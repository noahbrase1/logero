import { Link } from 'react-router-dom'
import RunnerSprite from '../components/RunnerSprite'
import InstallInstructions from '../components/InstallInstructions'

// The plain (no team invite attached) install page — /join is the combined
// invite+install flow built on top of the same InstallInstructions piece;
// this is what's linked when there's no specific team invite to go with it.
export default function InstallPage() {
  return (
    <div className="auth-page auth-page-animated">
      <div className="auth-hero">
        <RunnerSprite animate={false} />
      </div>
      <div className="auth-card auth-card-dark">
        <h1>Install the app</h1>
        <p className="page-subtitle">Add Logero to your home screen for quick access, on or off the field.</p>
        <InstallInstructions />
        <p className="auth-switch">
          Have a team invite link? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
