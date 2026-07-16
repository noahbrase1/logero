// Per-device "last seen" tracking for the mobile conversation list's unread
// dot. There's no read-receipt column in the schema (adding one is a real
// migration a coach would need to run by hand in the Supabase SQL editor —
// out of scope here), so this is intentionally a client-side approximation:
// it won't sync across a user's devices, but it correctly shows/clears the
// dot on whichever device is actually being used.

const PREFIX = 'logero:convo-last-seen:'

function storageKey(userId, conversationId) {
  return `${PREFIX}${userId}:${conversationId}`
}

export function getLastSeenAt(userId, conversationId) {
  try {
    return localStorage.getItem(storageKey(userId, conversationId))
  } catch {
    return null
  }
}

export function markConversationSeen(userId, conversationId, timestamp) {
  try {
    localStorage.setItem(storageKey(userId, conversationId), timestamp)
  } catch {
    // Storage unavailable (private browsing, quota) — unread state just
    // won't persist across reloads; not worth surfacing as an error.
  }
}

// A conversation with no last-seen record yet (feature just shipped, or a
// brand-new conversation) is treated as caught-up rather than unread, so
// the first-ever load of the mobile inbox doesn't light up every row.
export function isConversationUnread(userId, conversation) {
  const lastMessage = conversation.lastMessage
  if (!lastMessage) return false
  const seenAt = getLastSeenAt(userId, conversation.id)
  if (!seenAt) {
    markConversationSeen(userId, conversation.id, lastMessage.created_at)
    return false
  }
  return new Date(lastMessage.created_at) > new Date(seenAt)
}
