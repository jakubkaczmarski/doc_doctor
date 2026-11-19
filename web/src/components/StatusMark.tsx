import { Loader2 } from 'lucide-react'
import type { Doc } from '@/lib/api'
import { t } from '@/lib/i18n'

/** Where a document is in the pipeline, in plain words. */
export function StatusMark({ doc }: { doc: Doc }) {
  switch (doc.status) {
    case 'queued':
      return <span className="text-muted-foreground">{t('status.waiting')}</span>
    case 'processing':
      return (
        <span className="inline-flex items-center gap-1.5 text-primary">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {doc.stage === 'analyzing' ? t('status.filing') : t('status.reading')}
        </span>
      )
    case 'failed':
      return (
        <span className="font-medium text-stamp" title={doc.error}>
          {t('status.failed')}
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-ok">
          <span className="size-1.5 rounded-full bg-ok" aria-hidden />
          {t('status.ready')}
        </span>
      )
  }
}
