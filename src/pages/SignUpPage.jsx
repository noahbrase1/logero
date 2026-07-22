import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { resolveInviteCode } from '../lib/teams'
import RunnerSprite from '../components/RunnerSprite'

export default function SignUpPage() {
  const [searchParams] = useSearchParams()
  const codeFromUrl = searchParams.get('invite') || ''

  const [inviteCode, setInviteCode] = useState(codeFromUrl)
  const [team, setTeam] = useState(null)
  const [checkingCode, setCheckingCode] = useState(false)
  const [codeError, setCodeError] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (codeFromUrl) verifyCode(codeFromUrl)
    // Only ever auto-runs once, off whatever code was in the URL on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function verifyCode(code) {
    const trimmed = code.trim()
    if (!trimmed) {
      setCodeError('Enter an invite code.')
      return
    }
    setCheckingCode(true)
    setCodeError('')
    try {
      const found = await resolveInviteCode(trimmed)
      if (!found) {
        setCodeError("That invite code doesn't match any team — double-check the link with your coach.")
        setTeam(null)
        return
      }
      setTeam(found)
    } catch (err) {
      setCodeError(err.message)
      setTeam(null)
    } finally {
      setCheckingCode(false)
    }
  }

  function handleCodeSubmit(e) {
    e.preventDefault()
    verifyCode(inviteCode)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, team_id: team.id } },
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    if (data.session) {
      navigate('/')
    } else {
      setInfo('Account created. Check your email to confirm your address, then log in.')
    }
  }

  if (!team) {
    return (
      <div className="auth-page auth-page-animated">
        <div className="auth-hero">
          <RunnerSprite animate={false} />
        </div>
        <form className="auth-card auth-card-dark" onSubmit={handleCodeSubmit}>
          <h1>Sign up</h1>
          <p className="page-subtitle">Enter the invite code your coach shared with you.</p>
          <label>
            Invite code
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoFocus
              required
            />
          </label>
          {codeError && <p className="form-error">{codeError}</p>}
          <button type="submit" disabled={checkingCode}>
            {checkingCode ? 'Checking…' : 'Continue'}
          </button>
          <p className="auth-switch">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
          <p className="auth-switch">
            Starting a new team? <Link to="/create-team">Create your team</Link>
          </p>
        </form>
      </div>
    )
  }

  return (
    <div className="auth-page auth-page-animated">
      <div className="auth-hero">
        <RunnerSprite animate={false} />
      </div>
      <form className="auth-card auth-card-dark" onSubmit={handleSubmit}>
        <h1>Sign up</h1>
        <p className="page-subtitle">
          Joining <strong>{team.name}</strong>.{' '}
          <button type="button" className="link-button" onClick={() => setTeam(null)}>
            Not your team?
          </button>
        </p>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {info && <p className="form-info">{info}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing up…' : 'Sign up'}
        </button>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  )
}
