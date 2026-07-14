import { supabase } from './supabaseClient'

export async function updateOwnName(name) {
  const { error } = await supabase.rpc('update_own_name', { new_name: name })
  if (error) throw error
}

// Supabase Auth's own email-change flow — this does NOT update auth.users.email
// immediately. It sends a confirmation link to the new address (and, if
// "secure email change" is on for this project, to the old one too); the
// change only takes effect once confirmed.
export async function updateOwnEmail(newEmail) {
  const { error } = await supabase.auth.updateUser({ email: newEmail })
  if (error) throw error
}

// Supabase's updateUser() only needs the active session to change a
// password — it has no concept of "current password". The explicit
// re-entry/verification step the product wants is implemented here by
// signing in again with the claimed current password first; a wrong
// password fails that sign-in with a clear, specific error before anything
// is changed.
export async function updateOwnPassword(email, currentPassword, newPassword) {
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (verifyError) throw new Error('Current password is incorrect.')

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}
