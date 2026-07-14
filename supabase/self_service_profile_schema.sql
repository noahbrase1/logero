-- Trackward Workout Logging App — Self-service profile editing
-- Run this in the Supabase SQL editor AFTER founding_coach_team_channel_fix.sql.
-- Safe to re-run.
--
-- There was previously no way for a non-coach user to update even their own
-- display name — profiles_update_coach_only only lets a coach update rows on
-- their own team, nothing lets a user update their own row. Rather than add
-- a general "id = auth.uid()" RLS policy (which can't restrict which
-- *columns* are touched — a client could smuggle a role/team_id change
-- through the same request), this is a narrow SECURITY DEFINER RPC that only
-- ever touches the name column, hardcoded to auth.uid(). Email and password
-- changes go through supabase-js's own auth.updateUser()/signInWithPassword()
-- client-side — those aren't `profiles` table writes at all, so they need no
-- SQL support here.

create or replace function public.update_own_name(new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set name = new_name where id = auth.uid();
end;
$$;

grant execute on function public.update_own_name(text) to authenticated;
