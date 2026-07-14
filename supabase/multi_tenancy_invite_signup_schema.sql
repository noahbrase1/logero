-- Trackward Workout Logging App — Multi-tenancy, Stage 3: invite-based signup
-- Run this in the Supabase SQL editor AFTER multi_tenancy_rls_schema.sql.
-- Safe to re-run.
--
-- Adds the one new piece of surface signup needs: a way for an
-- unauthenticated visitor (following a team's invite link) to resolve an
-- invite_code to a team id/name *before* they have a session, without
-- exposing the rest of the teams table (invite_code itself, other teams,
-- etc). Everything else — team_id being NOT NULL on profiles, and
-- handle_new_user() requiring team_id in signup metadata — was already put
-- in place back in stage 1; this is what finally lets the client satisfy it.

create or replace function public.get_team_by_invite_code(code text)
returns table (id uuid, name text)
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.name
  from public.teams t
  where t.invite_code = lower(trim(code));
$$;

grant execute on function public.get_team_by_invite_code(text) to anon, authenticated;
