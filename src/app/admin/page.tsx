'use client'

import { useCallback, useEffect, useState } from 'react'
import { daysBetween, phaseOf, todayISO } from '@/lib/dates'
import type { OpportunityRow } from '@/lib/types'
import { COUNTRIES } from '@/lib/types'

const KEY = 'intake:adminkey'
const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME || 'scholarship_notifybot'

interface Admission { id: string; title: string; country: string | null; closes_on: string | null }
interface Member {
  id: string
  telegram_username: string | null
  telegram_user_id: string | null
  chat_id: string | null
  display_name: string | null
  is_admin: boolean
  status: string
  created_at: string
  linked_at: string | null
  applied_count: number
  skipped_count: number
}

/* ================================================================
   Passcode screen
   ================================================================ */
function Gate({ onUnlock }: { onUnlock: (k: string) => void }) {
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/stats', { headers: { 'x-admin-key': pass } })
      if (res.ok) {
        localStorage.setItem(KEY, pass)
        onUnlock(pass)
      } else {
        const j = await res.json().catch(() => ({}))
        setError(j.error || 'Wrong passcode.')
      }
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shell">
      <form className="card gate-screen" onSubmit={submit}>
        <div className="card-head">
          <div className="card-title">🔐 Admin</div>
          <div className="card-note">Enter the shared passcode to manage the board.</div>
        </div>
        <div className="card-body">
          {error && <div className="msg msg-error">{error}</div>}
          <div className="field">
            <label className="lbl" htmlFor="pc">Passcode</label>
            <input id="pc" type="password" value={pass} autoFocus onChange={(e) => setPass(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || !pass}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
          <div className="hint" style={{ marginTop: 12, textAlign: 'center' }}>
            <a href="/">← back to the board</a>
          </div>
        </div>
      </form>
    </div>
  )
}

/* ================================================================
   Edit / create modal
   ================================================================ */
const BLANK = {
  kind: 'admission',
  title: '',
  country: '',
  org: '',
  url: '',
  opens_on: '',
  closes_on: '',
  parent_id: '',
  degree_level: 'any',
  funding: 'unknown',
  notes: '',
  added_by: '',
  is_archived: false,
}

