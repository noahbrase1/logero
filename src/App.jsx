import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import NavBar from './components/NavBar'
import SuperAdminHeader from './components/SuperAdminHeader'
import TeamStatusBanner from './components/TeamStatusBanner'
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'
import CreateTeamPage from './pages/CreateTeamPage'
import PendingPage from './pages/PendingPage'
import RemovedPage from './pages/RemovedPage'
import LogWorkoutPage from './pages/LogWorkoutPage'
import TeamFeedPage from './pages/TeamFeedPage'
import RosterPage from './pages/RosterPage'
import FormerAthletesPage from './pages/FormerAthletesPage'
import AthleteDetailPage from './pages/AthleteDetailPage'
import PendingApprovalsPage from './pages/PendingApprovalsPage'
import MessagesPage from './pages/MessagesPage'
import TeamSettingsPage from './pages/TeamSettingsPage'
import EventsPage from './pages/EventsPage'
import EventDetailPage from './pages/EventDetailPage'
import CoachAssignmentsPage from './pages/CoachAssignmentsPage'
import AccountSettingsPage from './pages/AccountSettingsPage'
import SuperAdminPage from './pages/SuperAdminPage'

export default function App() {
  const { user, role, isSuperAdmin, loading } = useAuth()

  if (loading) {
    return (
      <div className="full-page-loader">
        <span className="spinner" /> Loading…
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/create-team" element={<CreateTeamPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
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
            <Route path="/pending" element={<PendingApprovalsPage />} />
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
          // CoachAssignmentsPage/MessagesPage). No /pending route here on
          // purpose — admins can view the roster but never approve/manage it.
          <Routes>
            <Route path="/" element={<TeamFeedPage />} />
            <Route path="/roster" element={<RosterPage />} />
            <Route path="/former-athletes" element={<FormerAthletesPage />} />
            <Route path="/athletes/:id" element={<AthleteDetailPage />} />
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
    </>
  )
}
