-- Trackward Workout Logging App — Standalone super admin
-- Run this in the Supabase SQL editor AFTER team_approval_schema.sql, and
-- after running reset_all_data.sql + deleting all auth.users (this file
-- assumes an empty database — see its header for why order matters).
-- Safe to re-run.
--
-- Replaces profiles.is_super_admin with a completely separate super_admins
-- table. A super admin is no longer a kind of profile — they have NO row in
-- profiles, NO team_id, and their read access is narrowed to exactly: the
-- teams list (name/status/created_at), aggregate counts per team, and a
-- pending team's founder name/email for identification during approval.
-- Every previous RLS bypass that let is_super_admin() see into team-scoped
-- content (profiles, workouts, messages, conversations, events, comments,
-- assignments, team_settings) is removed below — is_super_admin() now only
-- appears in policies on teams itself, plus the two new narrowly-scoped RPCs.

-- ============================================================================
-- TABLE: super_admins — completely separate from profiles/teams.
-- ============================================================================

create table if not exists public.super_admins (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.super_admins enable row level security;

-- A user can only ever see whether *they themselves* have a row here — this
-- is also how the client determines "am I a super admin" at login. No
-- INSERT/UPDATE/DELETE policy exists on purpose: granting super admin status
-- is a manual, one-time SQL-editor action (see the bootstrap snippet at the
-- bottom of this file), never something reachable from the app itself.
drop policy if exists "super_admins_select_own" on public.super_admins;
create policy "super_admins_select_own"
  on public.super_admins for select
  using (id = auth.uid());

-- ============================================================================
-- profiles.is_super_admin is gone — the column no longer exists, and status
-- is now determined exclusively by presence in super_admins.
-- ============================================================================

alter table public.profiles drop column if exists is_super_admin;

-- ============================================================================
-- is_super_admin(): same name, same signature (nothing else has to change
-- for the few policies that legitimately keep using it), redefined against
-- the new table.
-- ============================================================================

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.super_admins where id = auth.uid());
$$;

