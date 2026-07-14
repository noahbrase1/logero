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

**Environment**: Supabase connection lives in `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), read by `src/lib/supabaseClient.js`. `.env.example` documents the shape without values.

## Project structure

```
index.html                     # Vite entry; static <title> fallback (kept in sync with src/config.js)
vite.config.js
package.json
.env / .env.example             # Supabase URL + anon key (see Environment above)

public/                         # favicons, apple-touch-icon, logo.png (transparent), logo-source.png (original)

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
└── event_times_schema.sql      # adds events.start_time / events.end_time (both nullable time columns, no RLS change — the existing coach-only insert/update policies already gate the whole row)

reset_all_data.sql is a separate, standalone destructive utility (truncates every application table) for wiping a dev database back to empty — it is not part of the ordered chain above and should never be run against real data without explicit confirmation.

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
│   ├── assignments.js            # assigned_workouts + targets
│   ├── messages.js               # conversations/messages, DM + group RPC wrappers, fetchAllTeamConversations (admin-only team-wide visibility)
│   ├── events.js                 # events + meet lineups
│   ├── teamSettings.js           # team_settings read/update (RLS-scoped to the caller's own team)
│   ├── workoutComments.js        # coach comments on a workout
│   ├── teams.js                  # invite-code resolution, self-service team creation, super-admin stats/pending-teams/approve/reject
│   └── account.js                # self-service name/email/password updates — see "Account self-service" below
│
├── pages/                      # one component per route registered in App.jsx
│   ├── LoginPage.jsx / SignUpPage.jsx / CreateTeamPage.jsx   # SignUpPage = invite-code flow; CreateTeamPage = public self-service team creation
│   ├── PendingPage.jsx           # role === 'pending' gate screen
│   ├── RemovedPage.jsx           # role === 'removed' gate screen
│   ├── TeamFeedPage.jsx          # coach/admin home ("Team Logs")
│   ├── LogWorkoutPage.jsx        # athlete home
│   ├── WorkoutHistoryPage.jsx    # shared: own history (athlete) or any athlete's (coach/admin, via userId prop)
│   ├── RosterPage.jsx / FormerAthletesPage.jsx / AthleteDetailPage.jsx   # FormerAthletesPage carries the Reinstate action
│   ├── PendingApprovalsPage.jsx  # coach-only; Approve as Athlete/Coach/Admin, or Reject (deletes the account outright)
│   ├── MessagesPage.jsx          # shared, branches on profile.role internally — admin sees every team conversation, not just its own
│   ├── TeamSettingsPage.jsx      # coach edits / admin views theme, plus the team's invite link
│   ├── AccountSettingsPage.jsx   # self-service name/email/password — any logged-in athlete/coach/admin
│   ├── EventsPage.jsx / EventDetailPage.jsx   # shared
│   ├── CoachAssignmentsPage.jsx / AthleteAssignmentsPage.jsx   # CoachAssignmentsPage is also used read-only by admin
│   └── SuperAdminPage.jsx        # the entire standalone super-admin experience — see "Super admin" below
│
├── components/                 # shared/reusable pieces used across pages
│   ├── NavBar.jsx                # coach/admin/athlete nav — never rendered for a super admin
│   ├── SuperAdminHeader.jsx      # minimal header for the super-admin-only branch; deliberately not a NavBar variant
│   ├── TeamStatusBanner.jsx      # renders when the caller's team is pending/rejected, null otherwise
│   ├── WorkoutListItem.jsx       # dispatches WorkoutCard vs QuickNoteCard by workout.type
│   ├── WorkoutCard.jsx / QuickNoteCard.jsx / QuickNoteForm.jsx / WorkoutComments.jsx
│   ├── RunningSegmentsEditor.jsx / AssignedSegmentsEditor.jsx / SwimSegmentsEditor.jsx / AssignedSwimSegmentsEditor.jsx / BikeSegmentsEditor.jsx / AssignedBikeSegmentsEditor.jsx / TimeTextInput.jsx
│   ├── TargetVsActual.jsx        # renders assignment target vs. logged actual
│   ├── MessagesSidebar.jsx / ConversationView.jsx / GroupCreateForm.jsx / GroupManageControls.jsx
│   ├── EventEntryForm.jsx / AthleteChecklist.jsx / EventCard.jsx / EventForm.jsx / EventCalendar.jsx
│   ├── WorkoutTypeIcon.jsx / RunnerSprite.jsx  # fixed sport-type icon; looping login/signup hero animation — see "Team color theming" / "Auth pages" below
│   └── StatRow.jsx / MetricCardRow.jsx / Skeleton.jsx  # dashboard-stat tiles (plain vs. bold-colored) and loading-placeholder primitives
│
└── utils/                       # pure helpers, no Supabase calls
    ├── format.js                 # date/time/pace formatting
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
- `role === 'coach'` vs `'admin'` vs everything else (`athlete`) → **three separate `<Routes>` trees** defined inline in `App.jsx`, not a shared route set with permission checks. When adding a page, decide which tree(s) it belongs in and add the `<Route>` there (and to `NavBar.jsx`) — there's no central route config to update elsewhere. The `admin` tree reuses the same page components as `coach` (no route is admin-specific except omitting `/pending`) — each page hides its own write controls internally by checking `profile.role === 'coach'`.

A handful of pages (`WorkoutHistoryPage`, `EventsPage`/`EventDetailPage`, `MessagesPage`) are shared across all three trees and branch on `profile.role` internally instead of being duplicated.

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

Every Supabase query is wrapped in a `src/lib/*.js` module, one per domain (`workouts.js`, `messages.js`, `assignments.js`, `events.js`, `teamSettings.js`, `workoutComments.js`, `teams.js`, `account.js`). Pages and components call these functions and never import `supabaseClient` directly. Follow this pattern for new data access rather than inlining `supabase.from(...)` calls in components.

### Supabase schema — additive SQL files, run manually

There is no Supabase CLI / migration tooling wired up. Schema changes are plain `.sql` files under `supabase/`, meant to be pasted into the Supabase SQL editor by hand, **in order** — see the full annotated list in "Project structure" above for what each one does; the run order is exactly the order listed there.

Each file is written to be idempotent (`create table if not exists`, `drop policy if exists` before `create policy`, etc.) so it's safe to re-run. **Never edit a file that may have already been run against the live database** — add a new additive file instead, matching the existing naming/dating pattern, and note which prior file(s) it depends on in its header comment.

Non-obvious pitfalls hit repeatedly while building this schema, worth knowing before touching RLS or functions:

1. **`RETURNING` is filtered by the SELECT policy, not just the INSERT policy.** `supabase.from(x).insert(row).select()` asks Postgres to return the new row, which must pass that table's SELECT policy — not only the INSERT `WITH CHECK`. This breaks in a chicken-and-egg way whenever a SELECT policy depends on a related row that the same operation is *about to* create (e.g. a conversations table gated by "must already be a participant", inserted by the very user who isn't a participant yet). Fix: either drop `.select()` on that insert (generate the id client-side instead), or do the whole sequence inside a `SECURITY DEFINER` RPC, which bypasses RLS internally. See `get_or_create_direct_conversation` / `create_group_conversation` in the messaging schema files for the RPC pattern, and `createGroupConversation` in `src/lib/messages.js` for the client-generated-id pattern.
2. **Don't guess an auto-generated constraint name when altering it.** An inline `check (...)` with no explicit name gets a Postgres-assigned name that isn't guaranteed to match the `<table>_<column>_check` convention. `drop constraint if exists <guessed-name>` fails silently (no error, no effect) if the guess is wrong, so a later `add constraint` with the same guessed name creates a second, still-restrictive constraint alongside the untouched original. Look the real name up first via `pg_constraint`/`pg_get_constraintdef` and drop that — see the `conversations.type` or `workouts.type` constraint updates for the pattern.
3. **`CREATE OR REPLACE FUNCTION` can't change a function's return columns.** Changing a `RETURNS TABLE (...)` shape (e.g. dropping/adding a column) needs an explicit `DROP FUNCTION` first — `CREATE OR REPLACE` alone fails with `cannot change return type of existing function`. See the `drop function if exists public.get_team_stats();` in `standalone_super_admin_schema.sql`.
4. **A `RETURN QUERY` column type must match the declared return type exactly, not just "compatibly."** `auth.users.email` is `character varying`, not `text` — returning it uncast from a function declared `returns table (... founder_email text)` fails at *call time* (not at `CREATE FUNCTION` time) with `structure of query does not match function result type`. Cast explicitly (`u.email::text`) whenever pulling a `varchar` column into a `text`-typed return column.
5. **A trigger that only fires `AFTER UPDATE` misses rows created with the target state already set.** `add_user_to_team_conversation()` only ran on `AFTER UPDATE ... WHEN (old.role IS DISTINCT FROM new.role AND new.role IN (...))`, which by definition never fires for a row `INSERT`ed with that role already in place — exactly what happens for a founding coach (`INSERT ... role = 'coach'` directly, never a `'pending' → 'coach'` update). Fixed with a second, INSERT-scoped trigger sharing the same function (`founding_coach_team_channel_fix.sql`). Worth checking for the same gap any time a row can be created *already* in a state that's normally only reached via an update.

