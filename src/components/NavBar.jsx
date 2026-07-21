import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { IconMenu2, IconX } from '@tabler/icons-react'
import { useAuth } from '../context/AuthContext'
import { APP_NAME } from '../config'

export default function NavBar() {
  const { profile, signOut } = useAuth()
  const isCoach = profile?.role === 'coach'
  const isAdmin = profile?.role === 'admin'
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer any time navigation happens, so tapping a link
  // doesn't leave it hanging open behind the newly-rendered page.
  useEffect(() => {
    setMenuOpen(false)
  }, [location])

  // Lock page scroll behind the drawer while it's open — without this the
  // page content scrolls along with the overlay on a long mobile page.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  const links = isCoach ? (
    <>
      <NavLink to="/" end>
        Team Logs
      </NavLink>
      <NavLink to="/roster">Roster</NavLink>
      <NavLink to="/pending">Pending</NavLink>
      <NavLink to="/messages">Messages</NavLink>
      <NavLink to="/events">Calendar</NavLink>
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
      <NavLink to="/events">Calendar</NavLink>
      <NavLink to="/assignments">Assignments</NavLink>
      <NavLink to="/settings">Team Theme</NavLink>
    </>
  ) : (
    <>
      <NavLink to="/" end>
        Calendar
      </NavLink>
      <NavLink to="/history">History</NavLink>
      <NavLink to="/messages">Messages</NavLink>
      <NavLink to="/assignments">Assignments</NavLink>
    </>
  )

  return (
    <header className="navbar">
      <div className="navbar-brand">
        <img src="/logo.png" alt="" className="navbar-logo" />
        {APP_NAME}
      </div>

      <nav className="navbar-links">
        {links}
        <NavLink to="/account">Account</NavLink>
      </nav>
      <div className="navbar-user">
        <span>{profile?.name || 'You'}</span>
        <button type="button" className="link-button" onClick={signOut}>
          Log out
        </button>
      </div>

      <button
        type="button"
        className="navbar-menu-toggle"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <IconX size={24} /> : <IconMenu2 size={24} />}
      </button>

      {menuOpen && (
        <button
          type="button"
          className="navbar-drawer-overlay"
          onClick={() => setMenuOpen(false)}
          aria-label="Close menu"
        />
      )}

      <nav className={`navbar-drawer ${menuOpen ? 'open' : ''}`}>
        {links}
        <NavLink to="/account">Account</NavLink>
        <div className="navbar-drawer-user">
          <span>{profile?.name || 'You'}</span>
          <button type="button" className="link-button" onClick={signOut}>
            Log out
          </button>
        </div>
      </nav>
    </header>
  )
}
