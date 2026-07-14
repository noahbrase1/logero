-- Trackward Workout Logging App — Messaging v2
-- Run this in the Supabase SQL editor after messaging_schema.sql (and the
-- other prior schema files). Built incrementally in three parts, matching
-- how the feature was requested — safe to re-run in full as sections are
-- added.

-- ============================================================================
-- PART 1: Athletes can also initiate a DM with the coach
--
-- Replaces get_or_create_direct_conversation() so either side of a valid
-- coach<->athlete pair can call it (still de-duplicates against an existing
-- conversation first). Athlete<->athlete is explicitly rejected.
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
  other_role text;
begin
  select role into caller_role from public.profiles where id = auth.uid();
  select role into other_role from public.profiles where id = other_user_id;

  if caller_role is null or other_role is null then
    raise exception 'User not found';
  end if;

  if not (
    (caller_role = 'coach' and other_role = 'athlete')
    or (caller_role = 'athlete' and other_role = 'coach')
  ) then
    raise exception 'Direct conversations are only allowed between a coach and an athlete';
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

-- Direct-table insert paths (defense in depth; the app normally goes
-- through get_or_create_direct_conversation()). Replaces the old
-- coach-only versions with pairing-aware ones.

drop policy if exists "conversations_insert_coach_direct" on public.conversations;
drop policy if exists "conversations_insert_direct" on public.conversations;
create policy "conversations_insert_direct"
  on public.conversations for insert
  with check (type = 'direct' and (public.is_coach() or public.is_athlete()));

drop policy if exists "participants_insert_coach_direct" on public.conversation_participants;
drop policy if exists "participants_insert_direct" on public.conversation_participants;
create policy "participants_insert_direct"
  on public.conversation_participants for insert
  with check (
    exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'direct')
    and (
      -- Always allowed to add yourself...
      user_id = auth.uid()
      -- ...and a coach can add a specific athlete, or an athlete a specific
      -- coach, but never same-role pairs (blocks athlete-athlete DMs even
      -- via direct table access).
      or (public.is_coach() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'athlete'))
      or (public.is_athlete() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'coach'))
    )
  );

-- ============================================================================
-- PART 2: Coach-created group chats
--
-- A new conversation type distinct from 'team' (everyone, one singleton)
-- and 'direct' (exactly one coach + one athlete). A group has a coach-chosen
-- name and a coach-chosen subset of athletes as members.
-- ============================================================================

alter table public.conversations add column if not exists name text;
alter table public.conversations add column if not exists created_by uuid references public.profiles (id);

-- Widen the type check constraint to include 'group'. Looked up by its
-- actual definition rather than assumed name, so this can't silently no-op
-- if Postgres named it something other than the default guess.
do $$
declare
  existing_constraint text;
begin
  select conname into existing_constraint
  from pg_constraint
  where conrelid = 'public.conversations'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%type%team%direct%';

  if existing_constraint is not null then
    execute format('alter table public.conversations drop constraint %I', existing_constraint);
  end if;
end $$;

alter table public.conversations drop constraint if exists conversations_type_check;
alter table public.conversations add constraint conversations_type_check
  check (type in ('team', 'direct', 'group'));

-- Only coaches can create a group (and only coaches can create 'direct'
-- rows too, per Part 1 above — this just adds the group branch).
drop policy if exists "conversations_insert_direct" on public.conversations;
drop policy if exists "conversations_insert_direct_or_group" on public.conversations;
create policy "conversations_insert_direct_or_group"
  on public.conversations for insert
  with check (
    (type = 'direct' and (public.is_coach() or public.is_athlete()))
    or (type = 'group' and public.is_coach())
  );

-- Rename / delete a group (used by Part 3's management controls, added here
-- since they're the same "is this a group and am I a coach" shape).
drop policy if exists "conversations_update_coach_group" on public.conversations;
create policy "conversations_update_coach_group"
  on public.conversations for update
  using (public.is_coach() and type = 'group')
  with check (public.is_coach() and type = 'group');

drop policy if exists "conversations_delete_coach_group" on public.conversations;
create policy "conversations_delete_coach_group"
  on public.conversations for delete
  using (public.is_coach() and type = 'group');

-- Coaches add participants when creating a group (and later, per Part 3,
-- when adding more athletes).
drop policy if exists "participants_insert_coach_group" on public.conversation_participants;
create policy "participants_insert_coach_group"
  on public.conversation_participants for insert
  with check (
    public.is_coach()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'group')
  );

-- Coaches remove a specific athlete from a group without deleting the whole
-- conversation (Part 3). Deleting the group itself cascades and doesn't need
-- this policy — it only covers removing one participant at a time.
drop policy if exists "participants_delete_coach_group" on public.conversation_participants;
create policy "participants_delete_coach_group"
  on public.conversation_participants for delete
  using (
    public.is_coach()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'group')
  );

-- ============================================================================
-- FIX: create_group_conversation() RPC
--
-- The table-level policies above are correct and still used for adding more
-- athletes to an *existing* group later. But creating a brand-new group as a
-- sequence of plain client-side inserts hits a chicken-and-egg problem: the
-- policy that lets a coach insert into conversation_participants checks
-- `exists (select ... from conversations ...)`, and that subquery is itself
-- filtered by the conversations SELECT policy (is_conversation_participant),
-- which is false for everyone at the instant the group is created — nobody
-- is a participant yet. Same root cause almost bit the conversations insert
-- itself via RETURNING/select(), one step earlier in the sequence.
--
-- The DM flow never hit this because it runs entirely inside a SECURITY
-- DEFINER function, which bypasses RLS for its own internal work. Groups get
-- the same treatment here — everything happens with elevated privileges in
-- one atomic function call, and the coach-only check is enforced explicitly
-- instead of relying on table policies during creation.
-- ============================================================================

create or replace function public.create_group_conversation(group_name text, athlete_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
  athlete_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only coaches can create group conversations';
  end if;

  insert into public.conversations (type, name, created_by)
  values ('group', group_name, auth.uid())
  returning id into conv_id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, auth.uid());

  foreach athlete_id in array athlete_ids loop
    if exists (select 1 from public.profiles where id = athlete_id and role = 'athlete') then
      insert into public.conversation_participants (conversation_id, user_id)
      values (conv_id, athlete_id)
      on conflict do nothing;
    end if;
  end loop;

  return conv_id;
end;
$$;

grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;