-- ============================================================================
-- handle_new_user(): a signup with no team_id in its metadata no longer
-- fails the whole auth.users insert — it just leaves the account
-- profile-less instead. This is what makes it possible to create a pure
-- super-admin auth.users row (via the Supabase Dashboard, which doesn't go
-- through the app's signup metadata at all) without the trigger blocking it.
-- A profile-less account has zero privileges on its own — it only becomes a
-- super admin once a row is manually added to super_admins for it. Every
-- real signup path in the app (invite-link /signup, /create-team) always
-- supplies team_id, so this branch is never hit by normal usage.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_team_id uuid;
  team_status text;
  is_founding_coach boolean;
  assigned_role text;
begin
  signup_team_id := (new.raw_user_meta_data ->> 'team_id')::uuid;

  if signup_team_id is null then
    return new;
  end if;

  select status into team_status from public.teams where id = signup_team_id;
  if team_status is null then
    raise exception 'Invalid team';
  end if;

  is_founding_coach := team_status = 'pending' and not exists (
    select 1 from public.profiles where team_id = signup_team_id
  );

  assigned_role := case when is_founding_coach then 'coach' else 'pending' end;

  insert into public.profiles (id, name, role, team_id)
  values (new.id, new.raw_user_meta_data ->> 'name', assigned_role, signup_team_id);
  return new;
end;
$$;

-- ============================================================================
-- teams: approve/reject narrowed to a dedicated RPC instead of a general
-- UPDATE policy, so a super admin can only ever flip pending -> active or
-- pending -> rejected — never rename a team or touch any other column, and
-- never act on a team that isn't currently pending.
-- teams_select_own_or_super_admin (multi_tenancy_schema.sql) and
-- teams_insert_super_admin_only need no changes — is_super_admin() there
-- already correctly resolves against the new table, and both already match
-- "view all teams" / are otherwise unused by any current app flow.
-- ============================================================================

drop policy if exists "teams_update_super_admin_only" on public.teams;

create or replace function public.set_team_status(target_team_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can change a team''s status';
  end if;

  if new_status not in ('active', 'rejected') then
    raise exception 'Invalid status';
  end if;

  update public.teams set status = new_status where id = target_team_id and status = 'pending';

  if not found then
    raise exception 'Team not found or not pending';
  end if;
end;
$$;

grant execute on function public.set_team_status(uuid, text) to authenticated;

-- ============================================================================
-- RPC: get_pending_teams() — the founding coach's name/email, pulled
-- minimally and only for teams awaiting approval. auth.users.email isn't
-- reachable from the client directly (no anon/authenticated grant on the
-- auth schema); this SECURITY DEFINER function is the narrow, explicit
-- exception, gated to super admins and to exactly the two columns needed
-- for identification.
-- ============================================================================

create or replace function public.get_pending_teams()
returns table (
  team_id uuid,
  team_name text,
  created_at timestamptz,
  founder_name text,
  founder_email text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can view pending teams';
  end if;

  return query
  select
    t.id,
    t.name,
    t.created_at,
    p.name,
    u.email::text
  from public.teams t
  left join public.profiles p on p.team_id = t.id and p.role = 'coach'
  left join auth.users u on u.id = p.id
  where t.status = 'pending'
  order by t.created_at asc;
end;
$$;

grant execute on function public.get_pending_teams() to authenticated;

-- ============================================================================
-- get_team_stats(): still super-admin-only aggregate counts, but no longer
-- returns invite_code — a team's invite code is operational data a super
-- admin has no business seeing (it's the credential that lets someone join
-- that team), not "aggregate counts" or "identity for approval". Adds
-- status so the "all teams" list can show pending/active/rejected too.
-- ============================================================================

-- CREATE OR REPLACE can't change a function's return columns — the prior
-- version (multi_tenancy_super_admin_schema.sql) returned invite_code where
-- this one returns status instead, so the old one has to be dropped first.
drop function if exists public.get_team_stats();

create function public.get_team_stats()
returns table (
  team_id uuid,
  team_name text,
  status text,
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
    t.status,
    t.created_at,
    (select count(*) from public.profiles p where p.team_id = t.id and p.role = 'athlete'),
    (select count(*) from public.workouts w where w.team_id = t.id)
  from public.teams t
  order by t.created_at asc;
end;
$$;

-- ============================================================================
-- Strip the is_super_admin() bypass out of every team-scoped table's RLS.
-- Each policy below is otherwise byte-for-byte identical to
-- team_approval_schema.sql / multi_tenancy_rls_schema.sql — only the
-- `is_super_admin() or` branch is removed. is_admin() (the in-team,
-- read-only athletic-director role) is untouched and unrelated to this.
-- ============================================================================

drop policy if exists "profiles_select_own_or_coach" on public.profiles;
create policy "profiles_select_own_or_coach"
  on public.profiles for select
  using (
    id = auth.uid()
    or ((public.is_coach() or public.is_admin()) and team_id = public.current_team_id())
  );

drop policy if exists "profiles_update_coach_only" on public.profiles;
create policy "profiles_update_coach_only"
  on public.profiles for update
  using (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active')
  with check (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "profiles_select_conversation_participants" on public.profiles;
create policy "profiles_select_conversation_participants"
  on public.profiles for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.conversation_participants cp
      where cp.user_id = profiles.id
        and public.is_conversation_participant(cp.conversation_id)
    )
  );

drop policy if exists "workouts_select_own_or_coach" on public.workouts;
create policy "workouts_select_own_or_coach"
  on public.workouts for select
  using (
    (user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id())
    or ((public.is_coach() or public.is_admin()) and team_id = public.current_team_id())
  );

drop policy if exists "running_segments_select_own_or_coach" on public.running_segments;
create policy "running_segments_select_own_or_coach"
  on public.running_segments for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

drop policy if exists "running_segment_reps_select_own_or_coach" on public.running_segment_reps;
create policy "running_segment_reps_select_own_or_coach"
  on public.running_segment_reps for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

drop policy if exists "lifting_exercises_select_own_or_coach" on public.lifting_exercises;
create policy "lifting_exercises_select_own_or_coach"
  on public.lifting_exercises for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

drop policy if exists "workout_comments_select_owner_or_coach" on public.workout_comments;
create policy "workout_comments_select_owner_or_coach"
  on public.workout_comments for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id
        and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
    )
  );

drop policy if exists "assigned_workouts_select_own_or_coach" on public.assigned_workouts;
create policy "assigned_workouts_select_own_or_coach"
  on public.assigned_workouts for select
  using (
    team_id = public.current_team_id()
    and ((public.is_coach() or public.is_admin()) or (athlete_id = auth.uid() and public.is_athlete()))
  );

drop policy if exists "assigned_running_segments_select_own_or_coach" on public.assigned_running_segments;
create policy "assigned_running_segments_select_own_or_coach"
  on public.assigned_running_segments for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

drop policy if exists "assigned_lifting_targets_select_own_or_coach" on public.assigned_lifting_targets;
create policy "assigned_lifting_targets_select_own_or_coach"
  on public.assigned_lifting_targets for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  using (
    (team_id = public.current_team_id() and public.is_admin())
    or (
      public.is_conversation_participant(id)
      and (public.is_coach() or public.is_athlete())
      and team_id = public.current_team_id()
    )
  );

drop policy if exists "participants_select_own_conversations" on public.conversation_participants;
create policy "participants_select_own_conversations"
  on public.conversation_participants for select
  using (
    (team_id = public.current_team_id() and public.is_admin())
    or (
      public.is_conversation_participant(conversation_id)
      and (public.is_coach() or public.is_athlete())
      and team_id = public.current_team_id()
    )
  );

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select
  using (
    (team_id = public.current_team_id() and public.is_admin())
    or (
      public.is_conversation_participant(conversation_id)
      and (public.is_coach() or public.is_athlete())
      and team_id = public.current_team_id()
    )
  );

drop policy if exists "team_settings_select_own_team_or_super_admin" on public.team_settings;
drop policy if exists "team_settings_select_own_team" on public.team_settings;
create policy "team_settings_select_own_team"
  on public.team_settings for select
  using (team_id = public.current_team_id());

drop policy if exists "events_select_approved" on public.events;
create policy "events_select_approved"
  on public.events for select
  using (team_id = public.current_team_id() and (public.is_coach() or public.is_athlete() or public.is_admin()));

drop policy if exists "event_entries_select_approved" on public.event_entries;
create policy "event_entries_select_approved"
  on public.event_entries for select
  using (team_id = public.current_team_id() and (public.is_coach() or public.is_athlete() or public.is_admin()));

drop policy if exists "event_entry_athletes_select_approved" on public.event_entry_athletes;
create policy "event_entry_athletes_select_approved"
  on public.event_entry_athletes for select
  using (team_id = public.current_team_id() and (public.is_coach() or public.is_athlete() or public.is_admin()));

-- ============================================================================
-- ONE-TIME MANUAL STEP: create your super admin account.
--
-- 1. In the Supabase Dashboard: Authentication -> Users -> Add user, and
--    create an account with your email (set a password directly, or use
--    "send invite" so you set it yourself). Do NOT sign up through the app —
--    this account must never go through the normal team-scoped signup flow.
-- 2. Then run this (swap in the real email) to grant super admin status:
--
--   insert into public.super_admins (id, email)
--   select id, email from auth.users where email = 'you@example.com'
--   on conflict (id) do nothing;
--
-- ============================================================================
