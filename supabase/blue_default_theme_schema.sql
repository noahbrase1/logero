-- Trackward Workout Logging App — Blue default theme
-- Run this in the Supabase SQL editor after every prior schema file.
--
-- Rebrands the app's default team color from violet (#7c3aed/#5b21b6) to
-- blue (#3b82f6/#1d4ed8), to match the new app icon/logo artwork (see
-- CLAUDE.md's "Mobile & PWA" section — app-front.png/logo.png were
-- replaced with new blue source art in a prior session). This only
-- changes the *default* a team starts with — a coach who has already
-- picked a custom color for their team keeps it untouched, including one
-- who deliberately re-picked the old violet from the preset list (that's
-- now a plain, no-longer-labeled-"default" choice, indistinguishable from
-- any other custom pick once made).

-- ============================================================================
-- New teams going forward.
-- ============================================================================

alter table public.team_settings alter column primary_color set default '#3b82f6';
alter table public.team_settings alter column accent_color set default '#1d4ed8';

-- handle_new_team() (multi_tenancy_schema.sql) inserts each new team's
-- team_settings row explicitly rather than relying on the column default
-- above — CREATE OR REPLACE so both paths agree.
create or replace function public.handle_new_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_settings (team_id, primary_color, accent_color)
  values (new.id, '#3b82f6', '#1d4ed8');

  insert into public.conversations (type, team_id)
  values ('team', new.id);

  return new;
end;
$$;

-- ============================================================================
-- Existing teams still sitting on the untouched original default — moved
-- to the new default so the rebrand is actually visible for them. Scoped
-- tightly to rows matching BOTH old default values exactly, so a team that
-- customized away from the default (even to something that happens to
-- share one of the two old values) is never touched.
-- ============================================================================

update public.team_settings
set primary_color = '#3b82f6', accent_color = '#1d4ed8'
where primary_color = '#7c3aed' and accent_color = '#5b21b6';
