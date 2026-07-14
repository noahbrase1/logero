-- Trackward Workout Logging App — Running segments redesign
-- Run this in the Supabase SQL editor AFTER schema.sql, messaging_schema.sql,
-- and features_v2_schema.sql.
--
-- This replaces the old flat running_splits table with a segment/rep model
-- that supports interval workouts (e.g. "2mi warm-up, 3x1mi, 2x800m,
-- 4x400m"), each segment potentially in a different distance unit. There is
-- no production data yet, so this is a clean cut: the old table is dropped
-- rather than migrated.

-- ============================================================================
-- DROP OLD STRUCTURE
-- ============================================================================

drop table if exists public.running_splits cascade;

-- ============================================================================
-- NEW STRUCTURE
-- ============================================================================

create table public.running_segments (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  order_index integer not null default 0,
  label text,
  distance_value numeric not null check (distance_value > 0),
  distance_unit text not null check (distance_unit in ('meters', 'km', 'miles')),
  -- Canonical distance in meters, derived automatically from
  -- distance_value/distance_unit — always in sync, used for pace math and
  -- cross-unit comparison.
  distance_meters numeric generated always as (
    case distance_unit
      when 'meters' then distance_value
      when 'km' then distance_value * 1000
      when 'miles' then distance_value * 1609.344
    end
  ) stored,
  reps integer not null default 1 check (reps > 0)
);

create index running_segments_workout_id_idx on public.running_segments (workout_id, order_index);

create table public.running_segment_reps (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.running_segments (id) on delete cascade,
  rep_number integer not null,
  time_hours integer not null default 0 check (time_hours >= 0),
  time_minutes integer not null default 0 check (time_minutes between 0 and 59),
  time_seconds integer not null default 0 check (time_seconds between 0 and 59)
);

create index running_segment_reps_segment_id_idx on public.running_segment_reps (segment_id, rep_number);

-- Pace is derived (distance_meters / reps vs. each rep's time) and rendered
-- client-side, the same way the overall workout pace already is — not
-- stored, so it can never drift out of sync with the numbers it's based on.

-- ============================================================================
-- RLS: running_segments (ownership derived from parent workout, same pattern
-- the old running_splits table used)
-- ============================================================================

alter table public.running_segments enable row level security;

create policy "running_segments_select_own_or_coach"
  on public.running_segments for select
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and (w.user_id = auth.uid() or public.is_coach())
    )
  );

create policy "running_segments_insert_own_athlete"
  on public.running_segments for insert
  with check (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

create policy "running_segments_update_own_athlete"
  on public.running_segments for update
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

create policy "running_segments_delete_own_athlete"
  on public.running_segments for delete
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

-- ============================================================================
-- RLS: running_segment_reps (ownership derived from parent segment -> workout)
-- ============================================================================

alter table public.running_segment_reps enable row level security;

create policy "running_segment_reps_select_own_or_coach"
  on public.running_segment_reps for select
  using (
    exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and (w.user_id = auth.uid() or public.is_coach())
    )
  );

create policy "running_segment_reps_insert_own_athlete"
  on public.running_segment_reps for insert
  with check (
    exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

create policy "running_segment_reps_update_own_athlete"
  on public.running_segment_reps for update
  using (
    exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  )
  with check (
    exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

create policy "running_segment_reps_delete_own_athlete"
  on public.running_segment_reps for delete
  using (
    exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );
