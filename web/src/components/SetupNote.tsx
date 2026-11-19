import type { ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * A plain-language note about something that is not switched on, with the technical
 * fix folded away for whoever looks after the installation.
 */
export function SetupNote({
  children,
  details,
  className,
}: {
  children: ReactNode
  /** Which piece of setup is missing. */
  details: 'claude' | 'reader'
  className?: string
}) {
  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      <p>{children}</p>
      <details className="mt-1 text-muted-foreground">
        <summary className="cursor-pointer underline-offset-4 hover:underline">{t('setup.details')}</summary>
        <p className="mt-1">{t(`setup.${details}`)}</p>
      </details>
    </div>
  )
}
