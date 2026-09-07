import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/ui/Modal'
import SearchDropdown from '../../components/ui/SearchDropdown'
import { logActivity } from '../../lib/logger'
import { formatDate, formatDateTime } from '../../lib/format'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import VoiceInput from '../../components/ui/VoiceInput'
import EventDatePicker from '../../components/ui/EventDatePicker'

function byName(a, b) { return (a.name || '').localeCompare(b.name || '') }

var PARTY_TYPES = [
  { key: 'expense', label: 'Expense Type', icon: 'ti-receipt' },
  { key: 'event', label: 'Event', icon: 'ti-calendar-event' },
  { key: 'vendor', label: 'Vendor', icon: 'ti-building-store' },
  { key: 'employee', label: 'Employee', icon: 'ti-user' },
]

// Transfers only ever move cost between expense types now (no event/vendor/employee
// parties for new transfers) — one From, and one-or-many To rows so a single source
// can be split across several destination types in one go.
function makeToRow() {
  return { _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8), expense_type_id: '', expense_sub_type_id: '', meta: {}, amount_pts: '', remarks: '' }
}
function makeEmptyForm() {
  return {
    from: { expense_type_id: '', expense_sub_type_id: '', meta: {} },
    to_rows: [makeToRow()],
    description: '',
    effective_date: new Date().toISOString().substring(0, 10),
  }
}

