# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start Vite dev server (http://localhost:5173)
npm run build     # production build to dist/
npm run preview   # preview the production build
npm run lint      # oxlint
```

There is no test suite in this project.

**Node version**: the system default `node` may be too old for this project's Vite version (which requires Node 18+). If `npm run dev`/`npm run build` fail outright, switch to a newer Node first, e.g. `nvm use 20`.

**Environment**: Supabase connection lives in `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), read by `src/lib/supabaseClient.js`. `VITE_VAPID_PUBLIC_KEY` (see "Push notifications" below) lives there too — safe to expose, it's the public half of a VAPID key pair. `.env.example` documents the shape without values.

**Deployment**: see "Deployment: Cloudflare Workers" below — this is not a local-only project, it's live at a `*.workers.dev` URL, redeploying automatically on every push to `main`.

## Project structure

```
index.html                     # Vite entry; static <title> fallback (kept in sync with src/config.js); PWA meta tags (manifest link, apple-mobile-web-app-*, theme-color) — see "Mobile & PWA" below
vite.config.js
wrangler.jsonc                  # Cloudflare Workers static-assets deploy config — see "Deployment" below
package.json
.env / .env.example             # Supabase URL + anon key + VITE_VAPID_PUBLIC_KEY (see Environment above)

public/                         # favicons, apple-touch-icon.png, logo.png — all generated from infinity.png (the source artwork; wide/non-square, so icons are built from a square canvas centered on the shape's own bounding box, not a plain crop — see "Mobile & PWA" below for the transparent-vs-opaque split)
├── manifest.json                # PWA manifest — name/icons/theme_color/display:standalone
├── service-worker.js            # app-shell caching + push notification handling — see "Mobile & PWA" below
├── offline.html                 # precached fallback page shown for a failed navigation with nothing cached yet
├── icon-192.png / icon-512.png  # PWA install icons — opaque (Apple/Android home-screen icon guidance), unlike favicon.svg/logo.png which are transparent
└── icons.svg / logo-source.png  # unused leftovers, not referenced by any code — harmless, not wired into anything

supabase/                       # additive .sql files, run by hand and in order — see "Supabase schema" below
├── schema.sql                  # profiles/workouts/running_splits/lifting_exercises + core RLS helpers (is_coach, is_athlete)
├── messaging_schema.sql        # conversations/conversation_participants/messages + DM RPC
├── features_v2_schema.sql      # team_settings, events, workout_comments, assigned_workouts (+ assigned_running_targets)
├── running_segments_schema.sql # replaces running_splits with running_segments/running_segment_reps
├── assigned_running_segments_schema.sql  # replaces assigned_running_targets with assigned_running_segments
├── quick_notes_schema.sql      # adds workouts.type = 'note'
├── messaging_v2_schema.sql     # athlete-initiated DMs + group conversations
├── event_entries_schema.sql    # meet lineups (event_entries, event_entry_athletes)
├── event_entry_teams_schema.sql # relay sub-teams for lineup entries
├── remove_athlete_schema.sql   # profiles.role = 'removed', RLS tightening, remove_athlete() RPC (first pass — see remove_athlete_archive_schema.sql)
├── multi_tenancy_schema.sql    # teams table + team_id on every team-scoped table, never trusted from the client — BEFORE INSERT triggers auto-derive it from the parent/owner row
├── multi_tenancy_rls_schema.sql # every table's RLS rewritten to check team_id; adds the read-only 'admin' role
├── multi_tenancy_invite_signup_schema.sql # get_team_by_invite_code() RPC backing the invite-link signup flow
├── multi_tenancy_super_admin_schema.sql   # original profiles.is_super_admin flag — superseded by standalone_super_admin_schema.sql, kept for history
├── team_approval_schema.sql    # teams.status (pending/active/rejected), founding-coach signup, status-gated writes across every table
├── standalone_super_admin_schema.sql # REPLACES profiles.is_super_admin with a standalone super_admins table; strips the super-admin RLS bypass from every team-scoped table
├── founding_coach_team_channel_fix.sql # founding coach never auto-joined their own team channel (INSERT vs UPDATE trigger gap) — second trigger + backfill
├── self_service_profile_schema.sql # update_own_name() RPC (email/password go through supabase-js's own auth.updateUser()/signInWithPassword(), no SQL needed)
├── remove_athlete_archive_schema.sql # remove_athlete() also deletes their team/group messages + DMs outright; logs are preserved but kept out of the active feed client-side
├── reject_pending_delete_schema.sql  # rejecting a pending signup deletes the auth.users row outright (not a soft-remove), freeing the email for re-signup
├── swimming_schema.sql         # adds workouts.type = 'swim' + assigned_workouts.type = 'swim'; swim_segments/swim_segment_reps mirror running_segments/running_segment_reps (distance_unit adds 'yards'); assigned_swim_segments mirrors assigned_running_segments — team_id is NOT NULL from creation (not backfilled later) since multi-tenancy already existed when this file was written
├── cycling_schema.sql          # adds workouts.type = 'bike' + assigned_workouts.type = 'bike'; bike_segments/bike_segment_reps mirror swim_segments/swim_segment_reps but distance_unit is miles/km only, and bike_segment_reps adds two OPTIONAL per-rep columns (avg_watts, avg_cadence) with no default, left null when an athlete has no power meter/cadence sensor; assigned_bike_segments mirrors assigned_swim_segments (target time only — no target watts/cadence)
├── event_times_schema.sql      # adds events.start_time / events.end_time (both nullable time columns, no RLS change — the existing coach-only insert/update policies already gate the whole row)
├── push_notifications_schema.sql # push_subscriptions table + RLS only — deliberately does NOT create the messages→send-push-notification database webhook in SQL (see "Push notifications" below for why); that part is set up by hand in the Dashboard
├── message_images_schema.sql   # messages.image_url + relaxed content constraint (text-only/image-only/both, never neither) + the `message-images` Storage bucket (private) and its storage.objects RLS — see "Messaging" below for the image-sharing feature
└── coach_to_coach_dm_schema.sql # widens get_or_create_direct_conversation() + participants_insert_direct to also allow coach<->coach DMs (previously only coach<->athlete) — athlete<->athlete stays rejected

reset_all_data.sql is a separate, standalone destructive utility (truncates every application table) for wiping a dev database back to empty — it is not part of the ordered chain above and should never be run against real data without explicit confirmation.

supabase/functions/                # Supabase Edge Functions (Deno) — see "Push notifications" below. The only one in the project so far:
└── send-push-notification/index.ts # triggered by a Database Webhook on new `messages` rows; sends Web Push via VAPID keys held as function secrets, never in this repo

src/
├── main.jsx                    # React root; sets document.title from config.js
├── App.jsx                     # single route gate (super admin, then role) — see "Roles and route gating" below
├── config.js                   # APP_NAME — the one place to change the app's display name
├── index.css                   # design tokens + all app styles — see "Design tokens" below
│
├── context/
│   ├── AuthContext.jsx          # session + profile loading; exposes user/profile/role/teamStatus/isSuperAdmin/refreshProfile/signOut
│   ├── ThemeContext.jsx          # fetches the caller's own team_settings row (RLS-scoped, one row per team), applies palette as CSS custom properties
│   └── ToastContext.jsx          # useToast(), mounted once in main.jsx
│
├── lib/                        # one Supabase query module per domain — see "Data layer convention" below
│   ├── supabaseClient.js        # the only place supabase-js is instantiated
│   ├── workouts.js               # workouts/profiles/roster queries (fetchTeamRoster, removeAthlete, reinstateAthlete, approveProfile, rejectProfile)
│   ├── assignments.js            # assigned_workouts + targets, plus deleteAssignment()/assignmentToFormPayload()/date-range fetchAssignmentsForCoach() for the coach assignment grid (see "Coach assignment grid" below)
│   ├── messages.js               # conversations/messages, DM + group RPC wrappers, fetchAllTeamConversations (admin-only team-wide visibility), image upload/signed-URL helpers (see "Messaging" below)
│   ├── events.js                 # events + meet lineups
│   ├── teamSettings.js           # team_settings read/update (RLS-scoped to the caller's own team)
│   ├── workoutComments.js        # coach comments on a workout
│   ├── teams.js                  # invite-code resolution, self-service team creation, super-admin stats/pending-teams/approve/reject
│   ├── account.js                # self-service name/email/password updates — see "Account self-service" below
│   └── pushNotifications.js      # Push API subscribe/unsubscribe + push_subscriptions upsert/delete — see "Push notifications" below
│
├── pages/                      # one component per route registered in App.jsx
│   ├── LoginPage.jsx / SignUpPage.jsx / CreateTeamPage.jsx   # SignUpPage = invite-code flow; CreateTeamPage = public self-service team creation
│   ├── PendingPage.jsx           # role === 'pending' gate screen
│   ├── RemovedPage.jsx           # role === 'removed' gate screen
│   ├── TeamFeedPage.jsx          # coach/admin home ("Team Logs")
│   ├── LogWorkoutPage.jsx        # thin wrapper around LogWorkoutForm at /log and /edit/:workoutId — not nav-linked; the athlete calendar opens LogWorkoutForm directly in a modal instead, see "Athlete calendar" below
│   ├── WorkoutHistoryPage.jsx    # coach/admin only now, via AthleteDetailPage (userId prop) — athletes no longer have a standalone History tab, see "Athlete calendar" below
│   ├── RosterPage.jsx / FormerAthletesPage.jsx / AthleteDetailPage.jsx   # RosterPage shows pending sign-ups (coach-only; Approve as Athlete/Coach/Admin, or Reject — deletes the account outright) above the approved roster on one page, not a separate tab; FormerAthletesPage carries the Reinstate action
│   ├── MessagesPage.jsx          # shared, branches on profile.role internally — admin sees every team conversation, not just its own
│   ├── TeamSettingsPage.jsx      # coach edits / admin views theme, plus the team's invite link
│   ├── AccountSettingsPage.jsx   # self-service name/email/password, plus a push-notifications opt-in toggle — any logged-in athlete/coach/admin
│   ├── EventsPage.jsx / EventDetailPage.jsx   # shared across all three role trees; "Calendar" in nav (renamed from "Events") — athlete home (`/`), see "Athlete calendar" below
│   ├── CoachAssignmentsPage.jsx  # List/Grid toggle (Grid default for coaches; admin is List-only, no Grid button at all) — see "Coach assignment grid" below
│   └── SuperAdminPage.jsx        # the entire standalone super-admin experience — see "Super admin" below
│
├── components/                 # shared/reusable pieces used across pages
│   ├── NavBar.jsx                # coach/admin/athlete nav — never rendered for a super admin; hamburger + slide-out drawer below ~860px (see "Mobile & PWA" below), full row above it
│   ├── SuperAdminHeader.jsx      # minimal header for the super-admin-only branch; deliberately not a NavBar variant — no drawer, so its logout button needs its own carve-out from NavBar's mobile CSS (`.navbar-simple`)
│   ├── TeamStatusBanner.jsx      # renders when the caller's team is pending/rejected, null otherwise
│   ├── WorkoutListItem.jsx       # dispatches WorkoutCard vs QuickNoteCard by workout.type
│   ├── WorkoutCard.jsx / QuickNoteCard.jsx / QuickNoteForm.jsx / WorkoutComments.jsx
│   ├── RunningSegmentsEditor.jsx / AssignedSegmentsEditor.jsx / SwimSegmentsEditor.jsx / AssignedSwimSegmentsEditor.jsx / BikeSegmentsEditor.jsx / AssignedBikeSegmentsEditor.jsx / TimeTextInput.jsx  # TimeTextInput deliberately has no `inputMode="numeric"` — that forces mobile's digit-only keypad, which has no colon key, making "6:45"-style values impossible to type
│   ├── TargetVsActual.jsx        # renders assignment target vs. logged actual, including both distances side by side (e.g. "Target: 10mi @ 6:24/mi" vs "Actual: 9mi — ..."), not just pace/time
│   ├── ConversationList.jsx / ConversationView.jsx / GroupCreateForm.jsx / GroupManageControls.jsx  # ConversationList is the iOS-Messages-style avatar/preview/timestamp row list — used at every screen size (not just mobile, despite some `.mobile-inbox`/`.mobile-convo-*` CSS class names left over from when it was mobile-only), see "Messaging" below
│   ├── EventEntryForm.jsx / AthleteChecklist.jsx / EventCard.jsx / EventForm.jsx
│   ├── EventCalendar.jsx         # month calendar — team events (all roles) + an athlete's own assignments/logged workouts/mileage + the in-modal logging flow — see "Athlete calendar" below
│   ├── LogWorkoutForm.jsx        # the actual create/edit workout form, extracted from LogWorkoutPage so EventCalendar can render it in a Modal with no page navigation at all — see "Athlete calendar" below
│   ├── AssignmentForm.jsx        # sport-type-toggle + segment-editor + notes sub-form, extracted from CoachAssignmentsPage so AssignmentGrid's cell modal doesn't duplicate it — see "Coach assignment grid" below
│   ├── AssignmentGrid.jsx        # coach-only weekly athlete×day grid — click-drag/ctrl-click selection + copy/paste — see "Coach assignment grid" below
│   ├── Modal.jsx                 # generic overlay (backdrop-click/Escape to close) — this app's first; used by AssignmentGrid's cell editor and EventCalendar's logging flow, each styled separately rather than sharing the messaging feature's image lightbox CSS
│   ├── WorkoutTypeIcon.jsx / RunnerSprite.jsx  # fixed sport-type icon; looping login/signup hero animation — see "Team color theming" / "Auth pages" below
│   └── StatRow.jsx / MetricCardRow.jsx / Skeleton.jsx  # dashboard-stat tiles (plain vs. bold-colored) and loading-placeholder primitives
│
└── utils/                       # pure helpers, no Supabase calls
    ├── format.js                 # date/time/pace formatting, getInitials()/formatConversationTimestamp() for the conversation list, summarizeAssignment()/formatTargetPace()/sumAssignedDistanceMiles()/sumLoggedDistanceMiles() for the assignment grid and athlete calendar
    ├── week.js                   # pure date-math (toDateStr/parseDateStr/startOfWeek/addDays/formatWeekRangeLabel) — genuinely shared, unlike the deliberately-separate per-sport segment editors
    ├── conversationReadState.js  # localStorage-based "last seen per conversation" for the unread dot — see "Messaging" below for why this is client-side, not a schema column
    ├── lineup.js                 # meet-lineup grouping/sorting logic
    └── lineupPdf.js               # PDF export (jspdf)
```

