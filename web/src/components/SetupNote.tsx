import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A plain-language note about something that is not switched on, with the technical
 * fix folded away for whoever looks after the installation.
 */
export function SetupNote({ children, details, className }: { children: ReactNode; details: ReactNode; className?: string }) {
  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      <p>{children}</p>
      <details className="mt-1 text-muted-foreground">
        <summary className="cursor-pointer underline-offset-4 hover:underline">Setup details</summary>
        <p className="mt-1">{details}</p>
      </details>
    </div>
  )
}

export const CLAUDE_SETUP = (
  <>
    The server has no Claude API key. Add <code>ANTHROPIC_API_KEY</code> to the <code>.env</code> file in the project
    folder and restart the server.
  </>
)

export const READER_SETUP = (
  <>
    The local OCR worker is not answering on port 8001. Start it with <code>make ocr</code>.
  </>
)
