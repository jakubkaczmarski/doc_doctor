export type User = { id: number; org_id: number; email: string; org_name: string }

export type Capabilities = {
  claude: boolean
  local_ocr: boolean
  ocr_mode: string
  model: string
  /** Addresses a phone on the same network can use to reach this server. */
  lan_urls: string[]
}

export type Field = { name: string; value: string }

export type Doc = {
  id: number
  filename: string
  mime: string
  size_bytes: number
  status: 'queued' | 'processing' | 'ready' | 'failed'
  stage: string
  error: string
  notice: string
  ocr_engine: string
  ocr_confidence: number | null
  page_count: number
  doc_type: string
  /** Business area the document relates to. */
  category: string
  /** One short line saying what it is about. */
  subject: string
  title: string
  summary: string
  language: string
  doc_date: string | null
  counterparty: string
  total_amount: number | null
  currency: string
  tags: string[]
  fields: Field[]
  created_at: string
  processed_at: string | null
  /** Fields the user set by hand (doc_type, category, title, subject). */
  user_set: string[]
  /** The user's own description of the document. */
  user_note: string
  /** False when automatic detection was not confident about the type. */
  type_sure: boolean
}

export type Page = { page_no: number; text: string; confidence: number | null; engine: string }

export type Hit = {
  doc_id: number
  page: number
  title: string
  doc_type: string
  doc_date: string | null
  counterparty: string
  snippet: string
}

export type Source = {
  doc_id: number
  page: number
  title: string
  /** The words on that page the answer relies on. */
  quote?: string
  /** True when the quoted words were not found on the page. */
  unconfirmed?: boolean
}

export type ChatMessage = {
  id?: number
  role: 'user' | 'assistant'
  content: string
  sources: Source[]
  /** Figures in the answer that were not found in what the assistant read. */
  unverified?: string[]
  /** True once the server has finished its checks on this answer. */
  checked?: boolean
}

export type Conversation = { id: number; title: string; updated_at: string }

export type UploadResult = { filename: string; document?: Doc; duplicate?: boolean; error?: string }

import { lang, locale, t } from './i18n'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api' + path, {
      credentials: 'same-origin',
      ...init,
      headers: { ...init?.headers, 'X-Lang': lang() }, // server messages come back in this language
    })
  } catch {
    throw new ApiError(0, t('api.unreachable'))
  }
  if (!res.ok) {
    let message = t('api.failed', { status: res.status })
    try {
      message = (await res.json()).error ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Lang': lang() },
  body: JSON.stringify(body),
})

