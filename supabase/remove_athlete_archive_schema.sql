-- Trackward Workout Logging App — Archive logs + delete messages on remove
-- Run this in the Supabase SQL editor AFTER self_service_profile_schema.sql.
-- Safe to re-run.
--
-- remove_athlete() previously only flipped the athlete's role to 'removed'
-- and dropped them from the team channel/group chat *participant* rows —
-- their actual messages stayed visible to everyone else, and any DM with a
-- coach was deliberately left untouched. This tightens that: their own
-- messages in the team channel and any group chats are deleted outright,
-- and any direct conversation(s) they had with a coach are deleted entirely
-- (cascading to that conversation's participant rows and messages via the
-- existing ON DELETE CASCADE foreign keys). Workout logs are untouched here
-- — they're preserved by design, just kept out of the active Team Logs feed
-- by a query-level filter (see the accompanying lib/workouts.js change),
-- not deleted or altered.

create or replace function public.remove_athlete(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_coach() then
    raise exception 'Only coaches can remove an athlete';
  end if;

  if public.current_team_status() <> 'active' then
    raise exception 'Roster changes are unavailable until your team is approved';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = target_id and role = 'athlete' and team_id = public.current_team_id()
  ) then
    raise exception 'Athlete not found or already removed';
  end if;

  update public.profiles set role = 'removed' where id = target_id;

  -- Their own messages in the team channel and any group chats — permanently
  -- deleted, not just hidden. Other participants' messages in those same
  -- conversations are untouched.
  delete from public.messages
  where sender_id = target_id
    and conversation_id in (select id from public.conversations where type in ('team', 'group'));

  -- Drop their participant rows in those same conversations.
  delete from public.conversation_participants
  where user_id = target_id
    and conversation_id in (select id from public.conversations where type in ('team', 'group'));

  -- Any direct conversation(s) with a coach — delete the conversation
  -- outright (not just the participant row), which cascades to its
  -- messages and remaining participant row automatically.
  delete from public.conversations
  where type = 'direct'
    and id in (
      select conversation_id from public.conversation_participants where user_id = target_id
    );
end;
$$;
