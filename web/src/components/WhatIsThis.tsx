import { useState } from 'react'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, categoryKeys, categoryLabel, docTypes, needsSorting, typeLabel, type Doc } from '@/lib/api'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Type chips, an area picker and a free-text note: the three ways to say what a document is. */
export function SayWhatItIs({
  type,
  category,
  note,
  onChange,
  autoOption,
  idPrefix,
}: {
  type: string
  category: string
  note: string
  onChange: (next: { type?: string; category?: string; note?: string }) => void
  /** Offer "Detect automatically" as a choice (used before a document has been read). */
  autoOption?: boolean
  idPrefix: string
}) {
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1.5 text-sm transition-colors',
      active ? 'border-ink bg-ink text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground',
    )
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium">{t('sort.type')}</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {autoOption && (
            <button type="button" aria-pressed={type === ''} className={chip(type === '')} onClick={() => onChange({ type: '' })}>
              {t('sort.auto')}
            </button>
          )}
          {docTypes.map((d) => (
            <button type="button" key={d} aria-pressed={type === d} className={chip(type === d)} onClick={() => onChange({ type: d })}>
              {typeLabel(d)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-area`}>{t('sort.area')}</Label>
          <select
            id={`${idPrefix}-area`}
            value={category}
            onChange={(e) => onChange({ category: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm"
          >
            <option value="">{autoOption ? t('sort.auto') : t('sort.pickArea')}</option>
            {categoryKeys.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-note`}>{t('sort.note')}</Label>
          <Input
            id={`${idPrefix}-note`}
            value={note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder={t('sort.notePh')}
            maxLength={500}
            className="bg-card"
          />
        </div>
      </div>
    </div>
  )
}

/**
 * On a document page: asks what the document is when detection was unsure, and otherwise
 * offers a quiet "Change" link. Either way the user's answer sticks.
 */
export function WhatIsThis({ doc, onSaved }: { doc: Doc; onSaved: (doc: Doc) => void }) {
  const asking = needsSorting(doc)
  const guessed = doc.doc_type !== 'unknown' && doc.doc_type !== 'other'
  const [open, setOpen] = useState(false)
  const [type, setType] = useState(doc.doc_type === 'unknown' ? '' : doc.doc_type)
  const [category, setCategory] = useState(doc.category)
  const [note, setNote] = useState(doc.user_note)
  const [busy, setBusy] = useState(false)

  async function save(asType = type) {
    if (!asType) return
    setBusy(true)
    try {
      const res = await api.correct(doc.id, {
        doc_type: asType,
        ...(category ? { category } : {}),
        note,
      })
      toast.success(t('sort.saved'))
      setOpen(false)
      onSaved(res.document)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('sort.err'))
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <>
      <SayWhatItIs
        type={type}
        category={category}
        note={note}
        idPrefix={`doc-${doc.id}`}
        onChange={(n) => {
          if (n.type !== undefined) setType(n.type)
          if (n.category !== undefined) setCategory(n.category)
          if (n.note !== undefined) setNote(n.note)
        }}
      />
      <div className="mt-4 flex gap-2">
        <Button onClick={() => void save()} disabled={busy || !type}>
          {t('sort.save')}
        </Button>
        {!asking && (
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('sort.cancel')}
          </Button>
        )}
      </div>
    </>
  )

  if (asking) {
    return (
      <section className="mb-8 max-w-3xl border-l-2 border-primary bg-card px-4 py-4" aria-label={t('sort.askTitle')}>
        <h2 className="font-semibold">{t('sort.askTitle')}</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">{t('sort.askBody')}</p>
        {guessed && !open ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void save(doc.doc_type)} disabled={busy}>
              <Check aria-hidden /> {t('sort.yes', { type: typeLabel(doc.doc_type) })}
            </Button>
            <Button variant="outline" onClick={() => setOpen(true)}>
              {t('sort.somethingElse')}
            </Button>
          </div>
        ) : (
          form
        )}
      </section>
    )
  }

  if (!open) {
    return (
      <button className="mb-6 text-sm text-primary underline-offset-4 hover:underline" onClick={() => setOpen(true)}>
        {t('sort.change')}
      </button>
    )
  }
  return (
    <section className="mb-8 max-w-3xl border bg-card px-4 py-4" aria-label={t('sort.editTitle')}>
      <h2 className="mb-4 font-semibold">{t('sort.editTitle')}</h2>
      {form}
    </section>
  )
}
