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
import { api, categories, categoryLabel, docTypes, formatAmount, formatDate, typeLabel, type Doc, type Hit } from '@/lib/api'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.tif,.tiff,.bmp,.heic,.heif'

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [hits, setHits] = useState<Hit[]>([])
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [category, setCategory] = useState('')
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
      toast.error(err instanceof Error ? err.message : 'Could not load documents.')
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
      if (added) toast.success(`${added} ${added === 1 ? 'file' : 'files'} added. Reading ${added === 1 ? 'it' : 'them'} now.`)
      if (dupes) toast.info(`${dupes} ${dupes === 1 ? 'file was' : 'files were'} already in the archive.`)
      results.filter((r) => r.error).forEach((r) => toast.error(`${r.filename}: ${r.error}`))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
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
      toast.error(err instanceof Error ? err.message : 'Could not create a phone code.')
    }
  }
  const empty = docs !== null && docs.length === 0 && hits.length === 0

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
        aria-label="Upload documents"
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">Documents</h1>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your documents"
            aria-label="Search documents"
            className="bg-card pl-8"
          />
        </div>
        <Button variant="outline" className="hidden md:inline-flex" onClick={() => void openPhonePanel()}>
          <Smartphone aria-hidden /> Scan with phone
        </Button>
        <Button onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          {uploading > 0 ? `Uploading ${uploading}` : 'Upload files'}
        </Button>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter documents">
        {['', ...docTypes].map((t) => (
          <button
            key={t || 'all'}
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              type === t
                ? 'border-ink bg-ink text-white'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {t ? typeLabel(t) + 's' : 'All'}
          </button>
        ))}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by business area"
          className={cn(
            'h-[1.875rem] rounded-full border bg-card px-3 text-sm',
            category ? 'border-ink text-foreground' : 'text-muted-foreground',
          )}
        >
          <option value="">Any area</option>
          {Object.entries(categories).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {hits.length > 0 && (
        <section className="mt-8" aria-label="Matches in scanned text">
          <h2 className="text-sm font-semibold">Found inside documents</h2>
          <ul className="mt-2 divide-y border-y bg-card">
            {hits.map((h) => (
              <li key={`${h.doc_id}-${h.page}`}>
                <Link to={`/documents/${h.doc_id}#p${h.page}`} className="block px-4 py-3 hover:bg-accent/50">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="truncate font-medium">{h.title}</span>
                    <span className="shrink-0 text-muted-foreground">page {h.page}</span>
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
              <p className="font-medium">Nothing matches that search.</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a shorter word, or clear the filters.</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium">Add your first document</p>
              <ol className="mx-auto mt-4 mb-2 grid max-w-2xl gap-4 text-left text-sm sm:grid-cols-3">
                <li>
                  <span className="font-medium">1. Scan or upload.</span>{' '}
                  <span className="text-muted-foreground">Photograph a paper with your phone, or add files from this device.</span>
                </li>
                <li>
                  <span className="font-medium">2. We read and file it.</span>{' '}
                  <span className="text-muted-foreground">Each document is sorted by type and what it relates to.</span>
                </li>
                <li>
                  <span className="font-medium">3. Ask a question.</span>{' '}
                  <span className="text-muted-foreground">Answers show the page they came from.</span>
                </li>
              </ol>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                <span className="hidden md:inline">
                  You can also drag files onto this page. PDFs and photos work, up to 50 MB each.
                </span>
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link
                  to="/scan"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground md:hidden"
                >
                  Scan a document
                </Link>
                <Button variant="outline" className="md:hidden" onClick={() => fileInput.current?.click()}>
                  <Upload aria-hidden /> Upload files
                </Button>
                <Button className="hidden md:inline-flex" onClick={() => fileInput.current?.click()}>
                  <Upload aria-hidden /> Upload files
                </Button>
                <Button variant="outline" className="hidden md:inline-flex" onClick={() => void openPhonePanel()}>
                  <Smartphone aria-hidden /> Scan with phone
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        docs &&
        docs.length > 0 && (
          <section className="mt-8" aria-label="Document list">
            {hits.length > 0 && <h2 className="mb-2 text-sm font-semibold">Matching documents</h2>}
            {/* Phone: stacked rows */}
            <ul className="divide-y border-y bg-card md:hidden">
              {docs.map((d) => (
                <li key={d.id}>
                  <Link to={`/documents/${d.id}`} className="flex items-start gap-3 px-4 py-3 active:bg-accent/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.title || d.filename}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {d.subject || d.counterparty || (d.title !== d.filename ? d.filename : '')}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>{typeLabel(d.doc_type)}</span>
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
                    <th className="px-4 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Relates to</th>
                    <th className="px-3 py-2 font-medium">Dated</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {docs.map((d) => (
                    <tr key={d.id} className="group relative hover:bg-accent/50">
                      <td className="max-w-0 w-full px-4 py-3">
                        <Link to={`/documents/${d.id}`} className="block truncate font-medium after:absolute after:inset-0">
                          {d.title || d.filename}
                        </Link>
                        <div className="truncate text-muted-foreground">
                          {d.subject || d.counterparty || (d.title !== d.filename ? d.filename : d.page_count === 1 ? '1 page' : d.page_count ? `${d.page_count} pages` : '')}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{typeLabel(d.doc_type)}</td>
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
            <SheetTitle>Scan with your phone</SheetTitle>
            <SheetDescription>Take photos of your papers and they appear in this list.</SheetDescription>
          </SheetHeader>
          <div className="p-5 leading-relaxed">
            {!phoneAddress ? (
              <p>
                This computer is not on a network right now. Connect it to Wi-Fi, reload this page, and try again.
              </p>
            ) : !phoneLink ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Creating a code" />
            ) : (
              <>
                <div className="mx-auto w-fit border bg-white p-4">
                  <QRCodeSVG value={phoneLink.url} size={224} fgColor="#16233b" />
                </div>
                <ol className="mt-6 list-decimal space-y-2 pl-5">
                  <li>Make sure your phone is on the same Wi-Fi as this computer.</li>
                  <li>Open the phone&apos;s camera and point it at this code.</li>
                  <li>Tap the link that appears. Doc Doctor opens, already signed in.</li>
                  <li>Tap Take photo and photograph each page.</li>
                </ol>
                <p className="mt-6 text-sm text-muted-foreground">
                  The code works once, for {phoneLink.minutes} minutes. Close and reopen this panel for a new one. It
                  only works on your own Wi-Fi.
                </p>
                <details className="mt-3 text-sm text-muted-foreground">
                  <summary className="cursor-pointer underline-offset-4 hover:underline">The code does not open anything</summary>
                  <p className="mt-1">
                    On the phone, open the web browser and go to{' '}
                    <span className="font-medium break-all text-foreground">{phoneAddress}</span>, then sign in with your
                    email and password. If the page does not load, the computer&apos;s firewall may be blocking it.
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
            <p className="mt-2 font-medium">Drop to add to the archive</p>
          </div>
        </div>
      )}
    </div>
  )
}
