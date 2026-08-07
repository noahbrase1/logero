-- Trackward Workout Logging App — Meet lineup entries become a real assigned segment
-- Run this in the Supabase SQL editor after meet_results_schema.sql and
-- assigned_segment_reps_schema.sql (every prior schema file, in order).
--
-- Previously, adding an athlete to a meet lineup entry (event_entries /
-- event_entry_athletes) was purely informational — it never touched
-- assigned_workouts at all, and recording an official result
-- (record_meet_result, see meet_results_schema.sql) always created a
-- separate, disconnected "Meet result" workout, even if the athlete had
-- already logged a normal practice (with a warm-up, etc.) that day.
--
-- This makes a lineup entry behave like any other coach assignment: adding
-- Mitch to the "1500m" lineup adds a 1500m segment to Mitch's existing
-- assigned workout for that day (creating one if he doesn't have one yet),
-- which shows up anywhere an assignment/workout already shows up (Grid,
-- calendar, Logs). The athlete or coach can then log it exactly like any
-- other workout — LogWorkoutForm already lets you add extra segments (a
-- warm-up) beyond whatever the assignment prefilled, no changes needed
-- there. When the coach later records official splits for that race, they
-- land in the SAME workout (replacing the athlete's own guess for that one
-- segment, per this team's own choice that official numbers win) instead
-- of creating a second, disconnected log.

-- ============================================================================
-- event_entry_id link columns — nullable, on both the TARGET segment
-- (assigned_running_segments) and the ACTUAL segment (running_segments).
-- Lets sync_lineup_assignment_segments() and record_meet_result() below
-- find/update/remove precisely the one segment that came from a given
-- lineup entry, without disturbing any other segment in the same
-- assignment/workout — including one a coach manually added, or one with
-- the exact same distance for an unrelated reason (a coincidence a plain
-- distance-match alone couldn't rule out).
-- ============================================================================

alter table public.assigned_running_segments add column if not exists event_entry_id uuid references public.event_entries (id) on delete set null;
alter table public.running_segments add column if not exists event_entry_id uuid references public.event_entries (id) on delete set null;

create index if not exists assigned_running_segments_event_entry_id_idx on public.assigned_running_segments (event_entry_id);
create index if not exists running_segments_event_entry_id_idx on public.running_segments (event_entry_id);

-- ============================================================================
-- sync_lineup_assignment_segments — coach-only, called whenever a lineup
-- entry's athlete list or event name is created/edited/deleted (see
-- createEventEntry/updateEventEntry/deleteEventEntry in src/lib/events.js).
--
-- For every athlete currently in p_athlete_ids: finds or creates their own
-- 'running' assigned_workout for the event's date, then inserts or updates
-- (matched by event_entry_id, never by distance alone) the one segment
-- that represents this race. For every athlete previously linked to this
-- entry but no longer in p_athlete_ids: removes just that segment, and —
-- if that leaves their assigned_workout completely empty across every
-- sport/lifting child table — removes the now-pointless empty assignment
-- too.
--
-- SECURITY DEFINER the same way record_split_recorder_entry()/
-- record_meet_result() already are: assigned_running_segments only has
-- SELECT + INSERT RLS policies for a coach (see CLAUDE.md's schema
-- pitfalls) — there is no UPDATE/DELETE policy a plain client call could
-- use to touch just one segment in place, so this has to run as a
-- privileged function instead of loosening RLS on the whole table.
--
-- p_distance_value/p_distance_unit/p_label are resolved client-side by the
-- same parseEventDistance() (src/lib/meetResults.js) already used to seed
-- RecordResultsPanel's own segment editor, so a lineup entry's assigned
-- segment and its eventual recorded result always agree on what distance
-- the race actually is.
-- ============================================================================

create or replace function public.sync_lineup_assignment_segments(
  p_entry_id uuid,
  p_event_date date,
  p_distance_value numeric,
  p_distance_unit text,
  p_label text,
  p_athlete_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_team_id uuid;
  v_rec record;
  v_athlete_id uuid;
  v_assigned_workout_id uuid;
  v_segment_id uuid;
  v_next_order integer;
  v_remaining_count integer;
begin
  if not public.is_coach() then
    raise exception 'Only a coach can manage lineup assignments';
  end if;

  if public.current_team_status() <> 'active' then
    raise exception 'Team is not active';
  end if;

  select team_id into v_entry_team_id from public.event_entries where id = p_entry_id;
  if v_entry_team_id is null or v_entry_team_id <> public.current_team_id() then
    raise exception 'Entry not found on your team';
  end if;

  -- Remove the linked segment for any athlete no longer in the entry, and
  -- clean up their assigned_workout entirely if that was the only thing on
  -- it (the common case: the assignment only ever existed to hold this
  -- race).
  for v_rec in
    select aw.athlete_id, aw.id as assigned_workout_id
    from public.assigned_running_segments s
    join public.assigned_workouts aw on aw.id = s.assigned_workout_id
    where s.event_entry_id = p_entry_id
      and not (aw.athlete_id = any (coalesce(p_athlete_ids, array[]::uuid[])))
  loop
    delete from public.assigned_running_segments
      where event_entry_id = p_entry_id and assigned_workout_id = v_rec.assigned_workout_id;

    select count(*) into v_remaining_count from (
      select id from public.assigned_running_segments where assigned_workout_id = v_rec.assigned_workout_id
      union all select id from public.assigned_swim_segments where assigned_workout_id = v_rec.assigned_workout_id
      union all select id from public.assigned_bike_segments where assigned_workout_id = v_rec.assigned_workout_id
      union all select id from public.assigned_other_segments where assigned_workout_id = v_rec.assigned_workout_id
      union all select id from public.assigned_lifting_targets where assigned_workout_id = v_rec.assigned_workout_id
    ) remaining;

    if v_remaining_count = 0 then
      delete from public.assigned_workouts where id = v_rec.assigned_workout_id;
    end if;
  end loop;

  -- Add or refresh the linked segment for every athlete currently entered.
  if p_athlete_ids is not null then
    foreach v_athlete_id in array p_athlete_ids
    loop
      if not exists (select 1 from public.profiles where id = v_athlete_id and team_id = public.current_team_id()) then
        raise exception 'Athlete not found on your team';
      end if;

      select aw.id into v_assigned_workout_id
        from public.assigned_workouts aw
        where aw.athlete_id = v_athlete_id and aw.date = p_event_date and aw.type = 'running'
        order by aw.created_at asc
        limit 1;

      if v_assigned_workout_id is null then
        insert into public.assigned_workouts (coach_id, athlete_id, type, date)
          values (auth.uid(), v_athlete_id, 'running', p_event_date)
          returning id into v_assigned_workout_id;
      end if;

      select id into v_segment_id
        from public.assigned_running_segments
        where assigned_workout_id = v_assigned_workout_id and event_entry_id = p_entry_id;

      if v_segment_id is not null then
        update public.assigned_running_segments
          set distance_value = p_distance_value, distance_unit = p_distance_unit, label = p_label
          where id = v_segment_id;
      else
        select coalesce(max(order_index) + 1, 0) into v_next_order
          from public.assigned_running_segments where assigned_workout_id = v_assigned_workout_id;

        insert into public.assigned_running_segments
            (assigned_workout_id, order_index, label, distance_value, distance_unit, reps, event_entry_id)
          values (v_assigned_workout_id, v_next_order, p_label, p_distance_value, p_distance_unit, 1, p_entry_id);
      end if;
    end loop;
  end if;
end;
$$;

grant execute on function public.sync_lineup_assignment_segments(uuid, date, numeric, text, text, uuid[]) to authenticated;

-- ============================================================================
-- record_meet_result — rewritten (same signature, CLAUDE.md's additive-only
-- rule is why this lives here instead of editing meet_results_schema.sql
-- directly). Previously this always created/updated a wholly separate
-- "Meet result" workout via event_entry_athletes.workout_id, never linked
-- to any assignment. Now it reuses the assigned_workout
-- sync_lineup_assignment_segments() already created for this athlete/entry,
-- and merges results into whatever workout already fulfills it:
--
--   - No logged workout yet for that assignment -> create one, linked via
--     assignment_id from the start (so Grid/calendar/weekly-mileage all see
--     it as fulfilled immediately, unlike before).
--   - A logged workout already exists (the athlete logged it themselves,
--     maybe with a warm-up added) -> replace ONLY the segment(s) belonging
--     to this race, tagged via event_entry_id: first, whatever this
--     function itself recorded last time (a re-record/correction — always
--     safe and idempotent); if there's no previous official record yet,
--     the athlete's own untagged guess for this exact race distance (this
--     team's own choice: official splits always win for that one segment,
--     everything else the athlete logged is untouched either way).
--
-- Clearing a result (empty p_segments) only removes this function's own
-- tagged segment(s) from the linked workout — never the whole workout,
-- unless that segment was the only thing in it.
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
  v_segment_id uuid;
  v_seg jsonb;
  v_rep jsonb;
  v_seg_index integer;
  v_rep_index integer;
  v_total_seconds integer := 0;
  v_hours integer;
  v_minutes integer;
  v_seconds integer;
  v_insert_at integer;
  v_new_count integer;
  v_remaining_segments integer;
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

  -- sync_lineup_assignment_segments() already created this athlete's
  -- assignment + target segment when they were added to the lineup — this
  -- is what lets the official result land in the same workout the athlete
  -- may have already logged, instead of a second disconnected entry.
  select aw.id, s.distance_value, s.distance_unit
    into v_assigned_workout_id, v_target_distance_value, v_target_distance_unit
    from public.assigned_running_segments s
    join public.assigned_workouts aw on aw.id = s.assigned_workout_id
    where s.event_entry_id = p_entry_id and aw.athlete_id = p_athlete_id;

  if v_assigned_workout_id is not null then
    select id into v_workout_id
      from public.workouts
      where assignment_id = v_assigned_workout_id and user_id = p_athlete_id
      order by created_at asc
      limit 1;
  end if;

  -- Clear: remove only this function's own tagged segment(s) from whatever
  -- workout it's in — never the athlete's own other segments, and never
  -- the whole workout unless this was the only thing left in it.
  if p_segments is null or jsonb_array_length(p_segments) = 0 then
    if v_workout_id is not null then
      delete from public.running_segments where workout_id = v_workout_id and event_entry_id = p_entry_id;
      select count(*) into v_remaining_segments from public.running_segments where workout_id = v_workout_id;
      if v_remaining_segments = 0 then
        delete from public.workouts where id = v_workout_id;
      else
        update public.workouts set total_distance = null, total_duration_seconds = null where id = v_workout_id;
      end if;
    end if;
    update public.event_entry_athletes
      set result_hours = 0, result_minutes = 0, result_seconds = 0, workout_id = null
      where entry_id = p_entry_id and athlete_id = p_athlete_id;
    return null;
  end if;

  v_new_count := jsonb_array_length(p_segments);

  if v_workout_id is null then
    -- Nothing logged for this assignment yet — start a fresh workout,
    -- linked to the assignment from the very first result (unlike the
    -- previous version of this function, which never linked one at all).
    insert into public.workouts (user_id, date, type, name, notes, source, assignment_id)
      values (p_athlete_id, v_event_date, 'running', p_name, p_notes, 'meet_result', v_assigned_workout_id)
      returning id into v_workout_id;
    v_insert_at := 0;
  else
    -- A re-record/correction: remove whatever this function itself put
    -- here last time. Always safe, always idempotent.
    select min(order_index) into v_insert_at
      from public.running_segments where workout_id = v_workout_id and event_entry_id = p_entry_id;
    delete from public.running_segments where workout_id = v_workout_id and event_entry_id = p_entry_id;

    -- First time only: the athlete may have already logged their own
    -- untagged guess for this exact race distance before any official
    -- result existed — official numbers replace it outright (this team's
    -- own choice), leaving everything else in the workout untouched.
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

    -- Never overwrite a name/notes the athlete already gave this workout —
    -- only fall back to the meet-result convention if they left it blank.
    update public.workouts
      set name = coalesce(nullif(name, ''), p_name), notes = coalesce(nullif(notes, ''), p_notes)
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
      v_total_seconds := v_total_seconds + v_hours * 3600 + v_minutes * 60 + v_seconds;

      insert into public.running_segment_reps (segment_id, rep_number, time_hours, time_minutes, time_seconds)
        values (v_segment_id, v_rep_index, v_hours, v_minutes, v_seconds);
    end loop;
  end loop;

  -- The workout's own precomputed total_distance/total_duration_seconds
  -- (set by LogWorkoutForm when an athlete logs it themselves) would go
  -- stale the moment this function changes its segments without
  -- recomputing them — nulling both here makes
  -- sumLoggedDistanceMiles()/sumLoggedTimeSeconds() (src/utils/format.js)
  -- fall back to deriving fresh from the live segment set, which is always
  -- correct and avoids re-deriving that same unit-conversion math here.
  update public.workouts set total_distance = null, total_duration_seconds = null where id = v_workout_id;

  update public.event_entry_athletes
    set result_hours = v_total_seconds / 3600,
        result_minutes = (v_total_seconds % 3600) / 60,
        result_seconds = v_total_seconds % 60,
        workout_id = v_workout_id
    where entry_id = p_entry_id and athlete_id = p_athlete_id;

  return v_workout_id;
end;
$$;

grant execute on function public.record_meet_result(uuid, uuid, text, text, jsonb) to authenticated;
