import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { FileStack, LogOut, MessagesSquare } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { SessionProvider, useSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import AuthPage from '@/pages/Auth'
import DocumentsPage from '@/pages/Documents'
import DocumentPage from '@/pages/Document'
import AskPage from '@/pages/Ask'

function Shell() {
  const { user, capabilities, loading, signOut } = useSession()
  if (loading) return null
  if (!user) return <Navigate to="/sign-in" replace />

  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-accent text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 items-center gap-1 border-b bg-card px-3 py-2 md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-5">
        <div className="mr-3 md:mr-0 md:mb-6 md:px-3">
          <div className="text-base font-semibold tracking-tight">Doc Doctor</div>
          <div className="hidden truncate text-xs text-muted-foreground md:block" title={user.org_name}>
            {user.org_name}
          </div>
        </div>
        <nav className="flex gap-1 md:flex-col" aria-label="Main">
          <NavLink to="/documents" className={link}>
            <FileStack className="size-4" aria-hidden /> Documents
          </NavLink>
          <NavLink to="/ask" className={link}>
            <MessagesSquare className="size-4" aria-hidden /> Ask
          </NavLink>
        </nav>
        <div className="ml-auto md:mt-auto md:ml-0">
          {capabilities && (!capabilities.claude || !capabilities.local_ocr) && (
            <div className="mb-3 hidden rounded-md border border-dashed px-3 py-2 text-xs leading-relaxed text-muted-foreground md:block">
              {!capabilities.local_ocr && <p>Local OCR worker is not running, so new uploads will wait or fail.</p>}
              {!capabilities.claude && (
                <p>No Claude API key is set. Search works; questions, summaries and Claude vision are off.</p>
              )}
            </div>
          )}
          <button
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
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
          </Route>
          <Route path="*" element={<Navigate to="/documents" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </SessionProvider>
  )
}
