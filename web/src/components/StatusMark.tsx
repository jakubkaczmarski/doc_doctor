import { Loader2 } from 'lucide-react'
import type { Doc } from '@/lib/api'

/** Where a document is in the pipeline, in plain words. */
export function StatusMark({ doc }: { doc: Doc }) {
  switch (doc.status) {
    case 'queued':
      return <span className="text-muted-foreground">Waiting</span>
    case 'processing':
      return (
        <span className="inline-flex items-center gap-1.5 text-primary">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {doc.stage === 'analyzing' ? 'Filing' : 'Reading'}
        </span>
      )
    case 'failed':
      return (
        <span className="font-medium text-stamp" title={doc.error}>
          Could not read
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-ok">
          <span className="size-1.5 rounded-full bg-ok" aria-hidden />
          Ready
        </span>
      )
  }
}
