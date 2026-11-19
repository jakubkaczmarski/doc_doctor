import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Camera, Images, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SayWhatItIs } from '@/components/WhatIsThis'
import { api, type Said } from '@/lib/api'
import { t, tn } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type Shot = { id: number; file: File; url: string }

const MAX_SIDE = 2600 // enough for OCR; keeps a phone photo around 1 MB
const MAX_PAGES = 40

/**
 * Shrinks a camera photo before upload so it is quick to send over mobile data.
 * Falls back to the original file if the browser cannot decode it (e.g. HEIC on desktop).
 */
async function shrink(file: File, index: number): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return file
    return new File([blob], `page-${String(index).padStart(2, '0')}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export default function ScanPage() {
  const navigate = useNavigate()
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)
  const [shots, setShots] = useState<Shot[]>([])
  const [separate, setSeparate] = useState(false)
  const [name, setName] = useState('')
  const [said, setSaid] = useState<Said>({})
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  // Release preview URLs when leaving the screen.
  const shotsRef = useRef(shots)
  shotsRef.current = shots
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), [])

  async function add(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif|tiff?)$/i.test(f.name))
    if (images.length < files.length) toast.error(t('scan.onlyPhotos'))
    if (images.length === 0) return
    const room = MAX_PAGES - shots.length
    if (images.length > room) toast.error(t('scan.max', { n: MAX_PAGES }))
    setAdding(true)
    const added: Shot[] = []
    for (const f of images.slice(0, room)) {
      const id = nextId.current++
      const file = await shrink(f, id)
      added.push({ id, file, url: URL.createObjectURL(file) })
    }
    setShots((s) => [...s, ...added])
    setAdding(false)
  }

  function remove(id: number) {
    setShots((all) => {
      all.filter((s) => s.id === id).forEach((s) => URL.revokeObjectURL(s.url))
      return all.filter((s) => s.id !== id)
    })
  }

  async function save() {
    if (shots.length === 0 || saving) return
    setSaving(true)
    try {
      const files = shots.map((s) => s.file)
      const asOne = !separate || files.length === 1
      const { results } =
        asOne && files.length > 1 ? await api.uploadScan(files, name.trim(), said) : await api.upload(files, said)
      const failed = results.filter((r) => r.error)
      failed.forEach((r) => toast.error(`${r.filename}: ${r.error}`))
      if (failed.length === results.length) return
      const saved = results.filter((r) => r.document)
      if (saved.every((r) => r.duplicate)) toast.info(t('scan.already'))
      else toast.success(tn('scan.saved', saved.length))
      shots.forEach((s) => URL.revokeObjectURL(s.url))
      setShots([])
      setName('')
      setSaid({})
      navigate(saved.length === 1 ? `/documents/${saved[0].document!.id}` : '/documents')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('scan.saveErr'))
    } finally {
      setSaving(false)
    }
  }

  const n = shots.length
  const inputs = (
    <>
      {/* capture="environment" opens the rear camera directly on phones */}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={t('scan.takeAria')}
        onChange={(e) => {
          void add(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <input
        ref={library}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="sr-only"
        aria-label={t('scan.chooseAria')}
        onChange={(e) => {
          void add(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </>
  )

  if (n === 0) {
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col px-5 py-6 md:px-10 md:py-8">
        {inputs}
        <h1 className="text-2xl font-semibold tracking-tight">{t('scan.title')}</h1>
        <p className="mt-2 text-muted-foreground">
          {t('scan.intro')}
        </p>

        <div className="mt-6 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-12 text-center md:flex-none">
          <Button size="lg" className="h-14 w-full max-w-xs text-base" onClick={() => camera.current?.click()} disabled={adding}>
            {adding ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Camera className="size-5" aria-hidden />}
            {t('scan.takeFirst')}
          </Button>
          <Button variant="ghost" className="mt-3" onClick={() => library.current?.click()} disabled={adding}>
            <Images aria-hidden /> {t('scan.choose')}
          </Button>
        </div>

        <ul className="mt-6 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {['scan.tip1', 'scan.tip2', 'scan.tip3'].map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col px-5 pt-6 md:px-10 md:pt-8">
      {inputs}
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{tn('pages', n)}</h1>
        <button
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            shots.forEach((s) => URL.revokeObjectURL(s.url))
            setShots([])
          }}
        >
          {t('scan.startOver')}
        </button>
      </div>

      <ol className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
        {shots.map((s, i) => (
          <li key={s.id} className="relative">
            <img src={s.url} alt={t('scan.pageAlt', { n: i + 1 })} className="aspect-[3/4] w-full border bg-white object-cover" />
            <span className="absolute bottom-1 left-1 rounded bg-ink/80 px-1.5 text-xs font-medium text-white tabular-nums">
              {i + 1}
            </span>
            <button
              onClick={() => remove(s.id)}
              aria-label={t('scan.remove', { n: i + 1 })}
              className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm hover:text-stamp"
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
        {n < MAX_PAGES && (
          <li>
            <button
              onClick={() => camera.current?.click()}
              disabled={adding}
              className="grid aspect-[3/4] w-full place-items-center rounded-md border border-dashed bg-card text-sm font-medium text-primary"
            >
              <span className="flex flex-col items-center gap-1">
                {adding ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Plus className="size-5" aria-hidden />}
                {t('scan.pageN', { n: n + 1 })}
              </span>
            </button>
          </li>
        )}
      </ol>
      <button
        className="mt-3 self-start text-sm text-primary underline-offset-4 hover:underline"
        onClick={() => library.current?.click()}
      >
        {t('scan.addFromPhotos')}
      </button>

      {n > 1 && (
        <fieldset className="mt-6">
          <legend className="text-sm font-medium">{t('scan.theseAre')}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              { value: false, title: t('scan.one'), hint: tn('pages', n) },
              { value: true, title: t('scan.separate'), hint: tn('documents', n) },
            ].map((o) => (
              <label
                key={String(o.value)}
                className={cn(
                  'cursor-pointer rounded-md border bg-card px-3 py-2 text-sm',
                  separate === o.value ? 'border-primary ring-1 ring-primary' : 'text-muted-foreground',
                )}
              >
                <input
                  type="radio"
                  name="mode"
                  className="sr-only"
                  checked={separate === o.value}
                  onChange={() => setSeparate(o.value)}
                />
                <span className="block font-medium text-foreground">{o.title}</span>
                {o.hint}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {n > 1 && !separate && (
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="scan-name">{t('scan.name')}</Label>
          <Input
            id="scan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('scan.namePh')}
            maxLength={120}
            className="bg-card"
          />
        </div>
      )}

      <details className="mt-6 border-t pt-4">
        <summary className="cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:underline">
          {t('scan.sayTitle')}
        </summary>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">{t('scan.sayHint')}</p>
        <SayWhatItIs
          autoOption
          idPrefix="scan"
          type={said.type ?? ''}
          category={said.category ?? ''}
          note={said.note ?? ''}
          onChange={(n) => setSaid((s) => ({ ...s, ...n }))}
        />
      </details>

      <div className="sticky bottom-0 mt-auto bg-background pt-6 pb-4">
        <Button size="lg" className="h-12 w-full text-base" onClick={() => void save()} disabled={saving || adding}>
          {saving && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {saving ? t('scan.saving') : t('scan.save')}
        </Button>
      </div>
    </div>
  )
}
