'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { daysBetween, humanDays, prettyDate, phaseOf, todayISO } from '@/lib/dates'
import type { OpportunityRow } from '@/lib/types'
import { COUNTRIES } from '@/lib/types'

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME || 'scholarship_notifybot'

interface AdmissionOption {
  id: string
  title: string
  country: string | null
  closes_on: string | null
}

/* ================================================================
   Countdown
   ================================================================ */
function Countdown({ o }: { o: OpportunityRow }) {
  const t = todayISO()
  const phase = phaseOf(o.opens_on, o.closes_on, t)

  if (phase === 'undated') {
    return (
      <div className="countdown cd-past">
        <div className="countdown-n">—</div>
        <div className="countdown-l">no date</div>
      </div>
    )
  }
  if (phase === 'closed') {
    return (
      <div className="countdown cd-past">
        <div className="countdown-n">✕</div>
        <div className="countdown-l">closed</div>
      </div>
    )
  }
  if (phase === 'upcoming') {
    const d = daysBetween(o.opens_on!, t)
    return (
      <div className={'countdown ' + (d <= 7 ? 'cd-soon' : '')}>
        <div className="countdown-n">{d}</div>
        <div className="countdown-l">days to open</div>
      </div>
    )
  }
  if (!o.closes_on) {
    return (
      <div className="countdown cd-open">
        <div className="countdown-n">●</div>
        <div className="countdown-l">open now</div>
      </div>
    )
  }
  const d = daysBetween(o.closes_on, t)
  return (
    <div className={'countdown ' + (d <= 7 ? 'cd-urgent' : d <= 21 ? 'cd-soon' : 'cd-open')}>
      <div className="countdown-n">{d}</div>
      <div className="countdown-l">days to close</div>
    </div>
  )
}

/* ================================================================
   The dependency line — the reason this app exists
   ================================================================ */
function GateLine({ o }: { o: OpportunityRow }) {
  const t = todayISO()

  if (o.kind === 'admission') {
    if (!o.child_count) return null
    return (
      <div className="gate gate-info">
        <span>🔓</span>
        <span>
          Unlocks <b>{o.child_count}</b> scholarship{o.child_count === 1 ? '' : 's'}. Miss this
          window and they all go with it.
        </span>
      </div>
    )
  }

  if (!o.parent_id) {
    return (
      <div className="gate gate-warn">
        <span>💡</span>
        <span>
          Not linked to an admission. If it needs one, link it so nobody chases a dead end.
        </span>
      </div>
    )
  }

  const closed = o.parent_closes_on && daysBetween(o.parent_closes_on, t) < 0
  if (closed) {
    return (
      <div className="gate gate-block">
        <span>🚨</span>
        <span>
          Needs admission <b>{o.parent_title}</b>, which <b>closed {prettyDate(o.parent_closes_on)}</b>.
          Out of reach this cycle unless you already applied.
        </span>
      </div>
    )
  }

  return (
    <div className="gate gate-ok">
      <span>🎓</span>
      <span>
        Needs admission <b>{o.parent_title}</b>
        {o.parent_closes_on ? (
          <>
            {' '}
            — closes {prettyDate(o.parent_closes_on)} ({humanDays(daysBetween(o.parent_closes_on, t))})
          </>
        ) : null}
        . Secure that first.
      </span>
    </div>
  )
}

/* ================================================================
   Card
   ================================================================ */
function OppCard({ o, child }: { o: OpportunityRow; child?: boolean }) {
  const meta = [o.org, o.country, o.degree_level !== 'any' ? o.degree_level : null,
    o.funding && o.funding !== 'unknown' ? o.funding + ' funding' : null]
    .filter(Boolean) as string[]

  return (
    <article className={'opp' + (child ? ' is-child' : '') + (o.is_archived ? ' is-archived' : '')}>
      <div>
        <span className={'opp-kind ' + (o.kind === 'admission' ? 'k-admission' : 'k-scholarship')}>
          {o.kind === 'admission' ? '🎓 Admission' : '💰 Scholarship'}
        </span>

        <h3 className="opp-title">
          {o.url ? (
            <a href={o.url} target="_blank" rel="noopener noreferrer">
              {o.title} ↗
            </a>
          ) : (
            o.title
          )}
        </h3>

        {meta.length > 0 && (
          <div className="opp-meta">
            {meta.map((m, i) => (
              <span key={i}>
                {i > 0 && '· '}
                {m}
              </span>
            ))}
          </div>
        )}

        <div className="opp-dates">
          {o.opens_on && (
            <span className="date-pill">
              Opens <b>{prettyDate(o.opens_on)}</b>
            </span>
          )}
          {o.closes_on && (
            <span className="date-pill">
              Closes <b>{prettyDate(o.closes_on)}</b>
            </span>
          )}
          {!o.opens_on && !o.closes_on && <span className="date-pill">Dates not set</span>}
        </div>

        <GateLine o={o} />

        {o.notes && <div className="hint" style={{ marginTop: 8 }}>📝 {o.notes}</div>}
        {o.added_by && <div className="hint">added by {o.added_by}</div>}
      </div>

      <Countdown o={o} />
    </article>
  )
}

/* ================================================================
   Add form — six visible fields, the rest folded away
   ================================================================ */
const EMPTY = {
  kind: 'admission' as 'admission' | 'scholarship',
  title: '',
  country: '',
  url: '',
  opens_on: '',
  closes_on: '',
  parent_id: '',
  org: '',
  degree_level: 'any',
  funding: 'unknown',
  notes: '',
  added_by: '',
}

