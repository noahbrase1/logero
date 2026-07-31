import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { getPendingInvite } from './utils/pendingInvite'
import BottomNav from './components/BottomNav'
import NavBar from './components/NavBar'
import SuperAdminHeader from './components/SuperAdminHeader'
import TeamStatusBanner from './components/TeamStatusBanner'
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'
import CreateTeamPage from './pages/CreateTeamPage'
import JoinPage from './pages/JoinPage'
import InstallPage from './pages/InstallPage'
import PendingPage from './pages/PendingPage'
import RemovedPage from './pages/RemovedPage'
import LogWorkoutPage from './pages/LogWorkoutPage'
import TeamFeedPage from './pages/TeamFeedPage'
import RosterPage from './pages/RosterPage'
import FormerAthletesPage from './pages/FormerAthletesPage'
import AthleteDetailPage from './pages/AthleteDetailPage'
import AthleteCalendarPage from './pages/AthleteCalendarPage'
import MessagesPage from './pages/MessagesPage'
import TeamSettingsPage from './pages/TeamSettingsPage'
import EventsPage from './pages/EventsPage'
import EventDetailPage from './pages/EventDetailPage'
import CoachAssignmentsPage from './pages/CoachAssignmentsPage'
import AccountSettingsPage from './pages/AccountSettingsPage'
import SuperAdminPage from './pages/SuperAdminPage'

export default function App() {
  const { user, role, isSuperAdmin, loading, authError, retry } = useAuth()

  if (loading) {
    return (
      <div className="full-page-loader">
        <span className="spinner" /> Loading…
      </div>
    )
  }

  // The session check timed out (see AuthContext's SESSION_TIMEOUT_MS) and
  // there's no already-known session to fall back on — rather than bouncing
  // straight to the login page (which would force a real re-login even if
  // this was just a transient resume-from-background hiccup), offer a retry
  // that just re-checks the existing browser session first.
  if (authError && !user) {
    return (
      <div className="full-page-loader full-page-loader-error">
        <p>Something went wrong loading this.</p>
        <button type="button" onClick={retry}>
          Tap to retry
        </button>
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        {/* An installed PWA's start_url is always "/" (see
            public/manifest.json) — someone who visited /join?invite=CODE,
            installed to their home screen, and only opens the app later
            (or after fully closing it) loses that query string the moment
            they relaunch from the icon. LoggedOutEntry recovers a still-
            valid saved invite code (see src/utils/pendingInvite.js) and
            routes straight to signup with it applied; the catch-all below
            shares the same recovery for any other unmatched path. Explicit
            routes like /login are deliberately NOT covered by this check —
            an existing user consciously navigating to /login shouldn't be
            hijacked into signup just because some earlier invite code is
            still sitting in this browser's storage. */}
        <Route path="/" element={<LoggedOutEntry />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/create-team" element={<CreateTeamPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/install" element={<InstallPage />} />
        <Route path="*" element={<LoggedOutEntry />} />
      </Routes>
    )
  }

  // Checked before the profile-based gates below — a super admin has no
  // profiles row at all, so `role` is always null for them. This routes
  // them to a completely separate, minimal experience: no NavBar, no
  // TeamStatusBanner, no coach/admin/athlete routes, nothing team-scoped.
  if (isSuperAdmin) {
    return (
      <>
        <SuperAdminHeader />
        <main>
          <Routes>
            <Route path="/" element={<SuperAdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </>
    )
  }

  if (role === 'pending' || role === null) {
    return <PendingPage />
  }

  if (role === 'removed') {
    return <RemovedPage />
  }

  return (
    <>
      <NavBar />
      <TeamStatusBanner />
      <main>
        {role === 'coach' ? (
          <Routes>
            <Route path="/" element={<TeamFeedPage />} />
            <Route path="/roster" element={<RosterPage />} />
            <Route path="/former-athletes" element={<FormerAthletesPage />} />
            <Route path="/athletes/:id" element={<AthleteDetailPage />} />
            <Route path="/athletes/:id/calendar" element={<AthleteCalendarPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:id" element={<MessagesPage />} />
            <Route path="/settings" element={<TeamSettingsPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/assignments" element={<CoachAssignmentsPage />} />
            <Route path="/account" element={<AccountSettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : role === 'admin' ? (
          // Read-only athletic-director view: the same coach-facing pages,
          // reused as-is — each one hides its own write controls when
          // profile.role === 'admin' (see NavBar/RosterPage/TeamSettingsPage/
          // CoachAssignmentsPage/MessagesPage). RosterPage's pending-signups
          // section is one such control — it only fetches/renders for a
          // coach, so an admin's Roster page never shows it at all.
          <Routes>
            <Route path="/" element={<TeamFeedPage />} />
            <Route path="/roster" element={<RosterPage />} />
            <Route path="/former-athletes" element={<FormerAthletesPage />} />
            <Route path="/athletes/:id" element={<AthleteDetailPage />} />
            <Route path="/athletes/:id/calendar" element={<AthleteCalendarPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:id" element={<MessagesPage />} />
            <Route path="/settings" element={<TeamSettingsPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/assignments" element={<CoachAssignmentsPage />} />
            <Route path="/account" element={<AccountSettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<EventsPage />} />
            <Route path="/log" element={<LogWorkoutPage />} />
            <Route path="/edit/:workoutId" element={<LogWorkoutPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:id" element={<MessagesPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/account" element={<AccountSettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
      <BottomNav />
    </>
  )
}

// The logged-out landing spot for "/" and any unmatched path — see the
// comment above its routes for why this exists instead of a plain
// `<Navigate to="/login" />`.
function LoggedOutEntry() {
  const code = getPendingInvite()
  if (code) return <Navigate to={`/signup?invite=${encodeURIComponent(code)}`} replace />
  return <Navigate to="/login" replace />
}
