import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import { formatDate } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import Icon from '../../components/ui/Icon'
import SearchField from '../../components/ui/SearchField'
import { CTRL, TEXTAREA, BTN_GHOST, BTN_PRIMARY, BTN_DANGER, TH, TD, Chip, Labeled, Notice, EmptyState, CHIP_GOOD, CHIP_WARN, CHIP_BAD, CHIP_NEUTRAL } from './ui'

// Deferred, flagged rather than built riskily: (1) "Merge duplicates" — no
// rpc_wa_contact_merge exists in Phase 1, and hand-rolling a merge here would
// touch wa_messages/wa_conversations (unique per contact)/wa_list_members
// without RLS write access from the client; needs its own RPC first.
// (2) Saved Lists (static/dynamic) CRUD — omitted for now; campaigns still
// work without them since rpc_wa_campaign_preview/send accept a raw
// audience_filter_json with no list_id.

var SOURCE_OPTIONS = ['lms', 'contract', 'csv', 'manual', 'inbound']
var OPT_STATUS_OPTIONS = ['opted_in', 'implied', 'opted_out', 'unknown']

// Opt status is the one column that decides whether a contact may legally be
// messaged at all, and every value used to print in the same grey. These are
// the four the column stores.
var OPT_STATUS_STYLES = {
  opted_in: CHIP_GOOD,
  implied: CHIP_WARN,
  opted_out: CHIP_BAD,
  unknown: CHIP_NEUTRAL,
}

function maskPhone(phone) {
  if (!phone) return '—'
  return phone.slice(0, 3) + '●●●●●●' + phone.slice(-2)
}

function sessionLabel(contact) {
  var closed = { text: 'Closed', cls: CHIP_NEUTRAL }
  if (!contact.session_expires_at) return closed
  var open = new Date(contact.session_expires_at) > new Date()
  return open ? { text: 'Open', cls: CHIP_GOOD } : closed
}

function AddContactModal({ open, onClose, onSaved }) {
  var [phone, setPhone] = useState('')
  var [name, setName] = useState('')
  var [tags, setTags] = useState('')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  async function save() {
    if (saving) return
    setSaving(true); setError('')
    var row = {
      phone: phone.trim(), name: name.trim() || null, source: 'manual',
      tags: tags.split(',').map(function (t) { return t.trim() }).filter(Boolean),
    }
    var res = await supabase.rpc('rpc_wa_contact_upsert_bulk', { p_rows: [row] })
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    var summary = res.data || {}
    if (summary.skipped_invalid_phone > 0) { setError('Invalid phone — must be E.164, e.g. +919876543210'); return }
    setPhone(''); setName(''); setTags('')
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Contact">
      <div className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        <Labeled label="Phone" hint="E.164 format — country code, no spaces or dashes">
          <input type="text" value={phone} onChange={function (ev) { setPhone(ev.target.value) }}
            placeholder="+919876543210" className={CTRL} />
        </Labeled>
        <Labeled label="Name" hint="Optional, but it is what shows in campaign previews">
          <input type="text" value={name} onChange={function (ev) { setName(ev.target.value) }}
            placeholder="Riya Sharma" className={CTRL} />
        </Labeled>
        <Labeled label="Tags" hint="Comma-separated — campaigns can target these">
          <input type="text" value={tags} onChange={function (ev) { setTags(ev.target.value) }}
            placeholder="delhi, wedding" className={CTRL} />
        </Labeled>
        <button onClick={save} disabled={saving || !phone.trim()} className={BTN_PRIMARY + ' w-full h-10'}>
          <Icon name="check" size={14} strokeWidth={2.3} />
          {saving ? 'Saving…' : 'Save Contact'}
        </button>
      </div>
    </Modal>
  )
}

