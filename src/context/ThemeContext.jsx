import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { fetchTeamSettings, updateTeamSettings } from '../lib/teamSettings'

const ThemeContext = createContext(undefined)

function hexToRgbString(hex) {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = parseInt(full, 16)
  return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`
}

function applyCssVars(primaryColor, accentColor) {
  const root = document.documentElement
  root.style.setProperty('--accent', primaryColor)
  root.style.setProperty('--accent-dark', accentColor)
  const rgb = hexToRgbString(primaryColor)
  root.style.setProperty('--accent-rgb', rgb)
  root.style.setProperty('--accent-bg', `rgba(${rgb}, 0.1)`)
  root.style.setProperty('--accent-border', `rgba(${rgb}, 0.5)`)
  root.style.setProperty('--accent-shadow', `rgba(${rgb}, 0.35)`)
}

export function ThemeProvider({ children }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    let cancelled = false
    fetchTeamSettings()
      .then((data) => {
        if (cancelled) return
        setSettings(data)
        applyCssVars(data.primary_color, data.accent_color)
      })
      .catch((err) => console.error('Failed to load team theme', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const previewColors = useCallback((primaryColor, accentColor) => {
    applyCssVars(primaryColor, accentColor)
  }, [])

  const saveColors = useCallback(
    async (primaryColor, accentColor) => {
      if (!settings) throw new Error('Settings not loaded yet')
      const updated = await updateTeamSettings(settings.id, { primaryColor, accentColor })
      setSettings(updated)
      applyCssVars(updated.primary_color, updated.accent_color)
      return updated
    },
    [settings]
  )

  return (
    <ThemeContext.Provider value={{ settings, loading, previewColors, saveColors }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
