import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import { formatDate } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import Icon from '../../components/ui/Icon'
import SearchField from '../../components/ui/SearchField'
import { CTRL, TEXTAREA, BTN_GHOST, BTN_PRIMARY, BTN_DANGER, TH, TD, CARD, Chip, Labeled, Notice, EmptyState, CHIP_INFO, CHIP_NEUTRAL } from './ui'

var SOURCE_OPTIONS = ['', 'lms', 'contract', 'csv', 'manual', 'inbound']

// A saved audience for campaigns — the same two shapes
// fn_wa_resolve_audience (migration 00028) already knows how to resolve:
// 'static' is exact membership (wa_list_members), 'dynamic' is a filter
// re-evaluated live at send time (same filter_json shape the campaign
// builder's own ad-hoc audience already uses). This screen is the CRUD UI
// for wa_contact_lists/wa_list_members that was deferred when the tables
// were first built (see Contacts.jsx's top-of-file note).
function ListFormModal({ open, list, onClose, onSaved }) {
  var isEdit = !!list
  var [name, setName] = useState(list ? list.name : '')
  var [description, setDescription] = useState(list ? (list.description || '') : '')
  var [type, setType] = useState(list ? list.type : 'static')
  var [tagsText, setTagsText] = useState(list && list.filter_json ? (list.filter_json.tags || []).join(', ') : '')
  var [source, setSource] = useState(list && list.filter_json ? (list.filter_json.source || '') : '')
  var [minDays, setMinDays] = useState(list && list.filter_json && list.filter_json.min_last_sent_days != null ? String(list.filter_json.min_last_sent_days) : '')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  useEffect(function () {
    if (!open) return
    setName(list ? list.name : '')
    setDescription(list ? (list.description || '') : '')
    setType(list ? list.type : 'static')
    var f = (list && list.filter_json) || {}
    setTagsText((f.tags || []).join(', '))
    setSource(f.source || '')
    setMinDays(f.min_last_sent_days != null ? String(f.min_last_sent_days) : '')
    setError('')
  }, [open, list])

  async function save() {
    if (saving || !name.trim()) return
    setSaving(true); setError('')
    var payload = { name: name.trim(), description: description.trim() || null, type: type }
    if (type === 'dynamic') {
      var tags = tagsText.split(',').map(function (t) { return t.trim() }).filter(Boolean)
      var filter = {}
      if (tags.length > 0) filter.tags = tags
      if (source) filter.source = source
      if (minDays) filter.min_last_sent_days = Number(minDays)
      payload.filter_json = filter
    } else {
      payload.filter_json = null
    }
    var res = isEdit
      ? await supabase.from('wa_contact_lists').update(payload).eq('id', list.id).select().single()
      : await supabase.from('wa_contact_lists').insert(payload).select().single()
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    onSaved(res.data)
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit List' : 'New List'}>
      <div className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        <Labeled label="Name">
          <input type="text" value={name} onChange={function (ev) { setName(ev.target.value) }}
            placeholder="Diwali Regulars" className={CTRL} />
        </Labeled>
        <Labeled label="Description (optional)">
          <input type="text" value={description} onChange={function (ev) { setDescription(ev.target.value) }}
            placeholder="What this list is for" className={CTRL} />
        </Labeled>
        <Labeled label="Type">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={function () { setType('static') }}
              className={'h-10 rounded-xl text-[13px] font-bold border transition-colors ' +
                (type === 'static' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50')}>
              Static
            </button>
            <button type="button" onClick={function () { setType('dynamic') }}
              className={'h-10 rounded-xl text-[13px] font-bold border transition-colors ' +
                (type === 'dynamic' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50')}>
              Dynamic
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 leading-snug">
            {type === 'static'
              ? 'An exact set of contacts you add by hand — manage members from Contacts, or after saving.'
              : 'Anyone matching this filter, re-checked every time a campaign uses it — no membership to maintain.'}
          </p>
        </Labeled>
        {type === 'dynamic' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="sm:col-span-2">
              <Labeled label="Tags" hint="Comma-separated — a contact matching any of them is included">
                <input type="text" value={tagsText} onChange={function (ev) { setTagsText(ev.target.value) }}
                  placeholder="delhi, wedding" className={CTRL} />
              </Labeled>
            </div>
            <Labeled label="Source">
              <select value={source} onChange={function (ev) { setSource(ev.target.value) }} className={CTRL}>
                {SOURCE_OPTIONS.map(function (s) { return <option key={s} value={s}>{s || 'Any'}</option> })}
              </select>
            </Labeled>
            <Labeled label="Min days since last sent">
              <input type="number" min="0" value={minDays} onChange={function (ev) { setMinDays(ev.target.value) }}
                placeholder="e.g. 30" className={CTRL} />
            </Labeled>
          </div>
        )}
        <button onClick={save} disabled={saving || !name.trim()} className={BTN_PRIMARY + ' w-full h-10'}>
          <Icon name="check" size={14} strokeWidth={2.3} />
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create List'}
        </button>
      </div>
    </Modal>
  )
}

// Static lists only — dynamic lists have no membership to manage, their
// filter_json (edited in ListFormModal) is the whole story.
function MembersModal({ open, list, onClose, onChanged }) {
  var [members, setMembers] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [results, setResults] = useState([])
  var [searching, setSearching] = useState(false)
  var [busyId, setBusyId] = useState(null)

  function loadMembers() {
    if (!list) return
    setLoading(true)
    supabase.from('wa_list_members').select('contact_id, wa_contacts(id, name, phone_e164, source)').eq('list_id', list.id)
      .then(function (res) { setMembers((res.data || []).map(function (r) { return r.wa_contacts }).filter(Boolean)); setLoading(false) })
  }

  useEffect(function () { if (open) loadMembers() }, [open, list])

  useEffect(function () {
    if (!open || !search.trim()) { setResults([]); return }
    setSearching(true)
    var q = search.trim()
    var t = setTimeout(function () {
      supabase.from('wa_contacts').select('id, name, phone_e164, source')
        .or('name.ilike.%' + q + '%,phone_e164.ilike.%' + q + '%').limit(15)
        .then(function (res) { setResults(res.data || []); setSearching(false) })
    }, 250)
    return function () { clearTimeout(t) }
  }, [search, open])

  var memberIds = members.map(function (m) { return m.id })

  async function addMember(contact) {
    setBusyId(contact.id)
    var res = await supabase.from('wa_list_members').upsert({ list_id: list.id, contact_id: contact.id }, { onConflict: 'list_id,contact_id' })
    setBusyId(null)
    if (!res.error) { loadMembers(); onChanged() }
  }

  async function removeMember(contactId) {
    setBusyId(contactId)
    var res = await supabase.from('wa_list_members').delete().eq('list_id', list.id).eq('contact_id', contactId)
    setBusyId(null)
    if (!res.error) { loadMembers(); onChanged() }
  }

  if (!list) return null
  var addable = results.filter(function (c) { return memberIds.indexOf(c.id) === -1 })

  return (
    <Modal open={open} onClose={onClose} title={'Members — ' + list.name} wide>
      <div className="space-y-4">
        <div>
          <SearchField value={search} onChange={setSearch} placeholder="Search contacts by name or phone to add..." />
          {search.trim() && (
            <div className="mt-2 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto ambria-thin-scroll">
              {searching ? (
                <p className="px-3 py-2.5 text-[12px] text-slate-400">Searching…</p>
              ) : addable.length === 0 ? (
                <p className="px-3 py-2.5 text-[12px] text-slate-400">No matches (or already a member)</p>
              ) : addable.map(function (c) {
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 text-[13px] text-slate-800 truncate">
                      {c.name || <span className="text-slate-400">Unnamed</span>}
                      <span className="text-slate-400 font-mono text-[11.5px] ml-1.5" data-notranslate>{c.phone_e164}</span>
                    </span>
                    <button onClick={function () { addMember(c) }} disabled={busyId === c.id}
                      className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11.5px] font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 transition-colors">
                      <Icon name="plus" size={12} strokeWidth={2.5} />
                      Add
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
            {loading ? 'Loading…' : members.length + ' member' + (members.length === 1 ? '' : 's')}
          </p>
          {!loading && members.length === 0 ? (
            <EmptyState icon="users" title="No members yet" hint="Search above to add contacts, or select contacts in Contacts and use Add to list." />
          ) : (
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-64 overflow-y-auto ambria-thin-scroll">
              {members.map(function (c) {
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 text-[13px] text-slate-800 truncate">
                      {c.name || <span className="text-slate-400">Unnamed</span>}
                      <span className="text-slate-400 font-mono text-[11.5px] ml-1.5" data-notranslate>{c.phone_e164}</span>
                    </span>
                    <button onClick={function () { removeMember(c.id) }} disabled={busyId === c.id}
                      className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11.5px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                      <Icon name="close" size={12} strokeWidth={2.5} />
                      Remove
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Lists({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canEdit = hasPerm(permsNew, 'broadcast.contacts.edit')

  var [lists, setLists] = useState([])
  var [counts, setCounts] = useState({})
  var [loading, setLoading] = useState(true)
  var [formOpen, setFormOpen] = useState(false)
  var [editing, setEditing] = useState(null)
  var [membersFor, setMembersFor] = useState(null)

  function load() {
    setLoading(true)
    supabase.from('wa_contact_lists').select('*').order('created_at', { ascending: false })
      .then(function (res) {
        var rows = res.data || []
        setLists(rows)
        setLoading(false)
        var staticIds = rows.filter(function (l) { return l.type === 'static' }).map(function (l) { return l.id })
        if (staticIds.length === 0) { setCounts({}); return }
        supabase.from('wa_list_members').select('list_id').in('list_id', staticIds)
          .then(function (r2) {
            var c = {}
            ;(r2.data || []).forEach(function (row) { c[row.list_id] = (c[row.list_id] || 0) + 1 })
            setCounts(c)
          })
      })
  }

  useEffect(function () { load() }, [])

  function openNew() { setEditing(null); setFormOpen(true) }
  function openEdit(l) { setEditing(l); setFormOpen(true) }

  async function remove(l) {
    if (!window.confirm('Delete "' + l.name + '"? Campaigns already sent from it keep their history; this only removes the list itself.')) return
    var res = await supabase.from('wa_contact_lists').delete().eq('id', l.id)
    if (!res.error) load()
  }

  function filterSummary(l) {
    var f = l.filter_json || {}
    var parts = []
    if (f.tags && f.tags.length > 0) parts.push('tags: ' + f.tags.join(', '))
    if (f.source) parts.push('source: ' + f.source)
    if (f.min_last_sent_days != null) parts.push('idle ' + f.min_last_sent_days + 'd+')
    return parts.length > 0 ? parts.join(' · ') : 'Everyone (no filter)'
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-extrabold text-slate-900 leading-tight tracking-[-0.015em]">Lists</h2>
          <p className="text-[11.5px] text-slate-500 mt-0.5">Saved audiences campaigns can target directly, instead of rebuilding a filter each time.</p>
        </div>
        {canEdit && (
          <button onClick={openNew} className={BTN_PRIMARY}>
            <Icon name="plus" size={14} strokeWidth={2.4} />
            New List
          </button>
        )}
      </div>

      <div className={CARD + ' overflow-hidden'}>
        <div className="overflow-x-auto ambria-thin-scroll">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className={TH}>Name</th>
                <th className={TH}>Type</th>
                <th className={TH}>Audience</th>
                <th className={TH}>Created</th>
                <th className={TH + ' w-40'}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center text-[12px] text-slate-400 py-8">Loading…</td></tr>
              ) : lists.length === 0 ? (
                <tr><td colSpan={5}>
                  <EmptyState icon="list" title="No lists yet" hint="Create one to save an audience — a fixed set of contacts, or a filter that stays live." />
                </td></tr>
              ) : lists.map(function (l) {
                return (
                  <tr key={l.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className={TD + ' font-semibold text-slate-900'}>
                      {l.name}
                      {l.description && <span className="block text-[11px] font-normal text-slate-400 mt-0.5">{l.description}</span>}
                    </td>
                    <td className={TD}><Chip tone={l.type === 'static' ? CHIP_NEUTRAL : CHIP_INFO}>{l.type}</Chip></td>
                    <td className={TD + ' text-slate-600'}>
                      {l.type === 'static' ? (counts[l.id] || 0) + ' member' + ((counts[l.id] || 0) === 1 ? '' : 's') : filterSummary(l)}
                    </td>
                    <td className={TD + ' text-slate-500 whitespace-nowrap'}>{formatDate(l.created_at)}</td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1.5">
                        {l.type === 'static' && canEdit && (
                          <button onClick={function () { setMembersFor(l) }} className={BTN_GHOST}>
                            <Icon name="users" size={13} />
                            Members
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={function () { openEdit(l) }} title="Edit"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                            <Icon name="edit" size={14} />
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={function () { remove(l) }} title="Delete"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Icon name="trash" size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ListFormModal open={formOpen} list={editing} onClose={function () { setFormOpen(false) }}
        onSaved={function () { setFormOpen(false); load() }} />
      <MembersModal open={!!membersFor} list={membersFor} onClose={function () { setMembersFor(null) }}
        onChanged={load} />
    </div>
  )
}

export default Lists
