-- Trackward Workout Logging App — Backfill for meet results recorded before
-- lineup_race_assignments_schema.sql existed
-- Run this in the Supabase SQL editor after lineup_race_assignments_schema.sql.
--
-- A lineup entry/result created before that file was run never had
-- sync_lineup_assignment_segments() called for it (that only happens on
-- create/edit/delete of an event_entries row going forward) — so it has no
-- assigned_workout/segment at all, and its previously-recorded result is
-- still sitting in its own fully standalone workout, never linked via
-- assignment_id. That's exactly why it showed up fine in Logs (a plain
-- workouts-by-date/athlete query, unaffected by assignment linkage) but not
-- on the calendar (which matches a logged workout to an assignment via
-- workoutByAssignment[assignment.id] = workout — see EventCalendar.jsx).
--
-- Rewrites record_meet_result() (same signature again) so simply
-- re-recording/re-saving a result also self-heals this, with no separate
-- backfill script or manual SQL needed per athlete:
--
--   - Looks up the existing workout via event_entry_athletes.workout_id
--     FIRST — that's been the authoritative "does this athlete already
--     have a result" link since meet_results_schema.sql, and correctly
--     finds a workout recorded long before this file existed, unlike
--     assigned_running_segments.event_entry_id (only populated going
--     forward).
--   - If no assignment exists yet for this athlete/entry (the legacy gap
--     above), creates one now via sync_lineup_assignment_segments(),
--     seeded from the total distance of what's actually being saved
--     (same-unit segments summed, each accounting for its own rep count)
--     rather than needing the lineup entry to be separately re-saved.
--   - A workout whose source is 'meet_result' (every version of this
--     function's own dedicated workout, before or after this file) has
--     every one of its segments replaced wholesale, same as the original
--     behavior — and its assignment_id is backfilled if it wasn't set.
--   - A workout the athlete logged themselves keeps the narrower,
--     tag-or-distance-matched replace this project settled on for that
--     case (see lineup_race_assignments_schema.sql).
--
-- Net effect: an existing recorded result doesn't need any separate manual
-- fix — hitting "Save results" again for it (unchanged values are fine) is
-- enough to wire it up on the calendar/grid too. A lineup entry with
-- athletes but no recorded result yet needs nothing special either — the
-- very first result recorded for it already goes through this same path.

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
  v_total_seconds integer := 0;
  v_hours integer;
  v_minutes integer;
  v_seconds integer;
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
      set result_hours = 0, result_minutes = 0, result_seconds = 0, workout_id = null
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
      v_total_seconds := v_total_seconds + v_hours * 3600 + v_minutes * 60 + v_seconds;

      insert into public.running_segment_reps (segment_id, rep_number, time_hours, time_minutes, time_seconds)
        values (v_segment_id, v_rep_index, v_hours, v_minutes, v_seconds);
    end loop;
  end loop;

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
