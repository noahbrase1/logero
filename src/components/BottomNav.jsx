import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  IconCalendarEvent,
  IconClipboardList,
  IconClipboardPlus,
  IconDotsCircleHorizontal,
  IconMessageCircle,
  IconStopwatch,
  IconUsers,
} from '@tabler/icons-react'
import { useAuth } from '../context/AuthContext'
import Modal from './Modal'

// Mobile-only persistent bottom nav — replaces NavBar's old hamburger/
// drawer on small screens (see index.css's 860px breakpoint: this and
// NavBar's desktop links are both always rendered, CSS decides which is
// visible, same technique the old hamburger toggle used). Primary slots
// are role-specific; anything that doesn't fit lives under "More" (reuses
// Modal's overlay rather than a bespoke bottom-sheet).
export default function BottomNav() {
  const { profile, signOut } = useAuth()
  const isCoach = profile?.role === 'coach'
  const isAdmin = profile?.role === 'admin'
  const [moreOpen, setMoreOpen] = useState(false)

  // Same order/labels as NavBar's desktop links, with one deliberate
  // exception: a coach's 4th primary slot is Splits (a write-only tool, see
  // SplitsPage.jsx), not Athletes — Athletes moves under More for a coach
  // to make room. Admin has no access to Splits (read-only role, nothing to
  // record), so admin's primary four are unchanged. "Workouts" is also the
  // coach/admin home page ("/"), folding in what used to be a separate
  // "Team Logs" nav destination.
  const primaryItems = isCoach
    ? [
        { to: '/', label: 'Workouts', Icon: IconClipboardList, end: true },
        { to: '/events', label: 'Calendar', Icon: IconCalendarEvent },
        { to: '/messages', label: 'Messages', Icon: IconMessageCircle },
        { to: '/splits', label: 'Splits', Icon: IconStopwatch },
      ]
    : isAdmin
      ? [
          { to: '/', label: 'Workouts', Icon: IconClipboardList, end: true },
          { to: '/events', label: 'Calendar', Icon: IconCalendarEvent },
          { to: '/messages', label: 'Messages', Icon: IconMessageCircle },
          { to: '/roster', label: 'Athletes', Icon: IconUsers },
        ]
      : [
          { to: '/', label: 'Calendar', Icon: IconCalendarEvent, end: true },
          { to: '/log', label: 'Log', Icon: IconClipboardPlus },
          { to: '/messages', label: 'Messages', Icon: IconMessageCircle },
        ]

  const moreItems = isCoach
    ? [
        { to: '/roster', label: 'Athletes' },
        { to: '/settings', label: 'Team Theme' },
        { to: '/account', label: 'Account' },
      ]
    : isAdmin
      ? [
          { to: '/settings', label: 'Team Theme' },
          { to: '/account', label: 'Account' },
        ]
      : [{ to: '/account', label: 'Account' }]

  function closeMore() {
    setMoreOpen(false)
  }

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary">
        {primaryItems.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="bottom-nav-item">
            <Icon size={22} stroke={1.75} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button type="button" className="bottom-nav-item" onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <IconDotsCircleHorizontal size={22} stroke={1.75} />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <Modal onClose={closeMore} labelledBy="bottom-nav-more-heading">
          <h2 id="bottom-nav-more-heading" className="bottom-nav-more-heading">
            More
          </h2>
          <div className="bottom-nav-more-list">
            {moreItems.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} onClick={closeMore}>
                {label}
              </NavLink>
            ))}
            <button type="button" className="link-button danger" onClick={signOut}>
              Log out
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
