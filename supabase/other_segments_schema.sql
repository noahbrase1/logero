-- Trackward Workout Logging App — "Other" gets real distance/segments
-- Run this in the Supabase SQL editor after other_aerobic_schema.sql.
--
-- Upgrades "Other" from a duration-only type to the same segment/rep model
-- as running (other_segments/other_segment_reps mirror running_segments/
-- running_segment_reps; assigned_other_segments mirrors
-- assigned_running_segments), except distance_unit allows a wider set —
-- miles, meters, km, feet, yards — since cross-training activities span
-- more units than running does (a rower in meters, a sled push in feet).
--
-- This replaces the single-target-duration assigned_other_targets table
-- from other_aerobic_schema.sql outright (dropped below) — there's no
-- production data to migrate yet, same "clean cut" reasoning
-- running_segments_schema.sql used when it replaced running_splits.
--
-- The weekly progress view's "Other" goal now comes from the same
-- sumLoggedDistanceMiles/sumAssignedDistanceMiles path running/swim/bike
-- already use (see src/utils/format.js) rather than a separate minutes
-- total — no JS-side "minutes" concept for this category anymore.

-- ============================================================================
-- DROP the duration-only assigned_other_targets structure.
-- ============================================================================

drop trigger if exists set_assigned_other_target_team_id_trigger on public.assigned_other_targets;
drop function if exists public.set_assigned_other_target_team_id();
drop table if exists public.assigned_other_targets;

-- ============================================================================
-- NEW STRUCTURE: other_segments / other_segment_reps (mirrors bike_segments/
-- bike_segment_reps — team_id NOT NULL from creation, multi-tenancy already
-- exists).
-- ============================================================================

create table public.other_segments (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  order_index integer not null default 0,
  label text,
  distance_value numeric not null check (distance_value > 0),
  distance_unit text not null check (distance_unit in ('miles', 'meters', 'km', 'feet', 'yards')),
  distance_meters numeric generated always as (
    case distance_unit
      when 'meters' then distance_value
      when 'km' then distance_value * 1000
      when 'miles' then distance_value * 1609.344
      when 'feet' then distance_value * 0.3048
      when 'yards' then distance_value * 0.9144
    end
  ) stored,
  reps integer not null default 1 check (reps > 0)
);

create index other_segments_workout_id_idx on public.other_segments (workout_id, order_index);
create index other_segments_team_id_idx on public.other_segments (team_id);

create table public.other_segment_reps (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.other_segments (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  rep_number integer not null,
  time_hours integer not null default 0 check (time_hours >= 0),
  time_minutes integer not null default 0 check (time_minutes between 0 and 59),
  time_seconds integer not null default 0 check (time_seconds between 0 and 59)
);

create index other_segment_reps_segment_id_idx on public.other_segment_reps (segment_id, rep_number);
create index other_segment_reps_team_id_idx on public.other_segment_reps (team_id);

create or replace function public.set_other_segment_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;
drop trigger if exists set_other_segment_team_id_trigger on public.other_segments;
create trigger set_other_segment_team_id_trigger
  before insert on public.other_segments
  for each row execute function public.set_other_segment_team_id();

create or replace function public.set_other_segment_rep_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.other_segments where id = new.segment_id;
  return new;
end;
$$;
drop trigger if exists set_other_segment_rep_team_id_trigger on public.other_segment_reps;
create trigger set_other_segment_rep_team_id_trigger
  before insert on public.other_segment_reps
  for each row execute function public.set_other_segment_rep_team_id();

-- ============================================================================
-- RLS: other_segments / other_segment_reps — same shape as bike_segments /
-- bike_segment_reps.
-- ============================================================================

alter table public.other_segments enable row level security;

create policy "other_segments_select_own_or_coach"
  on public.other_segments for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

create policy "other_segments_insert_own_athlete"
  on public.other_segments for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

create policy "other_segments_update_own_athlete"
  on public.other_segments for update
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

create policy "other_segments_delete_own_athlete"
  on public.other_segments for delete
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

alter table public.other_segment_reps enable row level security;

create policy "other_segment_reps_select_own_or_coach"
  on public.other_segment_reps for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.other_segments os
      join public.workouts w on w.id = os.workout_id
      where os.id = segment_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

create policy "other_segment_reps_insert_own_athlete"
  on public.other_segment_reps for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.other_segments os
      join public.workouts w on w.id = os.workout_id
      where os.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

create policy "other_segment_reps_update_own_athlete"
  on public.other_segment_reps for update
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.other_segments os
      join public.workouts w on w.id = os.workout_id
      where os.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  )
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.other_segments os
      join public.workouts w on w.id = os.workout_id
      where os.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

create policy "other_segment_reps_delete_own_athlete"
  on public.other_segment_reps for delete
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.other_segments os
      join public.workouts w on w.id = os.workout_id
      where os.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

-- ============================================================================
-- NEW STRUCTURE: assigned_other_segments (mirrors assigned_bike_segments —
-- select + insert only; one target time per segment, applied per rep)
-- ============================================================================

create table public.assigned_other_segments (
  id uuid primary key default gen_random_uuid(),
  assigned_workout_id uuid not null references public.assigned_workouts (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  order_index integer not null default 0,
  label text,
  distance_value numeric not null check (distance_value > 0),
  distance_unit text not null check (distance_unit in ('miles', 'meters', 'km', 'feet', 'yards')),
  distance_meters numeric generated always as (
    case distance_unit
      when 'meters' then distance_value
      when 'km' then distance_value * 1000
      when 'miles' then distance_value * 1609.344
      when 'feet' then distance_value * 0.3048
      when 'yards' then distance_value * 0.9144
    end
  ) stored,
  reps integer not null default 1 check (reps > 0),
  target_time_hours integer not null default 0 check (target_time_hours >= 0),
  target_time_minutes integer not null default 0 check (target_time_minutes between 0 and 59),
  target_time_seconds integer not null default 0 check (target_time_seconds between 0 and 59)
);

create index assigned_other_segments_assignment_idx
  on public.assigned_other_segments (assigned_workout_id, order_index);
create index assigned_other_segments_team_id_idx on public.assigned_other_segments (team_id);

create or replace function public.set_assigned_other_segment_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_workouts where id = new.assigned_workout_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_other_segment_team_id_trigger on public.assigned_other_segments;
create trigger set_assigned_other_segment_team_id_trigger
  before insert on public.assigned_other_segments
  for each row execute function public.set_assigned_other_segment_team_id();

alter table public.assigned_other_segments enable row level security;

create policy "assigned_other_segments_select_own_or_coach"
  on public.assigned_other_segments for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

create policy "assigned_other_segments_insert_coach_only"
  on public.assigned_other_segments for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );
