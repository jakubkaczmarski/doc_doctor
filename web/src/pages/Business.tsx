import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { locale, t } from '@/lib/i18n'

export default function BusinessPage() {
  const [name, setName] = useState('')
  const [profile, setProfile] = useState('')
  const [saved, setSaved] = useState('')
  const [max, setMax] = useState(8000)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .org()
      .then((o) => {
        setName(o.name)
        setProfile(o.profile)
        setSaved(o.profile)
        setMax(o.max_chars)
        setLoaded(true)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : t('biz.loadErr')))
  }, [])

  async function save() {
    setBusy(true)
    try {
      const res = await api.saveOrg(profile)
      setProfile(res.profile)
      setSaved(res.profile)
      toast.success(t('biz.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('biz.saveErr'))
    } finally {
      setBusy(false)
    }
  }

  const over = profile.length > max

  return (
    <div className="max-w-3xl px-5 py-6 md:px-10 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('biz.title')}</h1>
      <p className="mt-2 max-w-[68ch] text-muted-foreground">
        {name ? t('biz.intro', { name }) : t('biz.introGeneric')}
      </p>

      <div className="mt-8 space-y-1.5">
        <Label htmlFor="profile">{t('biz.label')}</Label>
        <Textarea
          id="profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          disabled={!loaded}
          rows={12}
          placeholder={t('biz.example')}
          className="min-h-64 bg-card leading-relaxed placeholder:text-muted-foreground/70"
          aria-describedby="profile-help"
        />
        <div id="profile-help" className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span>{t('biz.help')}</span>
          <span className={over ? 'font-medium text-stamp' : 'tabular-nums'}>
            {profile.length.toLocaleString(locale())} / {max.toLocaleString(locale())}
          </span>
        </div>
      </div>

      <Button className="mt-5" onClick={() => void save()} disabled={!loaded || busy || over || profile === saved}>
        {t('biz.save')}
      </Button>

      <section className="mt-12 border-t pt-6">
        <h2 className="font-semibold">{t('biz.howTitle')}</h2>
        <ul className="mt-3 max-w-[68ch] list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          {['biz.how1', 'biz.how2', 'biz.how3', 'biz.how4'].map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
