-- Trackward Workout Logging App — Multi-tenancy, Stage 1: schema
-- Run this in the Supabase SQL editor AFTER remove_athlete_schema.sql (the
-- last file in the existing chain). Safe to re-run.
--
-- This is stage 1 of 4 for multi-team support:
--   1. schema — teams table, team_id columns, is_super_admin flag, admin role  (this file)
--   2. RLS policy updates across every existing table
--   3. invite-based signup flow
--   4. super-admin team-creation panel
--
-- IMPORTANT — data isolation is NOT enforced yet after this file alone.
-- Every existing RLS policy still only checks role (coach/athlete/etc), not
-- team_id. A coach in Team A can still read Team B's rows until stage 2
-- rewrites those policies. Don't treat this file as providing isolation on
-- its own.
--
-- IMPORTANT — this temporarily breaks the generic /signup page. profiles.team_id
-- becomes NOT NULL below, and handle_new_user() (redefined near the bottom of
-- this file) now requires a team_id in the signup metadata and raises an
-- exception if it's missing. The client doesn't send one yet — that's stage 3.
-- Don't create new accounts via the app until stage 3 ships; every profile
-- that already exists gets migrated into a bootstrap "My Team" below.

-- ============================================================================
-- TABLE: teams
-- ============================================================================

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- profiles: is_super_admin flag, team_id, widen role to include 'admin'
-- ============================================================================

alter table public.profiles add column if not exists is_super_admin boolean not null default false;
alter table public.profiles add column if not exists team_id uuid references public.teams (id);

do $$
declare
  existing_constraint text;
begin
  select conname into existing_constraint
  from pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%pending%athlete%coach%';

  if existing_constraint is not null then
    execute format('alter table public.profiles drop constraint %I', existing_constraint);
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'athlete', 'coach', 'admin', 'removed'));

-- ============================================================================
-- BACKFILL: bootstrap team for every pre-existing profile. Every profile —
-- including a super admin's own — belongs to exactly one team; is_super_admin
-- is a separate bypass flag layered on top, not a "no team" state. Keeping
-- team_id NOT NULL everywhere avoids threading a nullable special case
-- through every table and policy below and in stage 2.
-- ============================================================================

do $$
declare
  bootstrap_team_id uuid;
begin
  select id into bootstrap_team_id from public.teams where name = 'My Team' limit 1;

  if bootstrap_team_id is null then
    insert into public.teams (name) values ('My Team') returning id into bootstrap_team_id;
  end if;

  update public.profiles set team_id = bootstrap_team_id where team_id is null;
end $$;

alter table public.profiles alter column team_id set not null;
create index if not exists profiles_team_id_idx on public.profiles (team_id);

-- One-time: flag your own account as super admin. Safe/idempotent — a no-op
-- if the email doesn't match anything yet. Double-check this is the right
-- address before moving to stage 2; adjust and re-run if not.
update public.profiles
set is_super_admin = true
where id = (select id from auth.users where email = 'noahgbrase@gmail.com');

-- ============================================================================
-- team_id on every other team-scoped table, backfilled from each row's
-- existing parent/owner link, then locked NOT NULL. (lifting_exercises,
-- assigned_lifting_targets, conversation_participants, and
-- event_entry_athletes weren't named explicitly in the request but are the
-- same shape as sibling tables that were — included for consistency, so
-- stage 2's RLS can check team_id directly on every one of these without an
-- extra join.)
-- ============================================================================

alter table public.workouts add column if not exists team_id uuid references public.teams (id);
update public.workouts w set team_id = p.team_id from public.profiles p where w.user_id = p.id and w.team_id is null;
alter table public.workouts alter column team_id set not null;
create index if not exists workouts_team_id_idx on public.workouts (team_id);

alter table public.running_segments add column if not exists team_id uuid references public.teams (id);
update public.running_segments rs set team_id = w.team_id from public.workouts w where rs.workout_id = w.id and rs.team_id is null;
alter table public.running_segments alter column team_id set not null;
create index if not exists running_segments_team_id_idx on public.running_segments (team_id);

alter table public.running_segment_reps add column if not exists team_id uuid references public.teams (id);
update public.running_segment_reps rr set team_id = rs.team_id from public.running_segments rs where rr.segment_id = rs.id and rr.team_id is null;
alter table public.running_segment_reps alter column team_id set not null;
create index if not exists running_segment_reps_team_id_idx on public.running_segment_reps (team_id);

