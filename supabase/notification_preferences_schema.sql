-- notification_preferences_schema.sql
-- Depends on: push_notifications_schema.sql (push_subscriptions).
--
-- Splits push notifications into two independently-toggleable types —
-- messages (existing behavior) and a new daily calendar digest (today's
-- assigned workout + any team events, sent to athletes only — see
-- supabase/functions/send-daily-calendar-digest). Both flags live on
-- push_subscriptions itself rather than a separate table: a "notification
-- preference" only ever means something in the context of one specific
-- device's subscription, exactly like the rest of that row.
--
-- notify_messages defaults true so every browser already subscribed before
-- this file runs keeps getting message pushes with no action needed.
-- notify_calendar defaults false since it's a brand-new, opt-in feature —
-- nobody should suddenly start getting a new kind of notification they
-- never asked for.
alter table public.push_subscriptions
  add column if not exists notify_messages boolean not null default true,
  add column if not exists notify_calendar boolean not null default false;

-- send-push-notification (messages) now filters on notify_messages = true;
-- send-daily-calendar-digest filters on notify_calendar = true. Neither
-- needs an RLS change — the existing push_subscriptions_update_own policy
-- already lets a user flip either flag on their own row, and both Edge
-- Functions read via the service-role key, which bypasses RLS entirely.
