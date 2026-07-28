-- Trackward Workout Logging App — remove weekly_goals
-- Run this in the Supabase SQL editor after weekly_goals_schema.sql.
--
-- Weekly mileage progress no longer uses a separately coach-set goal —
-- the "goal" the progress meters fill toward is now derived directly from
-- whatever the coach assigned that athlete that week (assigned_workouts +
-- its segment children), summed the same way the athlete calendar's day
-- cells already sum assigned distance. weekly_goals is fully unused by the
-- app now, so this drops it outright rather than leaving dead schema
-- around — see weekly_goals_schema.sql for what it originally did.

drop trigger if exists set_weekly_goal_team_id_trigger on public.weekly_goals;
drop function if exists public.set_weekly_goal_team_id();
drop table if exists public.weekly_goals;
