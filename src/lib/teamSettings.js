import { supabase } from './supabaseClient'

export async function fetchTeamSettings() {
  const { data, error } = await supabase.from('team_settings').select('*').single()
  if (error) throw error
  return data
}

export async function updateTeamSettings(id, { primaryColor, accentColor }) {
  const { data, error } = await supabase
    .from('team_settings')
    .update({ primary_color: primaryColor, accent_color: accentColor, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
