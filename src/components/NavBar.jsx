import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { APP_NAME } from '../config'

export default function NavBar() {
  const { profile, signOut } = useAuth()
  const isCoach = profile?.role === 'coach'
  const isAdmin = profile?.role === 'admin'

  return (
    <header className="navbar">
      <div className="navbar-brand">
        <img src="/logo.png" alt="" className="navbar-logo" />
        {APP_NAME}
      </div>
      <nav className="navbar-links">
        {isCoach ? (
          <>
            <NavLink to="/" end>
              Team Logs
            </NavLink>
            <NavLink to="/roster">Roster</NavLink>
            <NavLink to="/pending">Pending</NavLink>
            <NavLink to="/messages">Messages</NavLink>
            <NavLink to="/events">Events</NavLink>
            <NavLink to="/assignments">Assignments</NavLink>
            <NavLink to="/settings">Team Theme</NavLink>
          </>
        ) : isAdmin ? (
          <>
            <NavLink to="/" end>
              Team Logs
            </NavLink>
            <NavLink to="/roster">Roster</NavLink>
            <NavLink to="/messages">Messages</NavLink>
            <NavLink to="/events">Events</NavLink>
            <NavLink to="/assignments">Assignments</NavLink>
            <NavLink to="/settings">Team Theme</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/" end>
              Log Workout
            </NavLink>
            <NavLink to="/history">History</NavLink>
            <NavLink to="/messages">Messages</NavLink>
            <NavLink to="/events">Events</NavLink>
            <NavLink to="/assignments">Assignments</NavLink>
          </>
        )}
        <NavLink to="/account">Account</NavLink>
      </nav>
      <div className="navbar-user">
        <span>{profile?.name || 'You'}</span>
        <button type="button" className="link-button" onClick={signOut}>
          Log out
        </button>
      </div>
    </header>
  )
}
