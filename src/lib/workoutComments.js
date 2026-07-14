import { supabase } from './supabaseClient'

export async function fetchComments(workoutId) {
  const { data, error } = await supabase
    .from('workout_comments')
    .select('*, profiles(name)')
    .eq('workout_id', workoutId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function addComment(workoutId, coachId, comment) {
  const { data, error } = await supabase
    .from('workout_comments')
    .insert({ workout_id: workoutId, coach_id: coachId, comment })
    .select('*, profiles(name)')
    .single()
  if (error) throw error
  return data
}
