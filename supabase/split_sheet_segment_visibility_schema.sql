-- Trackward Workout Logging App — Per-segment "include on split sheet" flag
-- Run this in the Supabase SQL editor after every prior schema file.
--
-- Adds include_on_splits to every ASSIGNED (target) segment table only —
-- never the actuals-side tables, since this only ever controls whether the
-- Split Recorder builds a column for a segment, and Split Recorder derives
-- every athlete's columns purely from their own assignment (see
-- resolveAthlete() in src/components/SplitRecorder.jsx). Opt-in, defaulting
-- to false: a segment (e.g. a repeats set) only gets a column if the coach
-- explicitly checks "Include on split sheet" for it, so an assignment with
-- nothing checked at all simply has no split sheet for that athlete — same
-- as having no assignment. The flag has no effect anywhere else an
-- assignment is displayed (Grid, calendar, WorkoutCard's Prescribed line
-- all keep showing every segment regardless).

alter table public.assigned_running_segments add column if not exists include_on_splits boolean not null default false;
alter table public.assigned_swim_segments add column if not exists include_on_splits boolean not null default false;
alter table public.assigned_bike_segments add column if not exists include_on_splits boolean not null default false;
alter table public.assigned_other_segments add column if not exists include_on_splits boolean not null default false;
