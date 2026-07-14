-- Trackward Workout Logging App — Assigned workouts, segment rework
-- Run this in the Supabase SQL editor AFTER schema.sql, messaging_schema.sql,
-- features_v2_schema.sql, and running_segments_schema.sql.
--
-- The assigned-workout feature still used the old flat
-- assigned_running_targets shape (one target_distance/target_duration per
-- assignment) from before running logs became segment-based. This replaces
-- it with a per-segment target table that mirrors running_segments, so a
-- coach can assign the same kind of multi-segment interval workout an
-- athlete would log (e.g. "2mi warm-up, 3x1mi, 2x800m, 4x400m"). No
-- production data yet, so this is a clean cut like the running_splits
-- migration was.

-- ============================================================================
-- DROP OLD STRUCTURE
-- ============================================================================

drop table if exists public.assigned_running_targets cascade;

-- ============================================================================
-- NEW STRUCTURE
-- ============================================================================

create table public.assigned_running_segments (
  id uuid primary key default gen_random_uuid(),
  assigned_workout_id uuid not null references public.assigned_workouts (id) on delete cascade,
  order_index integer not null default 0,
  label text,
  distance_value numeric not null check (distance_value > 0),
  distance_unit text not null check (distance_unit in ('meters', 'km', 'miles')),
  distance_meters numeric generated always as (
    case distance_unit
      when 'meters' then distance_value
      when 'km' then distance_value * 1000
      when 'miles' then distance_value * 1609.344
    end
  ) stored,
  reps integer not null default 1 check (reps > 0),
  -- One target time per segment (applies per rep), not per individual rep —
  -- these are targets, not actuals, so there's nothing to log per-rep yet.
  target_time_hours integer not null default 0 check (target_time_hours >= 0),
  target_time_minutes integer not null default 0 check (target_time_minutes between 0 and 59),
  target_time_seconds integer not null default 0 check (target_time_seconds between 0 and 59)
);

create index assigned_running_segments_assignment_idx
  on public.assigned_running_segments (assigned_workout_id, order_index);

alter table public.assigned_running_segments enable row level security;

create policy "assigned_running_segments_select_own_or_coach"
  on public.assigned_running_segments for select
  using (
    exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and (public.is_coach() or aw.athlete_id = auth.uid())
    )
  );

create policy "assigned_running_segments_insert_coach_only"
  on public.assigned_running_segments for insert
  with check (
    exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach()
    )
  );
