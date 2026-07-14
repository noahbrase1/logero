-- Trackward Workout Logging App — Soft-remove athletes
-- Run this in the Supabase SQL editor AFTER all prior schema files (schema.sql,
-- messaging_schema.sql, features_v2_schema.sql, running_segments_schema.sql,
-- assigned_running_segments_schema.sql, quick_notes_schema.sql,
-- messaging_v2_schema.sql, event_entries_schema.sql, event_entry_teams_schema.sql).
--
-- Adds a 'removed' profiles.role: a coach can revoke an athlete's access
-- while keeping their historical workouts/assignments intact for the
-- coach's own reference. 'removed' is deliberately excluded from
-- is_athlete()/is_coach() (both check for an exact role match), so every
-- existing "own row or coach" policy built on those helpers already stops
-- letting a removed user write anything the moment their role flips —
-- the only gap is SELECT policies that check raw ownership (`user_id =
-- auth.uid()`) instead of going through is_athlete(), which this file
-- tightens so a removed user loses read access too, not just write.

-- ============================================================================
-- profiles.role: widen the check constraint to allow 'removed'
-- ============================================================================

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
  check (role in ('pending', 'athlete', 'coach', 'removed'));

-- Note: profiles_select_own_or_coach and profiles_update_coach_only
-- (schema.sql) are untouched on purpose. A removed user must still be able
-- to read their *own* profile row — that's how the client detects
-- role = 'removed' and shows the "access removed" screen instead of an
-- error — and only a coach could ever change a role to 'removed' in the
-- first place, which that policy already guarantees.

-- ============================================================================
-- RLS tightening: workouts and its child tables
--
-- Was `user_id = auth.uid() or is_coach()`. A removed user's own row still
-- matches `user_id = auth.uid()` forever, so without the is_athlete() guard
-- they'd keep read access to their own logs after removal. Coaches are
-- unaffected (is_coach() branch unchanged).
-- ============================================================================

drop policy if exists "workouts_select_own_or_coach" on public.workouts;
create policy "workouts_select_own_or_coach"
  on public.workouts for select
  using ((user_id = auth.uid() and public.is_athlete()) or public.is_coach());

drop policy if exists "running_segments_select_own_or_coach" on public.running_segments;
create policy "running_segments_select_own_or_coach"
  on public.running_segments for select
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach())
    )
  );

drop policy if exists "running_segment_reps_select_own_or_coach" on public.running_segment_reps;
create policy "running_segment_reps_select_own_or_coach"
  on public.running_segment_reps for select
  using (
    exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach())
    )
  );

drop policy if exists "lifting_exercises_select_own_or_coach" on public.lifting_exercises;
create policy "lifting_exercises_select_own_or_coach"
  on public.lifting_exercises for select
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach())
    )
  );

drop policy if exists "workout_comments_select_owner_or_coach" on public.workout_comments;
create policy "workout_comments_select_owner_or_coach"
  on public.workout_comments for select
  using (
    exists (
      select 1 from public.workouts w
      where w.id = workout_id and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach())
    )
  );

-- ============================================================================
-- RLS tightening: assigned_workouts and its target tables (same reasoning)
-- ============================================================================

drop policy if exists "assigned_workouts_select_own_or_coach" on public.assigned_workouts;
create policy "assigned_workouts_select_own_or_coach"
  on public.assigned_workouts for select
  using (public.is_coach() or (athlete_id = auth.uid() and public.is_athlete()));

drop policy if exists "assigned_running_segments_select_own_or_coach" on public.assigned_running_segments;
create policy "assigned_running_segments_select_own_or_coach"
  on public.assigned_running_segments for select
  using (
    exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id
        and (public.is_coach() or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

drop policy if exists "assigned_lifting_targets_select_own_or_coach" on public.assigned_lifting_targets;
create policy "assigned_lifting_targets_select_own_or_coach"
  on public.assigned_lifting_targets for select
  using (
    exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id
        and (public.is_coach() or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

-- ============================================================================
-- RLS tightening: conversations / conversation_participants / messages
--
-- remove_athlete() below deletes the removed user's participant rows for
-- the team channel and any groups, but *leaves DMs with a coach in place*
-- so the coach keeps that history. Without an is_athlete()/is_coach() guard
-- here, the removed user would still be able to read (and even send) in
-- that leftover DM forever, since is_conversation_participant() alone
-- doesn't know or care about the caller's current role.
-- ============================================================================

drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  using (public.is_conversation_participant(id) and (public.is_coach() or public.is_athlete()));

drop policy if exists "participants_select_own_conversations" on public.conversation_participants;
create policy "participants_select_own_conversations"
  on public.conversation_participants for select
  using (public.is_conversation_participant(conversation_id) and (public.is_coach() or public.is_athlete()));

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select
  using (public.is_conversation_participant(conversation_id) and (public.is_coach() or public.is_athlete()));

drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
    and (public.is_coach() or public.is_athlete())
  );

-- ============================================================================
-- RPC: remove_athlete() — the coach's "Remove" action.
--
-- Runs as SECURITY DEFINER (same reasoning as get_or_create_direct_conversation
-- / create_group_conversation) so the role flip and the participant cleanup
-- happen atomically, with the coach-only check enforced explicitly here
-- rather than relying on table RLS the function bypasses anyway. Assigned
-- workouts and workout logs are deliberately left untouched — they're the
-- historical record this feature is meant to preserve.
-- ============================================================================

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

  if not exists (select 1 from public.profiles where id = target_id and role = 'athlete') then
    raise exception 'Athlete not found or already removed';
  end if;

  update public.profiles set role = 'removed' where id = target_id;

  -- Team channel + any group chats: gone. Direct conversations with a coach
  -- are intentionally left alone (see policy comments above).
  delete from public.conversation_participants
  where user_id = target_id
    and conversation_id in (select id from public.conversations where type in ('team', 'group'));
end;
$$;

grant execute on function public.remove_athlete(uuid) to authenticated;