function CsvImportModal({ open, onClose, onSaved }) {
  var [rawText, setRawText] = useState('')
  var [phoneCol, setPhoneCol] = useState('phone')
  var [nameCol, setNameCol] = useState('name')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [result, setResult] = useState(null)

  function parseCsv(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() })
    if (lines.length === 0) return { headers: [], rows: [] }
    var headers = lines[0].split(',').map(function (h) { return h.trim() })
    var rows = lines.slice(1).map(function (l) {
      var cells = l.split(',')
      var obj = {}
      headers.forEach(function (h, i) { obj[h] = (cells[i] || '').trim() })
      return obj
    })
    return { headers: headers, rows: rows }
  }

  async function doImport() {
    if (saving) return
    setSaving(true); setError(''); setResult(null)
    var parsed = parseCsv(rawText)
    if (parsed.rows.length === 0) { setSaving(false); setError('No rows found — paste CSV content with a header row'); return }

    var rows = parsed.rows.map(function (r) {
      return { phone: r[phoneCol] || '', name: r[nameCol] || null, source: 'csv' }
    })

    var res = await supabase.rpc('rpc_wa_contact_upsert_bulk', { p_rows: rows })
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    setResult(res.data)
    onSaved()
  }

  function handleClose() {
    setRawText(''); setResult(null); setError('')
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Import Contacts from CSV" wide>
      <div className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        {result && (
          <Notice tone="ok">
            Inserted {result.inserted}, updated {result.updated}, skipped (invalid phone) {result.skipped_invalid_phone}.
          </Notice>
        )}
        <Labeled label="CSV content" hint="The first row must be a header row with column names.">
          <textarea value={rawText} onChange={function (ev) { setRawText(ev.target.value) }} rows={8}
            placeholder={'phone,name\n+919876543210,Riya Sharma'}
            className={TEXTAREA + ' font-mono text-[16px] sm:text-[12px]'} />
        </Labeled>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Labeled label="Phone column">
            <input type="text" value={phoneCol} onChange={function (ev) { setPhoneCol(ev.target.value) }}
              className={CTRL + ' font-mono'} />
          </Labeled>
          <Labeled label="Name column">
            <input type="text" value={nameCol} onChange={function (ev) { setNameCol(ev.target.value) }}
              className={CTRL + ' font-mono'} />
          </Labeled>
        </div>
        <button onClick={doImport} disabled={saving || !rawText.trim()} className={BTN_PRIMARY + ' w-full h-10'}>
          <Icon name="download" size={14} strokeWidth={2.2} />
          {saving ? 'Importing…' : 'Import'}
        </button>
      </div>
    </Modal>
  )
}

