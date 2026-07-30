-- Trackward Workout Logging App — Split Recorder
-- Run this in the Supabase SQL editor after every prior schema file.
--
-- A coach previously had no write path into another athlete's `workouts`
-- row (or its child segment/rep tables) for any type but 'note' — every
-- other type is athlete-only per workouts_insert_own_athlete/
-- workouts_update_own_athlete (see multi_tenancy_rls_schema.sql /
-- team_approval_schema.sql). The Split Recorder tool needs a coach to log
-- times for many athletes at once (recording live splits during a
-- practice), so this adds one narrow SECURITY DEFINER RPC rather than
-- loosening RLS on workouts/segments/reps themselves — the same pattern
-- already used for remove_athlete()/reject_pending_profile() (a coach
-- privileged write into someone else's row that doesn't fit a column-level
-- RLS policy).
--
-- Handles running/swim/bike/other only (never lifting — "splits" has no
-- lifting analogue) via dynamic table names, since all four share the exact
-- same {type}_segments/{type}_segment_reps shape.

-- ============================================================================
-- workouts.source — a nullable marker so this RPC can find and update its
-- OWN previously-recorded entry (create-or-update-in-place, so a coach can
-- save partial progress and return later) without ever guessing based on
-- name/date alone, which could otherwise collide with and clobber an
-- athlete's own unrelated manually-logged workout that happens to share a
-- name. Never surfaced in the UI — purely an internal identity marker.
-- ============================================================================

alter table public.workouts add column if not exists source text;

alter table public.workouts drop constraint if exists workouts_source_check;
alter table public.workouts add constraint workouts_source_check
  check (source is null or source = 'split_recorder');

-- ============================================================================
-- record_split_recorder_entry — create-or-update one athlete's recorded-
-- splits log for a given day, across potentially several segments at once
-- (e.g. a 2mi warm-up + 4x400m + 4x200m all recorded in the same grid).
--
-- p_segments: jsonb array of
--   {"label": text|null, "distance_value": numeric, "distance_unit": text,
--    "rep_times": [{"hours":n,"minutes":n,"seconds":n}, ...]}
-- — each segment's rep_times already trimmed client-side to only the reps
-- the coach actually entered a time for (an athlete with 3 of 4 filled in
-- for one segment gets a 3-element rep_times there, not a 4-element one
-- with a gap), and a segment with nothing filled in at all is dropped
-- entirely rather than sent as an empty/zero-rep segment.
--
-- An explicit DROP is required (not just CREATE OR REPLACE) because this
-- replaces an earlier version of this function that took a single flat
-- distance/unit/rep_times shape — CREATE OR REPLACE can't change a
-- function's parameter list, it would just leave the old signature behind
-- as a second overload.
--
-- Identifies an existing split-recorder entry to update in place — rather
-- than create a duplicate — by (athlete, date, type, source =
-- 'split_recorder') plus matching assignment linkage; this is what lets the
-- coach re-open the recorder later and keep adding times before a final
-- save. If the athlete already has a DIFFERENT (non-recorder) workout
-- linked to the same assignment — e.g. they already logged it themselves —
-- this never overwrites that log; it saves the coach's recording as its own
-- standalone (unlinked) entry instead, so nothing athlete-authored is ever
-- silently clobbered.
--
-- Existing triggers (set_workout_team_id, validate_workout_assignment,
-- complete_assigned_workout) already fire correctly on the inserts/updates
-- this function performs, so team_id, assignment-athlete matching, and the
-- assignment's completed-status flip all just work without duplicating any
-- of that logic here.
-- ============================================================================

drop function if exists public.record_split_recorder_entry(uuid, date, text, text, numeric, text, uuid, jsonb);

create or replace function public.record_split_recorder_entry(
  p_athlete_id uuid,
  p_date date,
  p_type text,
  p_name text,
  p_assignment_id uuid,
  p_segments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete_team_id uuid;
  v_workout_id uuid;
  v_segment_id uuid;
  v_segments_table text;
  v_reps_table text;
  v_seg jsonb;
  v_rep jsonb;
  v_seg_index integer := -1;
  v_rep_index integer;
  v_total_reps integer := 0;
begin
  if not public.is_coach() then
    raise exception 'Only a coach can record splits';
  end if;

  if public.current_team_status() <> 'active' then
    raise exception 'Team is not active';
  end if;

  if p_type not in ('running', 'swim', 'bike', 'other') then
    raise exception 'Unsupported workout type for split recording: %', p_type;
  end if;

  select team_id into v_athlete_team_id from public.profiles where id = p_athlete_id;
  if v_athlete_team_id is null or v_athlete_team_id <> public.current_team_id() then
    raise exception 'Athlete not found on your team';
  end if;

  select coalesce(sum(jsonb_array_length(seg -> 'rep_times')), 0) into v_total_reps
    from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) seg;
  if v_total_reps = 0 then
    raise exception 'At least one split time is required';
  end if;

  -- Never double-link: if a non-recorder workout already fulfills this
  -- assignment for this athlete, save this recording as a standalone entry
  -- instead of contesting that link.
  if p_assignment_id is not null and exists (
    select 1 from public.workouts
    where assignment_id = p_assignment_id and user_id = p_athlete_id
      and coalesce(source, '') <> 'split_recorder'
  ) then
    p_assignment_id := null;
  end if;

  select id into v_workout_id
    from public.workouts
    where user_id = p_athlete_id and date = p_date and type = p_type and source = 'split_recorder'
      and (
        (p_assignment_id is not null and assignment_id = p_assignment_id)
        or (p_assignment_id is null and assignment_id is null)
      )
    order by created_at asc
    limit 1;

  v_segments_table := p_type || '_segments';
  v_reps_table := p_type || '_segment_reps';

  if v_workout_id is not null then
    update public.workouts
      set date = p_date, name = p_name, assignment_id = p_assignment_id, source = 'split_recorder'
      where id = v_workout_id;
    execute format('delete from public.%I where workout_id = $1', v_segments_table) using v_workout_id;
  else
    insert into public.workouts (user_id, date, type, name, assignment_id, source)
      values (p_athlete_id, p_date, p_type, p_name, p_assignment_id, 'split_recorder')
      returning id into v_workout_id;
  end if;

  for v_seg in select * from jsonb_array_elements(p_segments)
  loop
    v_seg_index := v_seg_index + 1;

    execute format(
      'insert into public.%I (workout_id, order_index, label, distance_value, distance_unit, reps) values ($1, $2, $3, $4, $5, $6) returning id',
      v_segments_table
    ) into v_segment_id using
      v_workout_id,
      v_seg_index,
      nullif(v_seg ->> 'label', ''),
      (v_seg ->> 'distance_value')::numeric,
      v_seg ->> 'distance_unit',
      jsonb_array_length(v_seg -> 'rep_times');

    v_rep_index := 0;
    for v_rep in select * from jsonb_array_elements(v_seg -> 'rep_times')
    loop
      v_rep_index := v_rep_index + 1;
      execute format(
        'insert into public.%I (segment_id, rep_number, time_hours, time_minutes, time_seconds) values ($1, $2, $3, $4, $5)',
        v_reps_table
      ) using v_segment_id, v_rep_index,
        coalesce((v_rep ->> 'hours')::int, 0),
        coalesce((v_rep ->> 'minutes')::int, 0),
        coalesce((v_rep ->> 'seconds')::int, 0);
    end loop;
  end loop;

  return v_workout_id;
end;
$$;

grant execute on function public.record_split_recorder_entry(uuid, date, text, text, uuid, jsonb) to authenticated;
