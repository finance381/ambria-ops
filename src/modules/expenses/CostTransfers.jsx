import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/ui/Modal'
import SearchDropdown from '../../components/ui/SearchDropdown'
import { logActivity } from '../../lib/logger'

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
  to_party_type: 'expense',
  to_expense_type_id: '', to_expense_sub_type_id: '',
  to_event_id: '', to_vendor_id: '', to_employee_id: '',
  amount_pts: '', description: '', reason_note: '',
  effective_date: new Date().toISOString().substring(0, 10),
}

function CostTransfers({ profile }) {
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

  var [form, setForm] = useState(EMPTY_FORM)

  useEffect(function () { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      var results = await Promise.all([
        supabase.from('cost_transfers').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('expense_types').select('id, name').eq('active', true).order('name'),
        supabase.from('expense_sub_types').select('id, name, expense_type_id').eq('active', true).order('name'),
        supabase.from('events').select('id, function_date, event_name, client_name').order('function_date', { ascending: false }).limit(500),
        supabase.from('vendors').select('id, name').eq('active', true).order('name'),
        supabase.from('employees').select('id, full_name').order('full_name').limit(1000),
      ])
      setTransfers(results[0].data || [])
      setExpTypes(results[1].data || [])
      setExpSubTypes(results[2].data || [])
      setEvents(results[3].data || [])
      setVendors(results[4].data || [])
      setEmployees(results[5].data || [])
    } catch (_) { setError('Load failed') }
    setLoading(false)
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
      })
      if (res.error) throw res.error
      try { logActivity('COST_TRANSFER_CREATE', '#' + res.data + ' Rs ' + amt.toFixed(2)) } catch (_) {}
      setShowForm(false)
      setForm(EMPTY_FORM)
      loadAll()
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
      loadAll()
    } catch (err) { setError(err.message || 'Reverse failed') }
    setReversing(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Move cost between ledgers without touching wallet.</p>
        <button onClick={function () { setForm(EMPTY_FORM); setError(''); setShowForm(true) }}
          className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
          <i className="ti ti-plus" style={{ fontSize: '14px', marginRight: '4px' }} aria-hidden="true"></i>
          New Transfer
        </button>
      </div>

      {error && !showForm && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
      )}

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-8">Loading...</p>
      ) : transfers.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">No cost transfers yet.</p>
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
                var canReverse = !isReversed && !isReversal
                return (
                  <tr key={r.id} className={isReversed ? "bg-gray-50 text-gray-400" : ""}>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.effective_date}</td>
                    <td className="px-3 py-2 text-xs">{partyLabel(r, 'from')}</td>
                    <td className="px-3 py-2 text-xs">{partyLabel(r, 'to')}</td>
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
            expTypes={expTypes} expSubTypes={expSubTypes} events={events} vendors={vendors} employees={employees} />
          <PartySection side="to" form={form} updForm={updForm}
            expTypes={expTypes} expSubTypes={expSubTypes} events={events} vendors={vendors} employees={employees} />

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
            <input type="text" value={form.description}
              onChange={function (e) { updForm({ description: e.target.value }) }}
              placeholder="e.g. 4 days painter labor for kitchen"
              style={{ fontSize: '16px' }}
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

function PartySection({ side, form, updForm, expTypes, expSubTypes, events, vendors, employees }) {
  var t = form[side + '_party_type']
  function fld(name) { return side + '_' + name }

  var picker = null
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
            var patch = {}; patch[fld('expense_type_id')] = v; patch[fld('expense_sub_type_id')] = ''
            updForm(patch)
          }}
          placeholder="Search expense type" />
        <SearchDropdown items={subItems}
          value={form[fld('expense_sub_type_id')]}
          onChange={function (v) { var patch = {}; patch[fld('expense_sub_type_id')] = v; updForm(patch) }}
          placeholder={!etId ? 'Pick a type first' : (subs.length === 0 ? 'No sub-types' : 'Sub-type (optional)')} />
      </div>
    )
  } else if (t === 'event') {
    var evItems = events.map(function (x) {
      var lbl = (x.event_name || x.client_name || ('Event #' + x.id)) + ' — ' + (x.function_date || '')
      return { value: String(x.id), label: lbl }
    })
    picker = (
      <SearchDropdown items={evItems}
        value={form[fld('event_id')]}
        onChange={function (v) { var patch = {}; patch[fld('event_id')] = v; updForm(patch) }}
        placeholder="Search event by name or date" />
    )
  } else if (t === 'vendor') {
    var vdItems = vendors.map(function (x) { return { value: String(x.id), label: x.name } })
    picker = (
      <SearchDropdown items={vdItems}
        value={form[fld('vendor_id')]}
        onChange={function (v) { var patch = {}; patch[fld('vendor_id')] = v; updForm(patch) }}
        placeholder="Search vendor" />
    )
  } else if (t === 'employee') {
    var emItems = employees.map(function (x) { return { value: String(x.id), label: x.full_name } })
    picker = (
      <SearchDropdown items={emItems}
        value={form[fld('employee_id')]}
        onChange={function (v) { var patch = {}; patch[fld('employee_id')] = v; updForm(patch) }}
        placeholder="Search employee" />
    )
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wider">{side}</label>
      <div className="grid grid-cols-4 gap-1 mb-2">
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
    </div>
  )
}

export default CostTransfers