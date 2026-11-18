import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useSession } from '@/lib/session'

export default function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { user, loading, refresh } = useSession()
  const navigate = useNavigate()
  const [org, setOrg] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const signUp = mode === 'sign-up'
  const linkExpired = useSearchParams()[0].get('link') === 'expired'

  if (!loading && user) return <Navigate to="/documents" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (signUp) await api.register(org, email, password)
      else await api.login(email, password)
      await refresh()
      navigate('/documents')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      {/* The pitch, set as a filed sheet with ledger rules. */}
      <section
        className="hidden flex-col justify-between border-r bg-card px-14 py-12 lg:flex"
        style={{
          backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 39px, var(--rule) 39px 40px)',
          backgroundPositionY: '8px',
        }}
      >
        <div className="text-base font-semibold tracking-tight">Doc Doctor</div>
        <div className="max-w-xl">
          <h1 className="font-serif text-[2.75rem] leading-[1.14] font-medium tracking-tight text-balance">
            Ask your filing cabinet a question.
          </h1>
          {/* A worked example instead of a feature list: question, answer, the page it came from. */}
          <div className="mt-10 max-w-md">
            <p className="font-serif text-lg leading-10 font-medium">When does the office lease end?</p>
            <p className="leading-10 text-muted-foreground">
              On 28 February 2030, with six months&apos; notice.{' '}
              <span className="marker text-sm font-medium text-foreground">p.2</span>
            </p>
            <p className="text-sm leading-10 text-muted-foreground">From Umowa najmu lokalu, scanned 14 Oct</p>
          </div>
        </div>
        <p className="text-sm leading-10 text-muted-foreground">
          Scans are read on your own server first. Nothing is sent to an AI model unless you turn that on.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 text-base font-semibold tracking-tight lg:hidden">Doc Doctor</div>
          <h2 className="text-2xl font-semibold tracking-tight">{signUp ? 'Create your archive' : 'Sign in'}</h2>
          <p className="mt-1 mb-8 text-sm text-muted-foreground">
            {signUp ? 'One workspace for your business documents.' : 'Open your document archive.'}
          </p>

          {linkExpired && (
            <p role="status" className="mb-6 border-l-2 border-stamp bg-card px-4 py-3 text-sm">
              That phone code has expired or was already used. On your computer, open Scan with phone again for a new
              code, or sign in here.
            </p>
          )}

          <div className="space-y-4">
            {signUp && (
              <div className="space-y-1.5">
                <Label htmlFor="org">Business name</Label>
                <Input id="org" value={org} onChange={(e) => setOrg(e.target.value)} autoComplete="organization" required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signUp ? 'new-password' : 'current-password'}
                minLength={signUp ? 8 : undefined}
                required
              />
              {signUp && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-stamp">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-6 w-full" disabled={busy}>
            {signUp ? 'Create archive' : 'Sign in'}
          </Button>
          <p className="mt-6 text-sm text-muted-foreground">
            {signUp ? 'Already have an archive? ' : 'New here? '}
            <Link
              to={signUp ? '/sign-in' : '/sign-up'}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {signUp ? 'Sign in' : 'Create an archive'}
            </Link>
          </p>
        </form>
      </section>
    </div>
  )
}
