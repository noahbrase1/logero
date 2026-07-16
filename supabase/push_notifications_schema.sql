-- push_notifications_schema.sql
-- Depends on: schema.sql (profiles), messaging_v2_schema.sql (messages,
-- conversation_participants).
--
-- Adds push_subscriptions (one row per opted-in browser/device — see
-- src/lib/pushNotifications.js) and wires a database webhook so every new
-- row in messages triggers the send-push-notification Edge Function
-- (supabase/functions/send-push-notification). Deploy that function BEFORE
-- running this file, or the trigger will just fail silently on every insert
-- until it exists.
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

-- ============================================================================
-- Database webhook: fires send-push-notification after every new message.
--
-- This is the SQL-level equivalent of what the Supabase Dashboard's
-- Database Webhooks UI generates when you point one at an Edge Function —
-- supabase_functions.http_request ships with every Supabase project (it's
-- the pg_net-backed mechanism the dashboard feature itself uses), so this
-- needs no extra setup beyond having deployed the function first.
--
-- The Edge Function is deployed with --no-verify-jwt (see its own header
-- comment for why) since this call has no end-user JWT to attach — nothing
-- secret is embedded in this trigger definition, which matters because this
-- file, like every other file in supabase/, is meant to be committed to git.
--
-- If this trigger mechanism isn't available on your project for some reason
-- (older project, extension not enabled), the fallback is identical in
-- effect: Dashboard → Database → Webhooks → create one, AFTER INSERT on
-- messages, pointing at the same Edge Function URL below.
-- ============================================================================

drop trigger if exists on_message_insert_send_push on public.messages;
create trigger on_message_insert_send_push
  after insert on public.messages
  for each row
  execute function supabase_functions.http_request(
    'https://exatzbclxoaooqjbusdj.supabase.co/functions/v1/send-push-notification',
    'POST',
    '{"Content-type":"application/json"}',
    '{}',
    '5000'
  );
