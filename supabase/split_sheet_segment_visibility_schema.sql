-- Trackward Workout Logging App — Per-segment "hide from split sheet" flag
-- Run this in the Supabase SQL editor after every prior schema file.
--
-- Adds exclude_from_splits to every ASSIGNED (target) segment table only —
-- never the actuals-side tables, since this only ever controls whether the
-- Split Recorder builds a column for a segment, and Split Recorder derives
-- every athlete's columns purely from their own assignment (see
-- resolveAthlete() in src/components/SplitRecorder.jsx). Lets a coach mark
-- e.g. a warm-up segment as "don't show on split sheet" while a repeats
-- segment in the same assignment still gets columns — the flag has no
-- effect anywhere else an assignment is displayed (Grid, calendar,
-- WorkoutCard's Prescribed line all keep showing every segment).

alter table public.assigned_running_segments add column if not exists exclude_from_splits boolean not null default false;
alter table public.assigned_swim_segments add column if not exists exclude_from_splits boolean not null default false;
alter table public.assigned_bike_segments add column if not exists exclude_from_splits boolean not null default false;
alter table public.assigned_other_segments add column if not exists exclude_from_splits boolean not null default false;
