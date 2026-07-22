-- Trackward Workout Logging App — allow coach<->coach direct messages
-- Additive migration: run this in the Supabase SQL editor AFTER
-- team_approval_schema.sql (depends on its version of
-- get_or_create_direct_conversation, which added team_id + team-status
-- checks on top of messaging_v2_schema.sql's original coach<->athlete-only
-- pairing rule) and messaging_v2_schema.sql (depends on its
-- participants_insert_direct policy). Safe to re-run.
--
-- Direct conversations were previously only allowed between a coach and an
-- athlete — athlete<->athlete and coach<->coach were both explicitly
-- rejected. A team with more than one coach had no way for those coaches to
-- message each other one-on-one (only the shared team channel). This file
-- widens the allowed pairing to also include coach<->coach, while still
-- rejecting athlete<->athlete.

-- ============================================================================
-- get_or_create_direct_conversation(): same body as team_approval_schema.sql's
-- version, just with the role-pairing check widened.
-- ============================================================================

create or replace function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
  caller_role text;
  caller_team_id uuid;
  other_role text;
  other_team_id uuid;
begin
  select role, team_id into caller_role, caller_team_id from public.profiles where id = auth.uid();
  select role, team_id into other_role, other_team_id from public.profiles where id = other_user_id;

  if caller_role is null or other_role is null then
    raise exception 'User not found';
  end if;

  if caller_team_id is distinct from other_team_id then
    raise exception 'Direct conversations can only be started with someone on your own team';
  end if;

  if public.current_team_status() <> 'active' then
    raise exception 'Messaging is unavailable until your team is approved';
  end if;

  if not (
    (caller_role = 'coach' and other_role = 'athlete')
    or (caller_role = 'athlete' and other_role = 'coach')
    or (caller_role = 'coach' and other_role = 'coach')
  ) then
    raise exception 'Direct conversations are only allowed between a coach and an athlete, or between two coaches';
  end if;

  select cp1.conversation_id into conv_id
  from public.conversation_participants cp1
  join public.conversation_participants cp2 on cp2.conversation_id = cp1.conversation_id
  join public.conversations c on c.id = cp1.conversation_id
  where c.type = 'direct'
    and cp1.user_id = auth.uid()
    and cp2.user_id = other_user_id
  limit 1;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.conversations (type) values ('direct') returning id into conv_id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, auth.uid()), (conv_id, other_user_id);

  return conv_id;
end;
$$;

-- ============================================================================
-- participants_insert_direct: defense-in-depth direct-table insert path
-- (the app normally goes through the RPC above) — widened the same way.
-- ============================================================================

drop policy if exists "participants_insert_direct" on public.conversation_participants;
create policy "participants_insert_direct"
  on public.conversation_participants for insert
  with check (
    exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'direct')
    and (
      -- Always allowed to add yourself...
      user_id = auth.uid()
      -- ...and a coach can add a specific athlete or another coach, or an
      -- athlete a specific coach — but never athlete-athlete, even via
      -- direct table access.
      or (public.is_coach() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'athlete'))
      or (public.is_athlete() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'coach'))
      or (public.is_coach() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'coach'))
    )
  );
