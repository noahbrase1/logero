import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { fetchTeamById } from '../lib/teams'

const PRESETS = [
  { name: 'Violet (default)', primary: '#7c3aed', accent: '#5b21b6' },
  { name: 'Crimson', primary: '#dc2626', accent: '#991b1b' },
  { name: 'Ocean', primary: '#0284c7', accent: '#075985' },
  { name: 'Forest', primary: '#16a34a', accent: '#166534' },
  { name: 'Amber', primary: '#d97706', accent: '#92400e' },
  { name: 'Slate', primary: '#475569', accent: '#1e293b' },
]

export default function TeamSettingsPage() {
  const { profile } = useAuth()
  const canEdit = profile?.role === 'coach'
  const { showToast } = useToast()
  const { settings, loading, previewColors, saveColors } = useTheme()
  const [primaryColor, setPrimaryColor] = useState('#7c3aed')
  const [accentColor, setAccentColor] = useState('#5b21b6')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [team, setTeam] = useState(null)

  useEffect(() => {
    if (settings) {
      setPrimaryColor(settings.primary_color)
      setAccentColor(settings.accent_color)
    }
  }, [settings])

  useEffect(() => {
    if (!profile?.team_id) return
    fetchTeamById(profile.team_id)
      .then(setTeam)
      .catch(() => {}) // non-critical — the invite panel just won't render
  }, [profile?.team_id])

  function inviteLink() {
    return team ? `${window.location.origin}/signup?invite=${team.invite_code}` : ''
  }

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink())
      showToast('Invite link copied')
    } catch {
      showToast('Could not copy — copy it manually')
    }
  }

  function handlePrimaryChange(value) {
    setPrimaryColor(value)
    previewColors(value, accentColor)
  }

  function handleAccentChange(value) {
    setAccentColor(value)
    previewColors(primaryColor, value)
  }

  function applyPreset(preset) {
    setPrimaryColor(preset.primary)
    setAccentColor(preset.accent)
    previewColors(preset.primary, preset.accent)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await saveColors(primaryColor, accentColor)
      setSuccess('Team colors updated for everyone.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="page loading-state">
        <span className="spinner" /> Loading…
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Team theme</h1>
      <p className="page-subtitle">
        Pick the colors used across buttons, nav, and highlights for the whole team.
      </p>

      {team && (
        <div className="theme-settings">
          <h2 className="events-section-heading">Team invite link</h2>
          <p className="page-subtitle">Share this link so athletes and coaches can join {team.name}.</p>
          <div className="form-row">
            <input type="text" readOnly value={inviteLink()} onFocus={(e) => e.target.select()} />
            <button type="button" className="secondary" onClick={handleCopyInvite}>
              Copy link
            </button>
          </div>
        </div>
      )}

      {canEdit ? (
        <div className="theme-settings">
          <div className="theme-presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="preset-swatch"
                style={{ background: p.primary }}
                onClick={() => applyPreset(p)}
                title={p.name}
                aria-label={p.name}
              />
            ))}
          </div>

          <div className="form-row">
            <label>
              Primary color
              <input type="color" value={primaryColor} onChange={(e) => handlePrimaryChange(e.target.value)} />
            </label>
            <label>
              Accent color
              <input type="color" value={accentColor} onChange={(e) => handleAccentChange(e.target.value)} />
            </label>
          </div>

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-info">{success}</p>}

          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save for everyone'}
          </button>
        </div>
      ) : (
        <div className="theme-settings">
          <div className="form-row">
            <label>
              Primary color
              <input type="color" value={primaryColor} disabled />
            </label>
            <label>
              Accent color
              <input type="color" value={accentColor} disabled />
            </label>
          </div>
          <p className="empty-state">Only coaches can change team colors.</p>
        </div>
      )}
    </div>
  )
}
