import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2, Search, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Marked } from '@/components/Marked'
import { StatusMark } from '@/components/StatusMark'
import { api, docTypes, formatAmount, formatDate, typeLabel, type Doc, type Hit } from '@/lib/api'
import { cn } from '@/lib/utils'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.tif,.tiff,.bmp,.heic,.heif'

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [hits, setHits] = useState<Hit[]>([])
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const load = useCallback(async () => {
    try {
      const q = query.trim()
      const [list, found] = await Promise.all([
        api.documents(q, type),
        q.length >= 2 ? api.search(q) : Promise.resolve({ hits: [] as Hit[] }),
      ])
      setDocs(list.documents)
      setHits(found.hits)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load documents.')
    }
  }, [query, type])

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
      if (added) toast.success(`${added} ${added === 1 ? 'file' : 'files'} uploaded. Reading now.`)
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

  const filtering = query.trim() !== '' || type !== ''
  const empty = docs !== null && docs.length === 0 && hits.length === 0

  return (
    <div
      className="relative min-h-dvh px-5 py-6 md:px-10 md:py-8"
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
            placeholder="Search titles and scanned text"
            aria-label="Search documents"
            className="bg-card pl-8"
          />
        </div>
        <Button onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          {uploading > 0 ? `Uploading ${uploading}` : 'Upload scans'}
        </Button>
      </header>

      <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
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
      </div>

      {hits.length > 0 && (
        <section className="mt-8" aria-label="Matches in scanned text">
          <h2 className="text-sm font-semibold">Found in scanned text</h2>
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
              <p className="mt-1 text-sm text-muted-foreground">Try a shorter word, or clear the type filter.</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium">Your archive is empty</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Drop scans or phone photos anywhere on this page. PDF, JPG, PNG, HEIC and TIFF up to 50 MB each.
              </p>
              <Button className="mt-5" onClick={() => fileInput.current?.click()}>
                <Upload aria-hidden /> Upload scans
              </Button>
            </>
          )}
        </div>
      ) : (
        docs &&
        docs.length > 0 && (
          <section className="mt-8" aria-label="Document list">
            {hits.length > 0 && <h2 className="mb-2 text-sm font-semibold">Matching documents</h2>}
            <div className="overflow-x-auto border-y bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-ink text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Type</th>
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
                          {d.counterparty || (d.title !== d.filename ? d.filename : d.page_count === 1 ? '1 page' : d.page_count ? `${d.page_count} pages` : '')}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{typeLabel(d.doc_type)}</td>
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
