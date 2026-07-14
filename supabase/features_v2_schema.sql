-- Trackward Workout Logging App — Features v2
-- Additive migration: run this in the Supabase SQL editor AFTER schema.sql
-- and messaging_schema.sql. Built incrementally, one feature section at a
-- time — safe to re-run in full as sections are added.

-- ============================================================================
-- FEATURE 1: Team color theme
-- ============================================================================

create table if not exists public.team_settings (
  id uuid primary key default gen_random_uuid(),
  primary_color text not null default '#7c3aed',
  accent_color text not null default '#5b21b6',
  updated_at timestamptz not null default now()
);

-- Enforce a single row (same singleton trick used for the team conversation).
create unique index if not exists team_settings_singleton_idx
  on public.team_settings ((true));

insert into public.team_settings (primary_color, accent_color)
select '#7c3aed', '#5b21b6'
where not exists (select 1 from public.team_settings);

alter table public.team_settings enable row level security;

-- Anyone signed in can read the current theme (colors aren't sensitive, and
-- every approved role needs them to render the UI consistently).
drop policy if exists "team_settings_select_authenticated" on public.team_settings;
create policy "team_settings_select_authenticated"
  on public.team_settings for select
  using (auth.uid() is not null);

-- Only coaches can change it. No insert/delete policy — the single row is
-- created by the backfill above and only ever updated in place.
drop policy if exists "team_settings_update_coach_only" on public.team_settings;
create policy "team_settings_update_coach_only"
  on public.team_settings for update
  using (public.is_coach())
  with check (public.is_coach());

-- ============================================================================
-- FEATURE 2: Meet/event calendar
-- ============================================================================

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null,
  location text,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists events_date_idx on public.events (date);

alter table public.events enable row level security;

-- Every approved user (coach or athlete) can see the calendar.
drop policy if exists "events_select_approved" on public.events;
create policy "events_select_approved"
  on public.events for select
  using (public.is_coach() or public.is_athlete());

drop policy if exists "events_insert_coach_only" on public.events;
create policy "events_insert_coach_only"
  on public.events for insert
  with check (public.is_coach() and created_by = auth.uid());

drop policy if exists "events_update_coach_only" on public.events;
create policy "events_update_coach_only"
  on public.events for update
  using (public.is_coach())
  with check (public.is_coach());

drop policy if exists "events_delete_coach_only" on public.events;
create policy "events_delete_coach_only"
  on public.events for delete
  using (public.is_coach());

-- ============================================================================
-- FEATURE 3: Coach comments on individual workout logs
-- ============================================================================

create table if not exists public.workout_comments (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  coach_id uuid not null references public.profiles (id),
  comment text not null check (char_length(trim(comment)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists workout_comments_workout_id_idx on public.workout_comments (workout_id);

alter table public.workout_comments enable row level security;

-- Same visibility as the workout itself: the owning athlete or any coach.
drop policy if exists "workout_comments_select_owner_or_coach" on public.workout_comments;
create policy "workout_comments_select_owner_or_coach"
  on public.workout_comments for select
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and (w.user_id = auth.uid() or public.is_coach())
    )
  );

-- Only coaches can post. No update/delete policy for this first pass —
-- athletes can see but not remove coach comments, and edits aren't required yet.
drop policy if exists "workout_comments_insert_coach_only" on public.workout_comments;
create policy "workout_comments_insert_coach_only"
  on public.workout_comments for insert
  with check (coach_id = auth.uid() and public.is_coach());

-- ============================================================================
-- FEATURE 4: Coach-assigned workouts (target vs. actual)
-- ============================================================================

create table if not exists public.assigned_workouts (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id),
  athlete_id uuid not null references public.profiles (id),
  type text not null check (type in ('running', 'lifting')),
  date date not null,
  notes text,
  status text not null default 'assigned' check (status in ('assigned', 'completed')),
  created_at timestamptz not null default now()
);

create index if not exists assigned_workouts_athlete_id_idx on public.assigned_workouts (athlete_id, status);

-- Distances/durations use the same units as workouts.total_distance /
-- total_duration_seconds (miles, seconds) for direct target-vs-actual comparison.
create table if not exists public.assigned_running_targets (
  id uuid primary key default gen_random_uuid(),
  assigned_workout_id uuid not null references public.assigned_workouts (id) on delete cascade,
  target_distance numeric,
  target_duration_seconds integer
);

