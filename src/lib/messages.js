import { supabase } from './supabaseClient'

export const MESSAGE_IMAGES_BUCKET = 'message-images'
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const EXTENSION_BY_MIME_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// Shared by fetchConversations() and fetchAllTeamConversations(): given a
// flat conversation list and every participant row for those conversations,
// builds the shape both the sidebar and ConversationView expect.
// `directLabel` covers direct conversations the viewer isn't part of (an
// admin looking at someone else's DM) by falling back to listing every
// participant, since there's no single "other" participant from their POV.
function hydrateConversations(rawConversations, allParticipants, viewerId) {
  const participantsByConvo = {}
  for (const p of allParticipants) {
    ;(participantsByConvo[p.conversation_id] ??= []).push(p)
  }

  const conversations = rawConversations.map((c) => {
    const participants = participantsByConvo[c.id] || []
    const isViewerParticipant = participants.some((p) => p.user_id === viewerId)
    const other = participants.find((p) => p.user_id !== viewerId)
    const otherParticipant = c.type === 'direct' && isViewerParticipant ? other?.profiles : null
    const directLabel =
      c.type !== 'direct'
        ? null
        : isViewerParticipant
          ? other?.profiles?.name
          : participants.map((p) => p.profiles?.name).filter(Boolean).join(' & ')

    return {
      id: c.id,
      type: c.type,
      name: c.name,
      created_by: c.created_by,
      created_at: c.created_at,
      participants,
      otherParticipant,
      directLabel,
    }
  })

  // Unsorted here — the caller (MessagesPage) re-sorts once it has each
  // conversation's last message, since "most recent activity" isn't known
  // yet at this point.
  return conversations
}

// Returns the current user's conversations (team channel first, then
// groups, then DMs), each annotated with the other participant's profile
// for direct conversations.
export async function fetchConversations(userId) {
  const { data: myConvos, error: myConvosError } = await supabase
    .from('conversation_participants')
    .select('conversation_id, conversations(id, type, name, created_by, created_at)')
    .eq('user_id', userId)

  if (myConvosError) throw myConvosError
  if (!myConvos || myConvos.length === 0) return []

  const rawConversations = myConvos.map((c) => c.conversations)
  const conversationIds = rawConversations.map((c) => c.id)

  const { data: allParticipants, error: participantsError } = await supabase
    .from('conversation_participants')
    .select('conversation_id, user_id, profiles(id, name)')
    .in('conversation_id', conversationIds)

  if (participantsError) throw participantsError

  return hydrateConversations(rawConversations, allParticipants, userId)
}

// Admin-only: every conversation on the admin's team, participant or not —
// RLS (is_admin() + team match) already scopes this to their own team.
export async function fetchAllTeamConversations(userId) {
  const { data: rawConversations, error: convosError } = await supabase
    .from('conversations')
    .select('id, type, name, created_by, created_at')

  if (convosError) throw convosError
  if (!rawConversations || rawConversations.length === 0) return []

  const conversationIds = rawConversations.map((c) => c.id)

  const { data: allParticipants, error: participantsError } = await supabase
    .from('conversation_participants')
    .select('conversation_id, user_id, profiles(id, name)')
    .in('conversation_id', conversationIds)

  if (participantsError) throw participantsError

  return hydrateConversations(rawConversations, allParticipants, userId)
}

// Latest message per conversation, for the mobile conversation list's
// preview/timestamp — keyed by conversation_id. PostgREST has no "latest N
// per group" query, so this pulls the most recent messages across all the
// given conversations (capped, since a chatty team's full history isn't
// needed) and keeps only the first (most recent, thanks to the sort) row
// seen per conversation. Fine at this app's scale; would need a proper
// per-conversation query (or a view) if a team ever had enough simultaneous
// conversation volume for 300 messages to not cover everyone's latest.
export async function fetchLastMessagesForConversations(conversationIds) {
  if (!conversationIds || conversationIds.length === 0) return {}

  const { data, error } = await supabase
    .from('messages')
    .select('conversation_id, content, sender_id, created_at, image_url, profiles(name)')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false })
    .limit(300)

  if (error) throw error

  const byConversation = {}
  for (const m of data) {
    if (!byConversation[m.conversation_id]) {
      byConversation[m.conversation_id] = m
    }
  }
  return byConversation
}