function AddForm({
  admissions,
  onAdded,
}: {
  admissions: AdmissionOption[]
  onAdded: () => void
}) {
  const [f, setF] = useState({ ...EMPTY })
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    const saved = localStorage.getItem('intake:name')
    if (saved) setF((p) => ({ ...p, added_by: saved }))
  }, [])

  const parent = admissions.find((a) => a.id === f.parent_id)
  const parentClosedBeforeScholarshipOpens =
    parent?.closes_on && f.opens_on && parent.closes_on < f.opens_on

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setOk('')
    setBusy(true)
    try {
      const res = await fetch('/api/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, parent_id: f.kind === 'scholarship' ? f.parent_id : null }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Could not save.')
        return
      }
      if (f.added_by) localStorage.setItem('intake:name', f.added_by)
      setOk(
        json.notified > 0
          ? `Added. ${json.notified} ${json.notified === 1 ? 'person' : 'people'} notified on Telegram.`
          : 'Added to the board.',
      )
      setF({ ...EMPTY, added_by: f.added_by })
      setMore(false)
      onAdded()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card sticky" onSubmit={submit}>
      <div className="card-head">
        <div className="card-title">Add an intake</div>
        <div className="card-note">
          Six fields. Everyone in the crew gets it on Telegram straight away.
        </div>
      </div>

      <div className="card-body">
        {error && <div className="msg msg-error">{error}</div>}
        {ok && <div className="msg msg-ok">{ok}</div>}

        <div className="field">
          <label className="lbl">Type <span className="req">*</span></label>
          <div className="seg">
            <button
              type="button"
              aria-pressed={f.kind === 'admission'}
              onClick={() => setF((p) => ({ ...p, kind: 'admission', parent_id: '' }))}
            >
              🎓 Admission
            </button>
            <button
              type="button"
              aria-pressed={f.kind === 'scholarship'}
              onClick={() => setF((p) => ({ ...p, kind: 'scholarship' }))}
            >
              💰 Scholarship
            </button>
          </div>
        </div>

        <div className="field">
          <label className="lbl" htmlFor="title">
            Name <span className="req">*</span>
          </label>
          <input
            id="title"
            type="text"
            required
            maxLength={200}
            value={f.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder={f.kind === 'admission' ? 'TU Munich — MSc Informatics' : 'DAAD EPOS Scholarship'}
          />
        </div>

        <div className="field">
          <label className="lbl" htmlFor="country">Country</label>
          <input
            id="country"
            type="text"
            list="country-list"
            value={f.country}
            onChange={(e) => set('country', e.target.value)}
            placeholder="Germany"
          />
          <datalist id="country-list">
            {COUNTRIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="field">
          <label className="lbl" htmlFor="url">Link</label>
          <input
            id="url"
            type="text"
            value={f.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="tum.de/en/studies/application"
          />
          <div className="hint">The info or application page. This goes in the reminder.</div>
        </div>

        <div className="field field-row">
          <div>
            <label className="lbl" htmlFor="opens">Opens</label>
            <input id="opens" type="date" value={f.opens_on} onChange={(e) => set('opens_on', e.target.value)} />
          </div>
          <div>
            <label className="lbl" htmlFor="closes">Closes</label>
            <input id="closes" type="date" value={f.closes_on} onChange={(e) => set('closes_on', e.target.value)} />
          </div>
        </div>

        {f.kind === 'scholarship' && (
          <div className="field">
            <label className="lbl" htmlFor="parent">Part of which admission?</label>
            <select id="parent" value={f.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
              <option value="">— standalone, no admission needed —</option>
              {admissions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                  {a.country ? ' · ' + a.country : ''}
                  {a.closes_on ? ' · closes ' + a.closes_on : ''}
                </option>
              ))}
            </select>
            <div className="hint">
              Link it and everyone gets warned about the admission deadline before this one matters.
            </div>
            {parentClosedBeforeScholarshipOpens && (
              <div className="hint-warn">
                ⚠️ Heads up: that admission closes <b>{prettyDate(parent!.closes_on)}</b>, before this
                scholarship even opens. Exactly the trap this app exists to catch — the admission has
                to be locked in first.
              </div>
            )}
          </div>
        )}

        <button type="button" className="disclosure" onClick={() => setMore((v) => !v)}>
          {more ? '▾' : '▸'} {more ? 'Hide' : 'Add'} detail (optional)
        </button>

        {more && (
          <>
            <div className="field">
              <label className="lbl" htmlFor="org">University / funder</label>
              <input id="org" type="text" value={f.org} onChange={(e) => set('org', e.target.value)} placeholder="DAAD" />
            </div>
            <div className="field field-row">
              <div>
                <label className="lbl" htmlFor="level">Level</label>
                <select id="level" value={f.degree_level} onChange={(e) => set('degree_level', e.target.value)}>
                  <option value="any">Any</option>
                  <option value="bachelor">Bachelor</option>
                  <option value="master">Master</option>
                  <option value="phd">PhD</option>
                </select>
              </div>
              <div>
                <label className="lbl" htmlFor="funding">Funding</label>
                <select id="funding" value={f.funding} onChange={(e) => set('funding', e.target.value)}>
                  <option value="unknown">Unknown</option>
                  <option value="full">Full</option>
                  <option value="partial">Partial</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="lbl" htmlFor="notes">Notes</label>
              <textarea
                id="notes"
                value={f.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="IELTS 6.5 needed · motivation letter · 2 referees"
              />
            </div>
          </>
        )}

        <div className="field">
          <label className="lbl" htmlFor="by">Your name</label>
          <input id="by" type="text" value={f.added_by} onChange={(e) => set('added_by', e.target.value)} placeholder="Esubalew" />
        </div>

        <button className="btn btn-primary btn-block" disabled={busy || !f.title.trim()}>
          {busy ? 'Saving…' : 'Add & notify the crew'}
        </button>
      </div>
    </form>
  )
}

/* ================================================================
   Page
   ================================================================ */
export default function Home() {
  const [items, setItems] = useState<OpportunityRow[]>([])
  const [admissions, setAdmissions] = useState<AdmissionOption[]>([])
  const [countries, setCountries] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const [timing, setTiming] = useState('')
  const [country, setCountry] = useState('')
  const [sort, setSort] = useState('urgency')

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (search.trim()) p.set('q', search.trim())
    if (kind) p.set('kind', kind)
    if (timing) p.set('timing', timing)
    if (country) p.set('country', country)
    if (sort) p.set('sort', sort)
    try {
      const res = await fetch('/api/opportunities?' + p.toString())
      const json = await res.json()
      setItems(json.opportunities ?? [])
      setAdmissions(json.admissions ?? [])
      setCountries(json.countries ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [search, kind, timing, country, sort])

  useEffect(() => {
    const id = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(id)
  }, [load, search])

  // Nest scholarships under their admission when both survived the filters.
  const blocks = useMemo(() => {
    const byId = new Map(items.map((o) => [o.id, o]))
    const out: { parent: OpportunityRow; children: OpportunityRow[] }[] = []
    for (const o of items) {
      if (o.kind === 'scholarship' && o.parent_id && byId.has(o.parent_id)) continue
      out.push({
        parent: o,
        children: o.kind === 'admission' ? items.filter((c) => c.parent_id === o.id) : [],
      })
    }
    return out
  }, [items])

  const filtersOn = !!(search || kind || timing || country)

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">🎓</span>
          <span>
            <div className="brand-name">Intake Tracker</div>
            <div className="brand-sub">admissions & scholarships, in order</div>
          </span>
        </a>
        <div className="topbar-actions">
          <a className="btn btn-tg" href={'https://t.me/' + BOT} target="_blank" rel="noopener noreferrer">
            Connect Telegram
          </a>
          <a className="btn" href="/admin">Admin</a>
        </div>
      </header>

      <p className="lede">
        A scholarship date is worthless if the admission behind it already closed. Add both here,
        link them together, and the bot will chase you — <strong>before the window opens</strong> and
        again <strong>before it shuts</strong> — until you have actually applied.
      </p>

      <div className="split">
        <AddForm admissions={admissions} onAdded={load} />

        <div>
          <div className="tg-callout">
            <h3>📲 Get the reminders</h3>
            <p>
              Open <a href={'https://t.me/' + BOT} target="_blank" rel="noopener noreferrer">@{BOT}</a> and
              send <code>/start</code>. If your Telegram username is on the list you are in
              immediately — otherwise ask an admin to run <code>/invite @you</code>.
            </p>
            <a className="btn btn-tg btn-sm" href={'https://t.me/' + BOT} target="_blank" rel="noopener noreferrer">
              Open the bot
            </a>
          </div>

          <div className="filters">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, university, country…"
              aria-label="Search"
            />
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="urgency">Most urgent</option>
              <option value="closes">Closing date</option>
              <option value="opens">Opening date</option>
              <option value="newest">Recently added</option>
              <option value="title">A → Z</option>
              <option value="country">Country</option>
            </select>
            <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="chips">
            {[
              ['', 'Everything'],
              ['admission', '🎓 Admissions'],
              ['scholarship', '💰 Scholarships'],
            ].map(([v, l]) => (
              <button key={v} className="chip" aria-pressed={kind === v} onClick={() => setKind(v)}>
                {l}
              </button>
            ))}
            <span style={{ width: 10 }} />
            {[
              ['', 'Any time'],
              ['closing', '🔥 Closing soon'],
              ['open', '🟢 Open now'],
              ['upcoming', '📅 Not open yet'],
              ['closed', '✕ Closed'],
            ].map(([v, l]) => (
              <button key={v} className="chip" aria-pressed={timing === v} onClick={() => setTiming(v)}>
                {l}
              </button>
            ))}
          </div>

          {!loading && (
            <div className="result-count">
              {items.length} {items.length === 1 ? 'entry' : 'entries'}
              {filtersOn && (
                <>
                  {' · '}
                  <button
                    className="chip"
                    style={{ padding: '1px 8px', fontSize: 12 }}
                    onClick={() => {
                      setSearch(''); setKind(''); setTiming(''); setCountry('')
                    }}
                  >
                    clear filters
                  </button>
                </>
              )}
            </div>
          )}

          {loading ? (
            <div className="list">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : items.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">🗓️</div>
              <div className="empty-title">
                {filtersOn ? 'Nothing matches those filters' : 'The board is empty'}
              </div>
              <div className="empty-sub">
                {filtersOn ? 'Try widening the search.' : 'Add the first admission on the left.'}
              </div>
            </div>
          ) : (
            <div className="list">
              {blocks.map(({ parent, children }) => (
                <div key={parent.id} className="list">
                  <OppCard o={parent} />
                  {children.map((c) => (
                    <OppCard key={c.id} o={c} child />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="foot">
        <span>Shared board · anyone with the link can add. Reminders are personal, on Telegram.</span>
        <a href={'https://t.me/' + BOT} target="_blank" rel="noopener noreferrer">@{BOT}</a>
      </footer>
    </div>
  )
}
