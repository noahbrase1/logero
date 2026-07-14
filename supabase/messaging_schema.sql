-- Trackward Workout Logging App — Messaging feature
-- Additive migration: run this in the Supabase SQL editor AFTER schema.sql.
-- Safe to re-run.

-- ============================================================================
-- TABLES
-- ============================================================================

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('team', 'direct')),
  created_at timestamptz not null default now()
);

-- Only one team conversation should ever exist.
create unique index if not exists conversations_single_team_idx
  on public.conversations ((type))
  where type = 'team';

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_participants_user_id_idx
  on public.conversation_participants (user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  content text not null check (char_length(trim(content)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

-- ============================================================================
-- BACKFILL: create the team conversation (if missing) and add every
-- currently-approved user (coach + athletes) as a participant.
-- ============================================================================

do $$
declare
  team_conv_id uuid;
begin
  select id into team_conv_id from public.conversations where type = 'team' limit 1;

  if team_conv_id is null then
    insert into public.conversations (type) values ('team') returning id into team_conv_id;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  select team_conv_id, id from public.profiles where role in ('athlete', 'coach')
  on conflict do nothing;
end $$;

-- ============================================================================
-- TRIGGER: whenever a profile transitions into an approved role (pending ->
-- athlete/coach), automatically add them to the team conversation.
-- ============================================================================

create or replace function public.add_user_to_team_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_conv_id uuid;
begin
  select id into team_conv_id from public.conversations where type = 'team' limit 1;

  if team_conv_id is not null then
    insert into public.conversation_participants (conversation_id, user_id)
    values (team_conv_id, new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_profile_approved_join_team on public.profiles;
create trigger on_profile_approved_join_team
  after update on public.profiles
  for each row
  when (old.role is distinct from new.role and new.role in ('athlete', 'coach'))
  execute function public.add_user_to_team_conversation();

-- ============================================================================
-- HELPER: is_conversation_participant() — security definer so it can check
-- conversation_participants without being blocked by (or recursing into)
-- the RLS policies defined below.
-- ============================================================================

create or replace function public.is_conversation_participant(conv_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = auth.uid()
  );
$$;

-- ============================================================================
-- RPC: get_or_create_direct_conversation() — the app's entry point for
-- starting a DM. Coach-only (enforced here, not just via RLS), and reuses
-- an existing direct conversation between the two users if one exists.
-- ============================================================================

create or replace function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only coaches can start direct conversations';
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

grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

-- ============================================================================
-- RLS: profiles (additional policy)
--
-- schema.sql only lets a user read their own profile row, or (if they're a
-- coach) everyone's. That means an athlete's client can't resolve the
-- coach's name when it nests `profiles(name)` onto conversation_participants
-- or messages — it comes back null, which is why the coach was showing up
-- as "Unknown" in the message list and "Unnamed athlete" in the sidebar.
-- This adds a second, permissive SELECT policy (policies for the same
-- command are OR'ed) so anyone can read the name of another user they share
-- at least one conversation with.
-- ============================================================================

drop policy if exists "profiles_select_conversation_participants" on public.profiles;
create policy "profiles_select_conversation_participants"
  on public.profiles for select
  using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.user_id = profiles.id
        and public.is_conversation_participant(cp.conversation_id)
    )
  );

-- ============================================================================
-- RLS: conversations
-- ============================================================================

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  using (public.is_conversation_participant(id));

-- Direct-table insert path (defense in depth; the app normally goes through
-- get_or_create_direct_conversation()). Only coaches, only direct type.
drop policy if exists "conversations_insert_coach_direct" on public.conversations;
create policy "conversations_insert_coach_direct"
  on public.conversations for insert
  with check (public.is_coach() and type = 'direct');

-- ============================================================================
-- RLS: conversation_participants
-- ============================================================================

alter table public.conversation_participants enable row level security;

drop policy if exists "participants_select_own_conversations" on public.conversation_participants;
create policy "participants_select_own_conversations"
  on public.conversation_participants for select
  using (public.is_conversation_participant(conversation_id));

drop policy if exists "participants_insert_coach_direct" on public.conversation_participants;
create policy "participants_insert_coach_direct"
  on public.conversation_participants for insert
  with check (
    public.is_coach()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.type = 'direct'
    )
  );

-- ============================================================================
-- RLS: messages
-- ============================================================================

alter table public.messages enable row level security;

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select
  using (public.is_conversation_participant(conversation_id));

drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
  );

-- ============================================================================
-- REALTIME: make sure the messages table streams postgres_changes.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
