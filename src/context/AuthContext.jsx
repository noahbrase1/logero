import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(undefined)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [teamStatus, setTeamStatus] = useState(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      setTeamStatus(null)
      setIsSuperAdmin(false)
      return
    }

    // Super admins have no profiles row at all — check this first, using
    // maybeSingle() since "no row" is the expected, common case here (not
    // an error to log), unlike the profiles lookup below.
    const { data: superAdminRow } = await supabase
      .from('super_admins')
      .select('id')
      .eq('id', userId)
      .maybeSingle()

    if (superAdminRow) {
      setIsSuperAdmin(true)
      setProfile(null)
      setTeamStatus(null)
      return
    }
    setIsSuperAdmin(false)

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Failed to load profile', error)
      setProfile(null)
      setTeamStatus(null)
      return
    }

    setProfile(data)

    if (!data.team_id) {
      setTeamStatus(null)
      return
    }
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .select('status')
      .eq('id', data.team_id)
      .single()

    if (teamError) {
      console.error('Failed to load team status', teamError)
      setTeamStatus(null)
    } else {
      setTeamStatus(team.status)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return
      setSession(session)
      await loadProfile(session?.user?.id)
      if (isMounted) setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      setLoading(true)
      await loadProfile(session?.user?.id)
      setLoading(false)
    })

    return () => {
      isMounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [loadProfile])

  const refreshProfile = useCallback(() => loadProfile(session?.user?.id), [loadProfile, session])

  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    role: profile?.role ?? null,
    teamStatus,
    isSuperAdmin,
    loading,
    refreshProfile,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