create table if not exists public.assigned_lifting_targets (
  id uuid primary key default gen_random_uuid(),
  assigned_workout_id uuid not null references public.assigned_workouts (id) on delete cascade,
  exercise_name text not null,
  target_sets integer,
  target_reps integer,
  target_weight numeric
);

create index if not exists assigned_running_targets_assignment_idx
  on public.assigned_running_targets (assigned_workout_id);
create index if not exists assigned_lifting_targets_assignment_idx
  on public.assigned_lifting_targets (assigned_workout_id);

-- Link a logged workout back to the assignment it fulfills. ON DELETE SET
-- NULL so deleting an assignment never deletes the athlete's actual log.
alter table public.workouts
  add column if not exists assignment_id uuid references public.assigned_workouts (id) on delete set null;

-- Before a workout is linked (on insert or when assignment_id changes),
-- confirm the assignment actually belongs to that same athlete — this runs
-- as the workout owner (athlete), so it can't be used to "complete" someone
-- else's assignment.
create or replace function public.validate_workout_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_athlete_id uuid;
begin
  if new.assignment_id is not null then
    select athlete_id into assignment_athlete_id
    from public.assigned_workouts
    where id = new.assignment_id;

    if assignment_athlete_id is null then
      raise exception 'Assignment not found';
    end if;

    if assignment_athlete_id <> new.user_id then
      raise exception 'Cannot link a workout to another athlete''s assignment';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_workout_assignment_validate on public.workouts;
create trigger on_workout_assignment_validate
  before insert or update of assignment_id on public.workouts
  for each row
  execute function public.validate_workout_assignment();

-- Once a workout is linked to an assignment, flip that assignment to completed.
create or replace function public.complete_assigned_workout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignment_id is not null then
    update public.assigned_workouts
    set status = 'completed'
    where id = new.assignment_id and athlete_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_workout_linked_to_assignment on public.workouts;
create trigger on_workout_linked_to_assignment
  after insert or update of assignment_id on public.workouts
  for each row
  when (new.assignment_id is not null)
  execute function public.complete_assigned_workout();

alter table public.assigned_workouts enable row level security;

drop policy if exists "assigned_workouts_select_own_or_coach" on public.assigned_workouts;
create policy "assigned_workouts_select_own_or_coach"
  on public.assigned_workouts for select
  using (public.is_coach() or athlete_id = auth.uid());

drop policy if exists "assigned_workouts_insert_coach_only" on public.assigned_workouts;
create policy "assigned_workouts_insert_coach_only"
  on public.assigned_workouts for insert
  with check (public.is_coach() and coach_id = auth.uid());

-- Kept for admin/cleanup use even though the first-pass UI doesn't expose
-- editing or deleting an assignment yet.
drop policy if exists "assigned_workouts_update_coach_only" on public.assigned_workouts;
create policy "assigned_workouts_update_coach_only"
  on public.assigned_workouts for update
  using (public.is_coach())
  with check (public.is_coach());

drop policy if exists "assigned_workouts_delete_coach_only" on public.assigned_workouts;
create policy "assigned_workouts_delete_coach_only"
  on public.assigned_workouts for delete
  using (public.is_coach());

alter table public.assigned_running_targets enable row level security;

drop policy if exists "assigned_running_targets_select_own_or_coach" on public.assigned_running_targets;
create policy "assigned_running_targets_select_own_or_coach"
  on public.assigned_running_targets for select
  using (
    exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and (public.is_coach() or aw.athlete_id = auth.uid())
    )
  );

drop policy if exists "assigned_running_targets_insert_coach_only" on public.assigned_running_targets;
create policy "assigned_running_targets_insert_coach_only"
  on public.assigned_running_targets for insert
  with check (
    exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach()
    )
  );

alter table public.assigned_lifting_targets enable row level security;

drop policy if exists "assigned_lifting_targets_select_own_or_coach" on public.assigned_lifting_targets;
create policy "assigned_lifting_targets_select_own_or_coach"
  on public.assigned_lifting_targets for select
  using (
    exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and (public.is_coach() or aw.athlete_id = auth.uid())
    )
  );

drop policy if exists "assigned_lifting_targets_insert_coach_only" on public.assigned_lifting_targets;
create policy "assigned_lifting_targets_insert_coach_only"
  on public.assigned_lifting_targets for insert
  with check (
    exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach()
    )
  );
