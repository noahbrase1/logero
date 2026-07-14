import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { createPendingTeam } from '../lib/teams'

export default function CreateTeamPage() {
  const [teamName, setTeamName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const teamId = await createPendingTeam(teamName)
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, team_id: teamId } },
      })
      if (signUpError) {
        setError(signUpError.message)
        return
      }
      if (data.session) {
        navigate('/')
      } else {
        setInfo('Team created and account registered. Check your email to confirm your address, then log in.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Create your team</h1>
        <p className="page-subtitle">
          You'll become the team's founding coach. A super admin reviews new teams before they can invite
          athletes or coaches — you can look around and set things up in the meantime.
        </p>
        <label>
          Team name
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Eastside Track Club"
            required
            autoFocus
          />
        </label>
        <label>
          Your name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
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
          {loading ? 'Creating…' : 'Create team'}
        </button>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
        <p className="auth-switch">
          Joining an existing team? <Link to="/signup">Sign up with an invite link</Link>
        </p>
      </form>
    </div>
  )
}
