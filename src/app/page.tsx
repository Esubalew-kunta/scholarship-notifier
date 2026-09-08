'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { daysBetween, humanDays, prettyDate, phaseOf, todayISO } from '@/lib/dates'
import type { LinkOption, OpportunityRow } from '@/lib/types'
import { COUNTRIES, formatFee } from '@/lib/types'
import LinkPicker from '@/components/LinkPicker'
import FieldLabel from '@/components/FieldLabel'
import { guideFor } from '@/lib/fieldGuide'

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME || 'scholarship_notifybot'

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
   The dependency line — the reason this app exists.
   A scholarship can be reachable through several admissions; holding any
   one of them is enough, so this reads the best route, not the worst.
   ================================================================ */
function GateLine({ o }: { o: OpportunityRow }) {
  const t = todayISO()
  const links = o.links ?? []

  if (o.kind === 'admission') {
    if (!links.length) return null
    return (
      <div className="gate gate-info">
        <span>🔓</span>
        <span>
          Unlocks <b>{links.length}</b> scholarship{links.length === 1 ? '' : 's'}:{' '}
          {links.map((l) => l.title).join(', ')}. Miss this window and they all go with it.
        </span>
      </div>
    )
  }

  if (!links.length) {
    return (
      <div className="gate gate-warn">
        <span>💡</span>
        <span>Not linked to an admission. If it needs one, link it so nobody chases a dead end.</span>
      </div>
    )
  }

  const reachable = links.filter((l) => !l.closes_on || daysBetween(l.closes_on, t) >= 0)

  if (!reachable.length) {
    return (
      <div className="gate gate-block">
        <span>🚨</span>
        <span>
          Needs one of <b>{links.length}</b> admission{links.length === 1 ? '' : 's'} —{' '}
          <b>all closed</b>. Out of reach this cycle unless you already applied.
        </span>
      </div>
    )
  }

  const soonest = reachable.find((l) => l.closes_on)
  return (
    <div className="gate gate-ok">
      <span>🎓</span>
      <span>
        Open to holders of{' '}
        {reachable.length === 1 ? (
          <b>{reachable[0].title}</b>
        ) : (
          <>
            any of <b>{reachable.length}</b> admissions: {reachable.map((l) => l.title).join(', ')}
          </>
        )}
        {soonest?.closes_on ? (
          <>
            {' '}
            — soonest closes {prettyDate(soonest.closes_on)} (
            {humanDays(daysBetween(soonest.closes_on, t))})
          </>
        ) : null}
        . Secure one first.
      </span>
    </div>
  )
}

/* ================================================================
   Card
   ================================================================ */
