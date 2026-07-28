-- Trackward Workout Logging App — Weekly mileage goals
-- Run this in the Supabase SQL editor after cycling_schema.sql.
--
-- Adds weekly_goals: a coach-set, per-athlete, per-sport (running/swim/bike)
-- weekly distance target. Multiple rows can exist per (athlete_id, sport) —
-- each new goal is a new row dated by effective_date, so a goal change never
-- overwrites history; a past week's progress is always judged against
-- whatever goal_value was in effect on that week's Monday, not today's
-- goal_value. See src/utils/weeklyGoals.js for the "goal in effect for a
-- given week" lookup, computed client-side (this is a genuinely new
-- temporal-history pattern for this codebase — no existing SQL "as of"
-- query to reuse).
--
-- goal_unit is deliberately broader than any single sport's own
-- distance_unit constraint (miles/km/meters/yards) since one table serves
-- all three sports and a coach should be able to set a goal in whatever
-- unit is natural for that sport (e.g. yards for swim) — the app converts
-- to a single miles figure for display/comparison via goalValueToMiles()
-- in src/utils/format.js, mirroring how sumLoggedDistanceMiles() already
-- converts running/swim/bike down to one miles figure elsewhere in the app.
--
-- Unlike assigned_* child tables (select + insert only, no update/delete),
-- this table also has an UPDATE policy — but only ever exercised by the
-- app's same-day upsert path (onConflict: athlete_id,sport,effective_date),
-- which never backdates effective_date. History itself is still never
-- mutated or deleted.

create table if not exists public.weekly_goals (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles (id),
  team_id uuid not null references public.teams (id),
  sport text not null check (sport in ('running', 'swim', 'bike')),
  goal_value numeric not null default 0 check (goal_value >= 0),
  goal_unit text not null check (goal_unit in ('miles', 'km', 'meters', 'yards')),
  effective_date date not null,
  created_at timestamptz not null default now(),
  unique (athlete_id, sport, effective_date)
);

create index if not exists weekly_goals_athlete_sport_idx
  on public.weekly_goals (athlete_id, sport, effective_date desc);

create or replace function public.set_weekly_goal_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.profiles where id = new.athlete_id;
  return new;
end;
$$;
drop trigger if exists set_weekly_goal_team_id_trigger on public.weekly_goals;
create trigger set_weekly_goal_team_id_trigger
  before insert on public.weekly_goals
  for each row execute function public.set_weekly_goal_team_id();

alter table public.weekly_goals enable row level security;

create policy "weekly_goals_select_own_or_coach"
  on public.weekly_goals for select
  using (
    public.is_super_admin()
    or (
      team_id = public.current_team_id()
      and ((public.is_coach() or public.is_admin()) or (athlete_id = auth.uid() and public.is_athlete()))
    )
  );

create policy "weekly_goals_insert_coach_only"
  on public.weekly_goals for insert
  with check (
    public.is_coach()
    and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.profiles ath where ath.id = athlete_id and ath.team_id = public.current_team_id())
  );

create policy "weekly_goals_update_coach_only"
  on public.weekly_goals for update
  using (
    public.is_coach()
    and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
  )
  with check (
    public.is_coach()
    and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.profiles ath where ath.id = athlete_id and ath.team_id = public.current_team_id())
  );
