-- Trackward Workout Logging App — Per-rep target times for assigned "other" segments
-- Run this in the Supabase SQL editor after other_segments_schema.sql and
-- assigned_segment_reps_schema.sql (this mirrors that file's shape exactly,
-- just for assigned_other_segments instead of running/swim/bike).
--
-- "Other" was originally left out of the per-rep-target rework (see
-- assigned_segment_reps_schema.sql's header) on the assumption it had its
-- own distinct structure like lifting does — it doesn't. other_segments/
-- other_segment_reps are structurally identical to running_segments/
-- running_segment_reps, and OtherSegmentsEditor already lets an athlete log
-- a separate actual time per rep exactly like running does. Leaving
-- assigned_other_segments on the old single-shared-target shape would just
-- be permanent, arbitrary inconsistency, so it gets the same treatment here.

create table public.assigned_other_segment_reps (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.assigned_other_segments (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  rep_number integer not null,
  target_time_hours integer not null default 0 check (target_time_hours >= 0),
  target_time_minutes integer not null default 0 check (target_time_minutes between 0 and 59),
  target_time_seconds integer not null default 0 check (target_time_seconds between 0 and 59)
);

create index assigned_other_segment_reps_segment_id_idx
  on public.assigned_other_segment_reps (segment_id, rep_number);
create index assigned_other_segment_reps_team_id_idx on public.assigned_other_segment_reps (team_id);

create or replace function public.set_assigned_other_segment_rep_team_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from public.assigned_other_segments where id = new.segment_id;
  return new;
end;
$$;
drop trigger if exists set_assigned_other_segment_rep_team_id_trigger on public.assigned_other_segment_reps;
create trigger set_assigned_other_segment_rep_team_id_trigger
  before insert on public.assigned_other_segment_reps
  for each row execute function public.set_assigned_other_segment_rep_team_id();

alter table public.assigned_other_segment_reps enable row level security;

create policy "assigned_other_segment_reps_select_own_or_coach"
  on public.assigned_other_segment_reps for select
  using (
    team_id = public.current_team_id()
    and exists (
      select 1 from public.assigned_other_segments aos
      join public.assigned_workouts aw on aw.id = aos.assigned_workout_id
      where aos.id = segment_id
        and ((public.is_coach() or public.is_admin()) or (aw.athlete_id = auth.uid() and public.is_athlete()))
    )
  );

create policy "assigned_other_segment_reps_insert_coach_only"
  on public.assigned_other_segment_reps for insert
  with check (
    team_id = public.current_team_id()
    and public.current_team_status() = 'active'
    and exists (
      select 1 from public.assigned_other_segments aos
      join public.assigned_workouts aw on aw.id = aos.assigned_workout_id
      where aos.id = segment_id and public.is_coach() and aw.team_id = public.current_team_id()
    )
  );