function OppCard({ o, child }: { o: OpportunityRow; child?: boolean }) {
  const meta = [
    o.org,
    o.country,
    o.degree_level !== 'any' ? o.degree_level : null,
    o.funding && o.funding !== 'unknown' ? o.funding + ' funding' : null,
  ].filter(Boolean) as string[]

  const fee = formatFee(o.application_fee, o.fee_currency)

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
          {fee && (
            <span className="date-pill fee-pill">
              Fee <b>{fee}</b>
            </span>
          )}
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
   Add form
   ================================================================ */
const EMPTY = {
  kind: 'admission' as 'admission' | 'scholarship',
  title: '',
  country: '',
  url: '',
  opens_on: '',
  closes_on: '',
  org: '',
  degree_level: 'any',
  funding: 'unknown',
  application_fee: '',
  fee_currency: 'EUR',
  notes: '',
  added_by: '',
}

function AddForm({
  admissions,
  scholarships,
  onAdded,
}: {
  admissions: LinkOption[]
  scholarships: LinkOption[]
  onAdded: () => void
}) {
  const [f, setF] = useState({ ...EMPTY })
  const [links, setLinks] = useState<string[]>([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    const saved = localStorage.getItem('intake:name')
    if (saved) setF((p) => ({ ...p, added_by: saved }))
  }, [])

  const isAdmission = f.kind === 'admission'
  const pool = isAdmission ? scholarships : admissions
  const chosen = pool.filter((o) => links.includes(o.id))
  const g = guideFor(f.kind)

  /** Switching type swaps the whole vocabulary, so links and the fee reset. */
  const setKind = (kind: 'admission' | 'scholarship') => {
    setF((p) => ({ ...p, kind, application_fee: '', fee_currency: 'EUR' }))
    setLinks([])
  }

  // The trap this app exists to catch, now across every chosen link.
  const strandedByDate = isAdmission
    ? chosen.filter((s) => f.closes_on && s.closes_on && f.closes_on > s.closes_on)
    : chosen.filter((a) => a.closes_on && f.opens_on && a.closes_on < f.opens_on)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setOk('')
    setBusy(true)
    try {
      const res = await fetch('/api/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...f,
          links,
          // Scholarships have no application fee — you pay to apply to a
          // university, not to be considered for its money.
          application_fee: isAdmission ? f.application_fee : null,
          fee_currency: isAdmission ? f.fee_currency : null,
        }),
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
      setLinks([])
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
          Link it to the other side and everyone in the crew gets it on Telegram straight away.
        </div>
      </div>

      <div className="card-body">
        {error && <div className="msg msg-error">{error}</div>}
        {ok && <div className="msg msg-ok">{ok}</div>}

        <div className="field">
          <label className="lbl">Type <span className="req">*</span></label>
          <div className="seg">
            <button type="button" aria-pressed={isAdmission} onClick={() => setKind('admission')}>
              🎓 Admission
            </button>
            <button type="button" aria-pressed={!isAdmission} onClick={() => setKind('scholarship')}>
              💰 Scholarship
            </button>
          </div>
        </div>

        <div className="field">
          <FieldLabel htmlFor="title" required hint={g.title}>Name</FieldLabel>
          <input
            id="title"
            type="text"
            required
            maxLength={200}
            value={f.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder={g.title.example}
          />
        </div>

        <div className="field">
          <FieldLabel htmlFor="country" hint={g.country}>Country</FieldLabel>
          <input
            id="country"
            type="text"
            list="country-list"
            value={f.country}
            onChange={(e) => set('country', e.target.value)}
            placeholder={g.country.example}
          />
          <datalist id="country-list">
            {COUNTRIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="field">
          <FieldLabel htmlFor="url" hint={g.url}>Link</FieldLabel>
          <input
            id="url"
            type="text"
            value={f.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder={g.url.example}
          />
        </div>

        <div className="field field-row">
          <div>
            <FieldLabel htmlFor="opens" hint={g.opens_on}>Opens</FieldLabel>
            <input id="opens" type="date" value={f.opens_on} onChange={(e) => set('opens_on', e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="closes" hint={g.closes_on}>Closes</FieldLabel>
            <input id="closes" type="date" value={f.closes_on} onChange={(e) => set('closes_on', e.target.value)} />
          </div>
        </div>

        {isAdmission && (
          <div className="field">
            <FieldLabel htmlFor="fee" hint={g.application_fee}>Application fee</FieldLabel>
            <div className="fee-row">
              <input
                id="fee"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={f.application_fee}
                onChange={(e) => set('application_fee', e.target.value)}
                placeholder="30"
              />
              <select
                value={f.fee_currency}
                onChange={(e) => set('fee_currency', e.target.value)}
                aria-label="Currency"
              >
                <option value="EUR">€ EUR</option>
                <option value="USD">$ USD</option>
              </select>
            </div>
            <div className="hint">Blank = unknown. 0 = free.</div>
          </div>
        )}

        <LinkPicker
          label={isAdmission ? 'Which scholarships does this unlock?' : 'Part of which admission(s)?'}
          options={pool}
          value={links}
          onChange={setLinks}
          hint={g.links}
          emptyText={
            isAdmission
              ? 'No scholarships on the board yet — add one, then come back and link it.'
              : 'No admissions on the board yet — add one, then come back and link it.'
          }
        />

        {strandedByDate.length > 0 && (
          <div className="hint-warn">
            ⚠️ Heads up:{' '}
            {isAdmission ? (
              <>
                this admission closes <b>{prettyDate(f.closes_on)}</b>, after{' '}
                <b>{strandedByDate.map((s) => s.title).join(', ')}</b> already{' '}
                {strandedByDate.length === 1 ? 'closes' : 'close'}.
              </>
            ) : (
              <>
                <b>{strandedByDate.map((a) => a.title).join(', ')}</b>{' '}
                {strandedByDate.length === 1 ? 'closes' : 'close'} before this scholarship even opens
                on <b>{prettyDate(f.opens_on)}</b>.
              </>
            )}{' '}
            Exactly the trap this app exists to catch — the admission has to be locked in first.
          </div>
        )}

        <button type="button" className="disclosure" onClick={() => setMore((v) => !v)}>
          {more ? '▾' : '▸'} {more ? 'Hide' : 'Add'} detail (optional)
        </button>

        {more && (
          <>
            <div className="field">
              <FieldLabel htmlFor="org" hint={g.org}>
                {isAdmission ? 'University' : 'Funder'}
              </FieldLabel>
              <input id="org" type="text" value={f.org} onChange={(e) => set('org', e.target.value)} placeholder={g.org.example} />
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
              <FieldLabel htmlFor="notes" hint={g.notes}>Notes</FieldLabel>
              <textarea
                id="notes"
                value={f.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder={g.notes.example}
              />
            </div>
          </>
        )}

        <div className="field">
          <FieldLabel htmlFor="by" hint={g.added_by}>Your name</FieldLabel>
          <input id="by" type="text" value={f.added_by} onChange={(e) => set('added_by', e.target.value)} placeholder={g.added_by.example} />
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
  const [admissions, setAdmissions] = useState<LinkOption[]>([])
  const [scholarships, setScholarships] = useState<LinkOption[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const [timing, setTiming] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (search.trim()) p.set('q', search.trim())
    if (kind) p.set('kind', kind)
    if (timing) p.set('timing', timing)
    try {
      const res = await fetch('/api/opportunities?' + p.toString())
      const json = await res.json()
      setItems(json.opportunities ?? [])
      setAdmissions(json.admissions ?? [])
      setScholarships(json.scholarships ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [search, kind, timing])

  useEffect(() => {
    const id = setTimeout(load, search ? 300 : 0)
    return () => clearTimeout(id)
  }, [load, search])

  // Nest scholarships under an admission that unlocks them, when both survived
  // the filters. A scholarship reachable through several admissions is shown
  // once, under the first one — repeating it would just pad the list.
  const blocks = useMemo(() => {
    const present = new Set(items.map((o) => o.id))
    const claimed = new Set<string>()
    for (const o of items) {
      if (o.kind !== 'admission') continue
      for (const l of o.links ?? []) {
        if (present.has(l.id) && !claimed.has(l.id)) claimed.add(l.id)
      }
    }

    const taken = new Set<string>()
    const out: { parent: OpportunityRow; children: OpportunityRow[] }[] = []
    const byId = new Map(items.map((o) => [o.id, o]))

    for (const o of items) {
      if (o.kind === 'scholarship' && claimed.has(o.id)) continue
      const children =
        o.kind === 'admission'
          ? ((o.links ?? [])
              .map((l) => byId.get(l.id))
              .filter((c): c is OpportunityRow => !!c && !taken.has(c.id)))
          : []
      children.forEach((c) => taken.add(c.id))
      out.push({ parent: o, children })
    }
    return out
  }, [items])

  const filtersOn = !!(search || kind || timing)

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
        link them together — one admission can unlock several scholarships — and the bot will DM you{' '}
        <strong>every day the window is open</strong> until you say you have applied.
      </p>

      <div className="split">
        <AddForm admissions={admissions} scholarships={scholarships} onAdded={load} />

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
              placeholder="Search name, university, country…"
              aria-label="Search"
            />
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
              ['open', '🟢 Open now'],
              ['closing', '🔥 Closing soon'],
              ['upcoming', '📅 Not open yet'],
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
                    onClick={() => { setSearch(''); setKind(''); setTiming('') }}
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
