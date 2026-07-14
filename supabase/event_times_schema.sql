-- Trackward Workout Logging App — Event start/end time
-- Run this in the Supabase SQL editor after cycling_schema.sql (the last
-- file to touch this database).
--
-- Adds optional start_time/end_time to events, alongside the existing date
-- column. Both are nullable — an event can be logged as all-day or
-- time-TBD with neither set, matching how event_entries.scheduled_time
-- already works (see event_entries_schema.sql). No RLS changes needed:
-- the existing coach-only insert/update policies on `events` already gate
-- the whole row, which now just has two more nullable columns on it.

alter table public.events add column if not exists start_time time;
alter table public.events add column if not exists end_time time;
