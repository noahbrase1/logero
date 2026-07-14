-- Trackward Workout Logging App
-- Run this entire file in the Supabase SQL editor (Project > SQL Editor > New query).
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS where possible.

-- ============================================================================
-- TABLES
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  role text not null default 'pending' check (role in ('pending', 'athlete', 'coach')),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  type text not null check (type in ('running', 'lifting')),
  name text not null,
  total_distance numeric,
  total_duration_seconds integer,
  perceived_effort integer check (perceived_effort between 1 and 10),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.running_splits (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  split_number integer not null,
  distance numeric,
  time_seconds integer
);

create table if not exists public.lifting_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_name text not null,
  sets integer,
  reps integer,
  weight numeric
);

create index if not exists workouts_user_id_date_idx on public.workouts (user_id, date desc);
create index if not exists running_splits_workout_id_idx on public.running_splits (workout_id);
create index if not exists lifting_exercises_workout_id_idx on public.lifting_exercises (workout_id);

-- ============================================================================
-- AUTO-CREATE PROFILE ON SIGNUP (always starts as 'pending' — client cannot
-- set its own role, since this trigger runs with elevated privileges and
-- ignores anything the client would try to pass for role/approved_by).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, new.raw_user_meta_data ->> 'name', 'pending');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- HELPER: is_coach() — security definer so it can read profiles.role without
-- being blocked by (or recursing into) the RLS policies defined below.
-- ============================================================================

create or replace function public.is_coach()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'coach'
  );
$$;

create or replace function public.is_athlete()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'athlete'
  );
$$;

-- ============================================================================
-- RLS: profiles
-- ============================================================================

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_or_coach" on public.profiles;
create policy "profiles_select_own_or_coach"
  on public.profiles for select
  using (id = auth.uid() or public.is_coach());

-- Only coaches can change roles / approve pending users. No client-side
-- insert policy exists on purpose — rows are created only by the trigger above.
drop policy if exists "profiles_update_coach_only" on public.profiles;
create policy "profiles_update_coach_only"
  on public.profiles for update
  using (public.is_coach())
  with check (public.is_coach());

-- ============================================================================
-- RLS: workouts
-- ============================================================================

alter table public.workouts enable row level security;

drop policy if exists "workouts_select_own_or_coach" on public.workouts;
create policy "workouts_select_own_or_coach"
  on public.workouts for select
  using (user_id = auth.uid() or public.is_coach());

drop policy if exists "workouts_insert_own_athlete" on public.workouts;
create policy "workouts_insert_own_athlete"
  on public.workouts for insert
  with check (user_id = auth.uid() and public.is_athlete());

drop policy if exists "workouts_update_own_athlete" on public.workouts;
create policy "workouts_update_own_athlete"
  on public.workouts for update
  using (user_id = auth.uid() and public.is_athlete())
  with check (user_id = auth.uid() and public.is_athlete());

drop policy if exists "workouts_delete_own_athlete" on public.workouts;
create policy "workouts_delete_own_athlete"
  on public.workouts for delete
  using (user_id = auth.uid() and public.is_athlete());

-- ============================================================================
-- RLS: running_splits (ownership derived from parent workout)
-- ============================================================================

alter table public.running_splits enable row level security;

drop policy if exists "running_splits_select_own_or_coach" on public.running_splits;
create policy "running_splits_select_own_or_coach"
  on public.running_splits for select
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and (w.user_id = auth.uid() or public.is_coach())
    )
  );

drop policy if exists "running_splits_insert_own_athlete" on public.running_splits;
create policy "running_splits_insert_own_athlete"
  on public.running_splits for insert
  with check (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

drop policy if exists "running_splits_update_own_athlete" on public.running_splits;
create policy "running_splits_update_own_athlete"
  on public.running_splits for update
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  )
  with check (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

drop policy if exists "running_splits_delete_own_athlete" on public.running_splits;
create policy "running_splits_delete_own_athlete"
  on public.running_splits for delete
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

-- ============================================================================
-- RLS: lifting_exercises (ownership derived from parent workout)
-- ============================================================================

alter table public.lifting_exercises enable row level security;

drop policy if exists "lifting_exercises_select_own_or_coach" on public.lifting_exercises;
create policy "lifting_exercises_select_own_or_coach"
  on public.lifting_exercises for select
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and (w.user_id = auth.uid() or public.is_coach())
    )
  );

drop policy if exists "lifting_exercises_insert_own_athlete" on public.lifting_exercises;
create policy "lifting_exercises_insert_own_athlete"
  on public.lifting_exercises for insert
  with check (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

drop policy if exists "lifting_exercises_update_own_athlete" on public.lifting_exercises;
create policy "lifting_exercises_update_own_athlete"
  on public.lifting_exercises for update
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  )
  with check (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

drop policy if exists "lifting_exercises_delete_own_athlete" on public.lifting_exercises;
create policy "lifting_exercises_delete_own_athlete"
  on public.lifting_exercises for delete
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

-- ============================================================================
-- ONE-TIME MANUAL STEP: designate your coach account.
-- Sign up through the app first (so the auth user + pending profile exist),
-- then run this (swap in the real email), which self-approves the coach:
--
--   update public.profiles
--   set role = 'coach', approved_by = id
--   where id = (select id from auth.users where email = 'coach@example.com');
--
-- ============================================================================
