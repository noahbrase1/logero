-- Trackward Workout Logging App — Multi-tenancy, Stage 2: RLS
-- Run this in the Supabase SQL editor AFTER multi_tenancy_schema.sql. Safe
-- to re-run.
--
-- Rewrites every existing RLS policy to also check team_id against the
-- caller's own team (public.current_team_id()), with public.is_super_admin()
-- bypassing the team check entirely wherever that makes sense. Also adds
-- public.is_admin() (the read-only athletic-director role) to every SELECT
-- policy that previously granted a coach broad visibility, so admins see
-- exactly what a coach sees for logs/roster/events. is_admin() is
-- deliberately never added to an INSERT/UPDATE/DELETE policy — the app's
-- 'admin' role is read-only by construction.
--
-- Two things that needed more than a mechanical team_id check are called out
-- inline below with a comment: team_settings was previously readable by any
-- authenticated user regardless of team, and several coach-write policies
-- only checked role (is athlete/coach) without checking the *specific* other
-- user referenced actually belongs to the same team — both are closed here.
--
-- Messaging visibility for admin: unlike a coach (who only ever sees
-- conversations they personally participate in), admin sees every
-- conversation/message/participant row on their team, participant or not —
-- confirmed with the app owner before writing this.

-- ============================================================================
-- RLS: profiles
-- ============================================================================

drop policy if exists "profiles_select_own_or_coach" on public.profiles;
create policy "profiles_select_own_or_coach"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.is_super_admin()
    or ((public.is_coach() or public.is_admin()) and team_id = public.current_team_id())
  );

drop policy if exists "profiles_update_coach_only" on public.profiles;
create policy "profiles_update_coach_only"
  on public.profiles for update
  using (public.is_super_admin() or (public.is_coach() and team_id = public.current_team_id()))
  with check (public.is_super_admin() or (public.is_coach() and team_id = public.current_team_id()));

drop policy if exists "profiles_select_conversation_participants" on public.profiles;
create policy "profiles_select_conversation_participants"
  on public.profiles for select
  using (
    public.is_super_admin()
    or (
      team_id = public.current_team_id()
      and exists (
        select 1 from public.conversation_participants cp
        where cp.user_id = profiles.id
          and public.is_conversation_participant(cp.conversation_id)
      )
    )
  );

-- ============================================================================
-- RLS: workouts
-- ============================================================================

drop policy if exists "workouts_select_own_or_coach" on public.workouts;
create policy "workouts_select_own_or_coach"
  on public.workouts for select
  using (
    public.is_super_admin()
    or (user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id())
    or ((public.is_coach() or public.is_admin()) and team_id = public.current_team_id())
  );

drop policy if exists "workouts_insert_own_athlete" on public.workouts;
create policy "workouts_insert_own_athlete"
  on public.workouts for insert
  with check (user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id());

drop policy if exists "workouts_update_own_athlete" on public.workouts;
create policy "workouts_update_own_athlete"
  on public.workouts for update
  using (user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id())
  with check (user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id());

drop policy if exists "workouts_delete_own_athlete" on public.workouts;
create policy "workouts_delete_own_athlete"
  on public.workouts for delete
  using (user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id());

drop policy if exists "workouts_insert_own_coach_note" on public.workouts;
create policy "workouts_insert_own_coach_note"
  on public.workouts for insert
  with check (user_id = auth.uid() and public.is_coach() and type = 'note' and team_id = public.current_team_id());

-- ============================================================================
-- RLS: running_segments / running_segment_reps
-- ============================================================================

drop policy if exists "running_segments_select_own_or_coach" on public.running_segments;
create policy "running_segments_select_own_or_coach"
  on public.running_segments for select
  using (
    public.is_super_admin()
    or (
      team_id = public.current_team_id()
      and exists (
        select 1 from public.workouts w
        where w.id = workout_id
          and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
      )
    )
  );

