-- Trackward Workout Logging App — Meet Lineup: Record Results
-- Run this in the Supabase SQL editor after event_entry_teams_schema.sql and
-- split_recorder_schema.sql (widens the same workouts.source marker column
-- split_recorder_schema.sql added).
--
-- Lets a coach record race-day results per lineup entry (see
-- event_entries_schema.sql), independently and in any order — events at a
-- real meet finish at different times throughout the day — with partial-
-- completion support, the same "save now, come back later" pattern as the
-- Split Recorder (split_recorder_schema.sql), but living on the Lineup page
-- and recording finished results rather than a live practice grid. This
-- never touches the Split Recorder's own tables/RPC at all.
--
-- Two kinds of result:
--   - An INDIVIDUAL result (a solo event, or one athlete's own relay leg
--     split, both entered the same way) creates/updates a real logged
--     `workouts` row for that athlete (type 'running', with as many
--     segments/reps as the coach actually has splits for — a relay leg is
--     always exactly one) via record_meet_result() below — the same "coach
--     writes into someone else's row" SECURITY DEFINER pattern
--     record_split_recorder_entry() already established, since RLS
--     otherwise only lets an athlete write their own workouts.
--   - A TEAM-level relay result (the whole squad's one finish time, not
--     attributed to any single athlete) is NOT a logged workout at all —
--     attributing an unsplit relay time to each individual athlete's
--     personal log wouldn't be accurate. It's stored on the new
--     event_entry_results table below and shown on the Lineup page only.
-- Both can coexist for the same relay squad (a coach may have a final team
-- time, individual leg splits, or both).

-- ============================================================================
-- workouts.source — widen the existing marker (added by
-- split_recorder_schema.sql) to also allow 'meet_result', same identity role:
-- lets record_meet_result() find its own previously-recorded entry to update
-- in place rather than guessing from name/date alone.
-- ============================================================================

alter table public.workouts drop constraint if exists workouts_source_check;
alter table public.workouts add constraint workouts_source_check
  check (source is null or source in ('split_recorder', 'meet_result'));

-- ============================================================================
-- event_entries.split_count — how many intervals a coach wants this race
-- broken into (null = no auto-splitting, the whole race is one segment).
-- Purely a seed for RecordResultsPanel's segment editor default — see
-- computeEvenSplitSegments() in src/lib/meetResults.js, which combines this
-- with the entry's own parsed event-name distance to build e.g. 1500m ÷ 4
-- -> 400m×3 + 300m, entirely client-side and recomputed fresh every time
-- rather than persisted as its own segment rows, so there's nothing here to
-- go stale if the entry's event name is ever edited later. Applies
-- identically to every athlete in the entry — not stored per-athlete —
-- since it's describing the race itself, not any one runner's result; an
-- athlete who already has a saved result keeps their own actual segments
-- regardless of this value (see initialSegments() in RecordResultsPanel.jsx).
-- ============================================================================

alter table public.event_entries add column if not exists split_count integer check (split_count is null or split_count >= 1);

-- ============================================================================
-- event_entry_athletes — per-athlete result + a link to the logged workout
-- it created, so re-opening Record Results finds and updates in place
-- instead of guessing or duplicating. This table already owns the (entry,
-- athlete) identity outright, so — unlike record_split_recorder_entry(),
-- which has to reconstruct that identity fuzzily from date/type/source —
-- an explicit FK here is simpler and exact. All-zero means "no result
-- recorded yet", the same convention TimeTextInput/formatRepTimesList
-- already use elsewhere for "nothing entered".
-- ============================================================================

alter table public.event_entry_athletes add column if not exists result_hours integer not null default 0 check (result_hours >= 0);
alter table public.event_entry_athletes add column if not exists result_minutes integer not null default 0 check (result_minutes between 0 and 59);
alter table public.event_entry_athletes add column if not exists result_seconds integer not null default 0 check (result_seconds between 0 and 59);
alter table public.event_entry_athletes add column if not exists workout_id uuid references public.workouts (id) on delete set null;

