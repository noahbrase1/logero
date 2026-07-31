-- Trackward Workout Logging App — Event categories
-- Run this in the Supabase SQL editor after blue_default_theme_schema.sql
-- (the last file to touch this database).
--
-- Adds a category to events (meet | team_event | other) so the calendar can
-- color-code each event's dot/badge distinctly from a plain workout — today
-- events have no type/category field at all, only assigned_workouts does.
-- Defaults every existing/new row to 'other' rather than requiring a value
-- up front, so this is safe to run against events created before this file
-- existed. No RLS changes needed: the existing coach-only insert/update
-- policies on `events` already gate the whole row, which now just has one
-- more constrained column on it.

alter table public.events add column if not exists category text not null default 'other';

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.events'::regclass
    and pg_get_constraintdef(oid) ilike '%category%';

  if constraint_name is not null then
    execute format('alter table public.events drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.events add constraint events_category_check
  check (category in ('meet', 'team_event', 'other'));
