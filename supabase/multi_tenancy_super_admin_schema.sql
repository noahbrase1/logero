-- Trackward Workout Logging App — Multi-tenancy, Stage 4: super-admin panel
-- Run this in the Supabase SQL editor AFTER multi_tenancy_invite_signup_schema.sql.
-- Safe to re-run.
--
-- Team *creation* needs no new SQL — a super admin can already
-- `insert into teams (name)` directly from the client: teams_insert_super_admin_only
-- (stage 1) covers the INSERT, teams_select_own_or_super_admin covers the
-- .select() on the way back, and on_team_created (also stage 1) already
-- auto-provisions the new team's team_settings row and team-channel
-- conversation. The one thing actually missing is a way to list every team
-- with basic stats in a single round trip, which is what this RPC is for.

create or replace function public.get_team_stats()
returns table (
  team_id uuid,
  team_name text,
  invite_code text,
  created_at timestamptz,
  athlete_count bigint,
  workout_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can view team stats';
  end if;

  return query
  select
    t.id,
    t.name,
    t.invite_code,
    t.created_at,
    (select count(*) from public.profiles p where p.team_id = t.id and p.role = 'athlete'),
    (select count(*) from public.workouts w where w.team_id = t.id)
  from public.teams t
  order by t.created_at asc;
end;
$$;

grant execute on function public.get_team_stats() to authenticated;
