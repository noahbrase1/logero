import { NavLink } from 'react-router-dom'
import {
  IconActivity,
  IconCalendarEvent,
  IconClipboardList,
  IconMessageCircle,
  IconPalette,
  IconUserCircle,
  IconUsers,
} from '@tabler/icons-react'
import { useAuth } from '../context/AuthContext'
import { APP_NAME } from '../config'

// Desktop-only top nav now (see index.css's 860px breakpoint) — the mobile
// hamburger/drawer this used to fall back to below that width is gone,
// replaced by BottomNav.jsx + Fab.jsx, mounted alongside this in App.jsx.
// Both this and BottomNav are always rendered; CSS alone decides which is
// visible at a given width, the same "always render both" technique the
// old hamburger toggle used, just split across two components now instead
// of one drawer.
export default function NavBar() {
  const { profile, signOut } = useAuth()
  const isCoach = profile?.role === 'coach'
  const isAdmin = profile?.role === 'admin'

  const links = isCoach ? (
    <>
      <NavLink to="/" end>
        <IconActivity size={18} stroke={1.75} />
        Team Logs
      </NavLink>
      <NavLink to="/roster">
        <IconUsers size={18} stroke={1.75} />
        Roster
      </NavLink>
      <NavLink to="/messages">
        <IconMessageCircle size={18} stroke={1.75} />
        Messages
      </NavLink>
      <NavLink to="/events">
        <IconCalendarEvent size={18} stroke={1.75} />
        Calendar
      </NavLink>
      <NavLink to="/assignments">
        <IconClipboardList size={18} stroke={1.75} />
        Assignments
      </NavLink>
      <NavLink to="/settings">
        <IconPalette size={18} stroke={1.75} />
        Team Theme
      </NavLink>
    </>
  ) : isAdmin ? (
    <>
      <NavLink to="/" end>
        <IconActivity size={18} stroke={1.75} />
        Team Logs
      </NavLink>
      <NavLink to="/roster">
        <IconUsers size={18} stroke={1.75} />
        Roster
      </NavLink>
      <NavLink to="/messages">
        <IconMessageCircle size={18} stroke={1.75} />
        Messages
      </NavLink>
      <NavLink to="/events">
        <IconCalendarEvent size={18} stroke={1.75} />
        Calendar
      </NavLink>
      <NavLink to="/assignments">
        <IconClipboardList size={18} stroke={1.75} />
        Assignments
      </NavLink>
      <NavLink to="/settings">
        <IconPalette size={18} stroke={1.75} />
        Team Theme
      </NavLink>
    </>
  ) : (
    <>
      <NavLink to="/" end>
        <IconCalendarEvent size={18} stroke={1.75} />
        Calendar
      </NavLink>
      <NavLink to="/messages">
        <IconMessageCircle size={18} stroke={1.75} />
        Messages
      </NavLink>
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
        <NavLink to="/account">
          <IconUserCircle size={18} stroke={1.75} />
          Account
        </NavLink>
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