function EditModal({
  row,
  admissions,
  adminKey,
  onClose,
  onSaved,
}: {
  row: OpportunityRow | null
  admissions: Admission[]
  adminKey: string
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState<any>(
    row
      ? {
          kind: row.kind,
          title: row.title ?? '',
          country: row.country ?? '',
          org: row.org ?? '',
          url: row.url ?? '',
          opens_on: row.opens_on ?? '',
          closes_on: row.closes_on ?? '',
          parent_id: row.parent_id ?? '',
          degree_level: row.degree_level ?? 'any',
          funding: row.funding ?? 'unknown',
          notes: row.notes ?? '',
          added_by: row.added_by ?? '',
          is_archived: row.is_archived,
        }
      : { ...BLANK },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const payload = {
      ...f,
      parent_id: f.kind === 'scholarship' ? f.parent_id || null : null,
      country: f.country || null,
      org: f.org || null,
      url: f.url || null,
      opens_on: f.opens_on || null,
      closes_on: f.closes_on || null,
      notes: f.notes || null,
      added_by: f.added_by || null,
    }
    try {
      const res = await fetch(
        row ? '/api/admin/opportunities/' + row.id : '/api/admin/opportunities',
        {
          method: row ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
          body: JSON.stringify(payload),
        },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error || 'Save failed.')
        return
      }
      onSaved()
      onClose()
    } catch {
      setError('Network error.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modal-head">
          <div className="card-title">{row ? 'Edit entry' : 'New entry'}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {error && <div className="msg msg-error">{error}</div>}

          <div className="field">
            <label className="lbl">Type</label>
            <div className="seg">
              <button type="button" aria-pressed={f.kind === 'admission'}
                onClick={() => setF((p: any) => ({ ...p, kind: 'admission', parent_id: '' }))}>
                🎓 Admission
              </button>
              <button type="button" aria-pressed={f.kind === 'scholarship'}
                onClick={() => set('kind', 'scholarship')}>
                💰 Scholarship
              </button>
            </div>
          </div>

          <div className="field">
            <label className="lbl">Name <span className="req">*</span></label>
            <input type="text" required value={f.title} onChange={(e) => set('title', e.target.value)} />
          </div>

          <div className="field field-row">
            <div>
              <label className="lbl">Country</label>
              <input type="text" list="ac" value={f.country} onChange={(e) => set('country', e.target.value)} />
              <datalist id="ac">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="lbl">University / funder</label>
              <input type="text" value={f.org} onChange={(e) => set('org', e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label className="lbl">Link</label>
            <input type="text" value={f.url} onChange={(e) => set('url', e.target.value)} />
          </div>

          <div className="field field-row">
            <div>
              <label className="lbl">Opens</label>
              <input type="date" value={f.opens_on} onChange={(e) => set('opens_on', e.target.value)} />
            </div>
            <div>
              <label className="lbl">Closes</label>
              <input type="date" value={f.closes_on} onChange={(e) => set('closes_on', e.target.value)} />
            </div>
          </div>

          {f.kind === 'scholarship' && (
            <div className="field">
              <label className="lbl">Depends on admission</label>
              <select value={f.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
                <option value="">— standalone —</option>
                {admissions
                  .filter((a) => a.id !== row?.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}{a.closes_on ? ' · closes ' + a.closes_on : ''}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="field field-row">
            <div>
              <label className="lbl">Level</label>
              <select value={f.degree_level} onChange={(e) => set('degree_level', e.target.value)}>
                <option value="any">Any</option>
                <option value="bachelor">Bachelor</option>
                <option value="master">Master</option>
                <option value="phd">PhD</option>
              </select>
            </div>
            <div>
              <label className="lbl">Funding</label>
              <select value={f.funding} onChange={(e) => set('funding', e.target.value)}>
                <option value="unknown">Unknown</option>
                <option value="full">Full</option>
                <option value="partial">Partial</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label className="lbl">Notes</label>
            <textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>

          <div className="field field-row">
            <div>
              <label className="lbl">Added by</label>
              <input type="text" value={f.added_by} onChange={(e) => set('added_by', e.target.value)} />
            </div>
            <div>
              <label className="lbl">Archived</label>
              <select value={f.is_archived ? '1' : '0'} onChange={(e) => set('is_archived', e.target.value === '1')}>
                <option value="0">Live — reminders on</option>
                <option value="1">Archived — no reminders</option>
              </select>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !f.title.trim()}>
            {busy ? 'Saving…' : row ? 'Save changes' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ================================================================
   Board tab
   ================================================================ */
function Board({ adminKey }: { adminKey: string }) {
  const [rows, setRows] = useState<OpportunityRow[]>([])
  const [admissions, setAdmissions] = useState<Admission[]>([])
  const [countries, setCountries] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<OpportunityRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState('')

  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [timing, setTiming] = useState('')
  const [country, setCountry] = useState('')
  const [level, setLevel] = useState('')
  const [funding, setFunding] = useState('')
  const [link, setLink] = useState('')
  const [archived, setArchived] = useState('false')
  const [sort, setSort] = useState('urgency')

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (kind) p.set('kind', kind)
    if (timing) p.set('timing', timing)
    if (country) p.set('country', country)
    if (level) p.set('degree_level', level)
    if (funding) p.set('funding', funding)
    if (link) p.set('link', link)
    p.set('archived', archived)
    p.set('sort', sort)
    try {
      const res = await fetch('/api/admin/opportunities?' + p, { headers: { 'x-admin-key': adminKey } })
      const j = await res.json()
      setRows(j.opportunities ?? [])
      setAdmissions(j.admissions ?? [])
      setCountries(j.countries ?? [])
    } finally {
      setLoading(false)
    }
  }, [adminKey, q, kind, timing, country, level, funding, link, archived, sort])

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  async function remove(row: OpportunityRow) {
    const warn =
      row.child_count > 0
        ? `Delete "${row.title}"? ${row.child_count} linked scholarship(s) will lose their admission link.`
        : `Delete "${row.title}"? This cannot be undone.`
    if (!confirm(warn)) return
    const res = await fetch('/api/admin/opportunities/' + row.id, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey },
    })
    if (res.ok) {
      setNote('Deleted "' + row.title + '".')
      load()
    } else setNote('Delete failed.')
  }

  async function toggleArchive(row: OpportunityRow) {
    const res = await fetch('/api/admin/opportunities/' + row.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ is_archived: !row.is_archived }),
    })
    if (res.ok) load()
  }

  const clearAll = () => {
    setQ(''); setKind(''); setTiming(''); setCountry('')
    setLevel(''); setFunding(''); setLink(''); setArchived('false')
  }
  const anyFilter = q || kind || timing || country || level || funding || link || archived !== 'false'

  return (
    <>
      {note && <div className="msg msg-ok">{note}</div>}

      <div className="filters">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, org, country, notes…" />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types</option>
          <option value="admission">🎓 Admission</option>
          <option value="scholarship">💰 Scholarship</option>
        </select>
        <select value={timing} onChange={(e) => setTiming(e.target.value)}>
          <option value="">Any timing</option>
          <option value="closing">Closing ≤30 days</option>
          <option value="open">Open now</option>
          <option value="upcoming">Not open yet</option>
          <option value="closed">Closed</option>
          <option value="undated">No dates set</option>
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Any level</option>
          <option value="bachelor">Bachelor</option>
          <option value="master">Master</option>
          <option value="phd">PhD</option>
          <option value="any">Unspecified</option>
        </select>
        <select value={funding} onChange={(e) => setFunding(e.target.value)}>
          <option value="">Any funding</option>
          <option value="full">Full</option>
          <option value="partial">Partial</option>
          <option value="unknown">Unknown</option>
        </select>
        <select value={link} onChange={(e) => setLink(e.target.value)}>
          <option value="">Any linkage</option>
          <option value="linked">Linked to an admission</option>
          <option value="orphan">⚠️ Scholarship with no admission</option>
        </select>
        <select value={archived} onChange={(e) => setArchived(e.target.value)}>
          <option value="false">Live only</option>
          <option value="all">Live + archived</option>
          <option value="true">Archived only</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="urgency">Most urgent</option>
          <option value="closes">Closing date</option>
          <option value="opens">Opening date</option>
          <option value="newest">Recently added</option>
          <option value="title">A → Z</option>
          <option value="country">Country</option>
        </select>
        {anyFilter && <button className="btn btn-sm" onClick={clearAll}>Clear</button>}
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ New entry</button>
      </div>

      <div className="result-count">
        {loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Title</th>
              <th>Country</th>
              <th>Opens</th>
              <th>Closes</th>
              <th>Depends on</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const phase = phaseOf(r.opens_on, r.closes_on)
              const badge =
                phase === 'closed' ? ['b-gray', 'closed']
                : phase === 'closing' ? ['b-red', 'closing']
                : phase === 'open' ? ['b-green', 'open']
                : phase === 'upcoming' ? ['b-blue', 'upcoming']
                : ['b-gray', 'no dates']
              const parentDead =
                r.parent_closes_on && daysBetween(r.parent_closes_on, todayISO()) < 0
              return (
                <tr key={r.id} style={r.is_archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    <span className={'badge ' + (r.kind === 'admission' ? 'b-blue' : 'b-green')}>
                      {r.kind === 'admission' ? '🎓 adm' : '💰 sch'}
                    </span>
                  </td>
                  <td style={{ maxWidth: 300 }}>
                    <div style={{ fontWeight: 560 }}>
                      {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : r.title}
                    </div>
                    {r.org && <div className="hint">{r.org}</div>}
                    {r.kind === 'admission' && r.child_count > 0 && (
                      <div className="hint">🔓 unlocks {r.child_count}</div>
                    )}
                  </td>
                  <td>{r.country || <span className="hint">—</span>}</td>
                  <td className="mono">{r.opens_on || '—'}</td>
                  <td className="mono">{r.closes_on || '—'}</td>
                  <td style={{ maxWidth: 190 }}>
                    {r.kind === 'scholarship' ? (
                      r.parent_title ? (
                        <>
                          <div style={{ fontSize: 12.5 }}>{r.parent_title}</div>
                          {parentDead && <span className="badge b-red">admission closed</span>}
                        </>
                      ) : (
                        <span className="badge b-yellow">standalone</span>
                      )
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td>
                    <span className={'badge ' + badge[0]}>{badge[1]}</span>
                    {r.is_archived && <div><span className="badge b-gray">archived</span></div>}
                  </td>
                  <td className="td-actions">
                    <button className="btn btn-sm" onClick={() => setEditing(r)}>Edit</button>{' '}
                    <button className="btn btn-sm" onClick={() => toggleArchive(r)}>
                      {r.is_archived ? 'Restore' : 'Archive'}
                    </button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              )
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8}><div className="empty" style={{ border: 'none' }}>Nothing matches.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <EditModal
          row={editing}
          admissions={admissions}
          adminKey={adminKey}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={load}
        />
      )}
    </>
  )
}

/* ================================================================
   Crew tab
   ================================================================ */
function Crew({ adminKey }: { adminKey: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/members', { headers: { 'x-admin-key': adminKey } })
    const j = await res.json()
    setMembers(j.members ?? [])
  }, [adminKey])

  useEffect(() => { load() }, [load])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(''); setNote('')
    try {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ telegram_username: username, display_name: name }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Failed.'); return }
      setNote(`@${j.telegram_username} added. Tell them to send /start to @${BOT}.`)
      setUsername(''); setName('')
      load()
    } finally { setBusy(false) }
  }

  async function patch(id: string, body: any) {
    await fetch('/api/admin/members/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify(body),
    })
    load()
  }

  async function ping(m: Member) {
    const res = await fetch('/api/admin/members/' + m.id, {
      method: 'POST', headers: { 'x-admin-key': adminKey },
    })
    const j = await res.json().catch(() => ({}))
    setNote(res.ok ? `Test DM sent to @${m.telegram_username}.` : j.error || 'Ping failed.')
  }

  async function remove(m: Member) {
    if (!confirm(`Remove @${m.telegram_username}? Their application history goes too.`)) return
    await fetch('/api/admin/members/' + m.id, { method: 'DELETE', headers: { 'x-admin-key': adminKey } })
    load()
  }

  return (
    <div className="split">
      <form className="card" onSubmit={invite}>
        <div className="card-head">
          <div className="card-title">Invite someone</div>
          <div className="card-note">Their Telegram username is the whole invite. No email, no password.</div>
        </div>
        <div className="card-body">
          {error && <div className="msg msg-error">{error}</div>}
          {note && <div className="msg msg-ok">{note}</div>}
          <div className="field">
            <label className="lbl">Telegram username <span className="req">*</span></label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@friend_name" />
            <div className="hint">They find it in Telegram → Settings → Username.</div>
          </div>
          <div className="field">
            <label className="lbl">Display name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Abel" />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || !username.trim()}>
            {busy ? 'Adding…' : 'Add to the crew'}
          </button>
          <div className="hint" style={{ marginTop: 12 }}>
            Then they open <a href={'https://t.me/' + BOT} target="_blank" rel="noopener noreferrer">@{BOT}</a> and
            send <code>/start</code>. You can also do this from the bot itself with <code>/invite @them</code>.
          </div>
        </div>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Member</th><th>State</th><th>Applied</th><th>Passed</th><th /></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ fontWeight: 560 }}>
                    @{m.telegram_username} {m.is_admin && <span className="badge b-blue">admin</span>}
                  </div>
                  {m.display_name && <div className="hint">{m.display_name}</div>}
                  {!m.chat_id && <div className="hint">not linked — needs /start</div>}
                </td>
                <td>
                  <span className={'badge ' + (m.status === 'active' ? 'b-green' : m.status === 'pending' ? 'b-yellow' : 'b-red')}>
                    {m.status}
                  </span>
                </td>
                <td className="mono">{m.applied_count}</td>
                <td className="mono">{m.skipped_count}</td>
                <td className="td-actions">
                  {m.chat_id && <><button className="btn btn-sm" onClick={() => ping(m)}>Ping</button>{' '}</>}
                  <button className="btn btn-sm" onClick={() => patch(m.id, { is_admin: !m.is_admin })}>
                    {m.is_admin ? 'Demote' : 'Promote'}
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => patch(m.id, { status: m.status === 'blocked' ? 'active' : 'blocked' })}>
                    {m.status === 'blocked' ? 'Unpause' : 'Pause'}
                  </button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => remove(m)}>Remove</button>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr><td colSpan={5}><div className="empty" style={{ border: 'none' }}>
                <div className="empty-title">No members yet</div>
                <div className="empty-sub">The first person to send /start to the bot becomes admin.</div>
              </div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ================================================================
   Tools tab
   ================================================================ */
