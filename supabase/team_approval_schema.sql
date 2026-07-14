-- Trackward Workout Logging App — Self-service team creation + approval
-- Run this in the Supabase SQL editor AFTER multi_tenancy_super_admin_schema.sql.
-- Safe to re-run.
--
-- Replaces the super-admin-only "create a team" flow with public self-service:
-- anyone can create a team and immediately become its founding coach, but the
-- team starts life as `status = 'pending'` and most write functionality stays
-- locked until a super admin approves it. This file is stage 1 of 3:
--   1. schema — teams.status, founding-coach signup, status-gated RLS (this file)
--   2. super-admin pending-teams approve/reject panel (frontend + a couple of
--      read-only RPCs, no further schema needed beyond this file)
--   3. verification that the existing invite/approval flow is untouched for
--      already-active teams
--
-- ============================================================================
-- teams.status
-- ============================================================================

alter table public.teams add column if not exists status text not null default 'pending'
  check (status in ('pending', 'active', 'rejected'));

-- Every team that already exists at the time this runs was created under the
-- old super-admin-only flow and is already operating — backfill it straight
-- to 'active' rather than leaving it stuck behind the new approval gate.
update public.teams set status = 'active';

-- ============================================================================
-- HELPER: current_team_status() — same reasoning as current_team_id() etc:
-- security definer so it can read profiles/teams without being blocked by
-- (or recursing into) the RLS policies that use it.
-- ============================================================================

create or replace function public.current_team_status()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select t.status
  from public.profiles p
  join public.teams t on t.id = p.team_id
  where p.id = auth.uid();
$$;

-- ============================================================================
-- RPC: create_pending_team() — the only way a team gets created now. Callable
-- by anon (there's no session yet at this point in the "Create Your Team"
-- flow) via SECURITY DEFINER, bypassing teams_insert_super_admin_only on
-- purpose. on_team_created (from multi_tenancy_schema.sql) still fires as a
-- normal AFTER INSERT trigger on this insert and provisions the new team's
-- team_settings row + team conversation exactly like it always has.
-- ============================================================================

create or replace function public.create_pending_team(team_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team_id uuid;
  trimmed_name text := trim(team_name);
begin
  if trimmed_name = '' then
    raise exception 'Team name is required';
  end if;

  insert into public.teams (name, status) values (trimmed_name, 'pending')
  returning id into new_team_id;

  return new_team_id;
end;
$$;

grant execute on function public.create_pending_team(text) to anon, authenticated;

-- ============================================================================
-- handle_new_user(): the founding coach of a brand-new team gets role='coach'
-- immediately instead of the usual 'pending' — derived purely from server
-- state (the target team has status='pending' and zero existing profiles),
-- never from anything the client claims. A signup against any team that
-- already has a member — active, still pending with its founder already
-- signed up, or rejected — falls through to the existing 'pending' behavior
-- unchanged, so the invite-link flow (stage 3 of the original multi-tenancy
-- build) is completely unaffected.
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
    raise exception 'Signup requires a team_id';
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
-- RLS: gate every "operate the team" write on current_team_status() = 'active'.
-- team_settings is gated separately (<> 'rejected', not = 'active') since the
-- founding coach is explicitly allowed to keep adjusting their own team's
-- setup while pending — see the header comment above for the stage split.
-- Every policy below is otherwise byte-for-byte the same as
-- multi_tenancy_rls_schema.sql, just with the status check appended.
-- ============================================================================

drop policy if exists "workouts_insert_own_athlete" on public.workouts;
create policy "workouts_insert_own_athlete"
  on public.workouts for insert
  with check (
    user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
  );

drop policy if exists "workouts_update_own_athlete" on public.workouts;
create policy "workouts_update_own_athlete"
  on public.workouts for update
  using (
    user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
  )
  with check (
    user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
  );

drop policy if exists "workouts_delete_own_athlete" on public.workouts;
create policy "workouts_delete_own_athlete"
  on public.workouts for delete
  using (
    user_id = auth.uid() and public.is_athlete() and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
  );

drop policy if exists "workouts_insert_own_coach_note" on public.workouts;
create policy "workouts_insert_own_coach_note"
  on public.workouts for insert
  with check (
    user_id = auth.uid() and public.is_coach() and type = 'note' and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
  );

drop policy if exists "running_segments_insert_own_athlete" on public.running_segments;
create policy "running_segments_insert_own_athlete"
  on public.running_segments for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "running_segments_update_own_athlete" on public.running_segments;
create policy "running_segments_update_own_athlete"
  on public.running_segments for update
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  )
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "running_segments_delete_own_athlete" on public.running_segments;
create policy "running_segments_delete_own_athlete"
  on public.running_segments for delete
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "running_segment_reps_insert_own_athlete" on public.running_segment_reps;
create policy "running_segment_reps_insert_own_athlete"
  on public.running_segment_reps for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
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
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  )
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
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
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.running_segments rs
      join public.workouts w on w.id = rs.workout_id
      where rs.id = segment_id and w.user_id = auth.uid() and public.is_athlete()
    )
  );

drop policy if exists "lifting_exercises_insert_own_athlete" on public.lifting_exercises;
create policy "lifting_exercises_insert_own_athlete"
  on public.lifting_exercises for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "lifting_exercises_update_own_athlete" on public.lifting_exercises;
create policy "lifting_exercises_update_own_athlete"
  on public.lifting_exercises for update
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  )
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "lifting_exercises_delete_own_athlete" on public.lifting_exercises;
create policy "lifting_exercises_delete_own_athlete"
  on public.lifting_exercises for delete
  using (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = auth.uid() and public.is_athlete())
  );

