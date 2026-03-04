import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { Permission } from './rbac'

type User = {
  id: string
  email: string
  role?: any
  name?: string
}

type AuthContextType = {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  permissions: Permission[] | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [permissions, setPermissions] = useState<Permission[] | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('pp_admin_token')
    const u = localStorage.getItem('pp_admin_user')
    if (t) setToken(t)
    if (u) setUser(JSON.parse(u))
    setLoading(false)
  }, [])

  const login = async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password })
    const { access_token, user } = res.data
    const t = access_token
    const u = { ...user, role: user?.role?.name ?? user?.role }
    localStorage.setItem('pp_admin_token', t)
    localStorage.setItem('pp_admin_user', JSON.stringify(u))
    setToken(t)
    setUser(u)
    try {
      if ((user as any)?.role?.id) {
        const roleRes = await api.get(`/roles/${(user as any).role.id}`)
        const perms = roleRes.data?.permissions || null
        setPermissions(perms)
      } else {
        const roleName = u?.role
        const overrideRaw = roleName ? localStorage.getItem(`pp_role_perms_${roleName}`) : null
        const override: Permission[] | null = overrideRaw ? JSON.parse(overrideRaw) : null
        setPermissions(override || null)
      }
    } catch {
      setPermissions(null)
    }
  }

  const logout = () => {
    localStorage.removeItem('pp_admin_token')
    localStorage.removeItem('pp_admin_user')
    setToken(null)
    setUser(null)
    setPermissions(null)
  }

  const value = useMemo(
    () => ({ user, token, loading, login, logout, permissions }),
    [user, token, loading, permissions]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