function Tools({ adminKey }: { adminKey: string }) {
  const [date, setDate] = useState(todayISO())
  const [out, setOut] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  async function run(dry: boolean) {
    setBusy(true); setOut(null)
    try {
      const res = await fetch('/api/admin/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ dry, date }),
      })
      setOut(await res.json())
    } catch (e: any) {
      setOut({ error: String(e) })
    } finally { setBusy(false) }
  }

  return (
    <div className="split">
      <div className="card">
        <div className="card-head">
          <div className="card-title">Reminder sweep</div>
          <div className="card-note">
            Runs automatically once a day at 05:00 UTC. Use this to test, or to catch up after a change.
          </div>
        </div>
        <div className="card-body">
          <div className="field">
            <label className="lbl">Pretend today is</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="hint">
              Set a future date to check that a ladder step fires when you expect it to.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy} onClick={() => run(true)}>Preview (send nothing)</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => run(false)}>Send for real</button>
          </div>
          <div className="hint" style={{ marginTop: 12 }}>
            Each reminder is sent once. A “preview” never marks anything as sent, so the real run still
            delivers it.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Result</div>
        </div>
        <div className="card-body">
          {busy && <div className="hint">Working…</div>}
          {!busy && !out && <div className="hint">Nothing run yet.</div>}
          {out && (
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 12 }}>
              {JSON.stringify(out, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

/* ================================================================
   Page
   ================================================================ */
export default function Admin() {
  const [adminKey, setAdminKey] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<'board' | 'crew' | 'tools'>('board')
  const [stats, setStats] = useState<any>(null)

  useEffect(() => {
    const k = localStorage.getItem(KEY)
    if (!k) { setReady(true); return }
    fetch('/api/admin/stats', { headers: { 'x-admin-key': k } })
      .then((r) => (r.ok ? setAdminKey(k) : localStorage.removeItem(KEY)))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!adminKey) return
    fetch('/api/admin/stats', { headers: { 'x-admin-key': adminKey } })
      .then((r) => r.json())
      .then((j) => setStats(j.stats))
      .catch(() => {})
  }, [adminKey, tab])

  if (!ready) return <div className="shell" style={{ padding: 40 }} />
  if (!adminKey) return <Gate onUnlock={setAdminKey} />

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">🎓</span>
          <span>
            <div className="brand-name">Intake Tracker</div>
            <div className="brand-sub">admin</div>
          </span>
        </a>
        <div className="topbar-actions">
          <a className="btn" href="/">Public board</a>
          <button className="btn" onClick={() => { localStorage.removeItem(KEY); setAdminKey(null) }}>
            Lock
          </button>
        </div>
      </header>

      {stats && (
        <div className="stats">
          <div className="stat"><div className="stat-n">{stats.total}</div><div className="stat-l">live entries</div></div>
          <div className="stat"><div className="stat-n">{stats.admissions}</div><div className="stat-l">admissions</div></div>
          <div className="stat"><div className="stat-n">{stats.scholarships}</div><div className="stat-l">scholarships</div></div>
          <div className={'stat' + (stats.closing_soon ? ' stat-alert' : '')}>
            <div className="stat-n">{stats.closing_soon}</div><div className="stat-l">closing ≤30d</div>
          </div>
          <div className="stat"><div className="stat-n">{stats.upcoming}</div><div className="stat-l">not open yet</div></div>
          <div className={'stat' + (stats.orphans ? ' stat-alert' : '')}>
            <div className="stat-n">{stats.orphans}</div><div className="stat-l">unlinked schol.</div>
          </div>
          <div className="stat"><div className="stat-n">{stats.members_active}</div><div className="stat-l">active members</div></div>
          <div className="stat"><div className="stat-n">{stats.reminders_sent}</div><div className="stat-l">reminders sent</div></div>
        </div>
      )}

      <div className="tabs">
        <button className="tab" aria-selected={tab === 'board'} onClick={() => setTab('board')}>Board</button>
        <button className="tab" aria-selected={tab === 'crew'} onClick={() => setTab('crew')}>Crew</button>
        <button className="tab" aria-selected={tab === 'tools'} onClick={() => setTab('tools')}>Tools</button>
      </div>

      {tab === 'board' && <Board adminKey={adminKey} />}
      {tab === 'crew' && <Crew adminKey={adminKey} />}
      {tab === 'tools' && <Tools adminKey={adminKey} />}
    </div>
  )
}