export async function fetchMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*, profiles(name)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data
}

export async function sendMessage(conversationId, senderId, content, imagePath = null) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, content, image_url: imagePath })
    .select('*, profiles(name)')
    .single()

  if (error) throw error
  return data
}

// Validates client-side (matching the bucket's own file_size_limit /
// allowed_mime_types, enforced again server-side as defense in depth), then
// uploads to {team_id}/{conversation_id}/{random}.{ext} — a path shape the
// storage RLS policies parse to check team + conversation-membership
// isolation. Returns the stored path (not a URL — the bucket is private, so
// a signed URL is minted fresh at render time via resolveMessageImageUrls()).
export async function uploadMessageImage(teamId, conversationId, file) {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
    throw new Error('That file type isn\'t supported. Please choose a JPEG, PNG, WebP, or GIF image.')
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('That image is too large — please choose one under 10MB.')
  }

  const ext = EXTENSION_BY_MIME_TYPE[file.type] || 'jpg'
  const path = `${teamId}/${conversationId}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage
    .from(MESSAGE_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) throw error
  return path
}

// Batched signed-URL resolution for however many distinct message image
// paths need displaying at once (same batching reasoning as
// fetchLastMessagesForConversations) — returns { [path]: signedUrl },
// skipping any path the Storage API couldn't sign rather than failing the
// whole batch.
export async function resolveMessageImageUrls(paths) {
  const uniquePaths = [...new Set(paths)]
  if (uniquePaths.length === 0) return {}

  const { data, error } = await supabase.storage
    .from(MESSAGE_IMAGES_BUCKET)
    .createSignedUrls(uniquePaths, 3600)

  if (error) throw error

  const urlsByPath = {}
  for (const entry of data) {
    if (entry.signedUrl && !entry.error) {
      urlsByPath[entry.path] = entry.signedUrl
    }
  }
  return urlsByPath
}

export async function startDirectConversation(otherUserId) {
  const { data, error } = await supabase.rpc('get_or_create_direct_conversation', {
    other_user_id: otherUserId,
  })
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Group conversations (coach-only to create/manage; athletes view/post only)
// ---------------------------------------------------------------------------

// Runs entirely inside a SECURITY DEFINER RPC (bypasses RLS internally,
// same reasoning as the DM flow) — creating a brand-new group as plain
// client-side inserts hits a chicken-and-egg RLS problem, since the policy
// that lets a coach add participants checks conversations via a subquery
// that's itself gated on already being a participant, which nobody is yet
// at the moment of creation.
export async function createGroupConversation({ name, athleteIds }) {
  const { data, error } = await supabase.rpc('create_group_conversation', {
    group_name: name,
    athlete_ids: athleteIds,
  })
  if (error) throw error
  return { id: data }
}

export async function renameGroup(conversationId, name) {
  const { error } = await supabase.from('conversations').update({ name }).eq('id', conversationId)
  if (error) throw error
}

export async function addGroupParticipants(conversationId, userIds) {
  if (userIds.length === 0) return
  const rows = userIds.map((userId) => ({ conversation_id: conversationId, user_id: userId }))
  const { error } = await supabase.from('conversation_participants').insert(rows)
  if (error) throw error
}

export async function removeGroupParticipant(conversationId, userId) {
  const { error } = await supabase
    .from('conversation_participants')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function deleteGroup(conversationId) {
  // .select() here isn't just for the return value — without it, a delete
  // that RLS silently filters down to 0 matched rows reports success with
  // no error (see CLAUDE.md's RLS pitfalls), which would hide a real
  // permission mismatch instead of surfacing it.
  const { data, error } = await supabase.from('conversations').delete().eq('id', conversationId).select()
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Group could not be deleted — it may have already been removed, or you no longer have permission.')
  }
}

export function subscribeToConversation(conversationId, onInsert) {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}