## Architecture

This is a single-page React app (Vite, plain CSS, `react-router-dom`) with **no backend of its own** — Supabase (Postgres + Auth + Realtime) is the entire backend, accessed directly from the browser via the anon key and secured entirely through Postgres Row Level Security. There is no Express/serverless layer; every read/write goes through `@supabase/supabase-js` and is authorized by RLS policies, not application code.

### Roles and route gating

Every user has a `profiles` row with `role` = `pending | athlete | coach | admin | removed` (set via a trigger on `auth.users` insert). `admin` is a read-only, in-team "athletic director" role — it sees everything a coach sees (roster, all logs, every conversation on the team, events) but can never write anything; every write-gated RLS policy and UI control checks for `coach` specifically, never `admin`. `AuthContext` (`src/context/AuthContext.jsx`) loads the session, checks `super_admins` (see below), then the matching `profiles` row, and exposes `user`/`profile`/`role`/`teamStatus`/`isSuperAdmin`. `App.jsx` is the single gate that decides what renders, in this order:

- no session → auth routes only (`/login`, `/signup`, `/create-team`)
- `isSuperAdmin` → an entirely separate branch (see "Super admin" below) — checked **before** the role gates, since a super admin has no `profiles` row at all and so `role` is always `null` for them
- `role === 'pending'` or `null` → `PendingPage`, nothing else
- `role === 'removed'` → `RemovedPage`, nothing else
- `role === 'coach'` vs `'admin'` vs everything else (`athlete`) → **three separate `<Routes>` trees** defined inline in `App.jsx`, not a shared route set with permission checks. When adding a page, decide which tree(s) it belongs in and add the `<Route>` there (and to `NavBar.jsx`) — there's no central route config to update elsewhere. The `admin` tree reuses the same page components as `coach` — each page hides its own write controls internally by checking `profile.role === 'coach'` (e.g. RosterPage's pending-signups section only fetches/renders for a coach).

