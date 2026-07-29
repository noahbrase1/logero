import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resolveInviteCode } from '../lib/teams'
import { savePendingInvite, getPendingInvite } from '../utils/pendingInvite'
import RunnerSprite from '../components/RunnerSprite'
import InstallInstructions from '../components/InstallInstructions'

// The combined "join + install" landing page a coach shares instead of a
// plain /signup?invite= link — covers both installing the PWA and signing
// up for the specific team the invite is for, in whichever order the
// athlete does them. Falls back to a previously-saved pending invite (see
// src/utils/pendingInvite.js) if this exact page is reopened with no ?invite=
// in the URL, though the primary recovery path for "installed, closed
// everything, reopened later" is App.jsx's logged-out entry point at "/".
export default function JoinPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const codeFromUrl = searchParams.get('invite') || ''
  const [code] = useState(() => codeFromUrl || getPendingInvite() || '')

  const [team, setTeam] = useState(null)
  const [loading, setLoading] = useState(Boolean(code))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!code) {
      setError('This link is missing an invite code — ask your coach for their invite link.')
      setLoading(false)
      return
    }

    // Saved immediately, before the code is even verified — so a genuinely
    // valid code still survives an install even if this particular check
    // happens to fail from a transient network blip (App.jsx's resume path
    // will simply re-verify it later, at signup, same as it always has).
    savePendingInvite(code)

    let cancelled = false
    resolveInviteCode(code)
      .then((found) => {
        if (cancelled) return
        if (!found) {
          setError("This invite code doesn't match any team — double-check the link with your coach.")
          return
        }
        setTeam(found)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code])

  return (
    <div className="auth-page auth-page-animated">
      <div className="auth-hero">
        <RunnerSprite animate={false} />
      </div>
      <div className="auth-card auth-card-dark join-card">
        <h1>Join your team</h1>

        {loading && (
          <div className="loading-state">
            <span className="spinner" /> Looking up your invite…
          </div>
        )}

        {!loading && error && (
          <>
            <p className="form-error">{error}</p>
            <p className="auth-switch">
              <Link to="/signup">Enter an invite code manually</Link>
            </p>
          </>
        )}

        {!loading && team && (
          <>
            <p className="page-subtitle">
              You've been invited to join <strong>{team.name}</strong>.
            </p>

            <div className="join-actions">
              <div className="join-action-card">
                <h2>Install the app</h2>
                <InstallInstructions />
              </div>

              <div className="join-action-card">
                <h2>Create your account</h2>
                <p className="page-subtitle">
                  Sign up now, or install first and come back to this page later — either way works.
                </p>
                <button type="button" onClick={() => navigate(`/signup?invite=${encodeURIComponent(code)}`)}>
                  Create your account
                </button>
              </div>
            </div>
          </>
        )}

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  )
}