function CostTransfers({ profile }) {
  var canCreate = hasPerm(profile?.permsNew, 'finance.cost_transfers')
  var [transfers, setTransfers] = useState([])
  var [loading, setLoading] = useState(true)
  var [showForm, setShowForm] = useState(false)
  var [saving, setSaving] = useState(false)
  var [reversing, setReversing] = useState(null)
  var [error, setError] = useState('')

  var [events, setEvents] = useState([])
  var [vendors, setVendors] = useState([])
  var [jobDepts, setJobDepts] = useState([])
  var refData = useReferenceData()
  var employees = refData.employees
  var expTypes = refData.expenseTypes.filter(function (t) { return t.active }).slice().sort(byName)
  var expSubTypes = refData.expenseSubTypes.filter(function (t) { return t.active }).slice().sort(byName)
  var venues = refData.venues.filter(function (v) { return v.active }).slice().sort(byName)
  var [categories, setCategories] = useState([])

  var [form, setForm] = useState(makeEmptyForm)

  // "For a Function?" — optional event tag applied to the whole transfer (both From and
  // every To row), mirroring the toggle on the expense submit form.
  var [isFunction, setIsFunction] = useState(false)
  var [eventDate, setEventDate] = useState('')
  var [eventId, setEventId] = useState('')
  var [formEvents, setFormEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)

  async function loadEventsByDate(dateStr) {
    if (!dateStr) { setFormEvents([]); setEventId(''); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, contract_type, venue_name, session, client_name, department, contract_no, created_user_name')
      .eq('function_date', dateStr)
      .order('event_name')
    var rows = data || []
    setFormEvents(rows)
    setEventsLoading(false)
    if (rows.length === 1) setEventId(String(rows[0].id))
    else if (!rows.some(function (r) { return String(r.id) === eventId })) setEventId('')
  }

  function toggleFunction(val) {
    setIsFunction(val)
    if (!val) { setEventId(''); setEventDate(''); setFormEvents([]) }
  }

  // Filters
  var [fromPartyFilter, setFromPartyFilter] = useState('')
  var [toPartyFilter, setToPartyFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('active') // 'all' | 'active' | 'reversed' | 'reversal'
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [searchRaw, setSearchRaw] = useState('')
  var [searchD, setSearchD] = useState('')
  var [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(function () {
    var t = setTimeout(function () { setSearchD(searchRaw) }, 400)
    return function () { clearTimeout(t) }
  }, [searchRaw])

  useEffect(function () { loadLookups() }, [])

  useEffect(function () { loadTransfers() }, [fromPartyFilter, toPartyFilter, statusFilter, dateFrom, dateTo, searchD])

  // Realtime: refresh list on any cost_transfers change
  useEffect(function () {
    var channel = supabase.channel('cost_transfers_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cost_transfers' }, function () { loadTransfers() })
      .subscribe()
    return function () { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPartyFilter, toPartyFilter, statusFilter, dateFrom, dateTo, searchD])

  async function loadLookups() {
    try {
      var results = await Promise.all([
        supabase.from('events').select('id, function_date, event_name, client_name').order('function_date', { ascending: false }).limit(500),
        supabase.from('vendors').select('id, name, category_ids').eq('active', true).order('name'),
        supabase.from('job_departments').select('id, name').order('name'),
        supabase.from('categories').select('id, sub_department_id').order('id'),
      ])
      setEvents(results[0].data || [])
      setVendors(results[1].data || [])
      setJobDepts(results[2].data || [])
      setCategories(results[3].data || [])
    } catch (_) { setError('Lookup load failed') }
  }

  async function loadTransfers() {
    setLoading(true)
    try {
      var q = supabase.from('cost_transfers').select('*').order('created_at', { ascending: false }).limit(500)
      if (fromPartyFilter) q = q.eq('from_party_type', fromPartyFilter)
      if (toPartyFilter) q = q.eq('to_party_type', toPartyFilter)
      if (dateFrom) q = q.gte('effective_date', dateFrom)
      if (dateTo) q = q.lte('effective_date', dateTo)
      if (searchD) q = q.ilike('description', '%' + searchD + '%')
      if (statusFilter === 'active') q = q.is('reversal_of', null).is('reversed_by_id', null)
      else if (statusFilter === 'reversed') q = q.not('reversed_by_id', 'is', null)
      else if (statusFilter === 'reversal') q = q.not('reversal_of', 'is', null)
      var res = await q
      if (res.error) throw res.error
      setTransfers(res.data || [])
    } catch (err) { setError(err.message || 'Load failed') }
    setLoading(false)
  }

  function resetFilters() {
    setFromPartyFilter(''); setToPartyFilter('')
    setStatusFilter('active')
    setDateFrom(''); setDateTo('')
    setSearchRaw('')
  }

  function activeFilterCount() {
    var n = 0
    if (fromPartyFilter) n++
    if (toPartyFilter) n++
    if (statusFilter !== 'active') n++
    if (dateFrom) n++
    if (dateTo) n++
    if (searchRaw) n++
    return n
  }

  function partyLabel(row, side) {
    var t = row[side + '_party_type']
    if (t === 'expense') {
      var et = expTypes.find(function (x) { return x.id === row[side + '_expense_type_id'] })
      var est = row[side + '_expense_sub_type_id'] ? expSubTypes.find(function (x) { return x.id === row[side + '_expense_sub_type_id'] }) : null
      var name = et ? et.name : ('Type#' + row[side + '_expense_type_id'])
      return est ? (name + ' → ' + est.name) : name
    }
    if (t === 'event') {
      var ev = events.find(function (x) { return x.id === row[side + '_event_id'] })
      if (!ev) return 'Event#' + row[side + '_event_id']
      return (ev.event_name || ev.client_name || 'Event') + ' · ' + (ev.function_date || '')
    }
    if (t === 'vendor') {
      var vd = vendors.find(function (x) { return x.id === row[side + '_vendor_id'] })
      return vd ? vd.name : ('Vendor#' + row[side + '_vendor_id'])
    }
    if (t === 'employee') {
      var em = employees.find(function (x) { return x.id === row[side + '_employee_id'] })
      return em ? em.full_name : 'Employee'
    }
    return t
  }

  function partyMeta(row, side) {
    if (row[side + '_party_type'] !== 'expense') return null
    var meta = row[side + '_meta'] || {}
    var items = []
    if (meta._event_name) items.push({ label: 'Event', value: '🎯 ' + meta._event_name })
    var subId = row[side + '_expense_sub_type_id']
    var picked = subId ? expSubTypes.find(function (x) { return x.id === subId }) : null
    if (picked && Array.isArray(picked.extra_fields)) {
      picked.extra_fields.forEach(function (f) {
        if (f.type !== 'lookup' || !f.source) return
        var val = meta[f.key]
        if (val === '' || val == null) return
        var label = ''
        if (f.source === 'vendors') {
          var vd = vendors.find(function (x) { return String(x.id) === String(val) })
          label = vd ? vd.name : ('#' + val)
        } else if (f.source === 'venues') {
          var vn = venues.find(function (x) { return String(x.id) === String(val) })
          label = vn ? (vn.code ? vn.code + ' — ' + vn.name : vn.name) : ('#' + val)
        } else if (f.source === 'job_departments') {
          var emp = employees.find(function (x) { return String(x.id) === String(val) })
          label = emp ? emp.full_name : ('#' + val)
        }
        if (label) items.push({ label: f.label, value: label })
      })
    }
    if (items.length === 0) return null
    return (
      <div className="mt-1 space-y-0.5">
        {items.map(function (it, i) {
          return (
            <div key={i} className="text-[10px] text-gray-500">
              <span className="font-medium">{it.label}:</span> {it.value}
            </div>
          )
        })}
      </div>
    )
  }

  function updForm(patch) {
    setForm(function (p) { return Object.assign({}, p, patch) })
  }
  function updFrom(patch) {
    setForm(function (p) { return Object.assign({}, p, { from: Object.assign({}, p.from, patch) }) })
  }
  function updToRow(idx, patch) {
    setForm(function (p) {
      var rows = p.to_rows.map(function (r, i) { return i === idx ? Object.assign({}, r, patch) : r })
      return Object.assign({}, p, { to_rows: rows })
    })
  }
  function addToRow() {
    setForm(function (p) { return Object.assign({}, p, { to_rows: p.to_rows.concat([makeToRow()]) }) })
  }
  function removeToRow(idx) {
    setForm(function (p) {
      if (p.to_rows.length <= 1) return p
      return Object.assign({}, p, { to_rows: p.to_rows.filter(function (_, i) { return i !== idx }) })
    })
  }

  function validExpense(v) { return !!v.expense_type_id }

  function validMeta(v) {
    var subId = Number(v.expense_sub_type_id) || 0
    if (!subId) return true
    var picked = expSubTypes.find(function (s) { return s.id === subId })
    if (!picked || !Array.isArray(picked.extra_fields)) return true
    var meta = v.meta || {}
    var required = picked.extra_fields.filter(function (ef) { return ef.type === 'lookup' && ef.source && ef.required })
    for (var i = 0; i < required.length; i++) {
      var val = meta[required[i].key]
      if (!val && val !== 0) return false
    }
    return true
  }

  function sameExpense(a, b) {
    return String(a.expense_type_id) === String(b.expense_type_id) && String(a.expense_sub_type_id || '') === String(b.expense_sub_type_id || '')
  }

  var toTotalPaise = form.to_rows.reduce(function (s, r) { return s + Math.round((Number(r.amount_pts) || 0) * 100) }, 0)

  async function handleSave() {
    if (saving) return
    setError('')
    if (!form.description.trim()) { setError('Description required'); return }
    if (!validExpense(form.from)) { setError('Select a From expense type'); return }
    if (!validMeta(form.from)) { setError('Fill required fields for From'); return }
    for (var i = 0; i < form.to_rows.length; i++) {
      var row = form.to_rows[i]
      if (!validExpense(row)) { setError('Row ' + (i + 1) + ': select an expense type'); return }
      if (!validMeta(row)) { setError('Row ' + (i + 1) + ': fill required fields'); return }
      if (!Number(row.amount_pts) || Number(row.amount_pts) <= 0) { setError('Row ' + (i + 1) + ': amount must be positive'); return }
      if (sameExpense(form.from, row)) { setError('Row ' + (i + 1) + ': To cannot be the same as From'); return }
    }

    setSaving(true)
    var selEvent = (isFunction && eventId) ? formEvents.find(function (e) { return String(e.id) === eventId }) : null
    var eventTag = selEvent ? { _event_id: selEvent.id, _event_name: selEvent.event_name } : null
    var fromMetaOut = eventTag ? Object.assign({}, form.from.meta || {}, eventTag) : (form.from.meta || {})

    var okCount = 0
    for (var j = 0; j < form.to_rows.length; j++) {
      var r = form.to_rows[j]
      var amt = Number(r.amount_pts)
      var toMetaOut = eventTag ? Object.assign({}, r.meta || {}, eventTag) : (r.meta || {})
      var rowDesc = form.description.trim() + (r.remarks && r.remarks.trim() ? ' — ' + r.remarks.trim() : '')
      try {
        var res = await supabase.rpc('fn_create_cost_transfer', {
          p_amount_paise: Math.round(amt * 100),
          p_from_party_type: 'expense',
          p_from_expense_type_id: Number(form.from.expense_type_id),
          p_from_expense_sub_type_id: form.from.expense_sub_type_id ? Number(form.from.expense_sub_type_id) : null,
          p_from_event_id: null,
          p_from_vendor_id: null,
          p_from_employee_id: null,
          p_to_party_type: 'expense',
          p_to_expense_type_id: Number(r.expense_type_id),
          p_to_expense_sub_type_id: r.expense_sub_type_id ? Number(r.expense_sub_type_id) : null,
          p_to_event_id: null,
          p_to_vendor_id: null,
          p_to_employee_id: null,
          p_description: rowDesc,
          p_reason_note: null,
          p_effective_date: form.effective_date,
          p_from_meta: fromMetaOut,
          p_to_meta: toMetaOut,
        })
        if (res.error) throw res.error
        try { logActivity('COST_TRANSFER_CREATE', '#' + res.data + ' Rs ' + amt.toFixed(2)) } catch (_) {}
        okCount++
      } catch (err) {
        setError((okCount > 0 ? okCount + ' of ' + form.to_rows.length + ' transfers were created before this failed — ' : '') +
          'Row ' + (j + 1) + ': ' + (err.message || 'Save failed'))
        setSaving(false)
        loadTransfers()
        return
      }
    }
    setShowForm(false)
    setForm(makeEmptyForm())
    toggleFunction(false)
    loadTransfers()
    setSaving(false)
  }

  async function handleReverse(id) {
    if (reversing) return
    if (!window.confirm('Reverse this cost transfer? A new offsetting entry will be created.')) return
    setReversing(id)
    setError('')
    try {
      var res = await supabase.rpc('fn_reverse_cost_transfer', { p_id: id })
      if (res.error) throw res.error
      try { logActivity('COST_TRANSFER_REVERSE', '#' + id) } catch (_) {}
      loadTransfers()
    } catch (err) { setError(err.message || 'Reverse failed') }
    setReversing(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Move cost between expense types without touching wallet.</p>
        {canCreate && (
          <button onClick={function () { setForm(makeEmptyForm()); toggleFunction(false); setError(''); setShowForm(true) }}
            className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
            <i className="ti ti-plus" style={{ fontSize: '14px', marginRight: '4px' }} aria-hidden="true"></i>
            New Transfer
          </button>
        )}
      </div>

      {error && !showForm && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
      )}

      {/* ─── FILTERS ─────────────────────────────────── */}
      <div className="mb-3 space-y-2">
        <input type="text" value={searchRaw} onChange={function (e) { setSearchRaw(e.target.value) }}
          placeholder="Search description..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
        <div className="flex gap-2">
          <button onClick={function () { setFiltersOpen(!filtersOpen) }}
            className={"flex-1 py-2 text-xs font-bold rounded-lg border transition-colors " + (filtersOpen ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
            {filtersOpen ? '▲' : '▼'} Filters{activeFilterCount() > 0 ? ' · ' + activeFilterCount() : ''}
          </button>
          {activeFilterCount() > 0 && (
            <button onClick={resetFilters}
              className="px-3 py-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100">
              Reset
            </button>
          )}
        </div>
        {filtersOpen && (
          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Status</label>
              <div className="flex gap-1.5 flex-wrap">
                {['all', 'active', 'reversed', 'reversal'].map(function (s) {
                  var lbl = s === 'all' ? 'All' : (s === 'active' ? 'Active' : (s === 'reversed' ? 'Reversed' : 'Reversal'))
                  return (
                    <button key={s} onClick={function () { setStatusFilter(s) }}
                      className={"px-3 py-1.5 text-[11px] font-bold rounded-full border " +
                        (statusFilter === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                      {lbl}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From (party)</label>
                <select value={fromPartyFilter} onChange={function (e) { setFromPartyFilter(e.target.value) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  style={{ fontSize: '16px' }}>
                  <option value="">All</option>
                  {PARTY_TYPES.map(function (p) { return <option key={p.key} value={p.key}>{p.label}</option> })}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To (party)</label>
                <select value={toPartyFilter} onChange={function (e) { setToPartyFilter(e.target.value) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  style={{ fontSize: '16px' }}>
                  <option value="">All</option>
                  {PARTY_TYPES.map(function (p) { return <option key={p.key} value={p.key}>{p.label}</option> })}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From date</label>
                <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To date</label>
                <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  style={{ fontSize: '16px' }} />
              </div>
            </div>
          </div>
        )}
        {!loading && transfers.length > 0 && (
          <div className="px-1 text-xs text-gray-600">
            <span className="font-semibold text-gray-900">{transfers.length}</span> shown
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-8">Loading...</p>
      ) : transfers.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">{activeFilterCount() > 0 ? 'No transfers match filters.' : 'No cost transfers yet.'}</p>
      ) : (
        <>
          <div className="hidden sm:block bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">From</th>
                  <th className="text-left px-3 py-2">To</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Description</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transfers.map(function (r) {
                  var isReversed = r.reversed_by_id != null
                  var isReversal = r.reversal_of != null
                  var canReverse = canCreate && !isReversed && !isReversal
                  return (
                    <tr key={r.id} className={isReversed ? "bg-gray-50 text-gray-400" : ""}>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {formatDate(r.effective_date)}
                        <div className="text-[10px] text-gray-400">Logged {formatDateTime(r.created_at)}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{partyLabel(r, 'from')}{partyMeta(r, 'from')}</td>
                      <td className="px-3 py-2 text-xs">{partyLabel(r, 'to')}{partyMeta(r, 'to')}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                        Rs {(r.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.description}
                        {isReversal && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">Reversal</span>}
                        {isReversed && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 uppercase">Reversed</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canReverse ? (
                          <button onClick={function () { handleReverse(r.id) }} disabled={reversing === r.id}
                            className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-300">
                            {reversing === r.id ? 'Reversing...' : 'Reverse'}
                          </button>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="sm:hidden space-y-2">
            {transfers.map(function (r) {
              var isReversed = r.reversed_by_id != null
              var isReversal = r.reversal_of != null
              var canReverse = canCreate && !isReversed && !isReversal
              return (
                <div key={r.id} className={"bg-white border border-gray-200 rounded-lg p-3 space-y-1.5 " + (isReversed ? "opacity-60" : "")}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{formatDate(r.effective_date)}</span>
                    <span className="font-mono text-sm font-semibold text-gray-800">
                      Rs {(r.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-400">Logged {formatDateTime(r.created_at)}</div>
                  <div className="text-xs text-gray-700">
                    <span className="font-medium">{partyLabel(r, 'from')}{partyMeta(r, 'from')}</span>
                    <span className="mx-1 text-gray-400">→</span>
                    <span className="font-medium">{partyLabel(r, 'to')}{partyMeta(r, 'to')}</span>
                  </div>
                  {r.description && <div className="text-xs text-gray-500">{r.description}</div>}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex gap-1">
                      {isReversal && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">Reversal</span>}
                      {isReversed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 uppercase">Reversed</span>}
                    </div>
                    {canReverse && (
                      <button onClick={function () { handleReverse(r.id) }} disabled={reversing === r.id}
                        className="text-xs text-red-600 hover:text-red-800 disabled:text-gray-300 font-medium">
                        {reversing === r.id ? 'Reversing...' : 'Reverse'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <Modal open={showForm} onClose={function () { setShowForm(false) }} title="New Cost Transfer">
        <div className="space-y-4">
          {/* For a Function? */}
          <div className="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">For a Function?</label>
              <button type="button" onClick={function () { toggleFunction(!isFunction) }} className="flex items-center gap-2">
                <div className={"relative w-9 h-5 rounded-full transition-colors " + (isFunction ? "bg-indigo-500" : "bg-gray-300")}>
                  <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (isFunction ? "translate-x-4" : "translate-x-0.5")} />
                </div>
              </button>
            </div>
            {isFunction && (
              <div className="space-y-2">
                <EventDatePicker label="Function Date" value={eventDate}
                  onChange={function (dateStr) { setEventDate(dateStr); loadEventsByDate(dateStr) }} />
                {eventsLoading && <p className="text-xs text-gray-400">Loading events...</p>}
                {eventDate && !eventsLoading && formEvents.length === 0 && <p className="text-xs text-gray-400">No events on this date</p>}
                {formEvents.length > 0 && (
                  <select value={eventId} onChange={function (e) { setEventId(e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300" style={{ fontSize: '16px' }}>
                    <option value="">Select event...</option>
                    {formEvents.map(function (ev) {
                      var deptTag = ev.department ? ' [' + ev.department + ']' : ''
                      var ctNo = ev.contract_no ? ' #' + ev.contract_no : ''
                      var by = ev.created_user_name ? ' · by ' + ev.created_user_name : ''
                      return <option key={ev.id} value={String(ev.id)}>{ev.event_name + (ev.client_name ? ' — ' + ev.client_name : '') + ' · ' + (ev.venue_name || '') + deptTag + ctNo + by}</option>
                    })}
                  </select>
                )}
                {(function () {
                  var sel = eventId ? formEvents.find(function (ev) { return String(ev.id) === eventId }) : null
                  if (!sel) return null
                  return (
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-1">
                      <p className="text-xs font-bold text-indigo-700">{sel.event_name}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-indigo-600">
                        {sel.function_date && <span>📅 {sel.function_date}</span>}
                        {sel.contract_type && <span>🎉 {sel.contract_type}</span>}
                        {sel.venue_name && <span>📍 {sel.venue_name}</span>}
                        {sel.session && <span>🕐 {sel.session}</span>}
                        {sel.client_name && <span>👤 {sel.client_name}</span>}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">From</label>
            <ExpenseTypeFields value={form.from} onChange={updFrom}
              expTypes={expTypes} expSubTypes={expSubTypes} vendors={vendors} venues={venues} employees={employees} categories={categories} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">To</label>
              <button type="button" onClick={addToRow} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">+ Add Row</button>
            </div>
            <div className="space-y-3">
              {form.to_rows.map(function (row, idx) {
                return (
                  <div key={row._key} className="flex gap-2 items-start border-t border-gray-100 pt-3 first:border-0 first:pt-0">
                    <div className="flex-1 space-y-1.5">
                      <ExpenseTypeFields value={row} onChange={function (patch) { updToRow(idx, patch) }}
                        expTypes={expTypes} expSubTypes={expSubTypes} vendors={vendors} venues={venues} employees={employees} categories={categories} />
                      <div className="grid grid-cols-2 gap-2">
                        <input type="number" step="0.01" min="0" inputMode="decimal"
                          value={row.amount_pts}
                          onChange={function (e) { updToRow(idx, { amount_pts: e.target.value }) }}
                          placeholder="Amount (Rs) *"
                          style={{ fontSize: '16px' }}
                          className="px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                        <input type="text" value={row.remarks}
                          onChange={function (e) { updToRow(idx, { remarks: e.target.value }) }}
                          placeholder="Remarks"
                          maxLength={200}
                          style={{ fontSize: '16px' }}
                          className="px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                      </div>
                    </div>
                    {form.to_rows.length > 1 && (
                      <button type="button" onClick={function () { removeToRow(idx) }}
                        className="text-red-400 hover:text-red-600 text-xs mt-1">✕</button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 text-xs font-bold text-gray-700 flex justify-between">
              <span>Total</span>
              <span>Rs {(toTotalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Effective Date</label>
            <input type="date" value={form.effective_date}
              onChange={function (e) { updForm({ effective_date: e.target.value }) }}
              style={{ fontSize: '16px' }}
              className="w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Description *</label>
            <VoiceInput type="text" value={form.description}
              onChange={function (e) { updForm({ description: e.target.value }) }}
              placeholder="e.g. 4 days painter labor for kitchen"
              className="w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button onClick={function () { setShowForm(false) }} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-indigo-300">
              {saving ? 'Saving...' : (form.to_rows.length > 1 ? 'Save ' + form.to_rows.length + ' Transfers' : 'Save Transfer')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Expense type + sub-type picker, plus whatever lookup extra_fields the picked
// sub-type declares (e.g. vendor/venue/employee) — shared by the From field and
// every To row. `value` is { expense_type_id, expense_sub_type_id, meta }.
function ExpenseTypeFields({ value, onChange, expTypes, expSubTypes, vendors, venues, employees, categories }) {
  var etId = Number(value.expense_type_id) || 0

  // Vendors filtered by currently-selected expense type's sub_department (or dept fallback)
  function vendorPool() {
    if (!etId) return vendors || []
    var et = (expTypes || []).find(function (x) { return x.id === etId })
    if (!et) return vendors || []
    var sdId = et.sub_department_id || null
    var dId = et.department_id || null
    var catList = categories || []
    var relevantCatIds = catList.filter(function (c) {
      if (sdId && c.sub_department_id === sdId) return true
      if (!sdId && dId) { // fallback: any cat under any sub_dept of this dept — punt: use all cats without sub_dept filter
        return true
      }
      return false
    }).map(function (c) { return c.id })
    if (relevantCatIds.length === 0) return vendors || []
    return (vendors || []).filter(function (v) {
      var vc = v.category_ids || []
      for (var i = 0; i < vc.length; i++) { if (relevantCatIds.indexOf(vc[i]) !== -1) return true }
      return false
    })
  }

  function lookupItems(field) {
    var source = field.source
    if (source === 'vendors') {
      return vendorPool().map(function (x) { return { value: String(x.id), label: x.name } })
    }
    if (source === 'venues') return (venues || []).map(function (x) { return { value: String(x.id), label: (x.code ? x.code + ' — ' + x.name : x.name) } })
    if (source === 'job_departments') {
      var allowed = Array.isArray(field.allowed_dept_ids) ? field.allowed_dept_ids : []
      var pool = employees || []
      if (allowed.length > 0) {
        pool = pool.filter(function (e) {
          var jd = e.job_department_ids || []
          for (var i = 0; i < jd.length; i++) { if (allowed.indexOf(jd[i]) !== -1) return true }
          return false
        })
      }
      return pool.map(function (e) { return { value: String(e.id), label: e.full_name + (e.employee_code ? ' (' + e.employee_code + ')' : '') } })
    }
    return []
  }

  var subs = expSubTypes.filter(function (s) { return s.expense_type_id === etId })
  var etItems = expTypes.map(function (x) { return { value: String(x.id), label: x.name } })
  var subItems = subs.map(function (x) { return { value: String(x.id), label: x.name } })

  // Collect lookup-type extra_fields declared on the picked sub-type (e.g. salary needs employee_id)
  var subId = Number(value.expense_sub_type_id) || 0
  var picked = subId ? expSubTypes.find(function (s) { return s.id === subId }) : null
  var lookupExtras = (picked && Array.isArray(picked.extra_fields))
    ? picked.extra_fields.filter(function (f) { return f.type === 'lookup' && f.source })
    : []
  var meta = value.meta || {}

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <SearchDropdown items={etItems}
          value={value.expense_type_id}
          onChange={function (v) { onChange({ expense_type_id: v, expense_sub_type_id: '', meta: {} }) }}
          placeholder="Search expense type" />
        <SearchDropdown items={subItems}
          value={value.expense_sub_type_id}
          onChange={function (v) { onChange({ expense_sub_type_id: v, meta: {} }) }}
          placeholder={!etId ? 'Pick a type first' : (subs.length === 0 ? 'No sub-types' : 'Sub-type (optional)')} />
      </div>
      {lookupExtras.length > 0 && (
        <div className="mt-2 space-y-2 pl-2 border-l-2 border-indigo-100">
          {lookupExtras.map(function (f) {
            return (
              <div key={f.key}>
                <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wider">{f.label}{f.required ? ' *' : ''}</label>
                <SearchDropdown items={lookupItems(f)}
                  value={meta[f.key] || ''}
                  onChange={function (v) {
                    var nextMeta = Object.assign({}, meta)
                    if (v === '' || v == null) { delete nextMeta[f.key] } else { nextMeta[f.key] = v }
                    onChange({ meta: nextMeta })
                  }}
                  placeholder={f.source === 'job_departments' ? 'Search employees' : ('Search ' + (f.source || ''))} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default CostTransfers