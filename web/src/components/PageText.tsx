import { useEffect, useRef } from 'react'

/** Lower-cases and collapses whitespace, keeping a map back to positions in the original. */
function normalize(text: string) {
  let out = ''
  const map: number[] = []
  let space = true // swallow leading whitespace
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch) || ch === '|') {
      if (!space) {
        out += ' '
        map.push(i)
        space = true
      }
      continue
    }
    out += ch.toLowerCase()
    map.push(i)
    space = false
  }
  return { out, map }
}

/** Finds the quoted passage in the page. Returns [start, end) ranges in the original text. */
export function findQuote(text: string, quote: string): [number, number][] {
  const page = normalize(text)
  const ranges: [number, number][] = []
  let from = 0
  for (const raw of quote.replace(/…/g, '...').split('...')) {
    const part = normalize(raw).out.trim().replace(/^[ .,;:]+|[ .,;:]+$/g, '')
    if (!part) continue
    const at = page.out.indexOf(part, from)
    if (at < 0) return []
    ranges.push([page.map[at], page.map[at + part.length - 1] + 1])
    from = at + part.length
  }
  return ranges
}

/** Page text as read from the scan, with the cited passage highlighted and scrolled into view. */
export function PageText({ text, quote, className }: { text: string; quote?: string; className?: string }) {
  const first = useRef<HTMLElement>(null)
  const ranges = quote ? findQuote(text, quote) : []

  useEffect(() => {
    first.current?.scrollIntoView({ block: 'center' })
  }, [text, quote])

  if (ranges.length === 0) return <div className={className ?? 'ocr-text'}>{text}</div>

  const parts = []
  let pos = 0
  ranges.forEach(([start, end], i) => {
    parts.push(<span key={`t${i}`}>{text.slice(pos, start)}</span>)
    parts.push(
      <mark key={`m${i}`} ref={i === 0 ? first : undefined} className="marker text-foreground">
        {text.slice(start, end)}
      </mark>,
    )
    pos = end
  })
  parts.push(<span key="tail">{text.slice(pos)}</span>)
  return <div className={className ?? 'ocr-text'}>{parts}</div>
}
