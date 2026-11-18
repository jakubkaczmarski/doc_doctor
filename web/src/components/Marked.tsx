/** Renders a search snippet, drawing a highlighter stroke over the **matched** terms. */
export function Marked({ text }: { text: string }) {
  const parts = text.split('**')
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="marker text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}
