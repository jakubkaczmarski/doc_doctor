import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'

const EXAMPLE = `For example:

We are an accounting office in Gdynia with 6 staff.
Our legal name is Biuro Rachunkowe Łoś i Wspólnicy sp.j., NIP 586-102-33-47.
Our fiscal year is the calendar year. We report amounts in PLN.
"Żuraw" means our stationery supplier, Hurtownia Papiernicza Żuraw Sp. z o.o.`

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
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load business info.'))
  }, [])

  async function save() {
    setBusy(true)
    try {
      const res = await api.saveOrg(profile)
      setProfile(res.profile)
      setSaved(res.profile)
      toast.success('Business info saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save business info.')
    } finally {
      setBusy(false)
    }
  }

  const over = profile.length > max

  return (
    <div className="max-w-3xl px-5 py-6 md:px-10 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Business info</h1>
      <p className="mt-2 max-w-[68ch] text-muted-foreground">
        Facts about {name || 'your business'} that the assistant should know when it answers. It reads this text and
        your uploaded documents, and nothing else.
      </p>

      <div className="mt-8 space-y-1.5">
        <Label htmlFor="profile">What the assistant should know</Label>
        <Textarea
          id="profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          disabled={!loaded}
          rows={12}
          placeholder={EXAMPLE}
          className="min-h-64 bg-card leading-relaxed placeholder:text-muted-foreground/70"
          aria-describedby="profile-help"
        />
        <div id="profile-help" className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span>
            Useful: legal name and tax ID, what you do, fiscal year, currency, nicknames for suppliers or clients.
          </span>
          <span className={over ? 'font-medium text-stamp' : 'tabular-nums'}>
            {profile.length.toLocaleString()} / {max.toLocaleString()}
          </span>
        </div>
      </div>

      <Button className="mt-5" onClick={() => void save()} disabled={!loaded || busy || over || profile === saved}>
        Save business info
      </Button>

      <section className="mt-12 border-t pt-6">
        <h2 className="font-semibold">How answers are kept to your documents</h2>
        <ul className="mt-3 max-w-[68ch] list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>The assistant can only look in this archive. It cannot browse the internet or see another business.</li>
          <li>It is instructed to answer from your documents and this page only, and to say so when they do not hold the answer.</li>
          <li>Each fact has a yellow page marker. Tap it to see the page it came from. A marker that does not match a page it really read is flagged.</li>
          <li>Numbers that are not written in the pages it read are listed under the answer, so worked-out or wrong numbers stand out.</li>
        </ul>
      </section>
    </div>
  )
}
