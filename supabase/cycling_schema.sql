-- Trackward Workout Logging App — Cycling workout type
-- Run this in the Supabase SQL editor after swimming_schema.sql.
--
-- Adds `bike` as a workout type, reusing the same segment/rep architecture
-- as running and swim: bike_segments/bike_segment_reps mirror
-- running_segments/running_segment_reps, and assigned_bike_segments mirrors
-- assigned_running_segments/assigned_swim_segments. Two differences from
-- running/swim:
--   1. distance_unit is miles/km only (no meters/yards) — track cycling
--      distances aren't measured in track-length units.
--   2. bike_segment_reps has two OPTIONAL per-rep fields, avg_watts and
--      avg_cadence, for athletes with a power meter/cadence sensor. Neither
--      is required — both are nullable with no default, and no check beyond
--      "non-negative if present" so an athlete who doesn't track them can
--      leave them blank exactly like any other optional field in this app.
-- Like swim_segments, team_id is NOT NULL from creation (multi-tenancy
-- already existed when this file was written), not a later backfill.

-- ============================================================================
-- Allow the new type on workouts and assigned_workouts.
-- ============================================================================

do $$
declare
  existing_constraint text;
begin
  select conname into existing_constraint
  from pg_constraint
  where conrelid = 'public.workouts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%type%running%lifting%';

  if existing_constraint is not null then
    execute format('alter table public.workouts drop constraint %I', existing_constraint);
  end if;
end $$;

alter table public.workouts drop constraint if exists workouts_type_check;
alter table public.workouts add constraint workouts_type_check
  check (type in ('running', 'lifting', 'note', 'swim', 'bike'));

do $$
declare
  existing_constraint text;
begin
  select conname into existing_constraint
  from pg_constraint
  where conrelid = 'public.assigned_workouts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%type%running%lifting%';

  if existing_constraint is not null then
    execute format('alter table public.assigned_workouts drop constraint %I', existing_constraint);
  end if;
end $$;

alter table public.assigned_workouts drop constraint if exists assigned_workouts_type_check;
alter table public.assigned_workouts add constraint assigned_workouts_type_check
  check (type in ('running', 'lifting', 'swim', 'bike'));

-- ============================================================================
-- NEW STRUCTURE: bike_segments / bike_segment_reps
-- ============================================================================

create table public.bike_segments (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  order_index integer not null default 0,
  label text,
  distance_value numeric not null check (distance_value > 0),
  distance_unit text not null check (distance_unit in ('miles', 'km')),
  distance_meters numeric generated always as (
    case distance_unit
      when 'km' then distance_value * 1000
      when 'miles' then distance_value * 1609.344
    end
  ) stored,
  reps integer not null default 1 check (reps > 0)
);

create index bike_segments_workout_id_idx on public.bike_segments (workout_id, order_index);
create index bike_segments_team_id_idx on public.bike_segments (team_id);

create table public.bike_segment_reps (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.bike_segments (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  rep_number integer not null,
  time_hours integer not null default 0 check (time_hours >= 0),
  time_minutes integer not null default 0 check (time_minutes between 0 and 59),
  time_seconds integer not null default 0 check (time_seconds between 0 and 59),
  avg_watts integer check (avg_watts is null or avg_watts >= 0),
  avg_cadence integer check (avg_cadence is null or avg_cadence >= 0)
);

create index bike_segment_reps_segment_id_idx on public.bike_segment_reps (segment_id, rep_number);
create index bike_segment_reps_team_id_idx on public.bike_segment_reps (team_id);

create or replace function public.set_bike_segment_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;
drop trigger if exists set_bike_segment_team_id_trigger on public.bike_segments;
create trigger set_bike_segment_team_id_trigger
  before insert on public.bike_segments
  for each row execute function public.set_bike_segment_team_id();

create or replace function public.set_bike_segment_rep_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.bike_segments where id = new.segment_id;
  return new;
end;
$$;
drop trigger if exists set_bike_segment_rep_team_id_trigger on public.bike_segment_reps;
create trigger set_bike_segment_rep_team_id_trigger
  before insert on public.bike_segment_reps
  for each row execute function public.set_bike_segment_rep_team_id();

-- ============================================================================
-- RLS: bike_segments / bike_segment_reps — same shape as swim_segments /
-- swim_segment_reps (see swimming_schema.sql).
-- ============================================================================

alter table public.bike_segments enable row level security;

create policy "bike_segments_select_own_or_coach"
  on public.bike_segments for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

create policy "bike_segments_insert_own_athlete"
  on public.bike_segments for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

create policy "bike_segments_update_own_athlete"
  on public.bike_segments for update
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  )
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

create policy "bike_segments_delete_own_athlete"
  on public.bike_segments for delete
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

alter table public.bike_segment_reps enable row level security;

create policy "bike_segment_reps_select_own_or_coach"
  on public.bike_segment_reps for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.bike_segments bs
      join public.workouts w on w.id = bs.workout_id
      where bs.id = segment_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

create policy "bike_segment_reps_insert_own_athlete"
  on public.bike_segment_reps for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.bike_segments bs
      join public.workouts w on w.id = bs.workout_id
      where bs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

create policy "bike_segment_reps_update_own_athlete"
  on public.bike_segment_reps for update
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.bike_segments bs
      join public.workouts w on w.id = bs.workout_id
      where bs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  )
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.bike_segments bs
      join public.workouts w on w.id = bs.workout_id
      where bs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

create policy "bike_segment_reps_delete_own_athlete"
  on public.bike_segment_reps for delete
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.bike_segments bs
      join public.workouts w on w.id = bs.workout_id
      where bs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

-- ============================================================================
-- NEW STRUCTURE: assigned_bike_segments (mirrors assigned_swim_segments —
-- select + insert only; no target watts/cadence, since assignments carry a
-- single target time per segment the same way running/swim targets do, and
-- watts/cadence are actuals-only concepts here)
-- ============================================================================

create table public.assigned_bike_segments (
  id uuid primary key default gen_random_uuid(),
  assigned_workout_id uuid not null references public.assigned_workouts (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  order_index integer not null default 0,
  label text,
  distance_value numeric not null check (distance_value > 0),
  distance_unit text not null check (distance_unit in ('miles', 'km')),
  distance_meters numeric generated always as (
    case distance_unit
      when 'km' then distance_value * 1000
      when 'miles' then distance_value * 1609.344
    end
  ) stored,
  reps integer not null default 1 check (reps > 0),
  target_time_hours integer not null default 0 check (target_time_hours >= 0),
  target_time_minutes integer not null default 0 check (target_time_minutes between 0 and 59),
  target_time_seconds integer not null default 0 check (target_time_seconds between 0 and 59)
);

create index assigned_bike_segments_assignment_idx
  on public.assigned_bike_segments (assigned_workout_id, order_index);
create index assigned_bike_segments_team_id_idx on public.assigned_bike_segments (team_id);

create or replace function public.set_assigned_bike_segment_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_workouts where id = new.assigned_workout_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_bike_segment_team_id_trigger on public.assigned_bike_segments;
create trigger set_assigned_bike_segment_team_id_trigger
  before insert on public.assigned_bike_segments
  for each row execute function public.set_assigned_bike_segment_team_id();

alter table public.assigned_bike_segments enable row level security;

create policy "assigned_bike_segments_select_own_or_coach"
  on public.assigned_bike_segments for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

create policy "assigned_bike_segments_insert_coach_only"
  on public.assigned_bike_segments for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );
