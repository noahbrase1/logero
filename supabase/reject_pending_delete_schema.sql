-- Trackward Workout Logging App — Rejecting a pending sign-up frees the email
-- Run this in the Supabase SQL editor AFTER remove_athlete_archive_schema.sql.
-- Safe to re-run.
--
-- Rejecting previously just flipped role to 'removed', reusing the same
-- soft-delete machinery as remove_athlete(). That leaves the auth.users row
-- in place, and Supabase enforces email uniqueness at the auth.users level
-- regardless of what profiles.role says — so the email stayed permanently
-- unusable for signup no matter what. A rejected pending user never had a
-- chance to create anything (no workouts, no messages — RLS requires
-- is_athlete()/is_coach() for all of that, and the team-channel auto-join
-- trigger never fires for role='pending'), so there's nothing to archive.
-- This deletes the account outright instead: profiles.id references
-- auth.users(id) on delete cascade, so deleting the auth.users row cleans
-- up the profiles row (and anything else, though there is nothing else)
-- automatically in one statement.

create or replace function public.reject_pending_profile(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_coach() then
    raise exception 'Only coaches can reject a pending sign-up';
  end if;

  if public.current_team_status() <> 'active' then
    raise exception 'Roster changes are unavailable until your team is approved';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = target_id and role = 'pending' and team_id = public.current_team_id()
  ) then
    raise exception 'Pending sign-up not found';
  end if;

  delete from auth.users where id = target_id;
end;
$$;

grant execute on function public.reject_pending_profile(uuid) to authenticated;