function ContactDetailDrawer({ contact, onClose, onChanged }) {
  var [phoneRevealed, setPhoneRevealed] = useState(false)
  var [tagsText, setTagsText] = useState((contact.tags || []).join(', '))
  var [notes, setNotes] = useState(contact.notes || '')
  var [saving, setSaving] = useState(false)
  var [messages, setMessages] = useState([])
  var [loadingMsgs, setLoadingMsgs] = useState(true)

  useEffect(function () {
    setLoadingMsgs(true)
    supabase.from('wa_messages').select('id, direction, rendered_body, status, created_at, template_id')
      .eq('contact_id', contact.id).order('created_at', { ascending: false }).limit(30)
      .then(function (res) { setMessages(res.data || []); setLoadingMsgs(false) })
  }, [contact.id])

  function revealPhone() {
    setPhoneRevealed(true)
    supabase.rpc('log_activity', { p_action: 'wa_contact_phone_view', p_details: 'contact_id=' + contact.id })
      .then(function (res) { if (res.error) console.warn('Log failed:', res.error.message) })
      .catch(function () {})
  }

  async function saveTagsNotes() {
    if (saving) return
    setSaving(true)
    var tags = tagsText.split(',').map(function (t) { return t.trim() }).filter(Boolean)
    var res = await supabase.from('wa_contacts').update({ tags: tags, notes: notes || null }).eq('id', contact.id)
    setSaving(false)
    if (!res.error) onChanged()
  }

  async function optOut() {
    if (saving) return
    if (!window.confirm('Opt this contact out of all future messages?')) return
    setSaving(true)
    var res = await supabase.rpc('rpc_wa_contact_opt_out', { p_phone: contact.phone_e164, p_reason: 'manual', p_source: 'manual' })
    setSaving(false)
    if (!res.error) { onChanged(); onClose() }
  }

  var sess = sessionLabel(contact)

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[440px] sm:shadow-2xl sm:border-l sm:border-slate-200">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 border-b border-slate-200">
        <button onClick={onClose}
          className="inline-flex items-center gap-1.5 h-8 px-2 -ml-1 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-white hover:text-slate-900 transition-colors">
          <Icon name="arrowLeft" size={15} />
          Back
        </button>
        <Chip>{contact.source}</Chip>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto ambria-thin-scroll px-4 py-4 space-y-4">
        <div>
          <p className="text-[17px] font-bold text-slate-900 leading-tight">{contact.name || 'Unnamed contact'}</p>
          {/* A real button, not a <p onClick>: revealing a phone number is
              logged to the activity trail, so it has to be reachable from a
              keyboard and announce itself as an action. */}
          {phoneRevealed ? (
            <p className="text-[13px] text-slate-600 font-mono mt-1" data-notranslate>{contact.phone_e164}</p>
          ) : (
            <button onClick={revealPhone}
              className="inline-flex items-center gap-2 mt-1 text-[13px] text-slate-600 font-mono hover:text-slate-900 transition-colors">
              <span data-notranslate>{maskPhone(contact.phone_e164)}</span>
              <span className="inline-flex items-center gap-1 font-sans text-[10.5px] font-bold text-indigo-600 uppercase tracking-wide">
                <Icon name="eye" size={12} />
                Reveal
              </span>
            </button>
          )}
        </div>

        <div className="space-y-3 border-t border-slate-100 pt-3.5">
          <Labeled label="Tags" hint="Comma-separated">
            <input type="text" value={tagsText} onChange={function (ev) { setTagsText(ev.target.value) }}
              placeholder="delhi, wedding" className={CTRL} />
          </Labeled>
          <Labeled label="Notes">
            <textarea value={notes} onChange={function (ev) { setNotes(ev.target.value) }} rows={2}
              placeholder="Anything the next person should know" className={TEXTAREA} />
          </Labeled>
          <button onClick={saveTagsNotes} disabled={saving} className={BTN_GHOST}>
            <Icon name="save" size={14} />
            {saving ? 'Saving…' : 'Save tags & notes'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3.5">
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Opt status</p>
            <p className="mt-1"><Chip tone={OPT_STATUS_STYLES[contact.opt_status]}>{contact.opt_status}</Chip></p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Session</p>
            <p className="mt-1"><Chip tone={sess.cls}>{sess.text}</Chip></p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Last sent</p>
            <p className="text-[12.5px] text-slate-900 mt-0.5">{contact.last_sent_at ? formatDate(contact.last_sent_at) : '—'}</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Last received</p>
            <p className="text-[12.5px] text-slate-900 mt-0.5">{contact.last_received_at ? formatDate(contact.last_received_at) : '—'}</p>
          </div>
        </div>

        {contact.external_ids && Object.keys(contact.external_ids).length > 0 && (
          <div className="border-t border-slate-100 pt-3.5">
            <p className="text-[12px] font-semibold text-slate-900 mb-1">External IDs</p>
            <p className="text-[11px] text-slate-500 font-mono break-all bg-slate-50 border border-slate-200 rounded-xl px-3 py-2" data-notranslate>
              {JSON.stringify(contact.external_ids)}
            </p>
          </div>
        )}

        <div className="border-t border-slate-100 pt-3.5">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-900 mb-2">
            <span className="text-slate-900"><Icon name="inbox" size={13} /></span>
            Message History
          </p>
          {loadingMsgs ? <p className="text-[12px] text-slate-400">Loading…</p>
            : messages.length === 0 ? <p className="text-[12px] text-slate-400">No messages yet</p>
            : (
              <div className="space-y-1.5">
                {messages.map(function (m) {
                  var out = m.direction === 'out'
                  return (
                    <div key={m.id}
                      className={'text-[12px] px-2.5 py-2 rounded-xl border ' +
                        (out ? 'bg-indigo-50 border-indigo-100 text-slate-800' : 'bg-slate-50 border-slate-200 text-slate-700')}>
                      <p className="leading-snug">{m.rendered_body || '(template message)'}</p>
                      <p className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
                        <Icon name={out ? 'arrowRight' : 'arrowLeft'} size={10} />
                        <span className="capitalize">{m.status}</span>
                        <span>·</span>
                        <span>{formatDate(m.created_at)}</span>
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
        </div>

        {contact.opt_status !== 'opted_out' && (
          <div className="border-t border-slate-100 pt-3.5">
            <button onClick={optOut} disabled={saving} className={BTN_DANGER}>
              <Icon name="close" size={14} strokeWidth={2.2} />
              Opt out this contact
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">
              Stops every future campaign message to this number. It cannot be undone from here.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Contacts({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canEdit = hasPerm(permsNew, 'broadcast.contacts.edit')
  var canImport = hasPerm(permsNew, 'broadcast.contacts.import')

  var [contacts, setContacts] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [sourceFilter, setSourceFilter] = useState('')
  var [optStatusFilter, setOptStatusFilter] = useState('')
  var [venues, setVenues] = useState([])
  var [venueFilter, setVenueFilter] = useState('')
  var [addOpen, setAddOpen] = useState(false)
  var [csvOpen, setCsvOpen] = useState(false)
  var [pulling, setPulling] = useState(false)
  var [pullMsg, setPullMsg] = useState('')
  var [pullFailed, setPullFailed] = useState(false)
  var [detail, setDetail] = useState(null)

  function loadContacts() {
    setLoading(true)
    supabase.from('wa_contacts').select('*').order('created_at', { ascending: false }).limit(500)
      .then(function (res) { setContacts(res.data || []); setLoading(false) })
  }

  useEffect(function () {
    loadContacts()
    supabase.from('venues').select('id, code, name').then(function (res) { setVenues(res.data || []) })
  }, [])

  var filtered = contacts.filter(function (c) {
    if (sourceFilter && c.source !== sourceFilter) return false
    if (optStatusFilter && c.opt_status !== optStatusFilter) return false
    if (venueFilter && String(c.venue_affinity) !== venueFilter) return false
    if (search) {
      var q = search.toLowerCase()
      var matchesName = (c.name || '').toLowerCase().indexOf(q) !== -1
      var matchesPhone = (c.phone_e164 || '').indexOf(search) !== -1
      if (!matchesName && !matchesPhone) return false
    }
    return true
  })

  var filtersOn = !!(search || sourceFilter || optStatusFilter || venueFilter)

  async function pullFromContracts() {
    if (pulling) return
    setPulling(true); setPullMsg(''); setPullFailed(false)
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    var res = await supabase.functions.invoke('lms-contacts-pull', {
      body: {}, headers: token ? { Authorization: 'Bearer ' + token } : {},
    })
    setPulling(false)
    if (res.error) { setPullFailed(true); setPullMsg('Pull failed: ' + res.error.message); return }
    var d = res.data || {}
    setPullMsg('Pulled ' + d.total_candidates + ' contract contacts — ' + d.inserted + ' new, ' + d.updated + ' updated, ' + d.skipped_invalid_phone + ' invalid phone.')
    loadContacts()
  }

  // "0 of 0" said nothing when nothing was filtered. Say the plain count, and
  // only mention a subset when the filters are actually narrowing the list.
  var countLine = loading ? 'Loading…'
    : filtersOn ? 'Showing ' + filtered.length + ' of ' + contacts.length
    : contacts.length + (contacts.length === 1 ? ' contact' : ' contacts')

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-extrabold text-slate-900 leading-tight tracking-[-0.015em]">Contacts</h2>
          <p className="text-[11.5px] text-slate-500 mt-0.5">{countLine}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canImport && (
            <button onClick={pullFromContracts} disabled={pulling} className={BTN_GHOST}>
              <Icon name={pulling ? 'refresh' : 'download'} size={14} />
              {pulling ? 'Pulling…' : 'Pull from Contracts'}
            </button>
          )}
          {canImport && (
            <button onClick={function () { setCsvOpen(true) }} className={BTN_GHOST}>
              <Icon name="fileText" size={14} />
              Import CSV
            </button>
          )}
          {canEdit && (
            <button onClick={function () { setAddOpen(true) }} className={BTN_PRIMARY}>
              <Icon name="plus" size={14} strokeWidth={2.4} />
              Add Contact
            </button>
          )}
        </div>
      </div>

      {pullMsg && <Notice tone={pullFailed ? 'error' : 'ok'}>{pullMsg}</Notice>}

      {/* Filters in their own card. Loose on the page they read as four
          unrelated controls floating above the table. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <SearchField value={search} onChange={setSearch} placeholder="Search name or phone..." />
          <select value={sourceFilter} onChange={function (ev) { setSourceFilter(ev.target.value) }}
            aria-label="Filter by source" className={CTRL + ' capitalize'}>
            <option value="">All sources</option>
            {SOURCE_OPTIONS.map(function (s) { return <option key={s} value={s}>{s}</option> })}
          </select>
          <select value={optStatusFilter} onChange={function (ev) { setOptStatusFilter(ev.target.value) }}
            aria-label="Filter by opt status" className={CTRL}>
            <option value="">All opt statuses</option>
            {OPT_STATUS_OPTIONS.map(function (s) { return <option key={s} value={s}>{s.replace(/_/g, ' ')}</option> })}
          </select>
          <select value={venueFilter} onChange={function (ev) { setVenueFilter(ev.target.value) }}
            aria-label="Filter by venue" className={CTRL}>
            <option value="">All venues</option>
            {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
          </select>
        </div>
      </div>

      {/* overflow-hidden rounds the card, overflow-x-auto scrolls the table.
          Both on one element makes the other axis compute to auto too, which
          is where the stray vertical scrollbar arrows came from. */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="overflow-x-auto ambria-thin-scroll">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className={TH}>Name</th>
                <th className={TH}>Phone</th>
                <th className={TH}>Source</th>
                <th className={TH}>Tags</th>
                <th className={TH}>Opt Status</th>
                <th className={TH}>Last Sent</th>
                <th className={TH}>Session</th>
                <th className={TH + ' w-8'}><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center text-[12px] text-slate-400 py-8">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState icon="users"
                      title={contacts.length === 0 ? 'No contacts yet' : 'No matches'}
                      hint={contacts.length === 0
                        ? 'Pull them from contracts, import a CSV, or add one by hand'
                        : 'Nothing matches these filters'} />
                  </td>
                </tr>
              ) : filtered.map(function (c) {
                var sess = sessionLabel(c)
                var tags = c.tags || []
                return (
                  <tr key={c.id} onClick={function () { setDetail(c) }}
                    className="group border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50 transition-colors">
                    <td className={TD + ' font-semibold text-slate-900 whitespace-nowrap'}>{c.name || <span className="font-normal text-slate-300">—</span>}</td>
                    <td className={TD + ' font-mono text-slate-500 whitespace-nowrap'} data-notranslate>{maskPhone(c.phone_e164)}</td>
                    <td className={TD}><Chip>{c.source}</Chip></td>
                    <td className={TD}>
                      {tags.length === 0 ? <span className="text-slate-300">—</span> : (
                        <span className="flex flex-wrap items-center gap-1">
                          {tags.slice(0, 2).map(function (t) {
                            return (
                              <span key={t} className="inline-flex items-center h-[19px] px-1.5 rounded-md bg-indigo-50 border border-indigo-100 text-[10.5px] font-semibold text-indigo-700 whitespace-nowrap">
                                {t}
                              </span>
                            )
                          })}
                          {tags.length > 2 && <span className="text-[10.5px] font-semibold text-slate-400">+{tags.length - 2}</span>}
                        </span>
                      )}
                    </td>
                    <td className={TD}><Chip tone={OPT_STATUS_STYLES[c.opt_status]}>{(c.opt_status || '').replace(/_/g, ' ')}</Chip></td>
                    <td className={TD + ' text-slate-500 whitespace-nowrap'}>{c.last_sent_at ? formatDate(c.last_sent_at) : <span className="text-slate-300">—</span>}</td>
                    <td className={TD}><Chip tone={sess.cls}>{sess.text}</Chip></td>
                    {/* The row opens a drawer; without this the only hint was
                        the cursor, which a touch screen does not have. */}
                    <td className={TD + ' text-slate-300 group-hover:text-slate-500 transition-colors'}>
                      <Icon name="chevronRight" size={14} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AddContactModal open={addOpen} onClose={function () { setAddOpen(false) }} onSaved={loadContacts} />
      <CsvImportModal open={csvOpen} onClose={function () { setCsvOpen(false) }} onSaved={loadContacts} />
      {detail && (
        <ContactDetailDrawer contact={detail} onClose={function () { setDetail(null) }}
          onChanged={function () { loadContacts(); setDetail(null) }} />
      )}
    </div>
  )
}

export default Contacts
