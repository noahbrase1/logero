-- Trackward Workout Logging App — Centisecond precision for splits/results
-- Run this in the Supabase SQL editor after every prior schema file.
--
-- Adds hundredths-of-a-second precision to the ACTUAL side of a rep time —
-- never the target/assigned side, which has no hundredths column and none
-- of this feature's stopwatch-driven use cases touch it — so a coach can
-- record "27.34" instead of just "27". This is what backs the new live
-- Stopwatch mode in both the Split Recorder (practice) and Record Results
-- (meet) tools: see src/utils/stopwatch.js for the tap-to-record math,
-- which is already exact to the millisecond internally and only needs
-- somewhere to actually store the hundredths it computes.
--
-- Every existing row defaults to 0 centiseconds, which is indistinguishable
-- from "no hundredths ever entered" — secondsToClock() (src/utils/format.js)
-- only renders a ".XX" suffix when centiseconds is actually nonzero, so
-- every pre-existing manually-typed time still displays exactly as before.

-- ============================================================================
-- time_centiseconds — one per rep-time column, on every ACTUAL segment-rep
-- table (never the assigned/target ones).
-- ============================================================================

alter table public.running_segment_reps add column if not exists time_centiseconds integer not null default 0 check (time_centiseconds between 0 and 99);
alter table public.swim_segment_reps add column if not exists time_centiseconds integer not null default 0 check (time_centiseconds between 0 and 99);
alter table public.bike_segment_reps add column if not exists time_centiseconds integer not null default 0 check (time_centiseconds between 0 and 99);
alter table public.other_segment_reps add column if not exists time_centiseconds integer not null default 0 check (time_centiseconds between 0 and 99);

-- ============================================================================
-- result_centiseconds — the same cached-total pattern result_hours/minutes/
-- seconds already use, on both a meet result's per-athlete cache
-- (event_entry_athletes) and a relay's team-level result
-- (event_entry_results).
-- ============================================================================

alter table public.event_entry_athletes add column if not exists result_centiseconds integer not null default 0 check (result_centiseconds between 0 and 99);
alter table public.event_entry_results add column if not exists result_centiseconds integer not null default 0 check (result_centiseconds between 0 and 99);

-- ============================================================================
-- record_split_recorder_entry — rewritten (same signature) purely to read/
-- write each rep's own `centiseconds` field alongside hours/minutes/seconds.
-- See split_recorder_schema.sql for everything else about this function,
-- none of which changes here.
-- ============================================================================

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
        'insert into public.%I (segment_id, rep_number, time_hours, time_minutes, time_seconds, time_centiseconds) values ($1, $2, $3, $4, $5, $6)',
        v_reps_table
      ) using v_segment_id, v_rep_index,
        coalesce((v_rep ->> 'hours')::int, 0),
        coalesce((v_rep ->> 'minutes')::int, 0),
        coalesce((v_rep ->> 'seconds')::int, 0),
        coalesce((v_rep ->> 'centiseconds')::int, 0);
    end loop;
  end loop;

  return v_workout_id;
end;
$$;

grant execute on function public.record_split_recorder_entry(uuid, date, text, text, uuid, jsonb) to authenticated;

-- ============================================================================
-- record_meet_result — rewritten again (same signature, layered on top of
-- lineup_race_assignment_backfill_schema.sql — every bit of that file's own
-- logic is unchanged here) purely to read/write each rep's own
-- `centiseconds` field, and to accumulate the cached per-athlete total in
-- centiseconds internally (v_total_centis, integer) rather than whole
-- seconds, so result_hours/minutes/seconds/centiseconds together are exact
-- instead of truncating a stopwatch-recorded fraction of a second.
-- ============================================================================

create or replace function public.record_meet_result(
  p_entry_id uuid,
  p_athlete_id uuid,
  p_name text,
  p_notes text,
  p_segments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_team_id uuid;
  v_event_date date;
  v_athlete_team_id uuid;
  v_assigned_workout_id uuid;
  v_target_distance_value numeric;
  v_target_distance_unit text;
  v_workout_id uuid;
  v_workout_source text;
  v_segment_id uuid;
  v_seg jsonb;
  v_rep jsonb;
  v_seg_index integer;
  v_rep_index integer;
  v_total_centis bigint := 0;
  v_hours integer;
  v_minutes integer;
  v_seconds integer;
  v_centiseconds integer;
  v_insert_at integer;
  v_new_count integer;
  v_remaining_segments integer;
  v_fallback_unit text;
  v_fallback_distance numeric;
begin
  if not public.is_coach() then
    raise exception 'Only a coach can record meet results';
  end if;

  if public.current_team_status() <> 'active' then
    raise exception 'Team is not active';
  end if;

  select ee.team_id, e.date into v_entry_team_id, v_event_date
    from public.event_entries ee
    join public.events e on e.id = ee.event_id
    where ee.id = p_entry_id;

  if v_entry_team_id is null or v_entry_team_id <> public.current_team_id() then
    raise exception 'Entry not found on your team';
  end if;

  select team_id into v_athlete_team_id from public.profiles where id = p_athlete_id;
  if v_athlete_team_id is null or v_athlete_team_id <> public.current_team_id() then
    raise exception 'Athlete not found on your team';
  end if;

  if not exists (select 1 from public.event_entry_athletes where entry_id = p_entry_id and athlete_id = p_athlete_id) then
    raise exception 'Athlete is not entered in this event';
  end if;

  select workout_id into v_workout_id
    from public.event_entry_athletes
    where entry_id = p_entry_id and athlete_id = p_athlete_id;

  if v_workout_id is not null then
    select source into v_workout_source from public.workouts where id = v_workout_id;
  end if;

  select aw.id, s.distance_value, s.distance_unit
    into v_assigned_workout_id, v_target_distance_value, v_target_distance_unit
    from public.assigned_running_segments s
    join public.assigned_workouts aw on aw.id = s.assigned_workout_id
    where s.event_entry_id = p_entry_id and aw.athlete_id = p_athlete_id;

  -- Clear: remove this result. A workout that exists only to hold it
  -- (source = 'meet_result') has every segment dropped; the athlete's own
  -- workout only loses the segment(s) tagged as belonging to this entry.
  if p_segments is null or jsonb_array_length(p_segments) = 0 then
    if v_workout_id is not null then
      if v_workout_source = 'meet_result' then
        delete from public.running_segments where workout_id = v_workout_id;
      else
        delete from public.running_segments where workout_id = v_workout_id and event_entry_id = p_entry_id;
      end if;
      select count(*) into v_remaining_segments from public.running_segments where workout_id = v_workout_id;
      if v_remaining_segments = 0 then
        delete from public.workouts where id = v_workout_id;
      else
        update public.workouts set total_distance = null, total_duration_seconds = null where id = v_workout_id;
      end if;
    end if;
    update public.event_entry_athletes
      set result_hours = 0, result_minutes = 0, result_seconds = 0, result_centiseconds = 0, workout_id = null
      where entry_id = p_entry_id and athlete_id = p_athlete_id;
    return null;
  end if;

  -- Legacy gap: this athlete was entered before lineup_race_assignments_
  -- schema.sql existed (or before this entry was last saved), so
  -- sync_lineup_assignment_segments() never ran for them and there's no
  -- assignment to link this result to yet. Create one now, seeded from the
  -- total distance of what's actually being saved (same-unit segments
  -- summed, each times its own rep count) — a long-past result gets fully
  -- wired up the moment it's next saved, with nothing else required.
  if v_assigned_workout_id is null then
    v_fallback_unit := p_segments -> 0 ->> 'distance_unit';
    select coalesce(sum((seg ->> 'distance_value')::numeric * greatest(jsonb_array_length(seg -> 'rep_times'), 1)), 0)
      into v_fallback_distance
      from jsonb_array_elements(p_segments) seg
      where seg ->> 'distance_unit' = v_fallback_unit;

    if v_fallback_distance > 0 then
      perform public.sync_lineup_assignment_segments(
        p_entry_id, v_event_date, v_fallback_distance, v_fallback_unit, p_name, array[p_athlete_id]
      );

      select aw.id, s.distance_value, s.distance_unit
        into v_assigned_workout_id, v_target_distance_value, v_target_distance_unit
        from public.assigned_running_segments s
        join public.assigned_workouts aw on aw.id = s.assigned_workout_id
        where s.event_entry_id = p_entry_id and aw.athlete_id = p_athlete_id;
    end if;
  end if;

  v_new_count := jsonb_array_length(p_segments);

  if v_workout_id is null then
    -- Nothing recorded for this athlete/entry at all yet — start a fresh
    -- workout, linked to the assignment from the very first result.
    insert into public.workouts (user_id, date, type, name, notes, source, assignment_id)
      values (p_athlete_id, v_event_date, 'running', p_name, p_notes, 'meet_result', v_assigned_workout_id)
      returning id into v_workout_id;
    v_insert_at := 0;
  elsif v_workout_source = 'meet_result' then
    -- A workout that exists ONLY to hold this result — whether it was
    -- created by this function before or after this file existed, every
    -- one of its segments belongs to this race, so replace them wholesale
    -- (same as every earlier version of this function), and backfill
    -- assignment_id if it was never set.
    delete from public.running_segments where workout_id = v_workout_id;
    update public.workouts
      set assignment_id = coalesce(assignment_id, v_assigned_workout_id)
      where id = v_workout_id;
    v_insert_at := 0;
  else
    -- The athlete's own workout (they logged it themselves, maybe with a
    -- warm-up added) — replace ONLY the segment(s) belonging to this race.
    select min(order_index) into v_insert_at
      from public.running_segments where workout_id = v_workout_id and event_entry_id = p_entry_id;
    delete from public.running_segments where workout_id = v_workout_id and event_entry_id = p_entry_id;

    if v_insert_at is null and v_target_distance_value is not null then
      select order_index into v_insert_at
        from public.running_segments
        where workout_id = v_workout_id and event_entry_id is null
          and distance_value = v_target_distance_value and distance_unit = v_target_distance_unit
        order by order_index asc
        limit 1;
      if v_insert_at is not null then
        delete from public.running_segments
          where workout_id = v_workout_id and event_entry_id is null
            and distance_value = v_target_distance_value and distance_unit = v_target_distance_unit
            and order_index = v_insert_at;
      end if;
    end if;

    if v_insert_at is null then
      select coalesce(max(order_index) + 1, 0) into v_insert_at
        from public.running_segments where workout_id = v_workout_id;
    else
      update public.running_segments
        set order_index = order_index + (v_new_count - 1)
        where workout_id = v_workout_id and order_index >= v_insert_at;
    end if;

    update public.workouts
      set name = coalesce(nullif(name, ''), p_name),
          notes = coalesce(nullif(notes, ''), p_notes),
          assignment_id = coalesce(assignment_id, v_assigned_workout_id)
      where id = v_workout_id;
  end if;

  v_seg_index := v_insert_at - 1;
  for v_seg in select * from jsonb_array_elements(p_segments)
  loop
    v_seg_index := v_seg_index + 1;

    insert into public.running_segments (workout_id, order_index, label, distance_value, distance_unit, reps, event_entry_id)
      values (
        v_workout_id,
        v_seg_index,
        nullif(v_seg ->> 'label', ''),
        (v_seg ->> 'distance_value')::numeric,
        v_seg ->> 'distance_unit',
        jsonb_array_length(v_seg -> 'rep_times'),
        p_entry_id
      )
      returning id into v_segment_id;

    v_rep_index := 0;
    for v_rep in select * from jsonb_array_elements(v_seg -> 'rep_times')
    loop
      v_rep_index := v_rep_index + 1;
      v_hours := coalesce((v_rep ->> 'hours')::int, 0);
      v_minutes := coalesce((v_rep ->> 'minutes')::int, 0);
      v_seconds := coalesce((v_rep ->> 'seconds')::int, 0);
      v_centiseconds := coalesce((v_rep ->> 'centiseconds')::int, 0);
      v_total_centis := v_total_centis + v_hours * 360000::bigint + v_minutes * 6000 + v_seconds * 100 + v_centiseconds;

      insert into public.running_segment_reps (segment_id, rep_number, time_hours, time_minutes, time_seconds, time_centiseconds)
        values (v_segment_id, v_rep_index, v_hours, v_minutes, v_seconds, v_centiseconds);
    end loop;
  end loop;

  update public.workouts set total_distance = null, total_duration_seconds = null where id = v_workout_id;

  update public.event_entry_athletes
    set result_hours = v_total_centis / 360000,
        result_minutes = (v_total_centis % 360000) / 6000,
        result_seconds = (v_total_centis % 6000) / 100,
        result_centiseconds = v_total_centis % 100,
        workout_id = v_workout_id
    where entry_id = p_entry_id and athlete_id = p_athlete_id;

  return v_workout_id;
end;
$$;

grant execute on function public.record_meet_result(uuid, uuid, text, text, jsonb) to authenticated;