A handful of pages (`EventsPage`/`EventDetailPage`, `MessagesPage`) are shared across all three trees and branch on `profile.role` internally instead of being duplicated. `WorkoutHistoryPage` used to be one of these (an athlete's own `/history`) but isn't anymore — the athlete tree has no History or Assignments routes at all now (see "Athlete calendar" below); `WorkoutHistoryPage` is only reachable via `AthleteDetailPage` (coach/admin viewing one athlete's history through the roster).

### Multi-tenancy: teams

Every team-scoped table (`workouts`, `running_segments`, `running_segment_reps`, `swim_segments`, `swim_segment_reps`, `bike_segments`, `bike_segment_reps`, `lifting_exercises`, `assigned_workouts` + its children, `conversations`, `conversation_participants`, `messages`, `workout_comments`, `events`, `event_entries`, `event_entry_athletes`, `team_settings`, `profiles`) has a NOT NULL `team_id`. It is **never trusted from the client** — a `BEFORE INSERT` trigger on each of those tables overwrites `team_id` with the value derived from the parent row (or, for tables with a direct owner column like `workouts.user_id`, from that user's own `profiles.team_id`), so no RLS `WITH CHECK` can be bypassed by lying about `team_id` even before it's evaluated. RLS policies then just compare `team_id = current_team_id()` (a `SECURITY DEFINER` helper reading the caller's own `profiles.team_id`), never inlining that subquery directly.

`teams.status` is `pending | active | rejected` and gates *write* access (not read) across the same set of tables via `current_team_status() = 'active'` (or `<> 'rejected'` for `team_settings`, which a founding coach is meant to keep editing while pending). A brand-new team's coach can view/adjust their own team's setup while pending, but can't approve roster changes, send messages, log workouts, or create events/assignments until a super admin approves the team. `TeamStatusBanner` (`src/components/TeamStatusBanner.jsx`) renders app-wide for `pending`/`rejected`.

Two ways to end up on a team:
- **Invite link** (`/signup?invite=CODE`) — `SignUpPage` resolves the code via the `get_team_by_invite_code()` RPC (the only thing granted to `anon`), then signs up with `team_id` in the auth metadata. `handle_new_user()` inserts the profile as `role = 'pending'`, same as always.
- **Self-service team creation** (`/create-team`) — `CreateTeamPage` calls `create_pending_team()` (also `anon`-callable) to create a brand-new `status = 'pending'` team, then signs up against that team's id. `handle_new_user()` detects — purely from server state, never a client-supplied flag — that the target team has `status = 'pending'` **and** zero existing profiles, and makes that one signup `role = 'coach'` immediately instead of `'pending'`. Any other signup against that same team (even later while it's still pending) falls through to the normal `'pending'` path, since the team now has a member.

A signup with no `team_id` in its metadata (e.g. a Dashboard-created `auth.users` row) is left profile-less rather than failing — see "Super admin" below for why that matters.

### Super admin

Completely separate from the `profiles`/`teams` role system — a super admin has **no** `profiles` row and **no** `team_id`. Status comes exclusively from a row in the standalone `super_admins` table (`id` references `auth.users`, `email`, `created_at`). There is no INSERT policy on that table and no in-app path to grant it — the only way to create one is manual: a Dashboard-created `auth.users` row, followed by a one-time SQL insert into `super_admins`. Never route this account through the app's own signup.

Read access is intentionally the narrowest slice in the app, enforced at the RLS/RPC level (not just hidden in the UI — verified during this build via direct REST calls with a super admin's own bearer token, which return `[]`, not an error, for every team-scoped table):

- `get_team_stats()` — every team's name/status/created_at plus aggregate athlete/workout *counts only* (no `invite_code` — that's a credential, not a stat).
- `get_pending_teams()` — a pending team's founding coach name/email only, via a `SECURITY DEFINER` read of `auth.users` (the sole sanctioned path to that data; the client has no direct grant on the `auth` schema).
- `set_team_status()` — can only transition a currently-`pending` team to `active` or `rejected`, nothing else (no renaming, no touching an already-active team).

Every other table that previously had an `is_super_admin()` RLS bypass branch (`profiles`, `workouts`, `messages`, `conversations`, `team_settings`, `events`, etc.) has had that branch stripped entirely. `App.jsx` renders `SuperAdminHeader` (not `NavBar`) and a single route to `SuperAdminPage` for this branch — there are no team-scoped routes in it at all.

### Data layer convention

Every Supabase query is wrapped in a `src/lib/*.js` module, one per domain (`workouts.js`, `messages.js`, `assignments.js`, `events.js`, `teamSettings.js`, `workoutComments.js`, `teams.js`, `account.js`, `pushNotifications.js`). Pages and components call these functions and never import `supabaseClient` directly. Follow this pattern for new data access rather than inlining `supabase.from(...)` calls in components.

### Supabase schema — additive SQL files, run manually

There is no *migration* tooling wired up for schema changes — those are plain `.sql` files under `supabase/`, meant to be pasted into the Supabase SQL editor by hand, **in order** — see the full annotated list in "Project structure" above for what each one does; the run order is exactly the order listed there. The Supabase CLI (`npx supabase ...`, no local install needed) is used for one thing only: deploying the Edge Function (see "Push notifications" below) — `supabase functions deploy` and `supabase secrets set`, not schema/migrations.

Each file is written to be idempotent (`create table if not exists`, `drop policy if exists` before `create policy`, etc.) so it's safe to re-run. **Never edit a file that may have already been run against the live database** — add a new additive file instead, matching the existing naming/dating pattern, and note which prior file(s) it depends on in its header comment.

Non-obvious pitfalls hit repeatedly while building this schema, worth knowing before touching RLS or functions:

1. **`RETURNING` is filtered by the SELECT policy, not just the INSERT policy.** `supabase.from(x).insert(row).select()` asks Postgres to return the new row, which must pass that table's SELECT policy — not only the INSERT `WITH CHECK`. This breaks in a chicken-and-egg way whenever a SELECT policy depends on a related row that the same operation is *about to* create (e.g. a conversations table gated by "must already be a participant", inserted by the very user who isn't a participant yet). Fix: either drop `.select()` on that insert (generate the id client-side instead), or do the whole sequence inside a `SECURITY DEFINER` RPC, which bypasses RLS internally. See `get_or_create_direct_conversation` / `create_group_conversation` in the messaging schema files for the RPC pattern, and `createGroupConversation` in `src/lib/messages.js` for the client-generated-id pattern.
2. **Don't guess an auto-generated constraint name when altering it.** An inline `check (...)` with no explicit name gets a Postgres-assigned name that isn't guaranteed to match the `<table>_<column>_check` convention. `drop constraint if exists <guessed-name>` fails silently (no error, no effect) if the guess is wrong, so a later `add constraint` with the same guessed name creates a second, still-restrictive constraint alongside the untouched original. Look the real name up first via `pg_constraint`/`pg_get_constraintdef` and drop that — see the `conversations.type` or `workouts.type` constraint updates for the pattern.
3. **`CREATE OR REPLACE FUNCTION` can't change a function's return columns.** Changing a `RETURNS TABLE (...)` shape (e.g. dropping/adding a column) needs an explicit `DROP FUNCTION` first — `CREATE OR REPLACE` alone fails with `cannot change return type of existing function`. See the `drop function if exists public.get_team_stats();` in `standalone_super_admin_schema.sql`.
4. **A `RETURN QUERY` column type must match the declared return type exactly, not just "compatibly."** `auth.users.email` is `character varying`, not `text` — returning it uncast from a function declared `returns table (... founder_email text)` fails at *call time* (not at `CREATE FUNCTION` time) with `structure of query does not match function result type`. Cast explicitly (`u.email::text`) whenever pulling a `varchar` column into a `text`-typed return column.
5. **A trigger that only fires `AFTER UPDATE` misses rows created with the target state already set.** `add_user_to_team_conversation()` only ran on `AFTER UPDATE ... WHEN (old.role IS DISTINCT FROM new.role AND new.role IN (...))`, which by definition never fires for a row `INSERT`ed with that role already in place — exactly what happens for a founding coach (`INSERT ... role = 'coach'` directly, never a `'pending' → 'coach'` update). Fixed with a second, INSERT-scoped trigger sharing the same function (`founding_coach_team_channel_fix.sql`). Worth checking for the same gap any time a row can be created *already* in a state that's normally only reached via an update.
6. **`supabase_functions.http_request` (the trigger-based way to call an Edge Function from SQL) needs the `supabase_functions` schema, which isn't pre-provisioned on every project.** It's only created the first time a project sets up a Database Webhook — a committed SQL trigger calling it on a project that's never used Database Webhooks before fails with `schema "supabase_functions" does not exist`. The Dashboard's own webhook-creation UI provisions that schema automatically as a side effect, so that's the reliable path for a project's *first* webhook rather than trying to replicate it in raw SQL upfront — see `push_notifications_schema.sql`'s header comment, which only creates the underlying table there and leaves the webhook itself to the Dashboard.
7. **PostgREST's `.upsert(..., { onConflict: 'col1,col2' })` needs a real unique constraint on plain columns — it can't reliably target one defined on a jsonb expression index.** `push_subscriptions` originally tried a unique index on `(user_id, (subscription ->> 'endpoint'))` to dedupe by device without a redundant column; the client-side upsert couldn't resolve it. Fixed by duplicating `endpoint` as its own real `text` column with a plain unique constraint on `(user_id, endpoint)`, even though the same value already lives inside the `subscription` jsonb blob.

RLS leans on a small set of `SECURITY DEFINER` helper functions (`is_coach()`, `is_athlete()`, `is_admin()`, `is_super_admin()`, `is_conversation_participant(conv_id)`, `current_team_id()`, `current_team_status()`) so policies can check role/team/membership without recursing into RLS on `profiles`/`teams`/`conversation_participants` themselves. Reuse these rather than inlining the same subqueries.

### Workout data model

A "workout" is one row in `workouts` with `type` = `running | swim | bike | lifting | note`:

- `running` — optionally has child rows in `running_segments` (each segment has a `distance_value`/`distance_unit` and a generated `distance_meters` for cross-unit math) and `running_segment_reps` (per-rep times, supports interval/relay-style workouts with multiple reps per segment). Segments are optional — a running workout can be logged as just notes/effort with no segment breakdown.
- `swim` — same segment/rep shape as `running`, in `swim_segments`/`swim_segment_reps` (see `supabase/swimming_schema.sql`), just with `yards` added to the `distance_unit` option set (`yards | meters | miles`) since pool lengths are the common case. No pace is shown for swim (unlike running) — `WorkoutCard`'s swim segment summary is just the times list. Entry UI is `SwimSegmentsEditor.jsx` (parallel to `RunningSegmentsEditor.jsx`, not a shared component, consistent with how this codebase already keeps per-type UI concrete rather than abstracted).
- `bike` — same segment/rep shape again, in `bike_segments`/`bike_segment_reps` (see `supabase/cycling_schema.sql`), with `distance_unit` restricted to `miles | km` (no track-length units). `bike_segment_reps` adds two OPTIONAL per-rep columns, `avg_watts`/`avg_cadence` — nullable, no default, shown alongside the time only when present (`summarizeBikeReps()` in `src/utils/format.js` averages them across only the reps that have a value). Entry UI is `BikeSegmentsEditor.jsx`.
- `lifting` — child rows in `lifting_exercises`.
- `note` — a "quick log" with no children, just `date` + `notes`; both athletes and coaches can create these (everything else under `workouts` is athlete-only to write). `src/components/WorkoutListItem.jsx` is the dispatcher that renders the right card (`WorkoutCard` vs `QuickNoteCard`) based on `type` — render workout lists through it rather than choosing the card component yourself.

`assigned_workouts` (+ `assigned_running_segments` / `assigned_swim_segments` / `assigned_bike_segments` / `assigned_lifting_targets`) mirror this same shape as coach-assigned targets — `assigned_bike_segments` carries only a target time per segment, same as running/swim, since watts/cadence are actuals-only concepts an athlete logs, not something a coach assigns a target for; `workouts.assignment_id` links a logged workout back to the assignment it fulfills, and `TargetVsActual` renders the comparison (target and actual distance side by side, not just pace/time). The same distance math also powers the athlete calendar's day-cell mileage — see "Athlete calendar" below.

`fetchRecentTeamFeed()` (the Team Logs home feed) excludes anyone with `role = 'removed'` via a query-level filter (`profiles!inner(...).neq('profiles.role', 'removed')`), not RLS — their logs are still fully intact and visible via Former Athletes → their detail page, just kept out of the active aggregate feed. See "Roster lifecycle" below.

### Roster lifecycle: remove / reinstate / reject

Three different actions that look similar but do genuinely different things — worth not conflating:

- **Remove** (`RosterPage`, coach only, active athlete → `role = 'removed'`) — `remove_athlete()` RPC. Their workout logs are preserved (never deleted, never altered) but excluded from the active Team Logs feed as described above. Their own messages in the team channel and any group chats are **permanently deleted** (other members' messages in those same conversations are untouched); any DM they had with a coach is **deleted entirely** (the `conversations` row itself, cascading to its messages/participants) rather than just hidden. The confirmation dialog states both consequences explicitly.
- **Reinstate** (`FormerAthletesPage`, coach only, `'removed' → 'athlete'`) — a plain client-side `profiles` update, no RPC needed: `profiles_update_coach_only` already lets a coach set any role on any of their team's profiles, and the existing team-channel auto-join trigger fires on this exact transition and re-adds them for free. Their workout logs simply reappear in the feed (they were never removed from it in the database). Their deleted messages are **not** restored — that deletion was permanent by design.
- **Reject** (`RosterPage`'s pending-signups section, coach only, a `'pending'` signup that was never approved) — `reject_pending_profile()` **deletes the `auth.users` row outright** (`profiles.id` cascades automatically), not a soft-remove like the other two. This is deliberately different: a pending user can't have created anything worth archiving (RLS blocks all writes and the team-channel auto-join trigger never fires for `role = 'pending'`), and — the actual reason this matters — Supabase enforces email uniqueness at the `auth.users` level regardless of what `profiles.role` says, so soft-removing would permanently block that email from ever signing up again.

### Account self-service

`/account` (`AccountSettingsPage`, any logged-in athlete/coach/admin — not pending/removed/super admin) has three independent forms:

- **Name** — `update_own_name()` RPC. A narrow, `SECURITY DEFINER` function that only ever touches the `name` column, hardcoded to `auth.uid()` — deliberately not a general `id = auth.uid()` RLS policy, since RLS can't restrict which *columns* a client's `UPDATE` touches (a loose policy would let a client smuggle a `role`/`team_id` change through the same request).
- **Email** — `supabase.auth.updateUser({ email })` directly, no `profiles`/SQL involvement at all. Does not take effect immediately — Supabase's own "secure email change" flow requires confirmation via email first. This depends on the Supabase project having a working mailer (custom SMTP); the shared built-in dev mailer is rate-limited and not reliable for this.
- **Password** — `supabase.auth.updateUser({ password })`. Supabase's API has no "current password" concept (an active session is already proof of auth), so the product's explicit re-entry requirement is implemented by calling `supabase.auth.signInWithPassword()` with the claimed current password first — a wrong one fails clearly before anything changes.

### Messaging

`ConversationList` (`src/components/ConversationList.jsx`) is the single component behind both the desktop sidebar and the mobile single-pane list — there's no separate desktop-only component (`MessagesSidebar.jsx` was retired). Desktop renders it as a fixed 300px panel beside `ConversationView`; below the mobile breakpoint (640px) it becomes a full-width list, with `MessagesPage` toggling between the list and the open conversation via a `.messages-page-detail` class rather than separate routes. Its CSS classes still say `.mobile-inbox`/`.mobile-convo-*` — a naming leftover from when this really was mobile-only; it applies at every screen size now.

Each row shows a circular avatar (initials for DMs; a fixed two-person icon for groups, not initials — a numeral-prefixed group name like "800m" has nothing but a leading digit to build initials from, and since two different distance groups would otherwise collide on the same bare digit, an icon sidesteps the whole problem; the team channel gets a speakerphone icon on the team's own customizable accent color, never gray, so it always reads as the primary channel), a single-line preview (sender-prefixed for group/team, `"You: "` if the viewer sent it last), a relative timestamp, and an unread dot.

**Direct message pairing** (`get_or_create_direct_conversation()`, `supabase/coach_to_coach_dm_schema.sql`): a coach can DM any approved athlete on the team *or* any other coach (a solo-coach team's picker just shows an empty coaches list); an athlete can only DM a coach. Athlete<->athlete direct messages are rejected at both the RPC and the `participants_insert_direct` RLS policy (the RPC's own team-id/team-status checks predate this file — see `team_approval_schema.sql`). `ConversationList`'s "Start a conversation with…" picker (`openDmPicker`) mirrors this: a coach's candidate list merges `fetchApprovedAthletes()` and `fetchCoaches()` (minus themselves), with a small "Coach" badge to disambiguate the two in one merged list; an athlete's list is coaches only.

**Sort order** (`sortByRecency` in `MessagesPage.jsx`): team channel always first, then most-recent-activity first — not alphabetical, not grouped by type. A conversation with no messages yet falls back to its own `created_at`, so an empty group doesn't jump around relative to other empty ones as the list re-sorts.

**Last-message previews** (`fetchLastMessagesForConversations` in `src/lib/messages.js`): PostgREST has no "latest row per group" query, so this pulls the most recent 300 messages across the user's conversations (ordered newest-first) and keeps only the first (most recent) one seen per conversation. Fine at this app's scale; would need a real per-conversation query or a SQL view if a team ever had enough simultaneous conversation volume for 300 messages to stop covering everyone's latest.

**Unread tracking** (`src/utils/conversationReadState.js`) is client-side only — a localStorage "last seen" timestamp per conversation, not a schema column. A real read-receipt column would need a migration a coach would have to run by hand, same as every other schema change in this project; the localStorage version correctly shows/clears the dot but won't sync across a user's devices (read on the laptop, still unread on the phone). A conversation with no stored last-seen yet is treated as caught-up rather than unread, so shipping this feature didn't retroactively light up every existing conversation on first load.

**Mobile single-pane behavior**: `MessagesPage` auto-navigates a bare `/messages` to the team channel when one exists — a nice shortcut on desktop, where the list stays visible alongside the conversation regardless. On the mobile single-pane layout this would trap the user in the team channel permanently (tapping "Back" out of any conversation just re-triggers the same auto-redirect, since there's always a team channel to jump to) — worked around two ways: a `?view=list` query param the redirect explicitly checks for (so the Back link can request the list without being redirected straight back), and an `isMobileMessagesLayout()` (`matchMedia('(max-width: 640px)')`) check that skips the auto-redirect outright on mobile, so tapping "Messages" in the nav lands on the list there too instead of jumping into a conversation. Desktop's shortcut behavior is unchanged by either.

**Image messages** (`supabase/message_images_schema.sql`, `src/lib/messages.js`, `ConversationView.jsx`): a message may carry `content`, an `image_url`, or both — never neither (enforced by a DB check constraint; `content`'s original NOT NULL/non-empty constraint was dropped and replaced). Images live in a **private** Storage bucket (`message-images`, 10MB/`image/{jpeg,png,webp,gif}` limits enforced at the bucket level, not just client-side) — private, not public, is what makes the RLS-on-`storage.objects` actually matter, since a public bucket's URLs bypass RLS entirely. `image_url` stores the object's storage **path** (`{team_id}/{conversation_id}/{random-uuid}.{ext}`), never a URL — the path's own segments are what the storage RLS policies (`message_images_select`/`message_images_insert`) parse via `storage.foldername(name)` to re-derive the same team/conversation-membership checks `messages_select_participant`/`messages_insert_participant` already enforce on the table, just against path segments instead of columns. Because the bucket is private, a path is useless on its own — the client calls `resolveMessageImageUrls()` (batched `createSignedUrls()`, 1-hour expiry, same "resolve many at once" shape as `fetchLastMessagesForConversations`) to mint a signed URL at render time, re-resolved for any message (initial load, realtime insert, or the just-sent local one) whose path isn't already in the resolved map. Upload always happens **before** the `messages` insert, never after — an upload that succeeds but is never referenced by a message row is harmless orphaned Storage garbage (still fully RLS-scoped, invisible, safe to ignore), whereas inserting the message first would risk a visibly broken image with no retry path, since messages have no UPDATE policy. No `capture` attribute on the file input — that would force mobile straight to the camera and remove the "choose from library" option; `accept="image/*"` alone already gets both from the OS picker. `ConversationList`'s last-message preview falls back to "📷 Photo" for an image-only message, and the push notification Edge Function does the same for its body text.

### Push notifications

Opt-in only, off by default — `AccountSettingsPage` has a toggle that must be explicitly turned on; nothing is ever requested or sent without that.

**Client side** (`src/lib/pushNotifications.js`): turning the toggle on calls `Notification.requestPermission()` from that click (never on page load — browsers require a user gesture, and a site only gets to burn that prompt once), then `PushManager.subscribe()` using `VITE_VAPID_PUBLIC_KEY`, then upserts the subscription into `push_subscriptions` keyed on `(user_id, endpoint)` — opting in from a second device adds a row rather than replacing the first, since each device's subscription has its own `endpoint`. Turning it off unsubscribes just that browser and deletes only its own row. `endpoint` is stored as its own plain column (duplicating a value already inside the `subscription` jsonb blob) because PostgREST's `upsert(onConflict:)` needs a real unique constraint on plain columns to target — it can't reliably resolve one defined on a jsonb expression index. A denied/blocked browser permission disables the toggle and shows an explanatory message instead of silently failing. iOS Safari has its own hard requirement on top of this, unrelated to anything in this codebase: Web Push only works for a PWA installed to the Home Screen, never a regular Safari tab, even though the `Notification`/`PushManager` APIs are technically present there too.

`push_subscriptions` (`supabase/push_notifications_schema.sql`) is deliberately **not** team-scoped like most tables in this project — it's purely user-owned, RLS restricts all client access to `auth.uid() = user_id`, and the only thing that ever reads across users is the Edge Function via the service role key (which bypasses RLS entirely). No `team_id`, no `BEFORE INSERT` trigger deriving one.

**Service worker** (`public/service-worker.js`) has `push` (shows the notification, using the app icon) and `notificationclick` (focuses an already-open tab on the target page, navigates one if none matches, or opens a new tab as a last resort) handlers.

**Sending** (`supabase/functions/send-push-notification/index.ts`, a Supabase Edge Function — the only one in this project) is triggered by a Database Webhook on every new `messages` row: looks up the conversation's other participants, finds their opted-in subscriptions, and sends each one a Web Push notification (sender's name + a truncated message preview) via `npm:web-push`, using VAPID keys held as Edge Function secrets (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`, set with `supabase secrets set` — never committed to this repo, unlike `VITE_VAPID_PUBLIC_KEY` which is safe to commit since it's meant to be public). Deployed with `--no-verify-jwt`, since the trigger is a database-level call with no end-user JWT to attach — see the function's own header comment for the trade-off reasoning (the endpoint ends up unauthenticated, judged acceptable here since the worst an outside caller could do is trigger push sends using data they supply, not read/write anything else).

**The webhook itself is set up by hand in the Dashboard, not in SQL.** `supabase_functions.http_request` (the mechanism a raw-SQL trigger would use to call an Edge Function) depends on the `supabase_functions` schema, which isn't pre-provisioned on every project — it's only created the first time a project sets up a Database Webhook, and the Dashboard's own webhook-creation flow provisions it automatically as a side effect. Confirmed the hard way: a committed SQL trigger attempting to call it failed with `schema "supabase_functions" does not exist` on this project, which had never used Database Webhooks before. `push_notifications_schema.sql` only creates the table + RLS for this reason; the webhook is: Dashboard → Database → Webhooks → table `messages`, event Insert, type "Supabase Edge Functions", function `send-push-notification`.

### Team color theming

`team_settings` holds one row **per team** (not a global singleton), RLS-scoped so each team only ever sees/edits its own row, editable by coaches (admin views, doesn't edit). `ThemeContext` (`src/context/ThemeContext.jsx`) fetches it on login and applies the palette as CSS custom properties directly on `document.documentElement` (`--accent`, `--accent-dark`, `--accent-bg`, `--accent-border`, `--accent-shadow`, `--accent-rgb`) — it does not use React state/props for coloring. All theme-aware CSS in `src/index.css` should reference these variables rather than hardcoding color values, so it stays responsive to a coach's palette choice.

**Sport-type colors are deliberately NOT part of this theme.** `--running`/`--swim`/`--bike`/`--lifting`/`--note` (used for `WorkoutCard`/`QuickNoteCard`'s left-border accent, `WorkoutTypeIcon`, and the `type-badge` classes) are fixed values in `:root` that `ThemeContext` never touches — the whole point is that the same sport always reads the same color regardless of which team's page you're on, which only works if a coach's custom accent color can't override them. The dashboard `MetricCardRow` tiles use a third, separate fixed trio (`--metric-week`/`--metric-athletes`/`--metric-event`) for the same reason, chosen to be visually distinct from the sport palette so a metric card is never mistaken for a sport indicator. When adding any new fixed-color UI, follow this pattern (a plain `:root` value, never `var(--accent...)`) rather than accidentally wiring it into the team theme.

### Events & calendar

The "Calendar" tab (renamed from "Events" — nav label and page `<h1>` changed; the route is still `/events`, plus `/` for athletes, see "Athlete calendar" below) defaults to the month calendar (`view` state, `'calendar' | 'list'`, toggled via a `.type-toggle` pair with Calendar first/left) — the flat list is the supplement now, not the default. Both views read from the same `events` array fetched once by the page.

`EventCalendar`'s month grid (`buildMonthGrid()`) always renders a full 7-column grid for alignment, but leading/trailing days from adjacent months render as blank, non-interactive `<div>` placeholders (`calendar-cell-outside`) rather than showing that neighboring month's dates or events — only the selected month's own days are ever clickable or show a dot/event-name indicator. Month/year jump is via two `<select>` dropdowns (in addition to Prev/Next/Today); the year dropdown's option range is recomputed off whatever year is currently in view (not a fixed range off today), so it always contains a valid selection even after navigating far away.

Editing an event happens **in place**: `EventsPage` owns all the form/editing state and bundles it into one `editing` object (`{ editingId, form, setForm, onSubmit, onCancel, saving, error }`) passed down through `EventCalendar` to `EventCard` — whichever `EventCard` instance matches `editing.editingId` renders the shared `EventForm` component in place of its normal display, instead of a separate form opening elsewhere on the page. This works identically whether the card is in the plain list or inside the calendar's day-detail panel, since both render through the same `EventCard`. Creating a new event is unrelated to this — it still opens `EventForm` in a fixed spot at the top of the page (`formOpen` state), since only editing was asked to happen inline.

### Coach assignment grid

`CoachAssignmentsPage` defaults to Grid for coaches (`view` state, `'grid' | 'list'`, Grid first/left; admin never sees the Grid button at all — `canCreate` gates it — so admin's effective view is always List regardless of the default). The flat List view (multi-athlete-select + single date + `AssignmentForm`, fanning out one `createAssignment()` call per selected athlete) is unchanged from before the grid existed.

`AssignmentGrid.jsx` — athletes × Mon-Sun, one week at a time, sticky header row + sticky first column inside an `overflow: auto` wrapper (this app's first two-axis-sticky table). Fetches a rolling 14-day window (`[weekStart-7d, weekStart+6d]`) via `fetchAssignmentsForCoach({startDate, endDate})` on every week-nav — the extra week behind is what lets "Copy previous week" work without navigating there first.

**Editing/deleting an assignment**: the child segment/target tables (`assigned_running_segments` etc.) only have SELECT + INSERT RLS policies, never UPDATE/DELETE — so "edit" is `deleteAssignment(id)` (the coach-only DELETE policy on `assigned_workouts` already existed; children `ON DELETE CASCADE`) followed by a normal `createAssignment()`, never an in-place update. `assignmentToFormPayload()` (`src/lib/assignments.js`) converts a fetched assignment's nested snake_case rows back into the camelCase shape `AssignmentForm`/`createAssignment` expect, for both pre-filling an edit and building a copy/paste clipboard entry.

**Known trade-off, not a bug**: editing or paste-overwriting an assignment the athlete has already logged against unlinks that log (`workouts.assignment_id` is `ON DELETE SET NULL`, and there's no coach-write path to `workouts` to relink it afterward — adding one would be a new RPC). The athlete's log itself is preserved; only the target-vs-actual link and completed status are lost. Both the cell modal and the paste-overwrite confirmation show an explicit, stronger warning for this specific case rather than doing it silently.

**Copy/paste**: click-drag (`mousedown`+`mouseenter`+document-level `mouseup`), ctrl/cmd-click (additive, non-contiguous), or shift-click (rectangle from the last anchor) builds a `Set<"athleteId|dateStr">` selection. A touch-only "Select mode" toggle makes taps additive instead of opening the cell modal, since there's no drag-select equivalent on touch. The clipboard is `{ athleteOffset, dayOffset, payload }[]`, relative to the selection's anchor at copy time — a selected cell with no assignment contributes nothing. Paste has two modes depending on clipboard size: **1 cell → broadcast** the same payload to every cell in the new target selection (covers "same day, different athletes" and "same athlete, different days" as one rule); **>1 cells → anchor mode**, ignoring the target selection's shape entirely and laying the clipboard's relative offsets out from just its anchor point (covers row-copy and full grid-to-grid paste; offsets landing outside the loaded roster or the visible week are silently dropped, never wrapped/clamped). "Copy previous week" is a one-click preset through this exact same path — a synthetic clipboard of the whole previous week anchored at the current week's first athlete row + Monday — not separate logic. Paste execution runs through a small local `mapWithConcurrency` (concurrency 5) rather than one unbounded `Promise.all` or slow sequential awaits, since a full grid-to-grid paste can be up to 50 athletes × 7 days; after the batch settles it just refetches the 14-day window rather than hand-patching local state.

### Athlete calendar: logging, assignments, and mileage

Calendar is the athlete's home (`/`) — `EventsPage`'s athlete branch additionally fetches `fetchAssignmentsForAthlete()` and *all* of `fetchWorkouts({userId})` (unfiltered by date), then passes `assignments`/`workoutByAssignment`/`workoutsByDate`/`canLog={true}` to `EventCalendar`. Coach/admin pass none of this, and `EventCalendar` behaves exactly as it did before any of this existed.

**No standalone Log Workout / History / Assignments tabs for athletes** — all three were folded into Calendar. `LogWorkoutPage` still exists at `/log` and `/edit/:workoutId` (not nav-linked, kept only as a direct-URL fallback) but is now a thin wrapper around `LogWorkoutForm`, which takes `workoutId`/`initialAssignmentId`/`initialDate` as plain props instead of reading route params/query string. `EventCalendar` opens `LogWorkoutForm` directly in a `Modal` from the day panel — no navigation at all, so logging/editing never leaves the calendar; `onSaved` closes the modal and calls `onWorkoutSaved` (= `EventsPage`'s `load()`) to refetch. `AthleteAssignmentsPage` was deleted outright (nothing else referenced it), not just unlinked, since the calendar day panel now fully covers what it did.

**Day panel, for an athlete**: every day is clickable, not just ones with events/assignments (`disabled={!canLog && !hasEvents && !hasAssignment}`), since logging isn't gated on having anything assigned. The log/edit button lives *inside* whichever card is showing that day's info (the assignment card, or a plain workout card when there's a log but no assignment) rather than floating below the list — only a genuinely empty day (nothing to attach it to) gets a bare standalone button. Button label/target: an existing log for the day → "Edit workout"; else an assignment exists → "Log this workout" (prefills type/segments/targets *and* the date — a pre-existing gap where an assignment's date was never actually applied to the log is fixed as part of this); else → "Log a workout" (blank, just the tapped date).

**Mileage on day cells** (`dayMiles()` in `EventCalendar.jsx`): running/swim/bike are all converted down to one miles figure for now, rather than each sport's own natural unit, via `sumLoggedDistanceMiles()`/`sumAssignedDistanceMiles()` (`src/utils/format.js`) — running's logged total already lives in `workouts.total_distance` (miles, populated by `LogWorkoutForm`); swim/bike have no such column, so their segments are summed the same way assigned-target segments are. Actual logged mileage always wins over the assigned target the moment a distance-type log exists for the day, whether or not it fulfills an assignment — a day logged with no assignment at all still shows its mileage. Styled muted-gray for "assigned, not yet logged" vs. bold and sport-colored (`--running`/`--swim`/`--bike`) for "actually logged", echoing the existing pending-vs-complete dot convention.

### Auth pages

`LoginPage`/`SignUpPage` render on a fixed near-black backdrop (`auth-page-animated`/`auth-card-dark` modifier classes, layered on top of the base `.auth-page`/`.auth-card` classes that `CreateTeamPage`/`PendingPage`/`RemovedPage` still use plain) with a looping runner animation (`RunnerSprite.jsx`) beside the form. The sprite cycles a sprite-sheet PNG (`public/runner-sprite.png`) via `background-position`, not `<img>` swapping. The frame count/positions/crop-inset constants at the top of `RunnerSprite.jsx` are measured directly from that specific source image (irregular pose spacing, a couple of frames with a stray fragment of the adjacent pose baked into their own cell) — they are not generic and must be re-derived by inspecting the new sheet if `runner-sprite.png` is ever replaced, not guessed by eye.

### Mobile & PWA

**Nav** (`NavBar.jsx`): the full row of links shows above ~860px; below it, a hamburger button reveals a slide-out drawer (`.navbar-drawer`) with the same links plus account/logout, closed automatically on navigation (`useLocation` inside a `useEffect`) with body scroll locked while open. `SuperAdminHeader` has no drawer at all — a super admin has no nav links, just identity + logout — so it carries a `.navbar-simple` class the mobile CSS explicitly excludes from the "hide `.navbar-user` below the breakpoint" rule; without that exclusion its logout button disappears on mobile with nothing to replace it (this was a real, shipped bug for a while — worth checking for the same gap any time a `.navbar`-using header doesn't have NavBar's drawer).

**PWA install**: `manifest.json` + `service-worker.js` + `index.html`'s `apple-mobile-web-app-*` meta tags (iOS Safari ignores `manifest.json` for install/standalone behavior and needs its own tags) make the app installable. Icons are generated from `public/infinity.png`, a wide/non-square source image — every derived icon is built from a square canvas centered on the shape's own bounding box (computed from its non-black pixels), not a plain center-crop, so nothing gets clipped. Favicon/logo variants (`favicon.svg`, `favicon-*.png`, `logo.png`) are transparent — the source is a neon glow rendered on solid black, "un-screened" into real alpha (same math as the login page's `mix-blend-mode: screen` on the runner sprite, just baked into pixels here since favicons/OS icons can't have CSS applied to them); the PWA install icons (`icon-192.png`/`icon-512.png`/`apple-touch-icon.png`) stay opaque, per Apple's own guidance against transparent home-screen icons.

**Service worker caching**: page navigations and everything else in `public/` (favicon, logo, manifest, icons) are network-first with a cache fallback for offline use — those keep a stable filename even when their contents change, so cache-first would serve a stale copy forever after any rebrand. This was also a real shipped bug once: the original fetch handler cached "everything same-origin," on the assumption it was all Vite's hashed build output, and a browser that had cached the old logo kept serving it regardless of later deploys. Only `/assets/*` (Vite's actual build output, content-hashed per file) is cache-first now — that's what makes repeat visits load instantly without ever risking staleness. `offline.html` is precached and served as a last-resort fallback for a failed navigation with nothing else cached yet.

### Design tokens

`src/index.css` defines a spacing scale (`--space-1`…`--space-10`, 4px-based), radius/shadow/transition tokens, and a small type scale in `:root`, plus light/dark overrides via `prefers-color-scheme` (no manual theme toggle). Card-like surfaces across the app share one grouped selector for consistent radius/shadow/hover treatment rather than each component defining its own. Shared UI primitives — `Skeleton`/`SkeletonList` (loading placeholders), `StatRow` (dashboard stat tiles), and the toast system (`ToastContext` + `useToast()`, mounted once in `main.jsx`) — should be reused for new pages rather than re-implemented.

### Deployment: Cloudflare Workers

Live at a `*.workers.dev` URL, GitHub-connected via Cloudflare's Workers Builds — every push to `main` triggers an automatic build (`npm run build`) and deploy (`npx wrangler deploy`), no manual deploy step. `wrangler.jsonc` configures this as a static-assets Worker (`assets.directory: "./dist"`, `not_found_handling: "single-page-application"` so client-side routes don't 404 on direct navigation), not a Worker with its own server-side code.

Build-time environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, `NODE_VERSION=20`) live in the Cloudflare dashboard under the Worker's **Settings → Builds → Variables and Secrets** — note this is a *different* "Variables and Secrets" screen than the one under the Worker's general Settings, which is for runtime bindings and doesn't apply to an assets-only Worker at all (the dashboard refuses to let you add anything there). A missing or wrong-scoped variable here doesn't fail the build — it just silently produces a working-looking site with that one feature broken (e.g. the push-notifications toggle throwing "not configured" with no other symptom). `wrangler deploy` logging **"No updated asset files to upload"** instead of listing new files is a strong tell that the build output didn't actually change — i.e. whatever variable you just added still isn't reaching the build, and it's worth re-checking it landed in the right "Variables and Secrets" screen before assuming the rebuild itself is broken.

Node version pinning matters here for the same reason `nvm use 20` is needed locally: the repo's default `node` is too old for this Vite version, and Cloudflare's build environment needs its own `NODE_VERSION` variable to pick a newer one.
