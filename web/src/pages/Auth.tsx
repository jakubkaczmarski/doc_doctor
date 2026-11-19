import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { LangSwitch, t } from '@/lib/i18n'
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
      setError(err instanceof Error ? err.message : t('auth.failed'))
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
            {t('auth.heroTitle')}
          </h1>
          {/* A worked example instead of a feature list: question, answer, the page it came from. */}
          <div className="mt-10 max-w-md">
            <p className="font-serif text-lg leading-10 font-medium">{t('auth.heroQ')}</p>
            <p className="leading-10 text-muted-foreground">
              {t('auth.heroA')} <span className="marker px-[0.4em] text-xs font-semibold text-foreground">1</span>
            </p>
            <p className="text-sm leading-10 text-muted-foreground">{t('auth.heroFrom')}</p>
          </div>
        </div>
        <p className="text-sm leading-10 text-muted-foreground">
          {t('auth.heroFoot')}
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 flex items-baseline justify-between">
            <div className="text-base font-semibold tracking-tight lg:invisible">Doc Doctor</div>
            <LangSwitch />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{signUp ? t('auth.create') : t('auth.signIn')}</h2>
          <p className="mt-1 mb-8 text-sm text-muted-foreground">
            {signUp ? t('auth.createSub') : t('auth.signInSub')}
          </p>

          {linkExpired && (
            <p role="status" className="mb-6 border-l-2 border-stamp bg-card px-4 py-3 text-sm">
              {t('auth.linkExpired')}
            </p>
          )}

          <div className="space-y-4">
            {signUp && (
              <div className="space-y-1.5">
                <Label htmlFor="org">{t('auth.org')}</Label>
                <Input id="org" value={org} onChange={(e) => setOrg(e.target.value)} autoComplete="organization" required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
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
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signUp ? 'new-password' : 'current-password'}
                minLength={signUp ? 8 : undefined}
                required
              />
              {signUp && <p className="text-xs text-muted-foreground">{t('auth.passwordHint')}</p>}
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-stamp">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-6 w-full" disabled={busy}>
            {signUp ? t('auth.createBtn') : t('auth.signIn')}
          </Button>
          <p className="mt-6 text-sm text-muted-foreground">
            {signUp ? t('auth.haveArchive') : t('auth.newHere')}{' '}
            <Link
              to={signUp ? '/sign-in' : '/sign-up'}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {signUp ? t('auth.signIn') : t('auth.createLink')}
            </Link>
          </p>
        </form>
      </section>
    </div>
  )
}
