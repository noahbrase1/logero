-- Trackward Workout Logging App — Relay sub-teams for meet lineup entries
-- Run this in the Supabase SQL editor after event_entries_schema.sql.
--
-- Lets a coach split one entry's athletes into labeled teams (e.g. "Team A"
-- / "Team B") when there are enough athletes for more than one relay squad
-- in the same event. Most entries (individual events, or a relay with only
-- one team) leave this null and just show a flat athlete list, unchanged
-- from before.

alter table public.event_entry_athletes add column if not exists team_label text;

-- No RLS change needed — the existing policies on event_entry_athletes
-- (everyone approved reads, only coaches write) already cover this column.
