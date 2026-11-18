export type User = { id: number; org_id: number; email: string; org_name: string }

export type Capabilities = { claude: boolean; local_ocr: boolean; ocr_mode: string; model: string }

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

export type Source = { doc_id: number; page: number; title: string }

export type ChatMessage = { id?: number; role: 'user' | 'assistant'; content: string; sources: Source[] }

export type Conversation = { id: number; title: string; updated_at: string }

export type UploadResult = { filename: string; document?: Doc; duplicate?: boolean; error?: string }

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
    res = await fetch('/api' + path, { credentials: 'same-origin', ...init })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that the API is running.')
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`
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
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  me: () => request<{ user: User; capabilities: Capabilities }>('/me'),
  login: (email: string, password: string) => request<User>('/auth/login', json({ email, password })),
  register: (org_name: string, email: string, password: string) =>
    request<User>('/auth/register', json({ org_name, email, password })),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  documents: (q = '', type = '') =>
    request<{ documents: Doc[] }>(`/documents?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`),
  document: (id: number) => request<{ document: Doc; pages: Page[] }>(`/documents/${id}`),
  deleteDocument: (id: number) => request<{ ok: boolean }>(`/documents/${id}`, { method: 'DELETE' }),
  reprocess: (id: number, ocr: 'local' | 'claude' | 'auto') =>
    request<{ ok: boolean }>(`/documents/${id}/reprocess`, json({ ocr })),
  upload: (files: File[]) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    return request<{ results: UploadResult[] }>('/documents', { method: 'POST', body: form })
  },
  search: (q: string) => request<{ hits: Hit[] }>(`/search?q=${encodeURIComponent(q)}`),

  conversations: () => request<{ conversations: Conversation[] }>('/conversations'),
  conversation: (id: number) => request<{ messages: ChatMessage[] }>(`/conversations/${id}`),
  deleteConversation: (id: number) => request<{ ok: boolean }>(`/conversations/${id}`, { method: 'DELETE' }),
}

export type ChatEvent =
  | { type: 'conversation'; conversation_id: number }
  | { type: 'text'; text: string }
  | { type: 'tool'; text: string }
  | { type: 'sources'; sources: Source[] }
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
    let message = `Request failed (${res.status})`
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

export const docTypes = ['invoice', 'receipt', 'contract', 'letter', 'form', 'report', 'other'] as const

export function typeLabel(t: string) {
  return t === 'unknown' ? 'Unsorted' : t.charAt(0).toUpperCase() + t.slice(1)
}

export function formatAmount(amount: number | null, currency: string) {
  if (amount == null) return ''
  const n = amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${n} ${currency}` : n
}

export function formatDate(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function engineLabel(engine: string) {
  switch (engine) {
    case 'rapidocr':
      return 'Local OCR'
    case 'pdf-text':
      return 'PDF text layer'
    case 'mixed':
      return 'Local OCR + PDF text'
    case 'claude-vision':
      return 'Claude vision'
    default:
      return engine
  }
}
