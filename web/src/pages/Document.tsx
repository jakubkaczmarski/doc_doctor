import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Download, ScanText, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusMark } from '@/components/StatusMark'
import { api, engineLabel, formatAmount, formatDate, typeLabel, type Doc, type Page } from '@/lib/api'
import { useSession } from '@/lib/session'

export default function DocumentPage() {
  const id = Number(useParams().id)
  const { hash } = useLocation()
  const navigate = useNavigate()
  const { capabilities } = useSession()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [missing, setMissing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.document(id)
      setDoc(res.document)
      setPages(res.pages)
    } catch {
      setMissing(true)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const pending = doc?.status === 'queued' || doc?.status === 'processing'
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => void load(), 2000)
    return () => clearInterval(t)
  }, [pending, load])

  // Jump to the cited page once the text is on screen.
  useEffect(() => {
    if (hash && pages.length) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash, pages.length])

  async function reread(ocr: 'local' | 'claude') {
    try {
      await api.reprocess(id, ocr)
      toast.success(ocr === 'claude' ? 'Reading again with Claude vision.' : 'Reading again with local OCR.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start a new read.')
    }
  }

  async function remove() {
    try {
      await api.deleteDocument(id)
      toast.success('Document deleted.')
      navigate('/documents')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the document.')
    }
  }

  if (missing) {
    return (
      <div className="px-10 py-16">
        <p className="font-medium">This document does not exist or was deleted.</p>
        <Link to="/documents" className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline">
          Back to documents
        </Link>
      </div>
    )
  }
  if (!doc) return null

  const fileUrl = `/api/documents/${doc.id}/file`
  const facts: [string, string][] = [
    ['Type', typeLabel(doc.doc_type)],
    ['Dated', formatDate(doc.doc_date)],
    ['Counterparty', doc.counterparty],
    ['Amount', formatAmount(doc.total_amount, doc.currency)],
    ...doc.fields.map((f) => [f.name, f.value] as [string, string]),
  ].filter(([, v]) => v) as [string, string][]

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-5 py-3 md:px-8">
        <Link to="/documents" aria-label="Back to documents" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{doc.title || doc.filename}</h1>
          <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <StatusMark doc={doc} />
            <span>{doc.filename}</span>
            {doc.page_count > 0 && <span>{doc.page_count === 1 ? '1 page' : `${doc.page_count} pages`}</span>}
          </div>
        </div>
        {!pending && (
          <>
            {doc.ocr_engine !== 'claude-vision' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reread('claude')}
                disabled={!capabilities?.claude}
                title={capabilities?.claude ? undefined : 'Needs a Claude API key on the server'}
              >
                <Sparkles aria-hidden /> Re-read with Claude vision
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => void reread('local')}>
                <ScanText aria-hidden /> Re-read with local OCR
              </Button>
            )}
            <a
              href={fileUrl}
              download={doc.filename}
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[0.8rem] font-medium hover:bg-muted"
            >
              <Download className="size-3.5" aria-hidden /> Original
            </a>
            {confirmDelete ? (
              <span className="flex items-center gap-1.5 text-sm">
                Delete for good?
                <Button variant="destructive" size="sm" onClick={() => void remove()}>
                  Delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Delete document">
                <Trash2 aria-hidden />
              </Button>
            )}
          </>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8">
        {doc.status === 'failed' && (
          <div role="alert" className="mb-6 max-w-3xl border-l-2 border-stamp bg-card px-4 py-3 text-sm">
            <p className="font-medium text-stamp">This file could not be read</p>
            <p className="mt-1 text-muted-foreground">{doc.error}</p>
          </div>
        )}
        {doc.notice && (
          <p className="mb-6 max-w-3xl border-l-2 border-input bg-card px-4 py-3 text-sm text-muted-foreground">{doc.notice}</p>
        )}

        {(doc.summary || facts.length > 0) && (
          <section className="mb-8 max-w-3xl">
            {doc.summary && <p className="max-w-[68ch] leading-relaxed">{doc.summary}</p>}
            {facts.length > 0 && (
              <dl className="mt-5 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 border-t text-sm">
                {facts.map(([name, value], i) => (
                  <div key={i} className="col-span-2 grid grid-cols-subgrid border-b py-2">
                    <dt className="text-muted-foreground">{name}</dt>
                    <dd className="tabular-nums [overflow-wrap:anywhere]">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {doc.tags.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tags">
                {doc.tags.map((t) => (
                  <li key={t} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {pages.length > 0 && (
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2 className="font-semibold">Scan and text, page by page</h2>
              <p className="text-sm text-muted-foreground">
                Read by {engineLabel(doc.ocr_engine)}
                {doc.ocr_confidence != null && `, ${Math.round(doc.ocr_confidence * 100)}% confident`}
              </p>
            </div>
            {pages.map((p) => (
              <article
                key={p.page_no}
                id={`p${p.page_no}`}
                className="mt-4 scroll-mt-4 border bg-card target:border-primary target:ring-2 target:ring-primary/20"
              >
                <div className="flex justify-between border-b px-5 py-1.5 text-xs text-muted-foreground">
                  <span>Page {p.page_no}</span>
                  {p.confidence != null && p.confidence < 0.85 && (
                    <span className="text-stamp">Low confidence, check against the scan</span>
                  )}
                </div>
                <div className="grid lg:grid-cols-2">
                  <a
                    href={`/api/documents/${doc.id}/pages/${p.page_no}/image`}
                    target="_blank"
                    rel="noreferrer"
                    className="block border-b bg-muted p-4 lg:border-r lg:border-b-0"
                    title="Open the scan at full size"
                  >
                    <img
                      src={`/api/documents/${doc.id}/pages/${p.page_no}/image`}
                      alt={`Scan of page ${p.page_no}`}
                      loading="lazy"
                      className="mx-auto max-h-[80vh] w-auto max-w-full bg-white shadow-sm"
                    />
                  </a>
                  <div className="ocr-text px-5 py-4">
                    {p.text || <em className="text-muted-foreground">No text on this page.</em>}
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
