-- Trackward Workout Logging App — Meet lineups
-- Run this in the Supabase SQL editor after the prior schema files.
--
-- Adds a lineup (list of individual event entries, e.g. "4x400m Relay",
-- "800m", "Long Jump") to an existing meet/event, each with a scheduled
-- time and the athletes competing in it. Unlike the group-chat feature,
-- read access here isn't participant-gated — every approved user can read
-- every entry regardless of who's in it — so there's no chicken-and-egg RLS
-- risk on insert/RETURNING the way there was for group conversations.

-- ============================================================================
-- TABLES
-- ============================================================================

create table if not exists public.event_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  event_name text not null,
  scheduled_time time,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists event_entries_event_id_idx on public.event_entries (event_id, order_index);

create table if not exists public.event_entry_athletes (
  entry_id uuid not null references public.event_entries (id) on delete cascade,
  athlete_id uuid not null references public.profiles (id) on delete cascade,
  primary key (entry_id, athlete_id)
);

create index if not exists event_entry_athletes_athlete_id_idx on public.event_entry_athletes (athlete_id);

-- ============================================================================
-- RLS: event_entries — everyone approved reads, only coaches write.
-- ============================================================================

alter table public.event_entries enable row level security;

drop policy if exists "event_entries_select_approved" on public.event_entries;
create policy "event_entries_select_approved"
  on public.event_entries for select
  using (public.is_coach() or public.is_athlete());

drop policy if exists "event_entries_insert_coach_only" on public.event_entries;
create policy "event_entries_insert_coach_only"
  on public.event_entries for insert
  with check (public.is_coach());

drop policy if exists "event_entries_update_coach_only" on public.event_entries;
create policy "event_entries_update_coach_only"
  on public.event_entries for update
  using (public.is_coach())
  with check (public.is_coach());

drop policy if exists "event_entries_delete_coach_only" on public.event_entries;
create policy "event_entries_delete_coach_only"
  on public.event_entries for delete
  using (public.is_coach());

-- ============================================================================
-- RLS: event_entry_athletes — same pattern.
-- ============================================================================

alter table public.event_entry_athletes enable row level security;

drop policy if exists "event_entry_athletes_select_approved" on public.event_entry_athletes;
create policy "event_entry_athletes_select_approved"
  on public.event_entry_athletes for select
  using (public.is_coach() or public.is_athlete());

drop policy if exists "event_entry_athletes_insert_coach_only" on public.event_entry_athletes;
create policy "event_entry_athletes_insert_coach_only"
  on public.event_entry_athletes for insert
  with check (public.is_coach());

drop policy if exists "event_entry_athletes_delete_coach_only" on public.event_entry_athletes;
create policy "event_entry_athletes_delete_coach_only"
  on public.event_entry_athletes for delete
  using (public.is_coach());
