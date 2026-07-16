import { useAuth } from '../context/AuthContext'
import { APP_NAME } from '../config'

// Deliberately not a variant of NavBar — a super admin has no profile/role
// to branch on, and no team-scoped pages to link to. Just identity + sign out.
export default function SuperAdminHeader() {
  const { signOut } = useAuth()

  return (
    <header className="navbar navbar-simple">
      <div className="navbar-brand">
        <img src="/logo.png" alt="" className="navbar-logo" />
        {APP_NAME} — Super Admin
      </div>
      <div className="navbar-user">
        <button type="button" className="link-button" onClick={signOut}>
          Log out
        </button>
      </div>
    </header>
  )
}
