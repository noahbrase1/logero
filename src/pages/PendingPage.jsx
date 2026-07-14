import { useAuth } from '../context/AuthContext'

export default function PendingPage() {
  const { profile, signOut } = useAuth()

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Almost there{profile?.name ? `, ${profile.name}` : ''}</h1>
        <p>
          Your account is waiting on approval from your coach. Once they assign you a role
          you&rsquo;ll get access to the app automatically.
        </p>
        <button type="button" onClick={signOut}>
          Log out
        </button>
      </div>
    </div>
  )
}
