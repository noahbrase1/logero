import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { onAppResume } from '../utils/appResume'
import { withTimeout } from '../utils/withTimeout'

const AuthContext = createContext(undefined)

// This provider's `loading` gates the *entire* app (see App.jsx) — if the
// session/profile check hangs, nothing renders at all. That's the exact
// "reopen the PWA after it's been backgrounded and it's stuck loading
// forever" bug: a phone can suspend a tab's network stack for long enough
// that the underlying request never settles, and normally nothing would
// ever un-stick it short of a full close/reopen. A hard timeout guarantees
// `loading` always resolves either way.
const SESSION_TIMEOUT_MS = 10000

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [teamStatus, setTeamStatus] = useState(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(false)
  const runningRef = useRef(false)

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

  const applySession = useCallback(
    async (nextSession) => {
      setSession(nextSession)
      await withTimeout(loadProfile(nextSession?.user?.id), SESSION_TIMEOUT_MS)
    },
    [loadProfile]
  )

  // The initial session check, also reused as the resume-recovery path
  // below. Guarded by runningRef so a resume firing while the initial (or a
  // previous resume's) check is still in flight doesn't kick off an
  // overlapping second one.
  const runInit = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setLoading(true)
    try {
      const {
        data: { session: nextSession },
      } = await withTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS)
      await applySession(nextSession)
      setAuthError(false)
    } catch (err) {
      console.error('Failed to restore session', err)
      setAuthError(true)
    } finally {
      setLoading(false)
      runningRef.current = false
    }
  }, [applySession])

  useEffect(() => {
    let isMounted = true

    runInit()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!isMounted) return
      setLoading(true)
      try {
        await applySession(nextSession)
        setAuthError(false)
      } catch (err) {
        console.error('Failed to load profile on auth change', err)
        setAuthError(true)
      } finally {
        if (isMounted) setLoading(false)
      }
    })

    // A phone backgrounding this tab for a while can silently drop the
    // in-flight session check, or leave the app trusting stale state from
    // before it was suspended — re-verify the session the instant the app
    // is back in the foreground rather than waiting on a connection that
    // may never recover on its own. See src/utils/appResume.js.
    const stopResumeListener = onAppResume(() => {
      if (isMounted) runInit()
    })

    return () => {
      isMounted = false
      listener?.subscription?.unsubscribe()
      stopResumeListener()
    }
  }, [runInit, applySession])

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
    authError,
    retry: runInit,
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
