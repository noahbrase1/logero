-- Trackward Workout Logging App — full data reset
-- Run this in the Supabase SQL editor. This is destructive and irreversible
-- — it empties every application table (every team, coach, athlete, admin,
-- and all their workouts/messages/events/etc). Run the verification query at
-- the bottom afterward and confirm every count is 0 before doing anything
-- else.
--
-- This does NOT touch:
--   - auth.users (Supabase's own auth schema) — delete those separately via
--     the Dashboard (Authentication → Users) AFTER running this script. See
--     the note at the bottom for why this order matters.
--   - public.super_admins — standalone super-admin accounts are
--     infrastructure, not a team/coach/athlete, and are deliberately left
--     alone (see standalone_super_admin_schema.sql). Truncate it separately,
--     on purpose, if you actually want to remove super admins too.
--   - storage.objects in the message-images bucket — old uploaded images
--     become orphaned (nothing references them once messages is emptied,
--     and no team will ever match their path again) but are not deleted by
--     SQL. Clear them from the Dashboard's Storage browser if you want a
--     fully clean slate there too.

-- ============================================================================
-- STEP 1: wipe every application table in one atomic statement. CASCADE
-- ensures Postgres handles the full foreign-key dependency graph regardless
-- of the order tables are listed in.
-- ============================================================================

truncate table
  public.profiles,
  public.teams,
  public.workouts,
  public.running_segments,
  public.running_segment_reps,
  public.swim_segments,
  public.swim_segment_reps,
  public.bike_segments,
  public.bike_segment_reps,
  public.lifting_exercises,
  public.assigned_workouts,
  public.assigned_running_segments,
  public.assigned_swim_segments,
  public.assigned_bike_segments,
  public.assigned_lifting_targets,
  public.conversations,
  public.messages,
  public.conversation_participants,
  public.workout_comments,
  public.events,
  public.event_entries,
  public.event_entry_athletes,
  public.team_settings,
  public.push_subscriptions
restart identity cascade;

-- ============================================================================
-- STEP 2: verify — every row below should read 0.
-- ============================================================================

select 'profiles' as table_name, count(*) from public.profiles
union all select 'teams', count(*) from public.teams
union all select 'workouts', count(*) from public.workouts
union all select 'running_segments', count(*) from public.running_segments
union all select 'running_segment_reps', count(*) from public.running_segment_reps
union all select 'swim_segments', count(*) from public.swim_segments
union all select 'swim_segment_reps', count(*) from public.swim_segment_reps
union all select 'bike_segments', count(*) from public.bike_segments
union all select 'bike_segment_reps', count(*) from public.bike_segment_reps
union all select 'lifting_exercises', count(*) from public.lifting_exercises
union all select 'assigned_workouts', count(*) from public.assigned_workouts
union all select 'assigned_running_segments', count(*) from public.assigned_running_segments
union all select 'assigned_swim_segments', count(*) from public.assigned_swim_segments
union all select 'assigned_bike_segments', count(*) from public.assigned_bike_segments
union all select 'assigned_lifting_targets', count(*) from public.assigned_lifting_targets
union all select 'conversations', count(*) from public.conversations
union all select 'messages', count(*) from public.messages
union all select 'conversation_participants', count(*) from public.conversation_participants
union all select 'workout_comments', count(*) from public.workout_comments
union all select 'events', count(*) from public.events
union all select 'event_entries', count(*) from public.event_entries
union all select 'event_entry_athletes', count(*) from public.event_entry_athletes
union all select 'team_settings', count(*) from public.team_settings
union all select 'push_subscriptions', count(*) from public.push_subscriptions;

-- ============================================================================
-- STEP 3 (manual, outside SQL editor): delete every auth.users account.
--
-- Do this AFTER step 1, not before — profiles.id references auth.users(id)
-- with ON DELETE CASCADE, but teams and several other tables have no such
-- link back to auth.users at all, so deleting users first would leave
-- orphaned teams/rows behind. Running the truncate first guarantees a clean
-- slate regardless.
--
-- In the Supabase Dashboard:
--   1. Go to your project → Authentication → Users.
--   2. Select all users (header checkbox) and click Delete.
--   3. If the list is paginated, repeat until the Users table is empty.
--   4. Confirm the list shows zero users.
--
-- After both steps, sign out of the app in your browser — any existing
-- session token refers to a now-deleted user and will otherwise error.
-- ============================================================================