export const api = {
  me: () => request<{ user: User; capabilities: Capabilities }>('/me'),
  login: (email: string, password: string) => request<User>('/auth/login', json({ email, password })),
  register: (org_name: string, email: string, password: string) =>
    request<User>('/auth/register', json({ org_name, email, password })),
  phoneLink: () => request<{ urls: string[]; minutes: number }>('/auth/phone-link', { method: 'POST' }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  documents: (q = '', type = '', category = '') =>
    request<{ documents: Doc[] }>(
      `/documents?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&category=${encodeURIComponent(category)}`,
    ),
  document: (id: number) => request<{ document: Doc; pages: Page[] }>(`/documents/${id}`),
  deleteDocument: (id: number) => request<{ ok: boolean }>(`/documents/${id}`, { method: 'DELETE' }),
  reprocess: (id: number, ocr: 'local' | 'claude' | 'auto') =>
    request<{ ok: boolean }>(`/documents/${id}/reprocess`, json({ ocr })),
  correct: (id: number, change: { doc_type?: string; category?: string; title?: string; subject?: string; note?: string }) =>
    request<{ document: Doc }>(`/documents/${id}`, { ...json(change), method: 'PATCH' }),
  upload: (files: File[], said?: Said) => {
    const form = new FormData()
    appendSaid(form, said)
    files.forEach((f) => form.append('files', f))
    return request<{ results: UploadResult[] }>('/documents', { method: 'POST', body: form })
  },
  /** Uploads page photos, in order, as one multi-page document. */
  uploadScan: (pages: File[], name: string, said?: Said) => {
    const form = new FormData()
    appendSaid(form, said)
    form.append('combine', '1') // must precede the files
    form.append('name', name)
    pages.forEach((f) => form.append('files', f))
    return request<{ results: UploadResult[] }>('/documents', { method: 'POST', body: form })
  },
  search: (q: string) => request<{ hits: Hit[] }>(`/search?q=${encodeURIComponent(q)}`),

  org: () => request<{ name: string; profile: string; max_chars: number }>('/org'),
  saveOrg: (profile: string) =>
    request<{ profile: string }>('/org', { ...json({ profile }), method: 'PUT' }),

  conversations: () => request<{ conversations: Conversation[] }>('/conversations'),
  conversation: (id: number) => request<{ messages: ChatMessage[] }>(`/conversations/${id}`),
  deleteConversation: (id: number) => request<{ ok: boolean }>(`/conversations/${id}`, { method: 'DELETE' }),
}

export type ChatEvent =
  | { type: 'conversation'; conversation_id: number }
  | { type: 'text'; text: string }
  /** Replace the answer so far (working notes written before a lookup are dropped). */
  | { type: 'reset'; text?: string }
  | { type: 'tool'; text: string }
  | { type: 'sources'; sources?: Source[]; unverified?: string[] }
  | { type: 'error'; text: string }
  | { type: 'done' }

/** Sends a question and calls onEvent for each server-sent event until the stream ends. */
export async function streamChat(
  conversationId: number | null,
  message: string,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
) {
  const res = await fetch('/api/chat', {
    ...json({ conversation_id: conversationId ?? 0, message }),
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok || !res.body) {
    let message = t('api.failed', { status: res.status })
    try {
      message = (await res.json()).error ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of frame.split('\n')) {
        if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)) as ChatEvent)
      }
    }
  }
}

export const docTypes = [
  'invoice',
  'receipt',
  'contract',
  'letter',
  'form',
  'report',
  'statement',
  'order',
  'delivery_note',
  'payslip',
  'certificate',
  'other',
] as const

/** True when the system could not tell what a document is and the user has not said. */
export function needsSorting(d: Doc) {
  if (d.status !== 'ready' || d.user_set.includes('doc_type')) return false
  return d.doc_type === 'unknown' || d.doc_type === 'other' || !d.type_sure
}

/** What the user says a document is, sent with an upload. */
export type Said = { type?: string; category?: string; note?: string }

function appendSaid(form: FormData, said?: Said) {
  // These fields must precede the files in the form.
  if (said?.type) form.append('doc_type', said.type)
  if (said?.category) form.append('category', said.category)
  if (said?.note?.trim()) form.append('note', said.note.trim())
}

export const categoryKeys = [
  'purchases',
  'sales',
  'premises',
  'banking',
  'taxes',
  'payroll_hr',
  'insurance',
  'legal',
  'vehicles',
  'it_telecom',
  'administration',
  'other',
] as const

export function categoryLabel(c: string) {
  return (categoryKeys as readonly string[]).includes(c) ? t(`cat.${c}`) : ''
}

export function typeLabel(type: string) {
  return t(`type.${type}`)
}

/** Plural label for the type filter ("Invoices"). */
export function typesLabel(type: string) {
  return t(`types.${type}`)
}

export function formatAmount(amount: number | null, currency: string) {
  if (amount == null) return ''
  const n = amount.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${n} ${currency}` : n
}

export function formatDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' })
}

/** How clearly a scan could be read, in words rather than a percentage. */
export function readability(confidence: number | null): { label: string; poor: boolean } | null {
  if (confidence == null) return null
  if (confidence >= 0.95) return { label: t('quality.clear'), poor: false }
  if (confidence >= 0.85) return { label: t('quality.mostly'), poor: false }
  return { label: t('quality.hard'), poor: true }
}

const NOTE_CODES = ['no_text', 'no_summary', 'summary_failed', 'guessed', 'hard_to_read', 'read_twice']

/** Turns the note codes stored on a document into sentences in the reader's language. */
export function noteText(notice: string) {
  const codes = notice.split(' ').filter(Boolean)
  if (codes.length === 0 || !codes.every((c) => NOTE_CODES.includes(c))) return notice // older free-text note
  return codes.map((c) => t(`note.${c}`)).join(' ')
}
