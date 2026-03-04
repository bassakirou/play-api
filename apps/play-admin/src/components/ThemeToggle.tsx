import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { Button } from './ui/button'

export function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const pref = localStorage.getItem('pp_admin_theme')
    const isDark = pref ? pref === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', isDark)
    setDark(isDark)
  }, [])

  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('pp_admin_theme', next ? 'dark' : 'light')
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Basculer le thème">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}

