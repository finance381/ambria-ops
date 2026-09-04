import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/ui/Modal'
import SearchDropdown from '../../components/ui/SearchDropdown'
import { logActivity } from '../../lib/logger'
import { hasPerm } from '../../lib/permissions'
import VoiceInput from '../../components/ui/VoiceInput'

var PARTY_TYPES = [
  { key: 'expense', label: 'Expense Type', icon: 'ti-receipt' },
  { key: 'event', label: 'Event', icon: 'ti-calendar-event' },
  { key: 'vendor', label: 'Vendor', icon: 'ti-building-store' },
  { key: 'employee', label: 'Employee', icon: 'ti-user' },
]

var EMPTY_FORM = {
  from_party_type: 'expense',
  from_expense_type_id: '', from_expense_sub_type_id: '',
  from_event_id: '', from_vendor_id: '', from_employee_id: '',
  from_meta: {},
  to_party_type: 'expense',
  to_expense_type_id: '', to_expense_sub_type_id: '',
  to_event_id: '', to_vendor_id: '', to_employee_id: '',
  to_meta: {},
  amount_pts: '', description: '', reason_note: '',
  effective_date: new Date().toISOString().substring(0, 10),
}

function CostTransfers({ profile }) {
  var canCreate = hasPerm(profile?.permsNew, 'finance.cost_transfers')
  var [transfers, setTransfers] = useState([])
  var [loading, setLoading] = useState(true)
  var [showForm, setShowForm] = useState(false)
  var [saving, setSaving] = useState(false)
  var [reversing, setReversing] = useState(null)
  var [error, setError] = useState('')

  var [expTypes, setExpTypes] = useState([])
  var [expSubTypes, setExpSubTypes] = useState([])
  var [events, setEvents] = useState([])
  var [vendors, setVendors] = useState([])
  var [employees, setEmployees] = useState([])
  var [venues, setVenues] = useState([])
  var [jobDepts, setJobDepts] = useState([])
  var [categories, setCategories] = useState([])

  var [form, setForm] = useState(EMPTY_FORM)

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
        supabase.from('expense_types').select('id, name, department_id, sub_department_id').eq('active', true).order('name'),
        supabase.from('expense_sub_types').select('id, name, expense_type_id, extra_fields').eq('active', true).order('name'),
        supabase.from('events').select('id, function_date, event_name, client_name').order('function_date', { ascending: false }).limit(500),
        supabase.from('vendors').select('id, name, category_ids').eq('active', true).order('name'),
        supabase.from('employees').select('id, full_name, employee_code, job_department_ids').order('full_name').limit(1000),
        supabase.from('venues').select('id, code, name').eq('active', true).order('name'),
        supabase.from('job_departments').select('id, name').order('name'),
        supabase.from('categories').select('id, sub_department_id').order('id'),
      ])
      setExpTypes(results[0].data || [])
      setExpSubTypes(results[1].data || [])
      setEvents(results[2].data || [])
      setVendors(results[3].data || [])
      setEmployees(results[4].data || [])
      setVenues(results[5].data || [])
      setJobDepts(results[6].data || [])
      setCategories(results[7].data || [])
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
    var subId = row[side + '_expense_sub_type_id']
    if (!subId) return null
    var picked = expSubTypes.find(function (x) { return x.id === subId })
    if (!picked || !Array.isArray(picked.extra_fields)) return null
    var items = []
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

  function validParty(f, side) {
    var t = f[side + '_party_type']
    if (t === 'expense') return !!f[side + '_expense_type_id']
    if (t === 'event') return !!f[side + '_event_id']
    if (t === 'vendor') return !!f[side + '_vendor_id']
    if (t === 'employee') return !!f[side + '_employee_id']
    return false
  }

  function isSameParty(f) {
    if (f.from_party_type !== f.to_party_type) return false
    var t = f.from_party_type
    if (t === 'expense') return f.from_expense_type_id === f.to_expense_type_id && (f.from_expense_sub_type_id || '') === (f.to_expense_sub_type_id || '')
    if (t === 'event') return f.from_event_id === f.to_event_id
    if (t === 'vendor') return f.from_vendor_id === f.to_vendor_id
    if (t === 'employee') return f.from_employee_id === f.to_employee_id
    return false
  }

  async function handleSave() {
    if (saving) return
    setError('')
    var amt = Number(form.amount_pts)
    if (!amt || amt <= 0) { setError('Amount must be positive'); return }
    if (!form.description.trim()) { setError('Description required'); return }
    if (!validParty(form, 'from')) { setError('Select From party'); return }
    if (!validParty(form, 'to')) { setError('Select To party'); return }
    if (isSameParty(form)) { setError('From and To cannot be identical'); return }

    setSaving(true)
    try {
      var res = await supabase.rpc('fn_create_cost_transfer', {
        p_amount_paise: Math.round(amt * 100),
        p_from_party_type: form.from_party_type,
        p_from_expense_type_id: form.from_party_type === 'expense' ? Number(form.from_expense_type_id) : null,
        p_from_expense_sub_type_id: form.from_party_type === 'expense' && form.from_expense_sub_type_id ? Number(form.from_expense_sub_type_id) : null,
        p_from_event_id: form.from_party_type === 'event' ? Number(form.from_event_id) : null,
        p_from_vendor_id: form.from_party_type === 'vendor' ? Number(form.from_vendor_id) : null,
        p_from_employee_id: form.from_party_type === 'employee' ? form.from_employee_id : null,
        p_to_party_type: form.to_party_type,
        p_to_expense_type_id: form.to_party_type === 'expense' ? Number(form.to_expense_type_id) : null,
        p_to_expense_sub_type_id: form.to_party_type === 'expense' && form.to_expense_sub_type_id ? Number(form.to_expense_sub_type_id) : null,
        p_to_event_id: form.to_party_type === 'event' ? Number(form.to_event_id) : null,
        p_to_vendor_id: form.to_party_type === 'vendor' ? Number(form.to_vendor_id) : null,
        p_to_employee_id: form.to_party_type === 'employee' ? form.to_employee_id : null,
        p_description: form.description.trim(),
        p_reason_note: form.reason_note.trim() || null,
        p_effective_date: form.effective_date,
        p_from_meta: form.from_meta || {},
        p_to_meta: form.to_meta || {},
      })
      if (res.error) throw res.error
      try { logActivity('COST_TRANSFER_CREATE', '#' + res.data + ' Rs ' + amt.toFixed(2)) } catch (_) {}
      setShowForm(false)
      setForm(EMPTY_FORM)
      loadTransfers()
    } catch (err) {
      setError(err.message || 'Save failed')
    }
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
          <button onClick={function () { setForm(EMPTY_FORM); setError(''); setShowForm(true) }}
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
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
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
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.effective_date}</td>
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
      )}

      <Modal open={showForm} onClose={function () { setShowForm(false) }} title="New Cost Transfer">
        <div className="space-y-4">
          <PartySection side="from" form={form} updForm={updForm}
            expTypes={expTypes} expSubTypes={expSubTypes} events={events} vendors={vendors} employees={employees}
            venues={venues} jobDepts={jobDepts} categories={categories} />
          <PartySection side="to" form={form} updForm={updForm}
            expTypes={expTypes} expSubTypes={expSubTypes} events={events} vendors={vendors} employees={employees}
            venues={venues} jobDepts={jobDepts} categories={categories} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Amount (Rs)</label>
              <input type="number" step="0.01" min="0"
                value={form.amount_pts}
                onChange={function (e) { updForm({ amount_pts: e.target.value }) }}
                style={{ fontSize: '16px' }}
                className="w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Effective Date</label>
              <input type="date" value={form.effective_date}
                onChange={function (e) { updForm({ effective_date: e.target.value }) }}
                style={{ fontSize: '16px' }}
                className="w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Description *</label>
            <VoiceInput type="text" value={form.description}
              onChange={function (e) { updForm({ description: e.target.value }) }}
              placeholder="e.g. 4 days painter labor for kitchen"
              className="w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Reason Note (optional)</label>
            <textarea rows="2" value={form.reason_note}
              onChange={function (e) { updForm({ reason_note: e.target.value }) }}
              style={{ fontSize: '16px' }}
              className="w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button onClick={function () { setShowForm(false) }} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-indigo-300">
              {saving ? 'Saving...' : 'Save Transfer'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function PartySection({ side, form, updForm, expTypes, expSubTypes, events, vendors, employees, venues, jobDepts, categories }) {
  var t = form[side + '_party_type']
  function fld(name) { return side + '_' + name }
  var metaKey = side + '_meta'

  // Vendors filtered by currently-selected expense type's sub_department (or dept fallback)
  function vendorPool() {
    var etId = Number(form[fld('expense_type_id')]) || 0
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

  function updMeta(fieldKey, val) {
    var currentMeta = form[metaKey] || {}
    var nextMeta = Object.assign({}, currentMeta)
    if (val === '' || val == null) { delete nextMeta[fieldKey] } else { nextMeta[fieldKey] = val }
    var patch = {}; patch[metaKey] = nextMeta
    updForm(patch)
  }

  var picker = null
  var lookupFields = null
  if (t === 'expense') {
    var etId = Number(form[fld('expense_type_id')]) || 0
    var subs = expSubTypes.filter(function (s) { return s.expense_type_id === etId })
    var etItems = expTypes.map(function (x) { return { value: String(x.id), label: x.name } })
    var subItems = subs.map(function (x) { return { value: String(x.id), label: x.name } })
    picker = (
      <div className="grid grid-cols-2 gap-2">
        <SearchDropdown items={etItems}
          value={form[fld('expense_type_id')]}
          onChange={function (v) {
            var patch = {}; patch[fld('expense_type_id')] = v; patch[fld('expense_sub_type_id')] = ''; patch[metaKey] = {}
            updForm(patch)
          }}
          placeholder="Search expense type" />
        <SearchDropdown items={subItems}
          value={form[fld('expense_sub_type_id')]}
          onChange={function (v) { var patch = {}; patch[fld('expense_sub_type_id')] = v; patch[metaKey] = {}; updForm(patch) }}
          placeholder={!etId ? 'Pick a type first' : (subs.length === 0 ? 'No sub-types' : 'Sub-type (optional)')} />
      </div>
    )

    // Render lookup-type extra_fields for the picked sub-type
    var subId = Number(form[fld('expense_sub_type_id')]) || 0
    var picked = subId ? expSubTypes.find(function (s) { return s.id === subId }) : null
    var lookupExtras = (picked && Array.isArray(picked.extra_fields))
      ? picked.extra_fields.filter(function (f) { return f.type === 'lookup' && f.source })
      : []
    if (lookupExtras.length > 0) {
      var meta = form[metaKey] || {}
      lookupFields = (
        <div className="mt-2 space-y-2 pl-2 border-l-2 border-indigo-100">
          {lookupExtras.map(function (f) {
            return (
              <div key={f.key}>
                <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wider">{f.label}{f.required ? ' *' : ''}</label>
                <SearchDropdown items={lookupItems(f)}
                  value={meta[f.key] || ''}
                  onChange={function (v) { updMeta(f.key, v) }}
                  placeholder={f.source === 'job_departments' ? 'Search employees' : ('Search ' + (f.source || ''))} />
              </div>
            )
          })}
        </div>
      )
    }
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">{side}</label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 mb-2">
        {PARTY_TYPES.map(function (pt) {
          var isActive = t === pt.key
          return (
            <button key={pt.key} type="button"
              onClick={function () { var patch = {}; patch[side + '_party_type'] = pt.key; updForm(patch) }}
              className={"px-2 py-1.5 text-xs rounded border " +
                (isActive ? "bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300")}>
              <i className={"ti " + pt.icon} style={{ fontSize: '13px', marginRight: '3px' }} aria-hidden="true"></i>
              {pt.label}
            </button>
          )
        })}
      </div>
      {picker}
      {lookupFields}
    </div>
  )
}

export default CostTransfers