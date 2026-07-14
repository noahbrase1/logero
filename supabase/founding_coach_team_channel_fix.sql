-- Trackward Workout Logging App — Founding coach team-channel fix
-- Run this in the Supabase SQL editor AFTER standalone_super_admin_schema.sql.
-- Safe to re-run.
--
-- The founding coach of a new team (see handle_new_user() in
-- team_approval_schema.sql) gets role='coach' via a direct INSERT into
-- profiles, never an UPDATE — there's no 'pending' -> 'coach' transition for
-- them to go through. add_user_to_team_conversation() (messaging_schema.sql,
-- last redefined in multi_tenancy_schema.sql) only auto-joins someone to
-- their team's channel on an UPDATE that changes role into
-- 'athlete'/'coach'/'admin' — it never fires on INSERT, so the founding
-- coach was never added as a participant of their own team's channel.
-- Everyone approved normally via Pending Approvals goes through an actual
-- UPDATE and is unaffected; this gap is specific to the founding-coach path.

-- Second trigger, same underlying function (it only reads new.id/new.team_id,
-- which are populated identically whether invoked from an insert or update).
drop trigger if exists on_profile_inserted_join_team on public.profiles;
create trigger on_profile_inserted_join_team
  after insert on public.profiles
  for each row
  when (new.role in ('athlete', 'coach', 'admin'))
  execute function public.add_user_to_team_conversation();

-- Backfill: add anyone with an approved role who's currently missing from
-- their team's channel — covers every founding coach created before this
-- fix (including your existing test team).
insert into public.conversation_participants (conversation_id, user_id)
select c.id, p.id
from public.profiles p
join public.conversations c on c.team_id = p.team_id and c.type = 'team'
where p.role in ('athlete', 'coach', 'admin')
on conflict do nothing;