-- Known trade-off: if an athlete later edits/deletes this workout themselves
-- (nothing prevents that — a meet-recorded log is an ordinary log once
-- created, same as a Split Recorder one), a delete nulls workout_id via the
-- FK above but the result_hours/minutes/seconds left here go stale until the
-- coach re-records or clears it. Not solved here, same spirit as Split
-- Recorder's own documented edge cases around athlete-authored logs.

-- ============================================================================
-- event_entry_results — team-level relay result, one row per (entry, squad).
-- team_label matches event_entry_athletes.team_label (null for an entry with
-- only one, unlabeled squad — the common case). Coach-only, same read/write
-- shape as event_entries itself — this never touches another user's row, so
-- unlike the per-athlete path above it doesn't need a SECURITY DEFINER RPC,
-- a plain RLS-gated client upsert is enough.
--
-- team_label_key is a plain generated column duplicating coalesce(team_label,
-- '') as a real column PostgREST's upsert(onConflict:) can target — an
-- expression-based unique index isn't reliably resolvable there, the exact
-- same issue push_subscriptions hit with a jsonb expression index (see
-- push_notifications_schema.sql / CLAUDE.md's schema pitfalls).
-- ============================================================================

create table if not exists public.event_entry_results (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.event_entries (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  team_label text,
  team_label_key text generated always as (coalesce(team_label, '')) stored,
  result_hours integer not null default 0 check (result_hours >= 0),
  result_minutes integer not null default 0 check (result_minutes between 0 and 59),
  result_seconds integer not null default 0 check (result_seconds between 0 and 59),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, team_label_key)
);

create index if not exists event_entry_results_team_id_idx on public.event_entry_results (team_id);

create or replace function public.set_event_entry_result_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.event_entries where id = new.entry_id;
  return new;
end;
$$;
drop trigger if exists set_event_entry_result_team_id_trigger on public.event_entry_results;
create trigger set_event_entry_result_team_id_trigger
  before insert on public.event_entry_results
  for each row execute function public.set_event_entry_result_team_id();

alter table public.event_entry_results enable row level security;

drop policy if exists "event_entry_results_select_approved" on public.event_entry_results;
create policy "event_entry_results_select_approved"
  on public.event_entry_results for select
  using (team_id = public.current_team_id() and (public.is_coach() or public.is_athlete() or public.is_admin()));

drop policy if exists "event_entry_results_insert_coach_only" on public.event_entry_results;
create policy "event_entry_results_insert_coach_only"
  on public.event_entry_results for insert
  with check (
    public.is_coach()
    and team_id = public.current_team_id()
    and exists (select 1 from public.event_entries ee where ee.id = entry_id and ee.team_id = public.current_team_id())
  );

drop policy if exists "event_entry_results_update_coach_only" on public.event_entry_results;
create policy "event_entry_results_update_coach_only"
  on public.event_entry_results for update
  using (public.is_coach() and team_id = public.current_team_id())
  with check (public.is_coach() and team_id = public.current_team_id());

drop policy if exists "event_entry_results_delete_coach_only" on public.event_entry_results;
create policy "event_entry_results_delete_coach_only"
  on public.event_entry_results for delete
  using (public.is_coach() and team_id = public.current_team_id());

-- ============================================================================
-- record_meet_result — coach-only create/update/clear of one athlete's
-- individual meet result (a solo event, or one relay leg split, both go
-- through this same path). Takes a full segment/rep breakdown, not just one
-- flat time — a race is rarely timed as a single number; splits are usually
-- taken at intervals (every 400m, every 200m, an irregular tail segment
-- like "3x400 + 300"), the exact same shape this app already uses for a
-- logged running workout's own segments/reps (see running_segments_schema.sql
-- and SegmentEditor.jsx). A coach who doesn't have splits just submits one
-- segment with one rep, so this single path covers both cases — no separate
-- "simple" vs "detailed" RPC.
--
-- p_segments: jsonb array of
--   {"label": text|null, "distance_value": numeric, "distance_unit": text,
--    "rep_times": [{"hours":n,"minutes":n,"seconds":n}, ...]}
-- — mirrors record_split_recorder_entry()'s own p_segments exactly (see
-- split_recorder_schema.sql), except distance is resolved client-side by
-- src/lib/meetResults.js's parseEventDistance() rather than typed fresh by
-- the coach every time (it parses the lineup entry's own event name, e.g.
-- "800m" -> 800 meters, "4x400m Relay" -> 400 meters per leg; falls back to
-- a nominal 1 meter when the name doesn't parse, e.g. a field event like
-- "Long Jump" — a harmless quirk of the display machinery, not a lie about
-- the result, since the workout's own name still states the real event) and
-- the coach can then freely edit/expand into multiple segments.
--
-- Empty/null p_segments clears any existing result: deletes the linked
-- workout (if any) and resets event_entry_athletes back to "nothing
-- recorded". Unlike record_split_recorder_entry() (which raises an
-- exception on zero total reps, since a live-recording grid save is never
-- meant to *clear* an entry), this is the explicit "Clear" action's own
-- path here, so an empty submission is a legitimate, expected clear rather
-- than an error.
--
-- Also caches the segments' total time on event_entry_athletes.
-- result_hours/minutes/seconds — a fast "does this athlete have a result,
-- and what's the headline time" read without joining out to
-- workouts/running_segments/running_segment_reps every time the Record
-- Results view loads; the segments themselves remain the source of truth
-- for the actual per-interval breakdown.
--
-- Never sets workouts.total_distance/total_duration_seconds — leaving those
-- null makes src/utils/format.js's sumLoggedDistanceMiles()/
-- sumLoggedTimeSeconds() fall through to summing these segments/reps
-- directly, which is exactly correct and saves this function from having to
-- duplicate that math.
-- ============================================================================

