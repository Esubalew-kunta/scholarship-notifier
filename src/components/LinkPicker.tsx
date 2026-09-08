'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LinkOption } from '@/lib/types'
import type { FieldHint } from '@/lib/fieldGuide'
import { prettyDate } from '@/lib/dates'
import FieldLabel from './FieldLabel'

/**
 * Multi-select for the admission <-> scholarship relationship.
 *
 * A native <select multiple> hides how many things you picked and punishes a
 * stray click by wiping the lot, which is exactly wrong for a field where
 * picking four scholarships at once is the normal case. So: a fixed-height
 * scroll box of checkboxes, a filter, and chips for what is chosen.
 */
export default function LinkPicker({
  label,
  hint,
  options,
  value,
  onChange,
  emptyText = 'Nothing to link to yet.',
  excludeId,
}: {
  label: string
  hint?: FieldHint
  options: LinkOption[]
  value: string[]
  onChange: (ids: string[]) => void
  emptyText?: string
  /** the entry being edited — it must never link to itself */
  excludeId?: string
}) {
  const [filter, setFilter] = useState('')

  const pool = useMemo(
    () => options.filter((o) => o.id !== excludeId),
    [options, excludeId],
  )

  const byId = useMemo(() => new Map(pool.map((o) => [o.id, o])), [pool])
  const chosen = value.map((id) => byId.get(id)).filter(Boolean) as LinkOption[]

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return pool
    return pool.filter(
      (o) =>
        o.title.toLowerCase().includes(f) ||
        (o.country ?? '').toLowerCase().includes(f),
    )
  }, [pool, filter])

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  // With a short list every tick is on screen already, so chips would just
  // repeat it. They earn their space once the list starts scrolling.
  const showChips = chosen.length > 0 && pool.length > 5

  // Only promise "scroll for more" when something is actually hidden.
  const listRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [shown.length, pool.length])

  return (
    <div className="field">
      <FieldLabel hint={hint}>
        {label}
        {chosen.length > 0 && <span className="picker-count">{chosen.length} selected</span>}
      </FieldLabel>

      {showChips && (
        <div className="picker-chips">
          {chosen.map((o) => (
            <button
              key={o.id}
              type="button"
              className="picker-chip"
              onClick={() => toggle(o.id)}
              title="Remove this link"
            >
              {o.title}
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}

      {pool.length === 0 ? (
        <div className="picker-empty">{emptyText}</div>
      ) : (
        <div className="picker">
          <input
            type="text"
            className="picker-search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or country…"
          />
          <div className="picker-list" ref={listRef}>
            {shown.map((o) => {
              const on = value.includes(o.id)
              return (
                <label key={o.id} className="picker-item" data-on={on || undefined}>
                  <input type="checkbox" checked={on} onChange={() => toggle(o.id)} />
                  <span>
                    <span className="picker-item-title">{o.title}</span>
                    <span className="picker-item-sub">
                      {[o.country, o.closes_on ? 'closes ' + prettyDate(o.closes_on) : null]
                        .filter(Boolean)
                        .join(' · ') || 'no dates set'}
                    </span>
                  </span>
                </label>
              )
            })}
            {shown.length === 0 && <div className="picker-empty">Nothing matches “{filter}”.</div>}
          </div>
          <div className="picker-foot">
            {filter.trim() ? `${shown.length} of ${pool.length} match` : `${pool.length} available`}
            {overflows && ' · scroll for more'}
            {' · tick as many as you need'}
          </div>
        </div>
      )}
    </div>
  )
}
