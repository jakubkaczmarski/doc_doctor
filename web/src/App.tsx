import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { Building2, Camera, FileStack, LogOut, MessagesSquare } from 'lucide-react'
import { CLAUDE_SETUP, READER_SETUP, SetupNote } from '@/components/SetupNote'
import { Toaster } from '@/components/ui/sonner'
import { SessionProvider, useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import AuthPage from '@/pages/Auth'
import DocumentsPage from '@/pages/Documents'
import DocumentPage from '@/pages/Document'
import AskPage from '@/pages/Ask'
import BusinessPage from '@/pages/Business'
import ScanPage from '@/pages/Scan'

const NAV = [
  { to: '/documents', label: 'Documents', short: 'Documents', icon: FileStack },
  { to: '/scan', label: 'Scan', short: 'Scan', icon: Camera },
  { to: '/ask', label: 'Ask', short: 'Ask', icon: MessagesSquare },
  { to: '/business', label: 'Business info', short: 'Info', icon: Building2 },
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
        <nav className="flex flex-col gap-1" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={link}>
              <Icon className="size-4" aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          {capabilities && (!capabilities.claude || !capabilities.local_ocr) && (
            <div className="mb-3 space-y-2 rounded-md border border-dashed px-3 py-2">
              {!capabilities.local_ocr && (
                <SetupNote details={READER_SETUP} className="text-xs">
                  Reading new documents is paused.
                </SetupNote>
              )}
              {!capabilities.claude && (
                <SetupNote details={CLAUDE_SETUP} className="text-xs">
                  Questions and summaries are not switched on yet. Search works.
                </SetupNote>
              )}
            </div>
          )}
          <button
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      {/* Phone: slim header, content, bottom tab bar */}
      <header className="flex shrink-0 items-center justify-between border-b bg-card px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
        <div className="min-w-0">
          <span className="font-semibold tracking-tight">Doc Doctor</span>
          <span className="ml-2 truncate text-xs text-muted-foreground">{user.org_name}</span>
        </div>
        <button
          onClick={() => void signOut()}
          aria-label="Sign out"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted"
        >
          <LogOut className="size-4" />
        </button>
      </header>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <nav
        className="flex shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Main"
      >
        {NAV.map(({ to, short, icon: Icon }) => (
          <NavLink key={to} to={to} className={tab}>
            <Icon className="size-5" aria-hidden />
            {short}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
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
  )
}
