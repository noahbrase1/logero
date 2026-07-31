import { NavLink } from 'react-router-dom'
import {
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

  // Coach and admin share one order/label set, uniform with BottomNav's
  // mobile tabs (Workouts/Calendar/Messages/Athletes primary, Team Theme
  // under More) — "Workouts" is also the coach/admin home page ("/"),
  // folding in what used to be a separate "Team Logs" nav destination.
  const links = isCoach || isAdmin ? (
    <>
      <NavLink to="/" end>
        <IconClipboardList size={18} stroke={1.75} />
        Workouts
      </NavLink>
      <NavLink to="/events">
        <IconCalendarEvent size={18} stroke={1.75} />
        Calendar
      </NavLink>
      <NavLink to="/messages">
        <IconMessageCircle size={18} stroke={1.75} />
        Messages
      </NavLink>
      <NavLink to="/roster">
        <IconUsers size={18} stroke={1.75} />
        Athletes
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
