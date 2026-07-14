import { supabase } from './supabaseClient'

// Resolves an invite code to { id, name } for the signup page — callable
// before the user has a session (see get_team_by_invite_code() in
// multi_tenancy_invite_signup_schema.sql, which is the only thing granted
// to anon). Returns null for an unknown code rather than throwing, since
// that's an expected, user-correctable outcome, not an error state.
export async function resolveInviteCode(code) {
  const { data, error } = await supabase.rpc('get_team_by_invite_code', { code })
  if (error) throw error
  return data && data.length > 0 ? data[0] : null
}

export async function fetchTeamById(teamId) {
  const { data, error } = await supabase.from('teams').select('*').eq('id', teamId).single()
  if (error) throw error
  return data
}

// Public self-service team creation (see "Create Your Team" page). Callable
// before the user has a session — the team starts life as status='pending'
// and the caller becomes its founding coach the moment they finish signing
// up against the returned team id (see handle_new_user() in
// team_approval_schema.sql for how that's decided server-side).
export async function createPendingTeam(name) {
  const { data, error } = await supabase.rpc('create_pending_team', { team_name: name })
  if (error) throw error
  return data // new team's id
}

// Everything below is super-admin only — each RPC enforces its own
// is_super_admin() check server-side (see standalone_super_admin_schema.sql)
// regardless of what calls it. None of these return anything beyond what a
// super admin is allowed to see: team name/status/created_at, aggregate
// counts, and — for pending teams only — the founding coach's name/email.

export async function fetchTeamStats() {
  const { data, error } = await supabase.rpc('get_team_stats')
  if (error) throw error
  return data
}

export async function fetchPendingTeams() {
  const { data, error } = await supabase.rpc('get_pending_teams')
  if (error) throw error
  return data
}

export async function approveTeam(teamId) {
  const { error } = await supabase.rpc('set_team_status', { target_team_id: teamId, new_status: 'active' })
  if (error) throw error
}

export async function rejectTeam(teamId) {
  const { error } = await supabase.rpc('set_team_status', { target_team_id: teamId, new_status: 'rejected' })
  if (error) throw error
}
