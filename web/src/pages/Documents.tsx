import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Loader2, Search, Smartphone, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Marked } from '@/components/Marked'
import { StatusMark } from '@/components/StatusMark'
import {
  api,
  categoryKeys,
  categoryLabel,
  docTypes,
  formatAmount,
  formatDate,
  needsSorting,
  typeLabel,
  type Doc,
  type Hit,
} from '@/lib/api'
import { t, tn } from '@/lib/i18n'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.tif,.tiff,.bmp,.heic,.heif'

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [hits, setHits] = useState<Hit[]>([])
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [category, setCategory] = useState('')
  const [onlyUnsure, setOnlyUnsure] = useState(false)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [phoneLink, setPhoneLink] = useState<{ url: string; minutes: number } | null>(null)
  const { capabilities } = useSession()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const load = useCallback(async () => {
    try {
      const q = query.trim()
      const [list, found] = await Promise.all([
        api.documents(q, type, category),
        q.length >= 2 ? api.search(q) : Promise.resolve({ hits: [] as Hit[] }),
      ])
      setDocs(list.documents)
      setHits(found.hits)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docs.loadErr'))
    }
  }, [query, type, category])

  // Debounced reload on filter change.
  useEffect(() => {
    const t = setTimeout(() => void load(), 200)
    return () => clearTimeout(t)
  }, [load])

  // Poll while anything is still being read.
  const pending = docs?.some((d) => d.status === 'queued' || d.status === 'processing') ?? false
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => void load(), 2000)
    return () => clearInterval(t)
  }, [pending, load])

  async function upload(files: File[]) {
    if (files.length === 0) return
    setUploading(files.length)
    try {
      const { results } = await api.upload(files)
      const added = results.filter((r) => r.document && !r.duplicate).length
      const dupes = results.filter((r) => r.duplicate).length
      if (added) toast.success(tn('docs.added', added))
      if (dupes) toast.info(tn('docs.dupes', dupes))
      results.filter((r) => r.error).forEach((r) => toast.error(`${r.filename}: ${r.error}`))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docs.uploadErr'))
    } finally {
      setUploading(0)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    void upload(Array.from(e.dataTransfer.files))
  }

  const filtering = query.trim() !== '' || type !== '' || category !== ''
  const phoneAddress = capabilities?.lan_urls?.[0] ?? ''

  // A fresh one-time code each time the panel opens: it signs the phone in without a password.
  async function openPhonePanel() {
    setPhoneLink(null)
    setPhoneOpen(true)
    try {
      const link = await api.phoneLink()
      if (link.urls[0]) setPhoneLink({ url: link.urls[0], minutes: link.minutes })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('phone.err'))
    }
  }
  const empty = docs !== null && docs.length === 0 && hits.length === 0
  // Documents the system was unsure about, so the user can go through them in one pass.
  const unsure = docs?.filter(needsSorting).length ?? 0
  const shown = docs && onlyUnsure && unsure > 0 ? docs.filter(needsSorting) : docs

  return (
    <div
      className="relative min-h-full px-5 py-6 md:px-10 md:py-8"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        aria-label={t('docs.uploadAria')}
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">{t('docs.title')}</h1>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('docs.search')}
            aria-label={t('docs.searchAria')}
            className="bg-card pl-8"
          />
        </div>
        <Button variant="outline" className="hidden md:inline-flex" onClick={() => void openPhonePanel()}>
          <Smartphone aria-hidden /> {t('docs.scanPhone')}
        </Button>
        <Button onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          {uploading > 0 ? t('docs.uploading', { n: uploading }) : t('docs.upload')}
        </Button>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('docs.filterAria')}>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label={t('docs.typeAria')}
          className={cn(
            'h-[1.875rem] rounded-full border bg-card px-3 text-sm',
            type ? 'border-ink text-foreground' : 'text-muted-foreground',
          )}
        >
          <option value="">{t('docs.anyType')}</option>
          {docTypes.map((value) => (
            <option key={value} value={value}>
              {typeLabel(value)}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label={t('docs.areaAria')}
          className={cn(
            'h-[1.875rem] rounded-full border bg-card px-3 text-sm',
            category ? 'border-ink text-foreground' : 'text-muted-foreground',
          )}
        >
          <option value="">{t('docs.anyArea')}</option>
          {categoryKeys.map((value) => (
            <option key={value} value={value}>
              {categoryLabel(value)}
            </option>
          ))}
        </select>
        {unsure > 0 && (
          <button
            onClick={() => setOnlyUnsure((v) => !v)}
            aria-pressed={onlyUnsure}
            title={t('docs.toSortAria')}
            className={cn(
              'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
              onlyUnsure ? 'border-primary bg-primary text-primary-foreground' : 'border-primary bg-card text-primary',
            )}
          >
            {tn('docs.toSort', unsure)}
          </button>
        )}
      </div>

      {hits.length > 0 && (
        <section className="mt-8" aria-label={t('docs.foundAria')}>
          <h2 className="text-sm font-semibold">{t('docs.foundInside')}</h2>
          <ul className="mt-2 divide-y border-y bg-card">
            {hits.map((h) => (
              <li key={`${h.doc_id}-${h.page}`}>
                <Link to={`/documents/${h.doc_id}#p${h.page}`} className="block px-4 py-3 hover:bg-accent/50">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="truncate font-medium">{h.title}</span>
                    <span className="shrink-0 text-muted-foreground">{t('docs.page', { n: h.page })}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 font-serif text-sm leading-relaxed text-muted-foreground">
                    <Marked text={h.snippet} />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {empty ? (
        <div className="mt-10 rounded-lg border border-dashed bg-card px-6 py-16 text-center">
          {filtering ? (
            <>
              <p className="font-medium">{t('docs.nothing')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('docs.nothingHint')}</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium">{t('docs.firstTitle')}</p>
              <ol className="mx-auto mt-4 mb-2 grid max-w-2xl gap-4 text-left text-sm sm:grid-cols-3">
                {['docs.step1', 'docs.step2', 'docs.step3'].map((k) => (
                  <li key={k}>
                    <span className="font-medium">{t(k)}</span>{' '}
                    <span className="text-muted-foreground">{t(k + 'd')}</span>
                  </li>
                ))}
              </ol>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                <span className="hidden md:inline">{t('docs.dragHint')}</span>
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link
                  to="/scan"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground md:hidden"
                >
                  {t('docs.scanDoc')}
                </Link>
                <Button variant="outline" className="md:hidden" onClick={() => fileInput.current?.click()}>
                  <Upload aria-hidden /> {t('docs.upload')}
                </Button>
                <Button className="hidden md:inline-flex" onClick={() => fileInput.current?.click()}>
                  <Upload aria-hidden /> {t('docs.upload')}
                </Button>
                <Button variant="outline" className="hidden md:inline-flex" onClick={() => void openPhonePanel()}>
                  <Smartphone aria-hidden /> {t('docs.scanPhone')}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        docs &&
        docs.length > 0 && (
          <section className="mt-8" aria-label={t('docs.listAria')}>
            {hits.length > 0 && <h2 className="mb-2 text-sm font-semibold">{t('docs.matching')}</h2>}
            {/* Phone: stacked rows */}
            <ul className="divide-y border-y bg-card md:hidden">
              {(shown ?? []).map((d) => (
                <li key={d.id}>
                  <Link to={`/documents/${d.id}`} className="flex items-start gap-3 px-4 py-3 active:bg-accent/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.title || d.filename}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {d.subject || d.counterparty || (d.title !== d.filename ? d.filename : '')}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        {needsSorting(d) ? (
                          <span className="marker font-medium text-foreground">{t('docs.whatIsThis')}</span>
                        ) : (
                          <span>{typeLabel(d.doc_type)}</span>
                        )}
                        {categoryLabel(d.category) && <span>{categoryLabel(d.category)}</span>}
                        {d.doc_date && <span className="tabular-nums">{formatDate(d.doc_date)}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      {d.total_amount != null && (
                        <div className="font-medium tabular-nums">{formatAmount(d.total_amount, d.currency)}</div>
                      )}
                      <StatusMark doc={d} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop: ledger table */}
            <div className="hidden overflow-x-auto border-y bg-card md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-ink text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-2 font-medium">{t('docs.colDocument')}</th>
                    <th className="px-3 py-2 font-medium">{t('docs.colType')}</th>
                    <th className="px-3 py-2 font-medium">{t('docs.colRelates')}</th>
                    <th className="px-3 py-2 font-medium">{t('docs.colDated')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('docs.colAmount')}</th>
                    <th className="px-4 py-2 font-medium">{t('docs.colStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(shown ?? []).map((d) => (
                    <tr key={d.id} className="group relative hover:bg-accent/50">
                      <td className="max-w-0 w-full px-4 py-3">
                        <Link to={`/documents/${d.id}`} className="block truncate font-medium after:absolute after:inset-0">
                          {d.title || d.filename}
                        </Link>
                        <div className="truncate text-muted-foreground">
                          {d.subject || d.counterparty || (d.title !== d.filename ? d.filename : d.page_count ? tn('pages', d.page_count) : '')}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                        {needsSorting(d) ? (
                          <span className="marker font-medium text-foreground">{t('docs.whatIsThis')}</span>
                        ) : (
                          typeLabel(d.doc_type)
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{categoryLabel(d.category)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatDate(d.doc_date)}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                        {formatAmount(d.total_amount, d.currency)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusMark doc={d} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      )}

      <Sheet open={phoneOpen} onOpenChange={setPhoneOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-md data-[side=right]:sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{t('phone.title')}</SheetTitle>
            <SheetDescription>{t('phone.desc')}</SheetDescription>
          </SheetHeader>
          <div className="p-5 leading-relaxed">
            {!phoneAddress ? (
              <p>{t('phone.noNetwork')}</p>
            ) : !phoneLink ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('phone.creating')} />
            ) : (
              <>
                <div className="mx-auto w-fit border bg-white p-4">
                  <QRCodeSVG value={phoneLink.url} size={224} fgColor="#16233b" />
                </div>
                <ol className="mt-6 list-decimal space-y-2 pl-5">
                  {['phone.s1', 'phone.s2', 'phone.s3', 'phone.s4'].map((k) => (
                    <li key={k}>{t(k)}</li>
                  ))}
                </ol>
                <p className="mt-6 text-sm text-muted-foreground">
                  {t('phone.valid', { n: phoneLink.minutes })}
                </p>
                <details className="mt-3 text-sm text-muted-foreground">
                  <summary className="cursor-pointer underline-offset-4 hover:underline">{t('phone.trouble')}</summary>
                  <p className="mt-1">
                    {t('phone.troubleA')}{' '}
                    <span className="font-medium break-all text-foreground">{phoneAddress}</span>, {t('phone.troubleB')}
                  </p>
                </details>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-primary/10 backdrop-blur-[2px]">
          <div className="rounded-lg border-2 border-dashed border-primary bg-card px-10 py-8 text-center shadow-lg">
            <Upload className="mx-auto size-6 text-primary" aria-hidden />
            <p className="mt-2 font-medium">{t('docs.drop')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