drop policy if exists "running_segments_insert_own_athlete" on public.running_segments;
create policy "running_segments_insert_own_athlete"
  on public.running_segments for insert
  with check (
    team_id = public.current_team_id()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "running_segments_update_own_athlete" on public.running_segments;
create policy "running_segments_update_own_athlete"
  on public.running_segments for update
  using (
    team_id = public.current_team_id()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  )
  with check (
    team_id = public.current_team_id()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "running_segments_delete_own_athlete" on public.running_segments;
create policy "running_segments_delete_own_athlete"
  on public.running_segments for delete
  using (
    team_id = public.current_team_id()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "running_segment_reps_select_own_or_coach" on public.running_segment_reps;
create policy "running_segment_reps_select_own_or_coach"
  on public.running_segment_reps for select
  using (
    public.is_super_admin()
    or (
      team_id = public.current_team_id()
      and exists (
        select 1 from public.running_segments rs
        join public.workouts w on w.id = rs.workout_id
        where rs.id = segment_id
          and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
      )
    )
  );

drop policy if exists "running_segment_reps_insert_own_athlete" on public.running_segment_reps;
create policy "running_segment_reps_insert_own_athlete"
  on public.running_segment_reps for insert
  with check (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

drop policy if exists "running_segment_reps_update_own_athlete" on public.running_segment_reps;
create policy "running_segment_reps_update_own_athlete"
  on public.running_segment_reps for update
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  )
  with check (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

drop policy if exists "running_segment_reps_delete_own_athlete" on public.running_segment_reps;
create policy "running_segment_reps_delete_own_athlete"
  on public.running_segment_reps for delete
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

-- ============================================================================
-- RLS: lifting_exercises
-- ============================================================================

drop policy if exists "lifting_exercises_select_own_or_coach" on public.lifting_exercises;
create policy "lifting_exercises_select_own_or_coach"
  on public.lifting_exercises for select
  using (
    public.is_super_admin()
    or (
      team_id = public.current_team_id()
      and exists (
        select 1 from public.workouts w
        where w.id = workout_id
          and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
      )
    )
  );

drop policy if exists "lifting_exercises_insert_own_athlete" on public.lifting_exercises;
create policy "lifting_exercises_insert_own_athlete"
  on public.lifting_exercises for insert
  with check (
    team_id = public.current_team_id()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "lifting_exercises_update_own_athlete" on public.lifting_exercises;
create policy "lifting_exercises_update_own_athlete"
  on public.lifting_exercises for update
  using (
    team_id = public.current_team_id()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  )
  with check (
    team_id = public.current_team_id()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "lifting_exercises_delete_own_athlete" on public.lifting_exercises;
create policy "lifting_exercises_delete_own_athlete"
  on public.lifting_exercises for delete
  using (
    team_id = public.current_team_id()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

-- ============================================================================
-- RLS: workout_comments
--
-- The insert policy previously only checked coach_id = auth.uid() and
-- is_coach() — it never checked that workout_id actually belongs to a
-- workout on the coach's own team, so a coach could comment on any workout
-- in the whole database by guessing/knowing its id. Closed below.
-- ============================================================================

drop policy if exists "workout_comments_select_owner_or_coach" on public.workout_comments;
create policy "workout_comments_select_owner_or_coach"
  on public.workout_comments for select
  using (
    public.is_super_admin()
    or (
      team_id = public.current_team_id()
      and exists (
        select 1 from public.workouts w
        where w.id = workout_id
          and ((w.user_id = auth.uid() and public.is_athlete()) or public.is_coach() or public.is_admin())
      )
    )
  );

drop policy if exists "workout_comments_insert_coach_only" on public.workout_comments;
create policy "workout_comments_insert_coach_only"
  on public.workout_comments for insert
  with check (
    coach_id = auth.uid()
    and public.is_coach()
    and team_id = public.current_team_id()
    and exists (select 1 from public.workouts w where w.id = workout_id and w.team_id = public.current_team_id())
  );

-- ============================================================================
-- RLS: assigned_workouts / assigned_running_segments / assigned_lifting_targets
--
-- assigned_workouts_insert_coach_only previously only checked is_coach() and
-- coach_id = auth.uid() — never that athlete_id belongs to the coach's own
-- team, so a coach could assign a workout to an athlete on another team by
-- id. Closed below.
-- ============================================================================

drop policy if exists "assigned_workouts_select_own_or_coach" on public.assigned_workouts;
create policy "assigned_workouts_select_own_or_coach"
  on public.assigned_workouts for select
  using (
    public.is_super_admin()
    or (
      team_id = public.current_team_id()
      and ((public.is_coach() or public.is_admin()) or (athlete_id = auth.uid() and public.is_athlete()))
    )
  );

drop policy if exists "assigned_workouts_insert_coach_only" on public.assigned_workouts;
create policy "assigned_workouts_insert_coach_only"
  on public.assigned_workouts for insert
  with check (
    public.is_coach()
    and coach_id = auth.uid()
    and team_id = public.current_team_id()
    and exists (select 1 from public.profiles ath where ath.id = athlete_id and ath.team_id = public.current_team_id())
  );

drop policy if exists "assigned_workouts_update_coach_only" on public.assigned_workouts;
create policy "assigned_workouts_update_coach_only"
  on public.assigned_workouts for update
  using (public.is_coach() and team_id = public.current_team_id())
  with check (public.is_coach() and team_id = public.current_team_id());

drop policy if exists "assigned_workouts_delete_coach_only" on public.assigned_workouts;
create policy "assigned_workouts_delete_coach_only"
  on public.assigned_workouts for delete
  using (public.is_coach() and team_id = public.current_team_id());

drop policy if exists "assigned_running_segments_select_own_or_coach" on public.assigned_running_segments;
create policy "assigned_running_segments_select_own_or_coach"
  on public.assigned_running_segments for select
  using (
    public.is_super_admin()
    or (
      team_id = public.current_team_id()
      and exists (
        select 1 from public.assigned_workouts aw
        where aw.id = assigned_workout_id
          and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
      )
    )
  );

drop policy if exists "assigned_running_segments_insert_coach_only" on public.assigned_running_segments;
create policy "assigned_running_segments_insert_coach_only"
  on public.assigned_running_segments for insert
  with check (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );

drop policy if exists "assigned_lifting_targets_select_own_or_coach" on public.assigned_lifting_targets;
create policy "assigned_lifting_targets_select_own_or_coach"
  on public.assigned_lifting_targets for select
  using (
    public.is_super_admin()
    or (
      team_id = public.current_team_id()
      and exists (
        select 1 from public.assigned_workouts aw
        where aw.id = assigned_workout_id
          and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
      )
    )
  );

drop policy if exists "assigned_lifting_targets_insert_coach_only" on public.assigned_lifting_targets;
create policy "assigned_lifting_targets_insert_coach_only"
  on public.assigned_lifting_targets for insert
  with check (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );

-- ============================================================================
-- RLS: conversations / conversation_participants / messages
--
-- Admin bypasses participant-gating entirely (team match only) — confirmed
-- with the app owner that a read-only AD should see every conversation on
-- their team, not just ones they're added to, unlike a coach.
-- ============================================================================

drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  using (
    public.is_super_admin()
    or (team_id = public.current_team_id() and public.is_admin())
    or (
      public.is_conversation_participant(id)
      and (public.is_coach() or public.is_athlete())
      and team_id = public.current_team_id()
    )
  );

drop policy if exists "conversations_insert_direct_or_group" on public.conversations;
create policy "conversations_insert_direct_or_group"
  on public.conversations for insert
  with check (
    team_id = public.current_team_id()
    and (
      (type = 'direct' and (public.is_coach() or public.is_athlete()))
      or (type = 'group' and public.is_coach())
    )
  );

drop policy if exists "conversations_update_coach_group" on public.conversations;
create policy "conversations_update_coach_group"
  on public.conversations for update
  using (public.is_coach() and type = 'group' and team_id = public.current_team_id())
  with check (public.is_coach() and type = 'group' and team_id = public.current_team_id());

drop policy if exists "conversations_delete_coach_group" on public.conversations;
create policy "conversations_delete_coach_group"
  on public.conversations for delete
  using (public.is_coach() and type = 'group' and team_id = public.current_team_id());

drop policy if exists "participants_select_own_conversations" on public.conversation_participants;
create policy "participants_select_own_conversations"
  on public.conversation_participants for select
  using (
    public.is_super_admin()
    or (team_id = public.current_team_id() and public.is_admin())
    or (
      public.is_conversation_participant(conversation_id)
      and (public.is_coach() or public.is_athlete())
      and team_id = public.current_team_id()
    )
  );

drop policy if exists "participants_insert_direct" on public.conversation_participants;
create policy "participants_insert_direct"
  on public.conversation_participants for insert
  with check (
    team_id = public.current_team_id()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'direct')
    and exists (select 1 from public.profiles p where p.id = user_id and p.team_id = public.current_team_id())
    and (
      user_id = auth.uid()
      or (public.is_coach() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'athlete'))
      or (public.is_athlete() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'coach'))
    )
  );

drop policy if exists "participants_insert_coach_group" on public.conversation_participants;
create policy "participants_insert_coach_group"
  on public.conversation_participants for insert
  with check (
    public.is_coach()
    and team_id = public.current_team_id()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'group' and c.team_id = public.current_team_id())
    and exists (select 1 from public.profiles p where p.id = user_id and p.team_id = public.current_team_id())
  );

drop policy if exists "participants_delete_coach_group" on public.conversation_participants;
create policy "participants_delete_coach_group"
  on public.conversation_participants for delete
  using (
    public.is_coach()
    and team_id = public.current_team_id()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'group')
  );

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select
  using (
    public.is_super_admin()
    or (team_id = public.current_team_id() and public.is_admin())
    or (
      public.is_conversation_participant(conversation_id)
      and (public.is_coach() or public.is_athlete())
      and team_id = public.current_team_id()
    )
  );

drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
    and (public.is_coach() or public.is_athlete())
    and team_id = public.current_team_id()
  );

-- ============================================================================
-- RLS: team_settings
--
-- Previously `using (auth.uid() is not null)` — any authenticated user on
-- ANY team could read every team's theme colors. Scoped to own team below.
-- ============================================================================

drop policy if exists "team_settings_select_authenticated" on public.team_settings;
create policy "team_settings_select_own_team_or_super_admin"
  on public.team_settings for select
  using (public.is_super_admin() or team_id = public.current_team_id());

drop policy if exists "team_settings_update_coach_only" on public.team_settings;
create policy "team_settings_update_coach_only"
  on public.team_settings for update
  using (public.is_coach() and team_id = public.current_team_id())
  with check (public.is_coach() and team_id = public.current_team_id());

-- ============================================================================
-- RLS: events
-- ============================================================================

drop policy if exists "events_select_approved" on public.events;
create policy "events_select_approved"
  on public.events for select
  using (
    public.is_super_admin()
    or (team_id = public.current_team_id() and (public.is_coach() or public.is_athlete() or public.is_admin()))
  );

drop policy if exists "events_insert_coach_only" on public.events;
create policy "events_insert_coach_only"
  on public.events for insert
  with check (public.is_coach() and created_by = auth.uid() and team_id = public.current_team_id());

drop policy if exists "events_update_coach_only" on public.events;
create policy "events_update_coach_only"
  on public.events for update
  using (public.is_coach() and team_id = public.current_team_id())
  with check (public.is_coach() and team_id = public.current_team_id());

drop policy if exists "events_delete_coach_only" on public.events;
create policy "events_delete_coach_only"
  on public.events for delete
  using (public.is_coach() and team_id = public.current_team_id());

-- ============================================================================
-- RLS: event_entries / event_entry_athletes
--
-- event_entry_athletes_insert_coach_only previously only checked is_coach()
-- — never that athlete_id belongs to the coach's own team, so a lineup
-- could be built with an athlete from another team by id. Closed below.
-- ============================================================================

drop policy if exists "event_entries_select_approved" on public.event_entries;
create policy "event_entries_select_approved"
  on public.event_entries for select
  using (
    public.is_super_admin()
    or (team_id = public.current_team_id() and (public.is_coach() or public.is_athlete() or public.is_admin()))
  );

drop policy if exists "event_entries_insert_coach_only" on public.event_entries;
create policy "event_entries_insert_coach_only"
  on public.event_entries for insert
  with check (
    public.is_coach()
    and team_id = public.current_team_id()
    and exists (select 1 from public.events e where e.id = event_id and e.team_id = public.current_team_id())
  );

drop policy if exists "event_entries_update_coach_only" on public.event_entries;
create policy "event_entries_update_coach_only"
  on public.event_entries for update
  using (public.is_coach() and team_id = public.current_team_id())
  with check (public.is_coach() and team_id = public.current_team_id());

drop policy if exists "event_entries_delete_coach_only" on public.event_entries;
create policy "event_entries_delete_coach_only"
  on public.event_entries for delete
  using (public.is_coach() and team_id = public.current_team_id());

drop policy if exists "event_entry_athletes_select_approved" on public.event_entry_athletes;
create policy "event_entry_athletes_select_approved"
  on public.event_entry_athletes for select
  using (
    public.is_super_admin()
    or (team_id = public.current_team_id() and (public.is_coach() or public.is_athlete() or public.is_admin()))
  );

drop policy if exists "event_entry_athletes_insert_coach_only" on public.event_entry_athletes;
create policy "event_entry_athletes_insert_coach_only"
  on public.event_entry_athletes for insert
  with check (
    public.is_coach()
    and team_id = public.current_team_id()
    and exists (select 1 from public.event_entries ee where ee.id = entry_id and ee.team_id = public.current_team_id())
    and exists (select 1 from public.profiles ath where ath.id = athlete_id and ath.team_id = public.current_team_id())
  );

drop policy if exists "event_entry_athletes_delete_coach_only" on public.event_entry_athletes;
create policy "event_entry_athletes_delete_coach_only"
  on public.event_entry_athletes for delete
  using (public.is_coach() and team_id = public.current_team_id());

-- ============================================================================
-- RPCs that run SECURITY DEFINER and bypass table RLS internally — the team
-- check has to live in the function body, not a policy. All three
-- previously checked role only, never that the *other* user referenced is
-- on the same team, which would otherwise let a coach DM/group-add/remove
-- someone on a different team just by knowing their id.
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

create or replace function public.create_group_conversation(group_name text, athlete_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
  athlete_id uuid;
  caller_team_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only coaches can create group conversations';
  end if;

  caller_team_id := public.current_team_id();

  insert into public.conversations (type, name, created_by)
  values ('group', group_name, auth.uid())
  returning id into conv_id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (conv_id, auth.uid());

  foreach athlete_id in array athlete_ids loop
    if exists (
      select 1 from public.profiles
      where id = athlete_id and role = 'athlete' and team_id = caller_team_id
    ) then
      insert into public.conversation_participants (conversation_id, user_id)
      values (conv_id, athlete_id)
      on conflict do nothing;
    end if;
  end loop;

  return conv_id;
end;
$$;

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

  if not exists (
    select 1 from public.profiles
    where id = target_id and role = 'athlete' and team_id = public.current_team_id()
  ) then
    raise exception 'Athlete not found or already removed';
  end if;

  update public.profiles set role = 'removed' where id = target_id;

  delete from public.conversation_participants
  where user_id = target_id
    and conversation_id in (select id from public.conversations where type in ('team', 'group'));
end;
$$;
