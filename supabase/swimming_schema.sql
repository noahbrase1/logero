-- Trackward Workout Logging App — Swimming workout type
-- Run this in the Supabase SQL editor after standalone_super_admin_schema.sql
-- and team_approval_schema.sql (the last files to touch workouts/
-- assigned_workouts RLS and the running_segments table shape).
--
-- Adds `swim` as a workout type, reusing the exact segment/rep architecture
-- running_segments_schema.sql and assigned_running_segments_schema.sql
-- established: swim_segments/swim_segment_reps mirror running_segments/
-- running_segment_reps (distance_unit adds 'yards', the standard pool-length
-- unit, alongside meters/miles), and assigned_swim_segments mirrors
-- assigned_running_segments. Unlike those original tables (created before
-- multi-tenancy existed and back-filled with team_id later), these are new
-- tables created after multi-tenancy is already in place, so team_id is
-- NOT NULL with its trigger from the start rather than added in a later
-- migration.

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
  check (type in ('running', 'lifting', 'note', 'swim'));

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
  check (type in ('running', 'lifting', 'swim'));

-- ============================================================================
-- NEW STRUCTURE: swim_segments / swim_segment_reps
-- ============================================================================

create table public.swim_segments (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  order_index integer not null default 0,
  label text,
  distance_value numeric not null check (distance_value > 0),
  distance_unit text not null check (distance_unit in ('yards', 'meters', 'miles')),
  distance_meters numeric generated always as (
    case distance_unit
      when 'meters' then distance_value
      when 'yards' then distance_value * 0.9144
      when 'miles' then distance_value * 1609.344
    end
  ) stored,
  reps integer not null default 1 check (reps > 0)
);

create index swim_segments_workout_id_idx on public.swim_segments (workout_id, order_index);
create index swim_segments_team_id_idx on public.swim_segments (team_id);

create table public.swim_segment_reps (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.swim_segments (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  rep_number integer not null,
  time_hours integer not null default 0 check (time_hours >= 0),
  time_minutes integer not null default 0 check (time_minutes between 0 and 59),
  time_seconds integer not null default 0 check (time_seconds between 0 and 59)
);

create index swim_segment_reps_segment_id_idx on public.swim_segment_reps (segment_id, rep_number);
create index swim_segment_reps_team_id_idx on public.swim_segment_reps (team_id);

-- team_id is never trusted from the client — derived server-side from the
-- parent row, same pattern as set_running_segment_team_id() etc.

create or replace function public.set_swim_segment_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;
drop trigger if exists set_swim_segment_team_id_trigger on public.swim_segments;
create trigger set_swim_segment_team_id_trigger
  before insert on public.swim_segments
  for each row execute function public.set_swim_segment_team_id();

create or replace function public.set_swim_segment_rep_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.swim_segments where id = new.segment_id;
  return new;
end;
$$;
drop trigger if exists set_swim_segment_rep_team_id_trigger on public.swim_segment_reps;
create trigger set_swim_segment_rep_team_id_trigger
  before insert on public.swim_segment_reps
  for each row execute function public.set_swim_segment_rep_team_id();

-- ============================================================================
-- RLS: swim_segments / swim_segment_reps — byte-for-byte the same shape as
-- the current (post team-approval, post standalone-super-admin) policies on
-- running_segments / running_segment_reps: team-scoped, write-gated on
-- current_team_status() = 'active', coach/admin read every athlete's, no
-- super-admin bypass (super admins never see team-scoped tables at all).
-- ============================================================================

alter table public.swim_segments enable row level security;

create policy "swim_segments_select_own_or_coach"
  on public.swim_segments for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

create policy "swim_segments_insert_own_athlete"
  on public.swim_segments for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

create policy "swim_segments_update_own_athlete"
  on public.swim_segments for update
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

create policy "swim_segments_delete_own_athlete"
  on public.swim_segments for delete
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

alter table public.swim_segment_reps enable row level security;

create policy "swim_segment_reps_select_own_or_coach"
  on public.swim_segment_reps for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.swim_segments ss
      join public.workouts w on w.id = ss.workout_id
      where ss.id = segment_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

create policy "swim_segment_reps_insert_own_athlete"
  on public.swim_segment_reps for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.swim_segments ss
      join public.workouts w on w.id = ss.workout_id
      where ss.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

create policy "swim_segment_reps_update_own_athlete"
  on public.swim_segment_reps for update
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.swim_segments ss
      join public.workouts w on w.id = ss.workout_id
      where ss.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  )
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.swim_segments ss
      join public.workouts w on w.id = ss.workout_id
      where ss.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

create policy "swim_segment_reps_delete_own_athlete"
  on public.swim_segment_reps for delete
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.swim_segments ss
      join public.workouts w on w.id = ss.workout_id
      where ss.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

-- ============================================================================
-- NEW STRUCTURE: assigned_swim_segments (mirrors assigned_running_segments —
-- select + insert only; assignments have no edit/delete UI, same as running/
-- lifting targets)
-- ============================================================================

create table public.assigned_swim_segments (
  id uuid primary key default gen_random_uuid(),
  assigned_workout_id uuid not null references public.assigned_workouts (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  order_index integer not null default 0,
  label text,
  distance_value numeric not null check (distance_value > 0),
  distance_unit text not null check (distance_unit in ('yards', 'meters', 'miles')),
  distance_meters numeric generated always as (
    case distance_unit
      when 'meters' then distance_value
      when 'yards' then distance_value * 0.9144
      when 'miles' then distance_value * 1609.344
    end
  ) stored,
  reps integer not null default 1 check (reps > 0),
  target_time_hours integer not null default 0 check (target_time_hours >= 0),
  target_time_minutes integer not null default 0 check (target_time_minutes between 0 and 59),
  target_time_seconds integer not null default 0 check (target_time_seconds between 0 and 59)
);

create index assigned_swim_segments_assignment_idx
  on public.assigned_swim_segments (assigned_workout_id, order_index);
create index assigned_swim_segments_team_id_idx on public.assigned_swim_segments (team_id);

create or replace function public.set_assigned_swim_segment_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_workouts where id = new.assigned_workout_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_swim_segment_team_id_trigger on public.assigned_swim_segments;
create trigger set_assigned_swim_segment_team_id_trigger
  before insert on public.assigned_swim_segments
  for each row execute function public.set_assigned_swim_segment_team_id();

alter table public.assigned_swim_segments enable row level security;

create policy "assigned_swim_segments_select_own_or_coach"
  on public.assigned_swim_segments for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

create policy "assigned_swim_segments_insert_coach_only"
  on public.assigned_swim_segments for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );
