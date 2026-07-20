-- Trackward Workout Logging App — Image upload/sharing in messaging
-- Additive migration: run this in the Supabase SQL editor AFTER
-- multi_tenancy_schema.sql, multi_tenancy_rls_schema.sql, team_approval_schema.sql,
-- and standalone_super_admin_schema.sql — it depends on the final versions of
-- current_team_id(), current_team_status(), is_admin(), is_coach(), is_athlete(),
-- and is_conversation_participant(), and on messages.team_id already existing.
-- Safe to re-run.

-- ============================================================================
-- STORAGE BUCKET
--
-- Private (public = false) — this is what actually blocks a cross-team user
-- from reaching another team's images "via a direct storage URL": a public
-- bucket serves objects over a stable, unsigned URL with zero RLS
-- involvement, regardless of what storage.objects policies say below. Every
-- read here goes through either the Storage API (evaluates the SELECT policy
-- against the caller's JWT) or a signed URL scoped to one specific object
-- path with an expiry, minted by the client at render time.
--
-- file_size_limit / allowed_mime_types are server-side enforcement alongside
-- the client-side checks in src/lib/messages.js — a renamed file extension
-- can't smuggle a disallowed type past this.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-images',
  'message-images',
  false,
  10485760, -- 10MB, in bytes
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- STORAGE RLS: storage.objects
--
-- Path scheme (enforced by convention in src/lib/messages.js, not by these
-- policies — the policies only ever read segments back out):
--   {team_id}/{conversation_id}/{random-uuid}.{ext}
-- storage.foldername(name) splits on '/', so segment [1] is the team_id and
-- [2] is the conversation_id; the filename itself is opaque and never parsed.
--
-- These mirror messages_select_participant / messages_insert_participant
-- (see standalone_super_admin_schema.sql / team_approval_schema.sql)
-- condition-for-condition, just against path segments instead of columns —
-- an admin's existing whole-team read-only view of a conversation shouldn't
-- stop at the image half of it, and only a coach/athlete on an active team
-- who's actually a participant can upload.
--
-- No UPDATE/DELETE policy — nothing in this feature edits or removes a sent
-- image, so default-deny (no policy = no access for that command) is correct.
-- ============================================================================

drop policy if exists "message_images_select" on storage.objects;
create policy "message_images_select"
  on storage.objects for select
  using (
    bucket_id = 'message-images'
    and (
      ((storage.foldername(name))[1] = public.current_team_id()::text and public.is_admin())
      or (
        public.is_conversation_participant(((storage.foldername(name))[2])::uuid)
        and (public.is_coach() or public.is_athlete())
        and (storage.foldername(name))[1] = public.current_team_id()::text
      )
    )
  );

drop policy if exists "message_images_insert" on storage.objects;
create policy "message_images_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'message-images'
    and (storage.foldername(name))[1] = public.current_team_id()::text
    and public.is_conversation_participant(((storage.foldername(name))[2])::uuid)
    and (public.is_coach() or public.is_athlete())
    and public.current_team_status() = 'active'
  );

-- ============================================================================
-- messages TABLE: image_url + relaxed content constraint
--
-- image_url stores the storage PATH, not a URL — the bucket is private, so a
-- signed URL is minted fresh at read time (see resolveMessageImageUrls() in
-- src/lib/messages.js) rather than persisted (it would go stale).
--
-- A message may now be text-only, image-only, or both, but never neither.
-- content's original "not null and non-empty" check constraint is dropped
-- and replaced — its auto-generated name is looked up via pg_constraint
-- rather than guessed, per this repo's own documented pitfall (see the
-- conversations.type widen in messaging_v2_schema.sql for the same pattern).
-- ============================================================================

alter table public.messages add column if not exists image_url text;

do $$
declare
  existing_constraint text;
begin
  select conname into existing_constraint
  from pg_constraint
  where conrelid = 'public.messages'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%char_length%';

  if existing_constraint is not null then
    execute format('alter table public.messages drop constraint %I', existing_constraint);
  end if;
end $$;

alter table public.messages alter column content drop not null;

alter table public.messages drop constraint if exists messages_content_or_image_check;
alter table public.messages add constraint messages_content_or_image_check
  check (
    (content is not null and char_length(trim(content)) > 0)
    or image_url is not null
  );