drop policy if exists "workout_comments_insert_coach_only" on public.workout_comments;
create policy "workout_comments_insert_coach_only"
  on public.workout_comments for insert
  with check (
    coach_id = auth.uid()
    and public.is_coach()
    and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.workouts w where w.id = workout_id and w.team_id = public.current_team_id())
  );

drop policy if exists "assigned_workouts_insert_coach_only" on public.assigned_workouts;
create policy "assigned_workouts_insert_coach_only"
  on public.assigned_workouts for insert
  with check (
    public.is_coach()
    and coach_id = auth.uid()
    and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.profiles ath where ath.id = athlete_id and ath.team_id = public.current_team_id())
  );

drop policy if exists "assigned_workouts_update_coach_only" on public.assigned_workouts;
create policy "assigned_workouts_update_coach_only"
  on public.assigned_workouts for update
  using (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active')
  with check (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "assigned_workouts_delete_coach_only" on public.assigned_workouts;
create policy "assigned_workouts_delete_coach_only"
  on public.assigned_workouts for delete
  using (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "assigned_running_segments_insert_coach_only" on public.assigned_running_segments;
create policy "assigned_running_segments_insert_coach_only"
  on public.assigned_running_segments for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );

drop policy if exists "assigned_lifting_targets_insert_coach_only" on public.assigned_lifting_targets;
create policy "assigned_lifting_targets_insert_coach_only"
  on public.assigned_lifting_targets for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_workouts aw
      where aw.id = assigned_workout_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );

drop policy if exists "conversations_insert_direct_or_group" on public.conversations;
create policy "conversations_insert_direct_or_group"
  on public.conversations for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and (
      (type = 'direct' and (public.is_coach() or public.is_athlete()))
      or (type = 'group' and public.is_coach())
    )
  );

drop policy if exists "conversations_update_coach_group" on public.conversations;
create policy "conversations_update_coach_group"
  on public.conversations for update
  using (public.is_coach() and type = 'group' and team_id = public.current_team_id() and public.current_team_status() = 'active')
  with check (public.is_coach() and type = 'group' and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "conversations_delete_coach_group" on public.conversations;
create policy "conversations_delete_coach_group"
  on public.conversations for delete
  using (public.is_coach() and type = 'group' and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "participants_insert_direct" on public.conversation_participants;
create policy "participants_insert_direct"
  on public.conversation_participants for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
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
    and public.current_team_status() = 'active'
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'group' and c.team_id = public.current_team_id())
    and exists (select 1 from public.profiles p where p.id = user_id and p.team_id = public.current_team_id())
  );

drop policy if exists "participants_delete_coach_group" on public.conversation_participants;
create policy "participants_delete_coach_group"
  on public.conversation_participants for delete
  using (
    public.is_coach()
    and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'group')
  );

drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
    and (public.is_coach() or public.is_athlete())
    and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
  );

drop policy if exists "events_insert_coach_only" on public.events;
create policy "events_insert_coach_only"
  on public.events for insert
  with check (public.is_coach() and created_by = auth.uid() and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "events_update_coach_only" on public.events;
create policy "events_update_coach_only"
  on public.events for update
  using (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active')
  with check (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "events_delete_coach_only" on public.events;
create policy "events_delete_coach_only"
  on public.events for delete
  using (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "event_entries_insert_coach_only" on public.event_entries;
create policy "event_entries_insert_coach_only"
  on public.event_entries for insert
  with check (
    public.is_coach()
    and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.events e where e.id = event_id and e.team_id = public.current_team_id())
  );

drop policy if exists "event_entries_update_coach_only" on public.event_entries;
create policy "event_entries_update_coach_only"
  on public.event_entries for update
  using (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active')
  with check (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "event_entries_delete_coach_only" on public.event_entries;
create policy "event_entries_delete_coach_only"
  on public.event_entries for delete
  using (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active');

drop policy if exists "event_entry_athletes_insert_coach_only" on public.event_entry_athletes;
create policy "event_entry_athletes_insert_coach_only"
  on public.event_entry_athletes for insert
  with check (
    public.is_coach()
    and team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (select 1 from public.event_entries ee where ee.id = entry_id and ee.team_id = public.current_team_id())
    and exists (select 1 from public.profiles ath where ath.id = athlete_id and ath.team_id = public.current_team_id())
  );

drop policy if exists "event_entry_athletes_delete_coach_only" on public.event_entry_athletes;
create policy "event_entry_athletes_delete_coach_only"
  on public.event_entry_athletes for delete
  using (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active');

-- Roster/role-approval — the explicit "approving pending athletes into
-- athlete/coach/admin roles" block. Super admin bypass stays
-- status-independent, same as it already was.
drop policy if exists "profiles_update_coach_only" on public.profiles;
create policy "profiles_update_coach_only"
  on public.profiles for update
  using (
    public.is_super_admin()
    or (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active')
  )
  with check (
    public.is_super_admin()
    or (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() = 'active')
  );

-- team_settings: allowed while pending (the founding coach is explicitly
-- meant to be able to set up their team before approval) and while active,
-- only frozen once rejected.
drop policy if exists "team_settings_update_coach_only" on public.team_settings;
create policy "team_settings_update_coach_only"
  on public.team_settings for update
  using (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() <> 'rejected')
  with check (public.is_coach() and team_id = public.current_team_id() and public.current_team_status() <> 'rejected');

-- ============================================================================
-- RPCs that run SECURITY DEFINER and bypass table RLS internally (same
-- reasoning as multi_tenancy_rls_schema.sql) — the status check has to live
-- in the function body too, not just in a policy.
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

  if public.current_team_status() <> 'active' then
    raise exception 'Group chats are unavailable until your team is approved';
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

  delete from public.conversation_participants
  where user_id = target_id
    and conversation_id in (select id from public.conversations where type in ('team', 'group'));
end;
$$;
