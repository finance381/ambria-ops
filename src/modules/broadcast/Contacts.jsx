import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import { formatDate } from '../../lib/format'
import Modal from '../../components/ui/Modal'

// Deferred, flagged rather than built riskily: (1) "Merge duplicates" — no
// rpc_wa_contact_merge exists in Phase 1, and hand-rolling a merge here would
// touch wa_messages/wa_conversations (unique per contact)/wa_list_members
// without RLS write access from the client; needs its own RPC first.
// (2) Saved Lists (static/dynamic) CRUD — omitted for now; campaigns still
// work without them since rpc_wa_campaign_preview/send accept a raw
// audience_filter_json with no list_id.

var SOURCE_OPTIONS = ['lms', 'contract', 'csv', 'manual', 'inbound']
var OPT_STATUS_OPTIONS = ['opted_in', 'implied', 'opted_out', 'unknown']

function maskPhone(phone) {
  if (!phone) return '—'
  return phone.slice(0, 3) + '●●●●●●' + phone.slice(-2)
}

function sessionLabel(contact) {
  if (!contact.session_expires_at) return { text: 'Closed', cls: 'bg-gray-100 text-gray-500' }
  var open = new Date(contact.session_expires_at) > new Date()
  return open ? { text: 'Open', cls: 'bg-emerald-100 text-emerald-700' } : { text: 'Closed', cls: 'bg-gray-100 text-gray-500' }
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
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Phone (E.164)</label>
          <input type="text" value={phone} onChange={function (ev) { setPhone(ev.target.value) }}
            placeholder="+919876543210" className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Name</label>
          <input type="text" value={name} onChange={function (ev) { setName(ev.target.value) }}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Tags (comma-separated)</label>
          <input type="text" value={tags} onChange={function (ev) { setTags(ev.target.value) }}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        </div>
        <button onClick={save} disabled={saving || !phone.trim()}
          className="w-full py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">Save Contact</button>
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
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {result && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            Inserted {result.inserted}, updated {result.updated}, skipped (invalid phone) {result.skipped_invalid_phone}.
          </p>
        )}
        <p className="text-xs text-gray-500">Paste CSV content below (first row must be a header row with column names).</p>
        <textarea value={rawText} onChange={function (ev) { setRawText(ev.target.value) }} rows={8}
          placeholder={'phone,name\n+919876543210,Riya Sharma'}
          className="w-full px-2 py-1.5 text-xs font-mono border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase">Phone column name</label>
            <input type="text" value={phoneCol} onChange={function (ev) { setPhoneCol(ev.target.value) }}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase">Name column name</label>
            <input type="text" value={nameCol} onChange={function (ev) { setNameCol(ev.target.value) }}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
          </div>
        </div>
        <button onClick={doImport} disabled={saving || !rawText.trim()}
          className="w-full py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">Import</button>
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

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[440px] sm:shadow-2xl sm:border-l sm:border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <button onClick={onClose} className="text-sm text-indigo-600 font-medium">← Back</button>
        <span className="text-xs text-gray-400 capitalize">{contact.source}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <p className="text-base font-bold text-gray-900">{contact.name || 'Unnamed contact'}</p>
          <p className="text-sm text-gray-500 font-mono cursor-pointer" onClick={revealPhone}>
            {phoneRevealed ? contact.phone_e164 : maskPhone(contact.phone_e164)}
            {!phoneRevealed && <span className="text-[10px] text-indigo-600 ml-2">tap to reveal</span>}
          </p>
        </div>

        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Tags</label>
          <input type="text" value={tagsText} onChange={function (ev) { setTagsText(ev.target.value) }}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="text-[10px] font-bold text-gray-400 uppercase">Notes</label>
          <textarea value={notes} onChange={function (ev) { setNotes(ev.target.value) }} rows={2}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        </div>
        <button onClick={saveTagsNotes} disabled={saving} className="text-xs font-bold text-indigo-600">Save tags/notes</button>

        <div className="grid grid-cols-2 gap-3 text-sm border-t border-gray-100 pt-3">
          <div><p className="text-[10px] font-bold text-gray-400 uppercase">Opt status</p><p className="text-gray-900 capitalize">{contact.opt_status}</p></div>
          <div><p className="text-[10px] font-bold text-gray-400 uppercase">Session</p><p className="text-gray-900">{sessionLabel(contact).text}</p></div>
          <div><p className="text-[10px] font-bold text-gray-400 uppercase">Last sent</p><p className="text-gray-900">{contact.last_sent_at ? formatDate(contact.last_sent_at) : '—'}</p></div>
          <div><p className="text-[10px] font-bold text-gray-400 uppercase">Last received</p><p className="text-gray-900">{contact.last_received_at ? formatDate(contact.last_received_at) : '—'}</p></div>
        </div>

        {contact.external_ids && Object.keys(contact.external_ids).length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">External IDs</p>
            <p className="text-xs text-gray-500 font-mono">{JSON.stringify(contact.external_ids)}</p>
          </div>
        )}

        <div className="border-t border-gray-100 pt-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Message History</p>
          {loadingMsgs ? <p className="text-xs text-gray-400">Loading...</p>
            : messages.length === 0 ? <p className="text-xs text-gray-400">No messages yet</p>
            : (
              <div className="space-y-2">
                {messages.map(function (m) {
                  return (
                    <div key={m.id} className={"text-xs p-2 rounded-lg " + (m.direction === 'out' ? "bg-indigo-50 text-gray-800" : "bg-gray-100 text-gray-700")}>
                      <p>{m.rendered_body || '(template message)'}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{m.direction === 'out' ? '→' : '←'} {m.status} · {formatDate(m.created_at)}</p>
                    </div>
                  )
                })}
              </div>
            )}
        </div>

        {contact.opt_status !== 'opted_out' && (
          <button onClick={optOut} disabled={saving} className="text-xs font-bold text-red-600">Opt out this contact</button>
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

  async function pullFromContracts() {
    if (pulling) return
    setPulling(true); setPullMsg('')
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    var res = await supabase.functions.invoke('lms-contacts-pull', {
      body: {}, headers: token ? { Authorization: 'Bearer ' + token } : {},
    })
    setPulling(false)
    if (res.error) { setPullMsg('Pull failed: ' + res.error.message); return }
    var d = res.data || {}
    setPullMsg('Pulled ' + d.total_candidates + ' contract contacts — ' + d.inserted + ' new, ' + d.updated + ' updated, ' + d.skipped_invalid_phone + ' invalid phone.')
    loadContacts()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Contacts</h2>
          <p className="text-xs text-gray-400">{filtered.length} of {contacts.length}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canImport && (
            <button onClick={pullFromContracts} disabled={pulling}
              className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg disabled:opacity-50">
              {pulling ? 'Pulling...' : 'Pull from Contracts'}
            </button>
          )}
          {canImport && (
            <button onClick={function () { setCsvOpen(true) }} className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg">Import CSV</button>
          )}
          {canEdit && (
            <button onClick={function () { setAddOpen(true) }} className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg">+ Add Contact</button>
          )}
        </div>
      </div>

      {pullMsg && <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{pullMsg}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={search} onChange={function (ev) { setSearch(ev.target.value) }}
          placeholder="Search name or phone..." className="min-w-[180px] px-2 py-1.5 text-xs border border-gray-200 rounded-md" style={{ fontSize: '16px' }} />
        <select value={sourceFilter} onChange={function (ev) { setSourceFilter(ev.target.value) }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
          <option value="">All sources</option>
          {SOURCE_OPTIONS.map(function (s) { return <option key={s} value={s}>{s}</option> })}
        </select>
        <select value={optStatusFilter} onChange={function (ev) { setOptStatusFilter(ev.target.value) }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
          <option value="">All opt statuses</option>
          {OPT_STATUS_OPTIONS.map(function (s) { return <option key={s} value={s}>{s}</option> })}
        </select>
        <select value={venueFilter} onChange={function (ev) { setVenueFilter(ev.target.value) }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
          <option value="">All venues</option>
          {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left">
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Name</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Phone</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Source</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Tags</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Opt Status</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Last Sent</th>
              <th className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase">Session</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center text-xs text-gray-400 py-6">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-xs text-gray-400 py-6">No contacts</td></tr>
            ) : filtered.map(function (c) {
              var sess = sessionLabel(c)
              return (
                <tr key={c.id} onClick={function () { setDetail(c) }} className="border-b border-gray-50 last:border-b-0 cursor-pointer hover:bg-indigo-50/30">
                  <td className="px-3 py-2 font-medium text-gray-900">{c.name || '—'}</td>
                  <td className="px-3 py-2 font-mono text-gray-500">{maskPhone(c.phone_e164)}</td>
                  <td className="px-3 py-2 text-gray-500 capitalize">{c.source}</td>
                  <td className="px-3 py-2 text-gray-500">{(c.tags || []).join(', ') || '—'}</td>
                  <td className="px-3 py-2"><span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{c.opt_status}</span></td>
                  <td className="px-3 py-2 text-gray-500">{c.last_sent_at ? formatDate(c.last_sent_at) : '—'}</td>
                  <td className="px-3 py-2"><span className={"text-[10px] font-bold px-1.5 py-0.5 rounded " + sess.cls}>{sess.text}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
