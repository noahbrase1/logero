-- Trackward Workout Logging App — Quick notes
-- Run this in the Supabase SQL editor after the prior schema files.
--
-- Adds a lightweight "note" workout type alongside running/lifting: just a
-- date + free-text content (stored in the existing `notes` column), no
-- segments or exercises. Both athletes and coaches can post one — this is
-- new for coaches, who previously had no INSERT access to `workouts` at all.
-- Structured running/lifting logging stays athlete-only.

-- ============================================================================
-- Allow the new type, and let a quick note skip the workout name.
-- ============================================================================

-- Find and drop whatever the original `type in ('running','lifting')` check
-- constraint is actually named (rather than assuming Postgres's default
-- auto-generated name), so this doesn't silently no-op if it differs.
do $$
declare
  existing_constraint text;
begin
  select conname into existing_constraint
  from pg_constraint
  where conrelid = 'public.workouts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%type%running%lifting%';

  if existing_constraint is not null then
    execute format('alter table public.workouts drop constraint %I', existing_constraint);
  end if;
end $$;

alter table public.workouts drop constraint if exists workouts_type_check;
alter table public.workouts add constraint workouts_type_check
  check (type in ('running', 'lifting', 'note'));

alter table public.workouts alter column name drop not null;

-- ============================================================================
-- RLS: let coaches insert their own note-type rows only. This is a second,
-- additive permissive policy — it doesn't touch workouts_insert_own_athlete,
-- so athletes keep inserting any type (including notes) exactly as before,
-- and coaches still can't insert running/lifting rows.
-- ============================================================================

drop policy if exists "workouts_insert_own_coach_note" on public.workouts;
create policy "workouts_insert_own_coach_note"
  on public.workouts for insert
  with check (user_id = auth.uid() and public.is_coach() and type = 'note');