drop function if exists public.record_meet_result(uuid, uuid, text, text, numeric, text, integer, integer, integer);
drop function if exists public.record_meet_result(uuid, uuid, text, text, jsonb);

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
  v_workout_id uuid;
  v_segment_id uuid;
  v_seg jsonb;
  v_rep jsonb;
  v_seg_index integer := -1;
  v_rep_index integer;
  v_total_seconds integer := 0;
  v_hours integer;
  v_minutes integer;
  v_seconds integer;
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

  select workout_id into v_workout_id
    from public.event_entry_athletes
    where entry_id = p_entry_id and athlete_id = p_athlete_id;

  if not found then
    raise exception 'Athlete is not entered in this event';
  end if;

  -- Clear: no valid segments left (the coach blanked the distance, or
  -- cleared the result entirely) removes any previously recorded result.
  if p_segments is null or jsonb_array_length(p_segments) = 0 then
    if v_workout_id is not null then
      delete from public.workouts where id = v_workout_id;
    end if;
    update public.event_entry_athletes
      set result_hours = 0, result_minutes = 0, result_seconds = 0, workout_id = null
      where entry_id = p_entry_id and athlete_id = p_athlete_id;
    return null;
  end if;

  if v_workout_id is not null then
    update public.workouts
      set date = v_event_date, name = p_name, notes = p_notes
      where id = v_workout_id;
    delete from public.running_segments where workout_id = v_workout_id;
  else
    insert into public.workouts (user_id, date, type, name, notes, source)
      values (p_athlete_id, v_event_date, 'running', p_name, p_notes, 'meet_result')
      returning id into v_workout_id;
  end if;

  for v_seg in select * from jsonb_array_elements(p_segments)
  loop
    v_seg_index := v_seg_index + 1;

    insert into public.running_segments (workout_id, order_index, label, distance_value, distance_unit, reps)
      values (
        v_workout_id,
        v_seg_index,
        nullif(v_seg ->> 'label', ''),
        (v_seg ->> 'distance_value')::numeric,
        v_seg ->> 'distance_unit',
        jsonb_array_length(v_seg -> 'rep_times')
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
