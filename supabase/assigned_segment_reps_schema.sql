-- Trackward Workout Logging App — Per-rep target times for assigned segments
-- Run this in the Supabase SQL editor after assigned_running_segments_schema.sql,
-- swimming_schema.sql, and cycling_schema.sql (the files that created the
-- assigned_running_segments / assigned_swim_segments / assigned_bike_segments
-- tables this references).
--
-- Until now, an assigned segment's target_time_hours/minutes/seconds applied
-- uniformly to every rep of that segment (e.g. one target time shared across
-- all 4 reps of a "4x800m" assignment) — a coach had no way to prescribe a
-- different target per rep the way an athlete can already log a different
-- actual time per rep (see running_segment_reps/swim_segment_reps/
-- bike_segment_reps). These three new tables mirror that exact actuals-side
-- shape (segment_id, rep_number, target time) for the assigned side. The
-- segment-level target_time_* columns are left in place (unused going
-- forward once a segment has per-rep rows — see AssignedSegmentsEditor.jsx —
-- but harmless, and simplest to leave alone rather than a destructive drop
-- with no production data cost either way to keeping them).
--
-- Like swim_segments/assigned_swim_segments etc., these are new tables
-- created after multi-tenancy is already in place, so team_id is NOT NULL
-- with its trigger from the start.

create table public.assigned_running_segment_reps (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.assigned_running_segments (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  rep_number integer not null,
  target_time_hours integer not null default 0 check (target_time_hours >= 0),
  target_time_minutes integer not null default 0 check (target_time_minutes between 0 and 59),
  target_time_seconds integer not null default 0 check (target_time_seconds between 0 and 59)
);

create index assigned_running_segment_reps_segment_id_idx
  on public.assigned_running_segment_reps (segment_id, rep_number);
create index assigned_running_segment_reps_team_id_idx on public.assigned_running_segment_reps (team_id);

create table public.assigned_swim_segment_reps (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.assigned_swim_segments (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  rep_number integer not null,
  target_time_hours integer not null default 0 check (target_time_hours >= 0),
  target_time_minutes integer not null default 0 check (target_time_minutes between 0 and 59),
  target_time_seconds integer not null default 0 check (target_time_seconds between 0 and 59)
);

create index assigned_swim_segment_reps_segment_id_idx
  on public.assigned_swim_segment_reps (segment_id, rep_number);
create index assigned_swim_segment_reps_team_id_idx on public.assigned_swim_segment_reps (team_id);

create table public.assigned_bike_segment_reps (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.assigned_bike_segments (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  rep_number integer not null,
  target_time_hours integer not null default 0 check (target_time_hours >= 0),
  target_time_minutes integer not null default 0 check (target_time_minutes between 0 and 59),
  target_time_seconds integer not null default 0 check (target_time_seconds between 0 and 59)
  -- No target watts/cadence, same reasoning as assigned_bike_segments itself
  -- (see cycling_schema.sql): those are actuals-only fields.
);

create index assigned_bike_segment_reps_segment_id_idx
  on public.assigned_bike_segment_reps (segment_id, rep_number);
create index assigned_bike_segment_reps_team_id_idx on public.assigned_bike_segment_reps (team_id);

-- team_id is never trusted from the client — derived server-side from the
-- parent segment row, same pattern as set_swim_segment_rep_team_id() etc.

create or replace function public.set_assigned_running_segment_rep_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_running_segments where id = new.segment_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_running_segment_rep_team_id_trigger on public.assigned_running_segment_reps;
create trigger set_assigned_running_segment_rep_team_id_trigger
  before insert on public.assigned_running_segment_reps
  for each row execute function public.set_assigned_running_segment_rep_team_id();

create or replace function public.set_assigned_swim_segment_rep_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_swim_segments where id = new.segment_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_swim_segment_rep_team_id_trigger on public.assigned_swim_segment_reps;
create trigger set_assigned_swim_segment_rep_team_id_trigger
  before insert on public.assigned_swim_segment_reps
  for each row execute function public.set_assigned_swim_segment_rep_team_id();

create or replace function public.set_assigned_bike_segment_rep_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_bike_segments where id = new.segment_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_bike_segment_rep_team_id_trigger on public.assigned_bike_segment_reps;
create trigger set_assigned_bike_segment_rep_team_id_trigger
  before insert on public.assigned_bike_segment_reps
  for each row execute function public.set_assigned_bike_segment_rep_team_id();

-- ============================================================================
-- RLS: select + insert only — assignments have no edit/delete UI (an "edit"
-- is delete-the-assignment-then-recreate, same as every other assigned
-- child table), same shape as assigned_running_segments/assigned_swim_segments.
-- ============================================================================

alter table public.assigned_running_segment_reps enable row level security;

create policy "assigned_running_segment_reps_select_own_or_coach"
  on public.assigned_running_segment_reps for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_running_segments ars
      join public.assigned_workouts aw on aw.id = ars.assigned_workout_id
      where ars.id = segment_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

create policy "assigned_running_segment_reps_insert_coach_only"
  on public.assigned_running_segment_reps for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_running_segments ars
      join public.assigned_workouts aw on aw.id = ars.assigned_workout_id
      where ars.id = segment_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );

alter table public.assigned_swim_segment_reps enable row level security;

create policy "assigned_swim_segment_reps_select_own_or_coach"
  on public.assigned_swim_segment_reps for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_swim_segments ass
      join public.assigned_workouts aw on aw.id = ass.assigned_workout_id
      where ass.id = segment_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

create policy "assigned_swim_segment_reps_insert_coach_only"
  on public.assigned_swim_segment_reps for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_swim_segments ass
      join public.assigned_workouts aw on aw.id = ass.assigned_workout_id
      where ass.id = segment_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );

alter table public.assigned_bike_segment_reps enable row level security;

create policy "assigned_bike_segment_reps_select_own_or_coach"
  on public.assigned_bike_segment_reps for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_bike_segments abs2
      join public.assigned_workouts aw on aw.id = abs2.assigned_workout_id
      where abs2.id = segment_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

create policy "assigned_bike_segment_reps_insert_coach_only"
  on public.assigned_bike_segment_reps for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_bike_segments abs2
      join public.assigned_workouts aw on aw.id = abs2.assigned_workout_id
      where abs2.id = segment_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );
