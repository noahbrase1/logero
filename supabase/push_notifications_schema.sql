-- push_notifications_schema.sql
-- Depends on: schema.sql (profiles), messaging_v2_schema.sql (messages,
-- conversation_participants).
--
-- Adds push_subscriptions (one row per opted-in browser/device — see
-- src/lib/pushNotifications.js). The database webhook that fires
-- send-push-notification on every new message is NOT set up by this file —
-- it needs the supabase_functions schema, which isn't pre-provisioned on
-- every project and only gets created the first time you set up a Database
-- Webhook, which the Dashboard does for you automatically. Create it there
-- instead: Dashboard → Database → Webhooks → Create a new hook — table
-- `messages`, event Insert, type "Supabase Edge Functions", function
-- send-push-notification. Deploy the function first (see its own header
-- comment) or the webhook will have nothing to call yet.
--
-- Not team-scoped like most tables in this project (see CLAUDE.md's
-- multi-tenancy notes): a push subscription belongs to exactly one user's
-- own browser and is never read cross-user by the client — only the Edge
-- Function, via the service role key (which bypasses RLS entirely), ever
-- reads another user's row. So there's no team_id and no BEFORE INSERT
-- trigger deriving one; auth.uid() = user_id is the whole access model.

-- `endpoint` duplicates a value already inside `subscription` (its
-- toJSON().endpoint), kept as its own column rather than only inside the
-- jsonb blob because PostgREST's upsert(onConflict:) needs a plain-column
-- unique constraint to target — it can't reliably resolve one defined on a
-- jsonb expression index.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

-- One row per (user, browser) — re-enabling on the same browser updates the
-- existing row instead of accumulating duplicates; a different browser or
-- device gets its own row, since its subscription has a different endpoint.
-- This is what the upsert in enablePushNotifications() targets.
create unique index if not exists push_subscriptions_user_endpoint_key
  on public.push_subscriptions (user_id, endpoint);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- The messages -> send-push-notification database webhook is created via
-- the Dashboard (see the header comment above), not here.
