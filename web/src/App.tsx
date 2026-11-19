import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { Building2, Camera, FileStack, LogOut, MessagesSquare } from 'lucide-react'
import { SetupNote } from '@/components/SetupNote'
import { Toaster } from '@/components/ui/sonner'
import { LangProvider, LangSwitch, t } from '@/lib/i18n'
import { SessionProvider, useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import AuthPage from '@/pages/Auth'
import DocumentsPage from '@/pages/Documents'
import DocumentPage from '@/pages/Document'
import AskPage from '@/pages/Ask'
import BusinessPage from '@/pages/Business'
import ScanPage from '@/pages/Scan'

// Labels are translation keys, resolved when the shell renders.
const NAV = [
  { to: '/documents', label: 'nav.documents', short: 'nav.documents', icon: FileStack },
  { to: '/scan', label: 'nav.scan', short: 'nav.scan', icon: Camera },
  { to: '/ask', label: 'nav.ask', short: 'nav.ask', icon: MessagesSquare },
  { to: '/business', label: 'nav.business', short: 'nav.businessShort', icon: Building2 },
]

function Shell() {
  const { user, capabilities, loading, signOut } = useSession()
  if (loading) return null
  if (!user) return <Navigate to="/sign-in" replace />

  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.6875rem] font-medium',
      isActive ? 'text-primary' : 'text-muted-foreground',
    )

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {/* Desktop: sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-card px-3 py-5 md:flex">
        <div className="mb-6 px-3">
          <div className="text-base font-semibold tracking-tight">Doc Doctor</div>
          <div className="truncate text-xs text-muted-foreground" title={user.org_name}>
            {user.org_name}
          </div>
        </div>
        <nav className="flex flex-col gap-1" aria-label={t('nav.main')}>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={link}>
              <Icon className="size-4" aria-hidden /> {t(label)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          {capabilities && (!capabilities.claude || !capabilities.local_ocr) && (
            <div className="mb-3 space-y-2 rounded-md border border-dashed px-3 py-2">
              {!capabilities.local_ocr && (
                <SetupNote details="reader" className="text-xs">
                  {t('shell.readerPaused')}
                </SetupNote>
              )}
              {!capabilities.claude && (
                <SetupNote details="claude" className="text-xs">
                  {t('shell.claudeOff')}
                </SetupNote>
              )}
            </div>
          )}
          <button
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden /> {t('nav.signOut')}
          </button>
          <LangSwitch className="mt-1 block w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground" />
        </div>
      </aside>

      {/* Phone: slim header, content, bottom tab bar */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-card px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-semibold tracking-tight whitespace-nowrap">Doc Doctor</span>
          <span className="truncate text-xs text-muted-foreground">{user.org_name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <LangSwitch className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted" />
          <button
            onClick={() => void signOut()}
            aria-label={t('nav.signOut')}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <nav
        className="flex shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label={t('nav.main')}
      >
        {NAV.map(({ to, short, icon: Icon }) => (
          <NavLink key={to} to={to} className={tab}>
            <Icon className="size-5" aria-hidden />
            {t(short)}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <LangProvider>
      <SessionProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
          <Route path="/sign-up" element={<AuthPage mode="sign-up" />} />
          <Route element={<Shell />}>
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/documents/:id" element={<DocumentPage />} />
            <Route path="/ask" element={<AskPage />} />
            <Route path="/ask/:id" element={<AskPage />} />
            <Route path="/business" element={<BusinessPage />} />
            <Route path="/scan" element={<ScanPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/documents" replace />} />
        </Routes>
      </BrowserRouter>
        <Toaster position="bottom-right" />
      </SessionProvider>
    </LangProvider>
  )
}