alter table public.lifting_exercises add column if not exists team_id uuid references public.teams (id);
update public.lifting_exercises le set team_id = w.team_id from public.workouts w where le.workout_id = w.id and le.team_id is null;
alter table public.lifting_exercises alter column team_id set not null;
create index if not exists lifting_exercises_team_id_idx on public.lifting_exercises (team_id);

alter table public.assigned_workouts add column if not exists team_id uuid references public.teams (id);
update public.assigned_workouts aw set team_id = p.team_id from public.profiles p where aw.coach_id = p.id and aw.team_id is null;
alter table public.assigned_workouts alter column team_id set not null;
create index if not exists assigned_workouts_team_id_idx on public.assigned_workouts (team_id);

alter table public.assigned_running_segments add column if not exists team_id uuid references public.teams (id);
update public.assigned_running_segments ars set team_id = aw.team_id from public.assigned_workouts aw where ars.assigned_workout_id = aw.id and ars.team_id is null;
alter table public.assigned_running_segments alter column team_id set not null;
create index if not exists assigned_running_segments_team_id_idx on public.assigned_running_segments (team_id);

alter table public.assigned_lifting_targets add column if not exists team_id uuid references public.teams (id);
update public.assigned_lifting_targets alt set team_id = aw.team_id from public.assigned_workouts aw where alt.assigned_workout_id = aw.id and alt.team_id is null;
alter table public.assigned_lifting_targets alter column team_id set not null;
create index if not exists assigned_lifting_targets_team_id_idx on public.assigned_lifting_targets (team_id);

-- conversations has no single owner column to backfill from; use any
-- existing participant's team, falling back to the bootstrap team for any
-- conversation that somehow has none (shouldn't happen).
alter table public.conversations add column if not exists team_id uuid references public.teams (id);
update public.conversations c set team_id = sub.team_id
from (
  select cp.conversation_id, p.team_id
  from public.conversation_participants cp
  join public.profiles p on p.id = cp.user_id
) sub
where c.id = sub.conversation_id and c.team_id is null;
update public.conversations set team_id = (select id from public.teams where name = 'My Team' limit 1) where team_id is null;
alter table public.conversations alter column team_id set not null;
create index if not exists conversations_team_id_idx on public.conversations (team_id);

alter table public.conversation_participants add column if not exists team_id uuid references public.teams (id);
update public.conversation_participants cp set team_id = c.team_id from public.conversations c where cp.conversation_id = c.id and cp.team_id is null;
alter table public.conversation_participants alter column team_id set not null;
create index if not exists conversation_participants_team_id_idx on public.conversation_participants (team_id);

alter table public.messages add column if not exists team_id uuid references public.teams (id);
update public.messages m set team_id = c.team_id from public.conversations c where m.conversation_id = c.id and m.team_id is null;
alter table public.messages alter column team_id set not null;
create index if not exists messages_team_id_idx on public.messages (team_id);

alter table public.workout_comments add column if not exists team_id uuid references public.teams (id);
update public.workout_comments wc set team_id = w.team_id from public.workouts w where wc.workout_id = w.id and wc.team_id is null;
alter table public.workout_comments alter column team_id set not null;
create index if not exists workout_comments_team_id_idx on public.workout_comments (team_id);

alter table public.events add column if not exists team_id uuid references public.teams (id);
update public.events e set team_id = p.team_id from public.profiles p where e.created_by = p.id and e.team_id is null;
update public.events set team_id = (select id from public.teams where name = 'My Team' limit 1) where team_id is null;
alter table public.events alter column team_id set not null;
create index if not exists events_team_id_idx on public.events (team_id);

alter table public.event_entries add column if not exists team_id uuid references public.teams (id);
update public.event_entries ee set team_id = e.team_id from public.events e where ee.event_id = e.id and ee.team_id is null;
alter table public.event_entries alter column team_id set not null;
create index if not exists event_entries_team_id_idx on public.event_entries (team_id);

alter table public.event_entry_athletes add column if not exists team_id uuid references public.teams (id);
update public.event_entry_athletes eea set team_id = ee.team_id from public.event_entries ee where eea.entry_id = ee.id and eea.team_id is null;
alter table public.event_entry_athletes alter column team_id set not null;
create index if not exists event_entry_athletes_team_id_idx on public.event_entry_athletes (team_id);

alter table public.team_settings add column if not exists team_id uuid references public.teams (id);
update public.team_settings set team_id = (select id from public.teams where name = 'My Team' limit 1) where team_id is null;
alter table public.team_settings alter column team_id set not null;

-- ============================================================================
-- Singleton indexes that assumed a single global team now need to be
-- per-team: team_settings was one row, period; conversations had one
-- type='team' row, period. Both become "one per team_id" instead.
-- ============================================================================

drop index if exists public.team_settings_singleton_idx;
create unique index if not exists team_settings_team_id_idx on public.team_settings (team_id);

drop index if exists public.conversations_single_team_idx;
create unique index if not exists conversations_team_channel_idx
  on public.conversations (team_id)
  where type = 'team';

-- ============================================================================
-- HELPERS: is_super_admin(), is_admin(), current_team_id() — security
-- definer, same reasoning as is_coach()/is_athlete() in schema.sql (read
-- profiles without being blocked by, or recursing into, RLS on profiles).
-- ============================================================================

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_team_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

-- ============================================================================
-- handle_new_user(): now requires team_id in signup metadata.
--
-- profiles.team_id is NOT NULL as of this file, so the insert below has to
-- supply one. The client doesn't send one until stage 3 (invite-based
-- signup) — until then this intentionally raises rather than silently
-- assigning new signups to the bootstrap team, which would be a data
-- isolation bug waiting to happen.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  signup_team_id uuid;
begin
  signup_team_id := (new.raw_user_meta_data ->> 'team_id')::uuid;

  if signup_team_id is null then
    raise exception 'Signup requires a team_id (invite-based signup lands in stage 3)';
  end if;

  insert into public.profiles (id, name, role, team_id)
  values (new.id, new.raw_user_meta_data ->> 'name', 'pending', signup_team_id);
  return new;
