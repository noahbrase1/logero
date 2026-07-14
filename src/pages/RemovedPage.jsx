import { useAuth } from '../context/AuthContext'

export default function RemovedPage() {
  const { profile, signOut } = useAuth()

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Access removed</h1>
        <p>
          {profile?.name ? `${profile.name}, your` : 'Your'} access to this team has been removed by a coach. If you
          think this is a mistake, reach out to your coach directly.
        </p>
        <button type="button" onClick={signOut}>
          Log out
        </button>
      </div>
    </div>
  )
}
