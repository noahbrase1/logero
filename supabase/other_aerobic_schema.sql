-- Trackward Workout Logging App — "Other Aerobic" workout type
-- Run this in the Supabase SQL editor after remove_weekly_goals_schema.sql.
--
-- Adds `other` as a workout/assignment type for aerobic cross-training that
-- doesn't fit running/swim/bike's distance-based model (rowing, elliptical,
-- hiking, stairmaster, etc — incompatible units across activities). Unlike
-- the sport-specific types, this has NO segments/reps table at all — it's
-- deliberately the simplest type in the app:
--   - logged: just reuses workouts.name (the activity, e.g. "Rowing"),
--     workouts.total_duration_seconds (already exists, populated by
--     running today but nullable/unused by swim/bike/lifting/note), and
--     workouts.notes — no new columns needed on `workouts` at all.
--   - assigned: a new assigned_other_targets table holding a single target
--     duration per assignment (no segments/reps — there's only one value),
--     mirroring assigned_lifting_targets' shape/RLS but with exactly one
--     row per assignment rather than a list of exercises.
--
-- The weekly progress view's "Other Aerobic" goal is derived the same way
-- running/swim/bike's goals are (see weeklyMileage.js) — total assigned
-- target duration for the week, summed from assigned_other_targets, no
-- separate coach-set-goal table.

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
  check (type in ('running', 'lifting', 'note', 'swim', 'bike', 'other'));

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
  check (type in ('running', 'lifting', 'swim', 'bike', 'other'));

-- ============================================================================
-- NEW STRUCTURE: assigned_other_targets (mirrors assigned_lifting_targets —
-- select + insert only; exactly one target-duration row per assignment)
-- ============================================================================

create table public.assigned_other_targets (
  id uuid primary key default gen_random_uuid(),
  assigned_workout_id uuid not null references public.assigned_workouts (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  target_duration_hours integer not null default 0 check (target_duration_hours >= 0),
  target_duration_minutes integer not null default 0 check (target_duration_minutes between 0 and 59),
  target_duration_seconds integer not null default 0 check (target_duration_seconds between 0 and 59)
);

create index assigned_other_targets_assignment_idx on public.assigned_other_targets (assigned_workout_id);
create index assigned_other_targets_team_id_idx on public.assigned_other_targets (team_id);

create or replace function public.set_assigned_other_target_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_workouts where id = new.assigned_workout_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_other_target_team_id_trigger on public.assigned_other_targets;
create trigger set_assigned_other_target_team_id_trigger
  before insert on public.assigned_other_targets
  for each row execute function public.set_assigned_other_target_team_id();

alter table public.assigned_other_targets enable row level security;

create policy "assigned_other_targets_select_own_or_coach"
  on public.assigned_other_targets for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

create policy "assigned_other_targets_insert_coach_only"
  on public.assigned_other_targets for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );
