import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateOwnEmail, updateOwnName, updateOwnPassword } from '../lib/account'
import { getNotificationPreferences, isPushSupported, setNotificationPreference } from '../lib/pushNotifications'

export default function AccountSettingsPage() {
  const { user, profile, refreshProfile } = useAuth()

  const pushSupported = isPushSupported()
  const [notifyMessages, setNotifyMessages] = useState(false)
  const [notifyCalendar, setNotifyCalendar] = useState(false)
  const [pushChecking, setPushChecking] = useState(pushSupported)
  const [savingType, setSavingType] = useState(null) // null | 'messages' | 'calendar'
  const [pushError, setPushError] = useState('')
  const [pushBlocked, setPushBlocked] = useState(false)

  useEffect(() => {
    if (!pushSupported) return
    setPushBlocked(Notification.permission === 'denied')
    getNotificationPreferences(user.id)
      .then(({ notifyMessages, notifyCalendar }) => {
        setNotifyMessages(notifyMessages)
        setNotifyCalendar(notifyCalendar)
      })
      .finally(() => setPushChecking(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // `type`: 'messages' | 'calendar'. Each toggle is independent — turning
  // one on subscribes this browser first if it isn't already; turning one
  // off never affects the other (see setNotificationPreference).
  async function handleToggle(type, checked) {
    setPushError('')
    setSavingType(type)
    try {
      await setNotificationPreference(user.id, type, checked)
      if (type === 'messages') setNotifyMessages(checked)
      else setNotifyCalendar(checked)
      setPushBlocked(false)
    } catch (err) {
      setPushError(err.message)
      setPushBlocked(Notification.permission === 'denied')
      const prefs = await getNotificationPreferences(user.id)
      setNotifyMessages(prefs.notifyMessages)
      setNotifyCalendar(prefs.notifyCalendar)
    } finally {
      setSavingType(null)
    }
  }

  const [name, setName] = useState(profile?.name || '')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [nameSuccess, setNameSuccess] = useState('')

  const [email, setEmail] = useState(user?.email || '')
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailSuccess, setEmailSuccess] = useState('')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')

  async function handleNameSubmit(e) {
    e.preventDefault()
    setNameError('')
    setNameSuccess('')
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Name cannot be empty.')
      return
    }
    setNameSaving(true)
    try {
      await updateOwnName(trimmed)
      await refreshProfile()
      setNameSuccess('Name updated.')
    } catch (err) {
      setNameError(err.message)
    } finally {
      setNameSaving(false)
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault()
    setEmailError('')
    setEmailSuccess('')
    const trimmed = email.trim()
    if (!trimmed) {
      setEmailError('Email cannot be empty.')
      return
    }
    setEmailSaving(true)
    try {
      await updateOwnEmail(trimmed)
      setEmailSuccess('Confirmation email sent to your new address — the change takes effect once you confirm it.')
    } catch (err) {
      setEmailError(err.message)
    } finally {
      setEmailSaving(false)
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.')
      return
    }
    setPasswordSaving(true)
    try {
      await updateOwnPassword(user.email, currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSuccess('Password updated.')
    } catch (err) {
      setPasswordError(err.message)
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <div className="page">
      <h1>Account settings</h1>

      <div className="theme-settings">
        <h2 className="events-section-heading">Display name</h2>
        <form onSubmit={handleNameSubmit}>
          <div className="form-row">
            <label>
              Name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
          </div>
          {nameError && <p className="form-error">{nameError}</p>}
          {nameSuccess && <p className="form-info">{nameSuccess}</p>}
          <button type="submit" disabled={nameSaving}>
            {nameSaving ? 'Saving…' : 'Save name'}
          </button>
        </form>
      </div>

      <div className="theme-settings">
        <h2 className="events-section-heading">Email</h2>
        <form onSubmit={handleEmailSubmit}>
          <div className="form-row">
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
          </div>
          {emailError && <p className="form-error">{emailError}</p>}
          {emailSuccess && <p className="form-info">{emailSuccess}</p>}
          <button type="submit" disabled={emailSaving}>
            {emailSaving ? 'Sending…' : 'Update email'}
          </button>
        </form>
      </div>

      <div className="theme-settings">
        <h2 className="events-section-heading">Password</h2>
        <form onSubmit={handlePasswordSubmit}>
          <label>
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          {passwordError && <p className="form-error">{passwordError}</p>}
          {passwordSuccess && <p className="form-info">{passwordSuccess}</p>}
          <button type="submit" disabled={passwordSaving}>
            {passwordSaving ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>

      <div className="theme-settings">
        <h2 className="events-section-heading">Notifications</h2>
        {!pushSupported ? (
          <p className="page-subtitle">Push notifications aren't supported in this browser.</p>
        ) : (
          <>
            <label className="toggle-row">
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={notifyMessages}
                  onChange={(e) => handleToggle('messages', e.target.checked)}
                  disabled={pushChecking || savingType !== null || pushBlocked}
                />
                <span className="toggle-track" aria-hidden="true" />
              </span>
              <span>
                <strong>Message notifications</strong>
                <br />
                <span className="page-subtitle" style={{ marginTop: 0 }}>
                  Get notified when you receive a new message.
                </span>
              </span>
            </label>

            <label className="toggle-row">
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={notifyCalendar}
                  onChange={(e) => handleToggle('calendar', e.target.checked)}
                  disabled={pushChecking || savingType !== null || pushBlocked}
                />
                <span className="toggle-track" aria-hidden="true" />
              </span>
              <span>
                <strong>Daily calendar notifications</strong>
                <br />
                <span className="page-subtitle" style={{ marginTop: 0 }}>
                  Get a morning summary of today's assigned workout and any team events — set on or off
                  independently of message notifications.
                </span>
              </span>
            </label>

            {pushBlocked && (
              <p className="form-error">
                Notifications are blocked for this site. To turn them on, allow notifications for this site in your
                browser or phone's settings, then reload this page.
              </p>
            )}
            {pushError && !pushBlocked && <p className="form-error">{pushError}</p>}
          </>
        )}
      </div>
    </div>
  )
}