RLS leans on a small set of `SECURITY DEFINER` helper functions (`is_coach()`, `is_athlete()`, `is_admin()`, `is_super_admin()`, `is_conversation_participant(conv_id)`, `current_team_id()`, `current_team_status()`) so policies can check role/team/membership without recursing into RLS on `profiles`/`teams`/`conversation_participants` themselves. Reuse these rather than inlining the same subqueries.

### Workout data model

A "workout" is one row in `workouts` with `type` = `running | swim | bike | lifting | note`:

- `running` — optionally has child rows in `running_segments` (each segment has a `distance_value`/`distance_unit` and a generated `distance_meters` for cross-unit math) and `running_segment_reps` (per-rep times, supports interval/relay-style workouts with multiple reps per segment). Segments are optional — a running workout can be logged as just notes/effort with no segment breakdown.
- `swim` — same segment/rep shape as `running`, in `swim_segments`/`swim_segment_reps` (see `supabase/swimming_schema.sql`), just with `yards` added to the `distance_unit` option set (`yards | meters | miles`) since pool lengths are the common case. No pace is shown for swim (unlike running) — `WorkoutCard`'s swim segment summary is just the times list. Entry UI is `SwimSegmentsEditor.jsx` (parallel to `RunningSegmentsEditor.jsx`, not a shared component, consistent with how this codebase already keeps per-type UI concrete rather than abstracted).
- `bike` — same segment/rep shape again, in `bike_segments`/`bike_segment_reps` (see `supabase/cycling_schema.sql`), with `distance_unit` restricted to `miles | km` (no track-length units). `bike_segment_reps` adds two OPTIONAL per-rep columns, `avg_watts`/`avg_cadence` — nullable, no default, shown alongside the time only when present (`summarizeBikeReps()` in `src/utils/format.js` averages them across only the reps that have a value). Entry UI is `BikeSegmentsEditor.jsx`.
- `lifting` — child rows in `lifting_exercises`.
- `note` — a "quick log" with no children, just `date` + `notes`; both athletes and coaches can create these (everything else under `workouts` is athlete-only to write). `src/components/WorkoutListItem.jsx` is the dispatcher that renders the right card (`WorkoutCard` vs `QuickNoteCard`) based on `type` — render workout lists through it rather than choosing the card component yourself.

`assigned_workouts` (+ `assigned_running_segments` / `assigned_swim_segments` / `assigned_bike_segments` / `assigned_lifting_targets`) mirror this same shape as coach-assigned targets — `assigned_bike_segments` carries only a target time per segment, same as running/swim, since watts/cadence are actuals-only concepts an athlete logs, not something a coach assigns a target for; `workouts.assignment_id` links a logged workout back to the assignment it fulfills, and `TargetVsActual` renders the comparison.

`fetchRecentTeamFeed()` (the Team Logs home feed) excludes anyone with `role = 'removed'` via a query-level filter (`profiles!inner(...).neq('profiles.role', 'removed')`), not RLS — their logs are still fully intact and visible via Former Athletes → their detail page, just kept out of the active aggregate feed. See "Roster lifecycle" below.

### Roster lifecycle: remove / reinstate / reject

Three different actions that look similar but do genuinely different things — worth not conflating:

- **Remove** (`RosterPage`, coach only, active athlete → `role = 'removed'`) — `remove_athlete()` RPC. Their workout logs are preserved (never deleted, never altered) but excluded from the active Team Logs feed as described above. Their own messages in the team channel and any group chats are **permanently deleted** (other members' messages in those same conversations are untouched); any DM they had with a coach is **deleted entirely** (the `conversations` row itself, cascading to its messages/participants) rather than just hidden. The confirmation dialog states both consequences explicitly.
- **Reinstate** (`FormerAthletesPage`, coach only, `'removed' → 'athlete'`) — a plain client-side `profiles` update, no RPC needed: `profiles_update_coach_only` already lets a coach set any role on any of their team's profiles, and the existing team-channel auto-join trigger fires on this exact transition and re-adds them for free. Their workout logs simply reappear in the feed (they were never removed from it in the database). Their deleted messages are **not** restored — that deletion was permanent by design.
- **Reject** (`PendingApprovalsPage`, coach only, a `'pending'` signup that was never approved) — `reject_pending_profile()` **deletes the `auth.users` row outright** (`profiles.id` cascades automatically), not a soft-remove like the other two. This is deliberately different: a pending user can't have created anything worth archiving (RLS blocks all writes and the team-channel auto-join trigger never fires for `role = 'pending'`), and — the actual reason this matters — Supabase enforces email uniqueness at the `auth.users` level regardless of what `profiles.role` says, so soft-removing would permanently block that email from ever signing up again.

### Account self-service

`/account` (`AccountSettingsPage`, any logged-in athlete/coach/admin — not pending/removed/super admin) has three independent forms:

- **Name** — `update_own_name()` RPC. A narrow, `SECURITY DEFINER` function that only ever touches the `name` column, hardcoded to `auth.uid()` — deliberately not a general `id = auth.uid()` RLS policy, since RLS can't restrict which *columns* a client's `UPDATE` touches (a loose policy would let a client smuggle a `role`/`team_id` change through the same request).
- **Email** — `supabase.auth.updateUser({ email })` directly, no `profiles`/SQL involvement at all. Does not take effect immediately — Supabase's own "secure email change" flow requires confirmation via email first. This depends on the Supabase project having a working mailer (custom SMTP); the shared built-in dev mailer is rate-limited and not reliable for this.
- **Password** — `supabase.auth.updateUser({ password })`. Supabase's API has no "current password" concept (an active session is already proof of auth), so the product's explicit re-entry requirement is implemented by calling `supabase.auth.signInWithPassword()` with the claimed current password first — a wrong one fails clearly before anything changes.

### Team color theming

`team_settings` holds one row **per team** (not a global singleton), RLS-scoped so each team only ever sees/edits its own row, editable by coaches (admin views, doesn't edit). `ThemeContext` (`src/context/ThemeContext.jsx`) fetches it on login and applies the palette as CSS custom properties directly on `document.documentElement` (`--accent`, `--accent-dark`, `--accent-bg`, `--accent-border`, `--accent-shadow`, `--accent-rgb`) — it does not use React state/props for coloring. All theme-aware CSS in `src/index.css` should reference these variables rather than hardcoding color values, so it stays responsive to a coach's palette choice.

**Sport-type colors are deliberately NOT part of this theme.** `--running`/`--swim`/`--bike`/`--lifting`/`--note` (used for `WorkoutCard`/`QuickNoteCard`'s left-border accent, `WorkoutTypeIcon`, and the `type-badge` classes) are fixed values in `:root` that `ThemeContext` never touches — the whole point is that the same sport always reads the same color regardless of which team's page you're on, which only works if a coach's custom accent color can't override them. The dashboard `MetricCardRow` tiles use a third, separate fixed trio (`--metric-week`/`--metric-athletes`/`--metric-event`) for the same reason, chosen to be visually distinct from the sport palette so a metric card is never mistaken for a sport indicator. When adding any new fixed-color UI, follow this pattern (a plain `:root` value, never `var(--accent...)`) rather than accidentally wiring it into the team theme.

### Events & calendar

`EventsPage` defaults to the plain list view (`view` state, `'list' | 'calendar'`, toggled via a `.type-toggle` pair) — the month calendar (`EventCalendar.jsx`) is a supplement, not a replacement, and both read from the same `events` array fetched once by the page.

`EventCalendar`'s month grid (`buildMonthGrid()`) always renders a full 7-column grid for alignment, but leading/trailing days from adjacent months render as blank, non-interactive `<div>` placeholders (`calendar-cell-outside`) rather than showing that neighboring month's dates or events — only the selected month's own days are ever clickable or show a dot/event-name indicator. Month/year jump is via two `<select>` dropdowns (in addition to Prev/Next/Today); the year dropdown's option range is recomputed off whatever year is currently in view (not a fixed range off today), so it always contains a valid selection even after navigating far away.

Editing an event happens **in place**: `EventsPage` owns all the form/editing state and bundles it into one `editing` object (`{ editingId, form, setForm, onSubmit, onCancel, saving, error }`) passed down through `EventCalendar` to `EventCard` — whichever `EventCard` instance matches `editing.editingId` renders the shared `EventForm` component in place of its normal display, instead of a separate form opening elsewhere on the page. This works identically whether the card is in the plain list or inside the calendar's day-detail panel, since both render through the same `EventCard`. Creating a new event is unrelated to this — it still opens `EventForm` in a fixed spot at the top of the page (`formOpen` state), since only editing was asked to happen inline.

### Auth pages

`LoginPage`/`SignUpPage` render on a fixed near-black backdrop (`auth-page-animated`/`auth-card-dark` modifier classes, layered on top of the base `.auth-page`/`.auth-card` classes that `CreateTeamPage`/`PendingPage`/`RemovedPage` still use plain) with a looping runner animation (`RunnerSprite.jsx`) beside the form. The sprite cycles a sprite-sheet PNG (`public/runner-sprite.png`) via `background-position`, not `<img>` swapping. The frame count/positions/crop-inset constants at the top of `RunnerSprite.jsx` are measured directly from that specific source image (irregular pose spacing, a couple of frames with a stray fragment of the adjacent pose baked into their own cell) — they are not generic and must be re-derived by inspecting the new sheet if `runner-sprite.png` is ever replaced, not guessed by eye.

### Design tokens

`src/index.css` defines a spacing scale (`--space-1`…`--space-10`, 4px-based), radius/shadow/transition tokens, and a small type scale in `:root`, plus light/dark overrides via `prefers-color-scheme` (no manual theme toggle). Card-like surfaces across the app share one grouped selector for consistent radius/shadow/hover treatment rather than each component defining its own. Shared UI primitives — `Skeleton`/`SkeletonList` (loading placeholders), `StatRow` (dashboard stat tiles), and the toast system (`ToastContext` + `useToast()`, mounted once in `main.jsx`) — should be reused for new pages rather than re-implemented.