end;
$$;

-- ============================================================================
-- add_user_to_team_conversation(): scope the "team conversation" lookup to
-- the newly-approved user's own team_id (there's now one per team, not a
-- global singleton), and include the new 'admin' role alongside
-- athlete/coach as roles that get auto-joined.
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
  select id into team_conv_id
  from public.conversations
  where type = 'team' and team_id = new.team_id
  limit 1;

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
  when (old.role is distinct from new.role and new.role in ('athlete', 'coach', 'admin'))
  execute function public.add_user_to_team_conversation();

-- ============================================================================
-- TEAM_ID AUTO-DERIVE TRIGGERS
--
-- For every child/owned table below, team_id is unconditionally overwritten
-- from the parent row (or, for tables with a direct owner column, from the
-- inserting user's own profile) on every insert — never trusted from the
-- client. This is what makes it structurally impossible to spoof a row into
-- another team, and it means existing RPCs (get_or_create_direct_conversation,
-- create_group_conversation, etc.) need no changes at all: their plain
-- inserts into conversations/conversation_participants/messages get the
-- right team_id transparently.
--
-- conversations is the one exception with real branching logic: a 'team'
-- type conversation has no natural "owner" to derive from (it's created by
-- the on_team_created trigger below, on behalf of a brand new team), so
-- team_id must be supplied explicitly for that case; 'direct'/'group'
-- conversations always derive team_id from their creator, ignoring
-- whatever the client sent.
-- ============================================================================

create or replace function public.set_workout_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.profiles where id = new.user_id;
  return new;
end;
$$;
drop trigger if exists set_workout_team_id_trigger on public.workouts;
create trigger set_workout_team_id_trigger
  before insert on public.workouts
  for each row execute function public.set_workout_team_id();

create or replace function public.set_running_segment_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;
drop trigger if exists set_running_segment_team_id_trigger on public.running_segments;
create trigger set_running_segment_team_id_trigger
  before insert on public.running_segments
  for each row execute function public.set_running_segment_team_id();

create or replace function public.set_running_segment_rep_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.running_segments where id = new.segment_id;
  return new;
end;
$$;
drop trigger if exists set_running_segment_rep_team_id_trigger on public.running_segment_reps;
create trigger set_running_segment_rep_team_id_trigger
  before insert on public.running_segment_reps
  for each row execute function public.set_running_segment_rep_team_id();

create or replace function public.set_lifting_exercise_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;
drop trigger if exists set_lifting_exercise_team_id_trigger on public.lifting_exercises;
create trigger set_lifting_exercise_team_id_trigger
  before insert on public.lifting_exercises
  for each row execute function public.set_lifting_exercise_team_id();

create or replace function public.set_assigned_workout_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.profiles where id = new.coach_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_workout_team_id_trigger on public.assigned_workouts;
create trigger set_assigned_workout_team_id_trigger
  before insert on public.assigned_workouts
  for each row execute function public.set_assigned_workout_team_id();

create or replace function public.set_assigned_running_segment_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_workouts where id = new.assigned_workout_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_running_segment_team_id_trigger on public.assigned_running_segments;
create trigger set_assigned_running_segment_team_id_trigger
  before insert on public.assigned_running_segments
  for each row execute function public.set_assigned_running_segment_team_id();

create or replace function public.set_assigned_lifting_target_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_workouts where id = new.assigned_workout_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_lifting_target_team_id_trigger on public.assigned_lifting_targets;
create trigger set_assigned_lifting_target_team_id_trigger
  before insert on public.assigned_lifting_targets
  for each row execute function public.set_assigned_lifting_target_team_id();

create or replace function public.set_conversation_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'team' then
    if new.team_id is null then
      raise exception 'team_id is required when creating a team-channel conversation';
    end if;
  else
    select team_id into new.team_id from public.profiles where id = auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists set_conversation_team_id_trigger on public.conversations;
create trigger set_conversation_team_id_trigger
  before insert on public.conversations
  for each row execute function public.set_conversation_team_id();

create or replace function public.set_conversation_participant_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.conversations where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists set_conversation_participant_team_id_trigger on public.conversation_participants;
create trigger set_conversation_participant_team_id_trigger
  before insert on public.conversation_participants
  for each row execute function public.set_conversation_participant_team_id();

create or replace function public.set_message_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.conversations where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists set_message_team_id_trigger on public.messages;
create trigger set_message_team_id_trigger
  before insert on public.messages
  for each row execute function public.set_message_team_id();

create or replace function public.set_workout_comment_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.workouts where id = new.workout_id;
  return new;
end;
$$;
drop trigger if exists set_workout_comment_team_id_trigger on public.workout_comments;
create trigger set_workout_comment_team_id_trigger
  before insert on public.workout_comments
  for each row execute function public.set_workout_comment_team_id();

create or replace function public.set_event_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.profiles where id = new.created_by;
  return new;
end;
$$;
drop trigger if exists set_event_team_id_trigger on public.events;
create trigger set_event_team_id_trigger
  before insert on public.events
  for each row execute function public.set_event_team_id();

create or replace function public.set_event_entry_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.events where id = new.event_id;
  return new;
end;
$$;
drop trigger if exists set_event_entry_team_id_trigger on public.event_entries;
create trigger set_event_entry_team_id_trigger
  before insert on public.event_entries
  for each row execute function public.set_event_entry_team_id();

create or replace function public.set_event_entry_athlete_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.event_entries where id = new.entry_id;
  return new;
end;
$$;
drop trigger if exists set_event_entry_athlete_team_id_trigger on public.event_entry_athletes;
create trigger set_event_entry_athlete_team_id_trigger
  before insert on public.event_entry_athletes
  for each row execute function public.set_event_entry_athlete_team_id();

-- ============================================================================
-- on_team_created: auto-provisions a new team's default settings row and
-- team-channel conversation. Only matters for teams created from here on
-- (i.e. via stage 4's super-admin panel) — the bootstrap "My Team" above was
-- inserted before this trigger existed, and its team_settings/conversations
-- rows were backfilled onto the pre-existing singleton rows instead.
-- ============================================================================

create or replace function public.handle_new_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_settings (team_id, primary_color, accent_color)
  values (new.id, '#7c3aed', '#5b21b6');

  insert into public.conversations (type, team_id)
  values ('team', new.id);

  return new;
end;
$$;

drop trigger if exists on_team_created on public.teams;
create trigger on_team_created
  after insert on public.teams
  for each row execute function public.handle_new_team();

-- ============================================================================
-- RLS: teams
--
-- A regular user can read their own team's row (needed later for e.g.
-- showing team name / invite code to a coach). Super admins bypass entirely.
-- Only super admins can create or rename teams. Anonymous invite-code lookup
-- during signup is deliberately NOT handled here — that needs a narrow
-- security-definer RPC that returns just the team name for a given code
-- without exposing this table to anon reads, which lands in stage 3 with
-- the rest of the invite flow.
-- ============================================================================

alter table public.teams enable row level security;

drop policy if exists "teams_select_own_or_super_admin" on public.teams;
create policy "teams_select_own_or_super_admin"
  on public.teams for select
  using (public.is_super_admin() or id = public.current_team_id());

drop policy if exists "teams_insert_super_admin_only" on public.teams;
create policy "teams_insert_super_admin_only"
  on public.teams for insert
  with check (public.is_super_admin());

drop policy if exists "teams_update_super_admin_only" on public.teams;
create policy "teams_update_super_admin_only"
  on public.teams for update
  using (public.is_super_admin())
  with check (public.is_super_admin());
