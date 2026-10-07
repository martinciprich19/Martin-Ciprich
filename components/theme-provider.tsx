'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  isReady: boolean
  storageError: boolean
}

const STORAGE_KEY = 'riva-theme'
const ThemeContext = createContext<ThemeContextValue | null>(null)

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, updateTheme] = useState<Theme>('dark')
  const [isReady, setIsReady] = useState(false)
  const [storageError, setStorageError] = useState(false)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      const initialTheme = saved === 'light' ? 'light' : 'dark'
      updateTheme(initialTheme)
      applyTheme(initialTheme)
    } catch (error: unknown) {
      console.error('Theme preference could not be loaded:', error)
      setStorageError(true)
    }
    setIsReady(true)

    const syncTheme = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || (event.key !== STORAGE_KEY && event.key !== null)) return
      const nextTheme = event.newValue === 'light' ? 'light' : 'dark'
      updateTheme(nextTheme)
      applyTheme(nextTheme)
    }
    window.addEventListener('storage', syncTheme)
    return () => window.removeEventListener('storage', syncTheme)
  }, [])

  const setTheme = useCallback((nextTheme: Theme) => {
    updateTheme(nextTheme)
    applyTheme(nextTheme)
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme)
      setStorageError(false)
    } catch (error: unknown) {
      console.error('Theme preference could not be saved:', error)
      setStorageError(true)
    }
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme, isReady, storageError }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
