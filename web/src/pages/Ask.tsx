import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { ArrowUp, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react'
import { PageText } from '@/components/PageText'
import { CLAUDE_SETUP, SetupNote } from '@/components/SetupNote'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { api, streamChat, type ChatMessage, type Conversation, type Page } from '@/lib/api'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

const STARTERS = [
  'Which invoices are due this month, and for how much?',
  'How much did we spend with each supplier this year?',
  'When does our office lease end, and what is the notice period?',
]

type Cite = { docId: number; page: number; quote?: string }

export default function AskPage() {
  const params = useParams()
  const navigate = useNavigate()
  const { capabilities } = useSession()
  const convId = params.id ? Number(params.id) : null

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState('')
  const [peek, setPeek] = useState<Cite | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  // The conversation whose messages are already in state (set while streaming a new one).
  const loadedConv = useRef<number | null>(null)

  const loadConversations = useCallback(() => {
    api.conversations().then((r) => setConversations(r.conversations)).catch(() => undefined)
  }, [])

  useEffect(loadConversations, [loadConversations])

  useEffect(() => {
    if (convId === loadedConv.current) return
    loadedConv.current = convId
    if (convId == null) {
      setMessages([])
      return
    }
    api
      .conversation(convId)
      .then((r) => setMessages(r.messages.map((m) => ({ ...m, checked: true }))))
      .catch(() => navigate('/ask', { replace: true }))
  }, [convId, navigate])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages, activity])

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return
    setDraft('')
    setBusy(true)
    setActivity('Looking through the archive')
    setMessages((m) => [...m, { role: 'user', content: question, sources: [] }, { role: 'assistant', content: '', sources: [] }])

    const patchLast = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)))

    try {
      await streamChat(convId, question, (e) => {
        switch (e.type) {
          case 'conversation':
            if (convId == null) {
              loadedConv.current = e.conversation_id
              navigate(`/ask/${e.conversation_id}`, { replace: true })
            }
            break
          case 'text':
            setActivity('')
            patchLast((m) => ({ ...m, content: m.content + e.text }))
            break
          case 'reset':
            patchLast((m) => ({ ...m, content: e.text ?? '' }))
            break
          case 'tool':
            setActivity(e.text)
            break
          case 'sources':
            patchLast((m) => ({ ...m, sources: e.sources ?? [], unverified: e.unverified ?? [], checked: true }))
            break
          case 'error':
            toast.error(e.text)
            patchLast((m) => (m.content ? m : { ...m, content: `(No answer: ${e.text})` }))
            break
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not get an answer.'
      toast.error(message)
      setMessages((all) => all.slice(0, -2))
      setDraft(question)
    } finally {
      setBusy(false)
      setActivity('')
      loadConversations()
    }
  }

  async function removeConversation(id: number) {
    await api.deleteConversation(id).catch(() => undefined)
    if (id === convId) navigate('/ask')
    loadConversations()
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(draft)
    }
  }

  return (
    <div className="flex h-full">
      {/* Past conversations */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card lg:flex">
        <div className="p-3">
          <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/ask')}>
            <Plus aria-hidden /> New question
          </Button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Past conversations">
          {conversations.map((c) => (
            <div key={c.id} className="group relative">
              <Link
                to={`/ask/${c.id}`}
                className={cn(
                  'block truncate rounded-md py-1.5 pr-8 pl-2 text-sm',
                  c.id === convId ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {c.title}
              </Link>
              <button
                onClick={() => void removeConversation(c.id)}
                aria-label={`Delete conversation: ${c.title}`}
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 hover:text-stamp focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-8">
            {messages.length === 0 ? (
              <div className="pt-[12vh]">
                <h1 className="font-serif text-3xl font-medium tracking-tight">Ask your archive</h1>
                <p className="mt-2 max-w-prose text-muted-foreground">
                  Answers come from your scanned documents, and each one points to the page it was found on.
                </p>
                {capabilities && !capabilities.claude ? (
                  <SetupNote details={CLAUDE_SETUP} className="mt-8 border-l-2 border-stamp bg-card px-4 py-3">
                    Questions are not switched on yet. You can still find documents with the search box on the
                    Documents page.
                  </SetupNote>
                ) : (
                  <ul className="mt-8 divide-y border-y">
                    {STARTERS.map((s) => (
                      <li key={s}>
                        <button onClick={() => void send(s)} className="w-full py-3 text-left hover:text-primary">
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <ol className="space-y-8">
                {messages.map((m, i) => (
                  <li key={i}>
                    {m.role === 'user' ? (
                      <p className="font-serif text-xl leading-snug font-medium">{m.content}</p>
                    ) : (
                      <Answer
                        message={m}
                        streaming={busy && i === messages.length - 1}
                        activity={activity}
                        onCite={setPeek}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}
            <div ref={bottom} className="h-4" />
          </div>
        </div>

        <div className="border-t bg-card">
          <form
            className="mx-auto flex w-full max-w-3xl items-end gap-2 px-5 py-3 md:px-8"
            onSubmit={(e) => {
              e.preventDefault()
              void send(draft)
            }}
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder="Type a question about your documents"
              aria-label="Your question"
              className="max-h-40 min-h-10 resize-none bg-background"
            />
            <Button type="submit" size="icon" className="size-10 shrink-0" disabled={busy || !draft.trim()} aria-label="Send question">
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </form>
        </div>
      </div>

      <PagePeek cite={peek} onClose={() => setPeek(null)} />
    </div>
  )
}

const CITE = /\[(\d+):(\d+)(?:\s*["“„]([^"”\]]{1,400})["”])?\](?!\()/g

/**
 * Turns [12:3 "quoted words"] markers into links the Markdown renderer hands back to us
 * as citations. While an answer is still streaming, a half-written marker at the end is
 * hidden so raw brackets never flash on screen.
 */
function linkCitations(text: string, streaming: boolean) {
  if (streaming) text = text.replace(/\[\d+(:[^\]]*)?$/, '')
  return text.replace(CITE, (_, doc, page, quote) => `[cite](#cite-${doc}-${page}-${encodeURIComponent(quote ?? '')})`)
}

function Answer({
  message,
  streaming,
  activity,
  onCite,
}: {
  message: ChatMessage
  streaming: boolean
  activity: string
  onCite: (c: Cite) => void
}) {
  const titles = new Map(message.sources.map((s) => [s.doc_id, s.title]))
  // Sources are numbered in the order the answer first uses them; the inline markers show that number.
  const byMarker = new Map(message.sources.map((s, i) => [`${s.doc_id}:${s.page}:${s.quote ?? ''}`, { ...s, n: i + 1 }]))
  const unverified = message.unverified ?? []
  const isAnswer = !message.content.startsWith('(No answer')
  const hasSources = message.sources.length > 0

  return (
    <div>
      <div className="answer">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a({ href, children }: { href?: string; children?: ReactNode }) {
              const m = href?.match(/^#cite-(\d+)-(\d+)-(.*)$/)
              if (!m) {
                return (
                  <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                    {children}
                  </a>
                )
              }
              const cite: Cite = { docId: Number(m[1]), page: Number(m[2]), quote: decodeURIComponent(m[3]) || undefined }
              const source = byMarker.get(`${cite.docId}:${cite.page}:${cite.quote ?? ''}`)
              // Once the answer is complete, only markers the server matched to a page the
              // assistant really read get a link.
              if (!streaming && message.checked && !source) {
                return <span className="text-sm text-muted-foreground">(page could not be confirmed)</span>
              }
              const title = titles.get(cite.docId)
              const wordingMissing = source?.unconfirmed
              return (
                <>
                  <button
                    onClick={() => onCite(wordingMissing ? { ...cite, quote: undefined } : cite)}
                    title={[title && `${title}, page ${cite.page}`, cite.quote && !wordingMissing && `“${cite.quote}”`]
                      .filter(Boolean)
                      .join('\n')}
                    aria-label={`Source ${source?.n ?? ''}: ${title ?? 'document'}, page ${cite.page}`}
                    className={cn(
                      'mx-0.5 cursor-pointer text-[0.75em] font-semibold whitespace-nowrap tabular-nums hover:brightness-95',
                      wordingMissing ? 'underline decoration-dotted underline-offset-2' : 'marker px-[0.4em]',
                    )}
                  >
                    {source ? source.n : `p. ${cite.page}`}
                  </button>
                  {wordingMissing && (
                    <span className="text-sm text-muted-foreground"> (these exact words are not on that page)</span>
                  )}
                </>
              )
            },
          }}
        >
          {linkCitations(message.content, streaming)}
        </ReactMarkdown>
      </div>

      {streaming && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {activity || 'Writing'}
        </p>
      )}

      {!streaming && message.checked && isAnswer && (!hasSources || unverified.length > 0) && (
        <div role="note" className="mt-5 max-w-[68ch] border-l-2 border-stamp bg-card px-4 py-3 text-sm">
          {!hasSources && (
            <p>
              <span className="font-medium">No document backs this answer.</span> It does not point to any page in
              your archive, so do not rely on it for facts.
            </p>
          )}
          {unverified.length > 0 && (
            <p className={!hasSources ? 'mt-2' : undefined}>
              <span className="font-medium">
                {unverified.length === 1 ? 'One number is' : `${unverified.length} numbers are`} not written in the
                pages it read:
              </span>{' '}
              <span className="tabular-nums">{unverified.join(', ')}</span>.{' '}
              {unverified.length === 1 ? 'It' : 'They'} may be worked out from other numbers, or may be wrong. Check{' '}
              {unverified.length === 1 ? 'it' : 'them'} in the document.
            </p>
          )}
        </div>
      )}

      {!streaming && hasSources && (
        <section className="mt-5 max-w-[68ch] border-t pt-3" aria-label="Where this answer comes from">
          <h3 className="text-sm font-semibold">Where this comes from</h3>
          <ol className="mt-2 space-y-2">
            {message.sources.map((s, i) => (
              <li key={i}>
                <button
                  onClick={() => onCite({ docId: s.doc_id, page: s.page, quote: s.unconfirmed ? undefined : s.quote })}
                  className="group flex w-full items-baseline gap-2 text-left"
                >
                  <span className="marker shrink-0 px-[0.4em] text-xs font-semibold tabular-nums">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-primary underline-offset-4 group-hover:underline">
                      {s.title}, page {s.page}
                    </span>
                    {s.quote && !s.unconfirmed && (
                      <span className="block font-serif text-sm leading-relaxed text-muted-foreground">“{s.quote}”</span>
                    )}
                    {s.unconfirmed && (
                      <span className="block text-sm text-muted-foreground">
                        The exact words quoted were not found on this page. Check it yourself.
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

/** Side sheet showing the cited page's text, so a claim can be checked without leaving the answer. */
function PagePeek({ cite, onClose }: { cite: Cite | null; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [page, setPage] = useState<Page | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!cite) return
    setPage(null)
    setError('')
    api
      .document(cite.docId)
      .then((r) => {
        setTitle(r.document.title || r.document.filename)
        const found = r.pages.find((p) => p.page_no === cite.page)
        if (found) setPage(found)
        else setError(`This document has no page ${cite.page}.`)
      })
      .catch(() => setError('This document is no longer in the archive.'))
  }, [cite])

  return (
    <Sheet open={cite != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="pr-8">{title || 'Source'}</SheetTitle>
          <SheetDescription>
            {cite ? `Page ${cite.page}${cite.quote ? '. The words the answer relies on are highlighted.' : ''}` : ''}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="text-sm text-muted-foreground">{error}</p>
          ) : page && cite ? (
            <>
              <PageText text={page.text} quote={cite.quote} />
              <img
                src={`/api/documents/${cite.docId}/pages/${cite.page}/image`}
                alt={`Picture of page ${cite.page}`}
                className="mt-4 w-full border bg-white"
              />
            </>
          ) : (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading page" />
          )}
        </div>
        {cite && !error && (
          <div className="border-t p-4">
            <Link
              to={`/documents/${cite.docId}${cite.quote ? `?quote=${encodeURIComponent(cite.quote)}` : ''}#p${cite.page}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden /> Open the whole document
            </Link>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
