import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type Capabilities, type User } from './api'

type Session = {
  user: User | null
  capabilities: Capabilities | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      setUser(me.user)
      setCapabilities(me.capabilities)
    } catch {
      setUser(null)
      setCapabilities(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined)
    setUser(null)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <SessionContext.Provider value={{ user, capabilities, loading, refresh, signOut }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
