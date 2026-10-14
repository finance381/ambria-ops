import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'
import { isPrivilegedRole } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import EventDatePicker from '../../components/ui/EventDatePicker'
import Icon from '../../components/ui/Icon'
import { deptCls, deptOrder } from '../../lib/ui'

function byName(a, b) { return (a.name || '').localeCompare(b.name || '') }

var ITEM_UNITS = ['Pieces', 'Nos', 'Sets', 'Pairs', 'Dozens', 'Kg', 'Grams', 'Liters', 'ML', 'Meters', 'Feet', 'Rolls', 'Packets', 'Bags', 'Boxes', 'Cartons', 'Bottles', 'Sheets', 'Reams']

// Same shape ExpenseForm.jsx's makeItem()/isItemComplete() use — a JV's item
// purchase ends up in the same expenses.metadata.item_receipts list a new
// expense's does (see submit() below), so the shape has to match exactly.
function makeItem() {
  return {
    _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    itemMode: 'existing',
    itemQuery: '',
    itemMatchedId: null,
    itemMatchedSource: null,
    itemMatchedCategoryId: null,
    itemQty: '',
    itemUnit: 'Pieces',
    itemNotes: '',
    itemRate: '',
  }
}

function isItemComplete(im) {
  return !!(im && String(im.itemQuery || '').trim() && Number(im.itemQty) > 0 && Number(im.itemRate) > 0)
}

function makeAlloc() {
  return { _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8), departmentId: '', expenseTypeId: '', expenseSubTypeId: '', venueId: '', subVenueId: '', amountPts: '', remarks: '' }
}

// One evening at one venue is booked as up to four contracts — one per
// department. Grouped so the picker lists each function once and hangs its
// contracts off it as department chips (mirrors ExpenseForm's picker).
function funcKeyOf(r) {
  return [r.client_name || '', r.venue_name || '', r.session || '', (r.event_name || '').trim().toLowerCase()].join('|')
}

function groupFunctions(rows) {
  var byKey = {}
  var order = []
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]
    var k = funcKeyOf(r)
    if (!byKey[k]) {
      byKey[k] = {
        key: k,
        contracts: [],
      }
      order.push(k)
    }
    byKey[k].contracts.push(r)
  }
  order.forEach(function (k) {
    byKey[k].contracts.sort(function (a, b) { return deptOrder(a.department) - deptOrder(b.department) })
  })
  return order.map(function (k) { return byKey[k] })
}

function GVForm({ exp, profile, onCancel, onSaved }) {
  var isAdmin = isPrivilegedRole(profile)
  var [reason, setReason] = useState('')
  var [allocations, setAllocations] = useState([])
  var [departments, setDepartments] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var refData = useReferenceData()
  var venues = refData.venues.filter(function (v) { return v.active }).slice().sort(byName)
  var expenseTypes = refData.expenseTypes.filter(function (t) { return t.active }).slice().sort(byName)
  var expenseSubTypes = refData.expenseSubTypes.filter(function (t) { return t.active }).slice().sort(byName)
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  // Optional: update parent expense fields (admin/finance_gv only)
  var [fieldsExpanded, setFieldsExpanded] = useState(false)
  var [newTypeId, setNewTypeId] = useState(exp.expense_type_id ? String(exp.expense_type_id) : '')
  var [newSubTypeId, setNewSubTypeId] = useState(exp.expense_sub_type_id ? String(exp.expense_sub_type_id) : '')
  // Optional: attribute this expense's cost to a function/event (drives event_ledger)
  var [isFunction, setIsFunction] = useState(!!exp.event_id)
  var [eventDate, setEventDate] = useState(exp.event_id ? (exp.expense_date || '') : '')
  var [eventId, setEventId] = useState(exp.event_id ? String(exp.event_id) : '')
  var [events, setEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)
  // Optional: buy item(s) as part of this adjustment — same input as
  // ExpenseForm's own "Item select", feeding the same
  // expenses.metadata.item_receipts list on submit (see submit() below).
  var [isItemPurchase, setIsItemPurchase] = useState(false)
  var [items, setItems] = useState([makeItem()])
  var [editingItemIdx, setEditingItemIdx] = useState(0)
  var [itemCategories, setItemCategories] = useState([])
  var [itemSearchKey, setItemSearchKey] = useState('')
  var [itemMatches, setItemMatches] = useState([])
  var itemSearchTimer = useRef(null)

  useEffect(function () {
    supabase.from('categories').select('id, name').order('name').then(function (res) { setItemCategories(res.data || []) })
  }, [])

  function toggleItemPurchase() {
    setIsItemPurchase(function (on) {
      var next = !on
      if (next) setItems(function (prev) { return prev && prev.length > 0 ? prev : [makeItem()] })
      return next
    })
    setItemMatches([]); setItemSearchKey('')
  }

  function computeItemsTotal() {
    return items.reduce(function (sum, it) { return sum + (Number(it.itemQty) || 0) * (Number(it.itemRate) || 0) }, 0)
  }

  function addItem() {
    setItems(function (prev) {
      var next = prev.concat([makeItem()])
      setEditingItemIdx(next.length - 1)
      return next
    })
  }

  function removeItem(itemIdx) {
    setItems(function (prev) {
      if (prev.length <= 1) { setEditingItemIdx(0); return [makeItem()] }
      setEditingItemIdx(function (cur) { return cur === itemIdx ? -1 : (cur > itemIdx ? cur - 1 : cur) })
      return prev.filter(function (_, j) { return j !== itemIdx })
    })
    var key = String(itemIdx)
    if (itemSearchKey === key) { setItemMatches([]); setItemSearchKey('') }
  }

  function toggleItemMode(itemIdx) {
    setItems(function (prev) {
      return prev.map(function (it, j) {
        if (j !== itemIdx) return it
        var nextMode = it.itemMode === 'new' ? 'existing' : 'new'
        return Object.assign({}, it, { itemMode: nextMode, itemMatchedId: null, itemMatchedSource: null, itemMatchedCategoryId: null })
      })
    })
    setEditingItemIdx(itemIdx)
    var key = String(itemIdx)
    if (itemSearchKey === key) { setItemMatches([]); setItemSearchKey('') }
  }

  function updateItem(itemIdx, field, val) {
    setItems(function (prev) {
      return prev.map(function (it, j) {
        if (j !== itemIdx) return it
        var ic = Object.assign({}, it)
        ic[field] = val
        if (field === 'itemQuery' && it.itemMode !== 'new') {
          ic.itemMatchedId = null; ic.itemMatchedSource = null; ic.itemMatchedCategoryId = null
        }
        return ic
      })
    })
    setEditingItemIdx(itemIdx)
  }

  function searchInventoryItems(itemIdx, term) {
    setItemSearchKey(String(itemIdx))
    if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current)
    if (!term || term.trim().length < 2) { setItemMatches([]); return }
    itemSearchTimer.current = setTimeout(function () {
      var q = term.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
      Promise.all([
        supabase.from('inventory_items').select('id, name, unit, category_id').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(6),
        supabase.from('catering_store_items').select('id, name, unit, category_id').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(6),
      ]).then(function (results) {
        var inv = (results[0].data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
        var cs = (results[1].data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store' }) })
        setItemMatches(inv.concat(cs).slice(0, 8))
      })
    }, 300)
  }

  function pickItemMatch(itemIdx, item) {
    setItems(function (prev) {
      return prev.map(function (it, j) {
        if (j !== itemIdx) return it
        return Object.assign({}, it, { itemQuery: item.name, itemMatchedId: item.id, itemMatchedSource: item._source, itemMatchedCategoryId: item.category_id || null, itemUnit: item.unit || it.itemUnit })
      })
    })
    setEditingItemIdx(itemIdx)
    setItemMatches([]); setItemSearchKey('')
  }

  useEffect(function () {
    if (exp.event_id && exp.expense_date) loadEventsByDate(exp.expense_date)
  }, [])

  async function loadEventsByDate(dateStr) {
    if (!dateStr) { setEvents([]); setEventId(''); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, venue_name, session, client_name, department')
      .eq('function_date', dateStr)
      .is('lms_cancelled_at', null)
      .order('event_name')
    var rows = data || []
    setEvents(rows)
    setEventsLoading(false)
    if (rows.length === 1) setEventId(String(rows[0].id))
    else if (!rows.some(function (r) { return String(r.id) === eventId })) setEventId('')
  }

  function toggleFunction(val) {
    setIsFunction(val)
    if (!val) { setEventId(''); setEventDate(''); setEvents([]) }
  }

  function renderFunctionPicker() {
    return (
      <div className="space-y-2">
        <EventDatePicker label="Function Date" value={eventDate} collapsible
          onChange={function (dateStr) { setEventDate(dateStr); loadEventsByDate(dateStr) }} />
        {eventsLoading && <p className="text-[12px] text-slate-500">Loading events...</p>}
        {eventDate && !eventsLoading && events.length === 0 && <p className="text-[12px] text-slate-500">No events on this date</p>}
        {events.length > 0 && (function () {
          var groups = groupFunctions(events)
          var picked = eventId ? groups.filter(function (g) {
            return g.contracts.some(function (c) { return String(c.id) === eventId })
          }) : null
          var shown = (picked && picked.length === 1) ? picked : groups
          return (
            <div className="space-y-2">
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                {shown.map(function (g) {
                  var head = g.contracts[0]
                  var sel = g.contracts.filter(function (c) { return String(c.id) === eventId })[0] || null
                  return (
                    <button key={g.key} type="button" onClick={function () { setEventId(String(head.id)) }}
                      className={"text-left rounded-xl border px-2.5 py-2 transition-all duration-150 " +
                        (sel
                          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                          : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)]")}>
                      <span className="flex items-start justify-between gap-1.5">
                        <span className={"min-w-0 flex-1 block text-[11px] font-bold uppercase tracking-[0.03em] leading-snug truncate " +
                          (sel ? "text-indigo-900" : "text-slate-900")}>
                          {head.event_name}
                        </span>
                        <span className="shrink-0 flex flex-nowrap items-center gap-1">
                          {g.contracts.map(function (c) {
                            return (
                              <span key={c.id}
                                className={"text-[10px] font-bold uppercase tracking-[0.03em] leading-none px-1.5 py-[3px] rounded " + deptCls(c.department)}>
                                {c.department}
                              </span>
                            )
                          })}
                        </span>
                      </span>
                      {head.client_name && (
                        <span className={"block text-[11px] leading-snug truncate " + (sel ? "text-indigo-800" : "text-slate-700")}>
                          {head.client_name}
                        </span>
                      )}
                      <span className={"block text-[10px] leading-snug truncate " + (sel ? "text-indigo-600" : "text-slate-500")}>
                        {(head.venue_name || '') + (head.session ? ' · ' + head.session : '')}
                      </span>
                    </button>
                  )
                })}
              </div>
              {shown !== groups && groups.length > 1 && (
                <button type="button" onClick={function () { setEventId('') }}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 px-1">
                  Change function
                </button>
              )}
            </div>
          )
        })()}
      </div>
    )
  }

  useEffect(function () {
    Promise.all([
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, department_id'),
      supabase.from('expense_allocations')
        .select('id, department, department_id, expense_type_id, expense_sub_type_id, venue_id, sub_venue_id, amount_paise, remarks')
        .eq('expense_id', exp.id)
        .order('id'),
    ]).then(function (res) {
      setDepartments(res[0].data || [])
      setSubDepartments(res[1].data || [])
      // Prefill from freshly-fetched allocation rows
      var allocRows = res[2].data || []
      var prefill = allocRows.map(function (a) {
        return {
          _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + a.id,
          departmentId: a.department_id ? String(a.department_id) : '',
          expenseTypeId: a.expense_type_id ? String(a.expense_type_id) : '',
          expenseSubTypeId: a.expense_sub_type_id ? String(a.expense_sub_type_id) : '',
          venueId: a.venue_id ? String(a.venue_id) : '',
          subVenueId: a.sub_venue_id ? String(a.sub_venue_id) : '',
          amountPts: a.amount_paise != null ? String(a.amount_paise / 100) : '',
          remarks: a.remarks || '',
          _departmentText: a.department || '',
        }
      })
      if (prefill.length === 0) {
        // Legacy expense with no allocations — seed one row from the parent expense's type/sub-type
        var seed = makeAlloc()
        var parentTypeId = exp.expense_type_id ? Number(exp.expense_type_id) : null
        var parentType = parentTypeId ? expenseTypes.find(function (t) { return t.id === parentTypeId }) : null
        seed.departmentId = parentType && parentType.department_id ? String(parentType.department_id) : ''
        seed.expenseTypeId = parentTypeId ? String(parentTypeId) : ''
        seed.expenseSubTypeId = exp.expense_sub_type_id ? String(exp.expense_sub_type_id) : ''
        seed.amountPts = exp.amount_paise ? String(exp.amount_paise / 100) : ''
        prefill = [seed]
      }
      setAllocations(prefill)
      setLoading(false)
    })
  }, [exp.id])

  function updateAlloc(idx, field, val) {
    setAllocations(function (prev) {
      return prev.map(function (a, i) { return i === idx ? Object.assign({}, a, (function () { var o = {}; o[field] = val; return o })()) : a })
    })
  }

  function addAlloc() {
    setAllocations(function (prev) { return prev.concat([makeAlloc()]) })
  }

  function removeAlloc(idx) {
    setAllocations(function (prev) {
      if (prev.length <= 1) return prev
      return prev.filter(function (_, i) { return i !== idx })
    })
  }

  // The parent expense's own type/sub-type doubles as the implicit "everything not
  // explicitly broken out" bucket — whatever the entered rows fall short of the
  // expense total auto-attributes there, so the user only has to enter the splits
  // they actually want to carve out (mirrors the auto_default pattern used when
  // recording/editing an expense's own allocations).
  function deriveParentDeptId() {
    var parentTypeId = exp.expense_type_id ? Number(exp.expense_type_id) : null
    if (!parentTypeId) return null
    var parentType = expenseTypes.find(function (t) { return t.id === parentTypeId })
    if (!parentType) return null
    if (parentType.department_id) return parentType.department_id
    if (parentType.sub_department_id) {
      var sd = subDepartments.find(function (s) { return s.id === parentType.sub_department_id })
      if (sd && sd.department_id) return sd.department_id
    }
    return null
  }

  var totalPaise = allocations.reduce(function (sum, a) { return sum + Math.round((Number(a.amountPts) || 0) * 100) }, 0)
  var expectedPaise = exp.amount_paise || 0
  var diff = totalPaise - expectedPaise
  var overAllocated = diff > 0
  var remainderPaise = overAllocated ? 0 : -diff
  var parentDeptId = remainderPaise > 0 ? deriveParentDeptId() : null
  var remainderNeedsManualEntry = remainderPaise > 0 && (!exp.expense_type_id || !parentDeptId)
  var sumOk = !overAllocated && !remainderNeedsManualEntry
  var reasonOk = reason.trim().length >= 3
  var parentTypeName = (expenseTypes.find(function (t) { return t.id === Number(exp.expense_type_id) }) || {}).name || ''

  async function submit() {
    if (saving) return
    setError('')
    if (!reasonOk) { setError('Reason must be at least 3 characters'); return }
    if (overAllocated) { setError('Allocation total exceeds the expense amount by ' + formatPoints(Math.abs(diff))); return }
    if (remainderNeedsManualEntry) { setError('Parent expense has no type/department to auto-allocate the remaining ' + formatPoints(remainderPaise) + ' to — add it as an explicit row'); return }
    for (var i = 0; i < allocations.length; i++) {
      var a = allocations[i]
      if (!a.departmentId) { setError('Row ' + (i + 1) + ': department required'); return }
      if (!Number(a.amountPts)) { setError('Row ' + (i + 1) + ': amount required'); return }
    }
    if (isItemPurchase && !items.every(isItemComplete)) { setError('Finish or remove the incomplete item(s)'); return }
    setSaving(true)

    var payload = allocations.map(function (a) {
      var deptName = (departments.find(function (d) { return String(d.id) === String(a.departmentId) }) || {}).name || a._departmentText || ''
      return {
        department: deptName,
        department_id: a.departmentId ? Number(a.departmentId) : null,
        expense_type_id: a.expenseTypeId ? Number(a.expenseTypeId) : null,
        expense_sub_type_id: a.expenseSubTypeId ? Number(a.expenseSubTypeId) : null,
        venue_id: a.venueId ? Number(a.venueId) : null,
        sub_venue_id: a.subVenueId ? Number(a.subVenueId) : null,
        amount_paise: Math.round(Number(a.amountPts) * 100),
        remarks: (a.remarks || '').trim() || null,
      }
    })

    if (remainderPaise > 0) {
      var parentDeptRow = departments.find(function (d) { return d.id === parentDeptId })
      payload.push({
        department: parentDeptRow ? parentDeptRow.name : null,
        department_id: parentDeptId,
        expense_type_id: exp.expense_type_id ? Number(exp.expense_type_id) : null,
        expense_sub_type_id: exp.expense_sub_type_id ? Number(exp.expense_sub_type_id) : null,
        venue_id: null,
        sub_venue_id: null,
        amount_paise: remainderPaise,
        remarks: null,
        source: 'auto_default',
      })
    }

    // Only submit field updates if the section is expanded AND at least one value changed
    var typeChanged = fieldsExpanded && Number(newTypeId) !== Number(exp.expense_type_id || 0)
    var subChanged  = fieldsExpanded && Number(newSubTypeId || 0) !== Number(exp.expense_sub_type_id || 0)
    var sendFieldUpdate = typeChanged || subChanged

    // Function attribution: only sent when it actually differs from what the
    // expense already carries — this both drives and mirrors trg_expense_to_ledger,
    // which rebuilds the expense's event_ledger row off expenses.event_id.
    var newEventId = (isFunction && eventId) ? Number(eventId) : null
    var eventChanged = newEventId !== (exp.event_id || null)

    var { data, error: rpcErr } = await supabase.rpc('fn_create_gv', {
      p_expense_id: exp.id,
      p_reason: reason.trim(),
      p_allocations: payload,
      p_new_expense_type_id: sendFieldUpdate ? (newTypeId ? Number(newTypeId) : null) : null,
      p_new_expense_sub_type_id: sendFieldUpdate ? (newSubTypeId ? Number(newSubTypeId) : null) : null,
      p_update_event: eventChanged,
      p_event_id: newEventId,
    })

    if (rpcErr) {
      setError(rpcErr.message || 'Failed to raise JV')
      setSaving(false)
      return
    }

    // Same item_receipts shape and item_receipt_status ExpenseForm.jsx writes
    // on a new expense — a JV's item purchase joins the parent expense's own
    // list rather than starting a separate one, so the (not yet built)
    // receiver step has exactly one list per expense to work through either
    // way. Appended after fn_create_gv succeeds, not atomically with it — the
    // same accepted two-call precedent as SalaryPayouts' wallet debit.
    if (isItemPurchase) {
      var itemReceipts = items.map(function (im) {
        var qtyN = Number(im.itemQty) || 0
        var rateN = Number(im.itemRate) || 0
        return {
          query: (im.itemQuery || '').trim(),
          matched_item_id: im.itemMode === 'new' ? null : im.itemMatchedId,
          matched_source: im.itemMode === 'new' ? 'new' : im.itemMatchedSource,
          matched_category_id: im.itemMatchedCategoryId,
          qty: qtyN,
          unit: im.itemUnit,
          notes: (im.itemNotes || '').trim() || null,
          rate_paise: Math.round(rateN * 100),
          line_total_paise: Math.round(qtyN * rateN * 100),
          resulting_item_id: null,
          received_by: null,
          received_at: null,
          cancel_reason: null,
          source: 'gv',
          gv_number: data?.gv_number || null,
        }
      })
      try {
        var { data: freshExp } = await supabase.from('expenses').select('metadata, item_receipt_status').eq('id', exp.id).single()
        var freshMeta = (freshExp && freshExp.metadata && typeof freshExp.metadata === 'object') ? Object.assign({}, freshExp.metadata) : {}
        freshMeta.item_receipts = (Array.isArray(freshMeta.item_receipts) ? freshMeta.item_receipts : []).concat(itemReceipts)
        var statusUpdate = { metadata: freshMeta }
        if (!freshExp || freshExp.item_receipt_status !== 'received') statusUpdate.item_receipt_status = 'pending'
        await supabase.from('expenses').update(statusUpdate).eq('id', exp.id)
      } catch (itemErr) {
        console.error('GV_ITEM_RECEIPTS_APPEND_FAIL', itemErr)
      }
    }

    try { await logActivity({ action: 'gv_create', entity: 'expense', entity_id: exp.id, meta: { gv_number: data?.gv_number, fields_changed: data?.fields_changed || false } }) } catch (e) {}

    setSaving(false)
    if (onSaved) onSaved(data)
  }

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={onCancel} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 mb-2">← Cancel</button>
          <h2 className="text-lg font-bold text-gray-900">Raise Journal Voucher</h2>
          <p className="text-xs text-gray-500">Adjust expense #{exp.id} · {formatPoints(exp.amount_paise)}</p>
          {exp.description && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-md">{exp.description}</p>}
        </div>
      </div>

      {/* Reason */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1.5">Reason <span className="text-red-500">*</span></label>
        <textarea value={reason} onChange={function (e) { setReason(e.target.value) }}
          placeholder="Why is this expense being adjusted?"
          rows={2} maxLength={500}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
      </div>

      {/* Optional: attribute to a function — drives event_ledger */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <label className="block text-[13px] font-semibold text-gray-800">For a function?</label>
            <span className="block text-[11px] text-gray-500 leading-snug">Ties this expense's cost to an event's ledger</span>
          </div>
          <button type="button" onClick={function () { toggleFunction(!isFunction) }}
            aria-pressed={isFunction} aria-label="For a function?"
            className="shrink-0 flex items-center gap-2">
            <div className={"relative w-9 h-5 rounded-full transition-colors " + (isFunction ? "bg-indigo-600" : "bg-slate-300")}>
              <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (isFunction ? "translate-x-4" : "translate-x-0.5")} />
            </div>
          </button>
        </div>
        {isFunction && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            {renderFunctionPicker()}
          </div>
        )}
      </div>

      {/* Optional: buy item(s) as part of this adjustment — same input as
          ExpenseForm's "Item select", joining the same expenses.metadata.
          item_receipts list on submit. */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={"shrink-0 w-9 h-9 rounded-xl inline-flex items-center justify-center transition-colors " + (isItemPurchase ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-400")}>
              <Icon name="box" size={17} />
            </span>
            <div className="min-w-0">
              <label className="block text-[13px] font-semibold text-gray-800">Item select</label>
              <span className="block text-[11px] text-gray-500 leading-snug">Item enters inventory via receiver</span>
            </div>
          </div>
          <button type="button" onClick={toggleItemPurchase} aria-pressed={isItemPurchase} aria-label="Item select" className="shrink-0 flex items-center gap-2">
            <div className={"relative w-9 h-5 rounded-full transition-colors " + (isItemPurchase ? "bg-indigo-600" : "bg-slate-300")}>
              <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (isItemPurchase ? "translate-x-4" : "translate-x-0.5")} />
            </div>
          </button>
        </div>

        {isItemPurchase && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2.5">
            {items.map(function (im, iIdx) {
              var key = String(iIdx)
              var lineTotal = (Number(im.itemQty) || 0) * (Number(im.itemRate) || 0)
              var complete = isItemComplete(im)
              var expanded = editingItemIdx === iIdx
              if (!expanded) {
                return (
                  <div key={im._key} className={"border rounded-xl px-3 py-2.5 flex items-center gap-2 transition-colors " + (complete ? "bg-white border-gray-200" : "bg-amber-50/40 border-amber-200")}>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">{iIdx + 1}</span>
                    <button type="button" onClick={function () { setEditingItemIdx(iIdx) }} className="flex-1 min-w-0 flex items-center gap-2 text-left hover:opacity-70">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-900 truncate">
                          {im.itemQuery ? im.itemQuery : <span className="font-normal text-gray-400">Unnamed item</span>}
                          {im.itemMode === 'new'
                            ? <Icon name="sparkle" size={12} className="shrink-0 text-gray-400" />
                            : (im.itemMatchedId && <Icon name="check" size={12} className="shrink-0 text-indigo-600" />)}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate tabular-nums">
                          {(Number(im.itemQty) || 0)} {im.itemUnit} × {(Number(im.itemRate) || 0).toLocaleString('en-IN')} pts{im.itemNotes ? ' · ' + im.itemNotes : ''}
                        </p>
                      </div>
                      {complete ? (
                        <span className="shrink-0 text-[13px] font-bold text-gray-900 tabular-nums">{lineTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts</span>
                      ) : (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">Incomplete</span>
                      )}
                    </button>
                    <button type="button" onClick={function () { removeItem(iIdx) }}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors" title="Delete item" aria-label="Delete item">
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                )
              }
              return (
                <div key={im._key} className="border border-gray-200 rounded-xl bg-white p-3 space-y-2.5"
                  onFocusCapture={function () { if (editingItemIdx !== iIdx) setEditingItemIdx(iIdx) }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">{'Item ' + (iIdx + 1)}</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={function () { toggleItemMode(iIdx) }}
                        className="flex items-center gap-1.5" title={im.itemMode === 'new' ? 'Switch to inventory search' : 'Create as new item'}>
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">
                          <Icon name={im.itemMode === 'new' ? 'sparkle' : 'box'} size={13} />
                          {im.itemMode === 'new' ? 'New' : 'Inventory'}
                        </span>
                        <div className={"relative w-9 h-5 rounded-full transition-colors " + (im.itemMode === 'new' ? "bg-gray-400" : "bg-indigo-600")}>
                          <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (im.itemMode === 'new' ? "translate-x-4" : "translate-x-0.5")} />
                        </div>
                      </button>
                      <button type="button" onClick={function () { removeItem(iIdx) }}
                        className="w-6 h-6 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors" title="Delete item" aria-label="Delete item">
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>

                  {im.itemMode === 'new' ? (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-600 mb-1">Item Name <span className="text-red-500">*</span></label>
                        <input type="text" value={im.itemQuery} onChange={function (e) { updateItem(iIdx, 'itemQuery', e.target.value) }}
                          placeholder="Item name (e.g. A4 Sheets, Broom, Chair)" maxLength="200"
                          className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" style={{ fontSize: '16px' }} />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-600 mb-1">Category <span className="text-gray-500">(optional)</span></label>
                        <select value={im.itemMatchedCategoryId || ''}
                          onChange={function (e) { updateItem(iIdx, 'itemMatchedCategoryId', e.target.value ? Number(e.target.value) : null) }}
                          className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" style={{ fontSize: '16px' }}>
                          <option value="">Category (optional)</option>
                          {itemCategories.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                        Item Name <span className="text-red-500">*</span>
                        {im.itemMatchedId && <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600"><Icon name="check" size={11} />Matched existing</span>}
                      </label>
                      <input type="text" value={im.itemQuery}
                        onChange={function (e) { updateItem(iIdx, 'itemQuery', e.target.value); searchInventoryItems(iIdx, e.target.value) }}
                        onFocus={function () { if (im.itemQuery && im.itemQuery.length >= 2) searchInventoryItems(iIdx, im.itemQuery) }}
                        placeholder="Search or type new item name..."
                        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" style={{ fontSize: '16px' }} />
                      {itemSearchKey === key && itemMatches.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                          {itemMatches.map(function (m) {
                            return (
                              <button key={m._source + '_' + m.id} type="button" onMouseDown={function (evt) { evt.preventDefault(); pickItemMatch(iIdx, m) }}
                                className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-50 last:border-0">
                                <div className="text-[13px] text-gray-800 font-medium truncate">{m.name}</div>
                                <div className="text-[10px] text-gray-500">{m._source === 'catering_store' ? 'Catering Store' : 'Inventory'}{m.unit ? ' · ' + m.unit : ''}</div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {im.itemQuery && !im.itemMatchedId && itemMatches.length === 0 && itemSearchKey === key && im.itemQuery.length >= 2 && (
                        <p className="text-[10px] text-amber-600 mt-1">No match — receiver will create as new inventory item</p>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Qty <span className="text-red-500">*</span></label>
                      <input type="number" inputMode="numeric" value={im.itemQty} onChange={function (e) { updateItem(iIdx, 'itemQty', e.target.value) }}
                        placeholder="0" min="0" step="any"
                        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" style={{ fontSize: '16px' }} />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Unit</label>
                      <select value={im.itemUnit} onChange={function (e) { updateItem(iIdx, 'itemUnit', e.target.value) }}
                        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" style={{ fontSize: '16px' }}>
                        {ITEM_UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Rate <span className="text-red-500">*</span></label>
                      <input type="number" inputMode="decimal" value={im.itemRate} onChange={function (e) { updateItem(iIdx, 'itemRate', e.target.value) }}
                        placeholder="0" min="0" step="any"
                        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" style={{ fontSize: '16px' }} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">Notes <span className="font-normal text-gray-500">(brand, size, spec)</span></label>
                    <div className="flex items-center gap-2">
                      <input type="text" value={im.itemNotes} onChange={function (e) { updateItem(iIdx, 'itemNotes', e.target.value) }}
                        placeholder="e.g. White ceramic, 10-inch round"
                        className="flex-1 min-w-0 px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" style={{ fontSize: '16px' }} />
                      <button type="button" onClick={function () { setEditingItemIdx(-1) }}
                        title={complete ? 'Done — collapse this item' : 'Collapse this item'}
                        className={"shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border active:scale-95 transition-all " +
                          (complete ? "text-indigo-700 bg-indigo-50 border-indigo-300 hover:bg-indigo-100" : "text-gray-500 bg-white border-gray-200 hover:bg-gray-50")}>
                        <Icon name="chevronUp" size={16} />
                      </button>
                    </div>
                  </div>

                  {lineTotal > 0 && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                      <span className="text-[11px] font-medium text-gray-500">
                        Line total <span className="text-[13px] font-bold text-gray-900 tabular-nums">{lineTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts</span>
                      </span>
                    </div>
                  )}
                </div>
              )
            })}

            <button type="button" onClick={addItem}
              className="w-full py-2.5 rounded-xl border border-gray-200 text-[12px] font-semibold text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
              + Add item
            </button>

            {computeItemsTotal() > 0 && (
              <div className="flex items-center justify-between text-[12px] font-bold text-gray-700 pt-1">
                <span>Items total</span>
                <span className="tabular-nums">{computeItemsTotal().toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Optional: Update parent expense fields */}
      {isAdmin && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button type="button" onClick={function () { setFieldsExpanded(function (v) { return !v }) }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-gray-500 uppercase">Update parent expense fields</span>
              <span className="text-[10px] text-gray-400 normal-case tracking-normal">optional · admin only</span>
            </div>
            <span className={"text-gray-400 transition-transform " + (fieldsExpanded ? "rotate-180" : "")}>▾</span>
          </button>
          {fieldsExpanded && (function () {
            var currentTypeName = (expenseTypes.find(function (t) { return t.id === Number(exp.expense_type_id) }) || {}).name || '—'
            var currentSubName = (expenseSubTypes.find(function (s) { return s.id === Number(exp.expense_sub_type_id) }) || {}).name || '—'
            var subOpts = newTypeId ? expenseSubTypes.filter(function (s) { return s.expense_type_id === Number(newTypeId) }) : []
            var typeChangedPreview = Number(newTypeId || 0) !== Number(exp.expense_type_id || 0)
            var subChangedPreview = Number(newSubTypeId || 0) !== Number(exp.expense_sub_type_id || 0)
            var willUpdate = typeChangedPreview || subChangedPreview
            return (
              <div className="border-t border-gray-100 p-4 space-y-3 bg-gray-50">
                <div className="text-[10px] text-gray-500">
                  Current: <span className="font-semibold text-gray-700">{currentTypeName}</span>
                  {currentSubName !== '—' && <span> › <span className="font-semibold text-gray-700">{currentSubName}</span></span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">New expense type</label>
                    <select value={newTypeId}
                      onChange={function (e) { setNewTypeId(e.target.value); setNewSubTypeId('') }}
                      className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                      style={{ fontSize: '16px' }}>
                      <option value="">— Select —</option>
                      {expenseTypes.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name}</option> })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">New sub-type</label>
                    <select value={newSubTypeId}
                      onChange={function (e) { setNewSubTypeId(e.target.value) }}
                      disabled={!newTypeId}
                      className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-100 disabled:text-gray-400"
                      style={{ fontSize: '16px' }}>
                      <option value="">— None —</option>
                      {subOpts.map(function (s) { return <option key={s.id} value={String(s.id)}>{s.name}</option> })}
                    </select>
                  </div>
                </div>
                {willUpdate ? (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-semibold">
                    ⚠ This JV will update the parent expense fields. The change is captured in the audit trail.
                  </div>
                ) : (
                  <div className="text-[11px] text-gray-500 italic">No changes — leave collapsed to skip field updates.</div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Allocations */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <label className="text-[11px] font-bold text-gray-500 uppercase">New Allocations</label>
          <button onClick={addAlloc} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">+ Add Row</button>
        </div>
        <div className="space-y-3">
          {allocations.map(function (alloc, aIdx) {
            var allocDeptId = alloc.departmentId ? Number(alloc.departmentId) : null
            var scopedTypes = allocDeptId ? expenseTypes.filter(function (t) { return t.department_id === allocDeptId }) : []
            var genericTypes = expenseTypes.filter(function (t) { return !t.department_id })
            var subOpts = alloc.expenseTypeId ? expenseSubTypes.filter(function (s) { return s.expense_type_id === Number(alloc.expenseTypeId) }) : []
            return (
              <div key={alloc._key} className="flex gap-2 items-start border-t border-gray-100 pt-3 first:border-0 first:pt-0">
                <div className="flex-1 space-y-1.5">
                  <div className="grid grid-cols-2 gap-2">
                    <select value={alloc.departmentId}
                      onChange={function (e) { updateAlloc(aIdx, 'departmentId', e.target.value); updateAlloc(aIdx, 'expenseTypeId', ''); updateAlloc(aIdx, 'expenseSubTypeId', '') }}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }}>
                      <option value="">Dept *</option>
                      {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                    </select>
                    <select value={alloc.venueId}
                      onChange={function (e) { updateAlloc(aIdx, 'venueId', e.target.value) }}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }}>
                      <option value="">Venue</option>
                      {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code}</option> })}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={alloc.expenseTypeId}
                      onChange={function (e) { updateAlloc(aIdx, 'expenseTypeId', e.target.value); updateAlloc(aIdx, 'expenseSubTypeId', '') }}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }}>
                      <option value="">Type</option>
                      {scopedTypes.length > 0 && (
                        <optgroup label="Dept-specific">
                          {scopedTypes.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name}</option> })}
                        </optgroup>
                      )}
                      {genericTypes.length > 0 && (
                        <optgroup label="Generic">
                          {genericTypes.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name}</option> })}
                        </optgroup>
                      )}
                    </select>
                    <select value={alloc.expenseSubTypeId}
                      onChange={function (e) { updateAlloc(aIdx, 'expenseSubTypeId', e.target.value) }}
                      disabled={!alloc.expenseTypeId}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-100 disabled:text-gray-400" style={{ fontSize: '16px' }}>
                      <option value="">Sub-type</option>
                      {subOpts.map(function (s) { return <option key={s.id} value={String(s.id)}>{s.name}</option> })}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" inputMode="decimal" step="0.01" value={alloc.amountPts}
                      onChange={function (e) { updateAlloc(aIdx, 'amountPts', e.target.value) }}
                      placeholder="Amount (pts) *" className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }} />
                    <input type="text" value={alloc.remarks}
                      onChange={function (e) { updateAlloc(aIdx, 'remarks', e.target.value) }}
                      placeholder="Remarks" maxLength={200}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }} />
                  </div>
                </div>
                {allocations.length > 1 && (
                  <button type="button" onClick={function () { removeAlloc(aIdx) }}
                    className="text-red-400 hover:text-red-600 text-xs mt-1">✕</button>
                )}
              </div>
            )
          })}
        </div>

        {/* Running total */}
        <div className={"mt-3 pt-3 border-t border-gray-100 text-xs font-bold " + (sumOk ? 'text-green-700' : 'text-red-600')}>
          <div className="flex items-center justify-between">
            <span>Entered: {formatPoints(totalPaise)}</span>
            <span>Expected: {formatPoints(expectedPaise)}</span>
          </div>
          {overAllocated && (
            <p className="mt-1 font-normal">Over by {formatPoints(Math.abs(diff))} — reduce an allocation.</p>
          )}
          {!overAllocated && remainderPaise > 0 && !remainderNeedsManualEntry && (
            <p className="mt-1 font-normal text-gray-600">+ {formatPoints(remainderPaise)} auto-allocated to parent{parentTypeName ? ' (' + parentTypeName + ')' : ''}</p>
          )}
          {remainderNeedsManualEntry && (
            <p className="mt-1 font-normal">{formatPoints(remainderPaise)} unallocated — parent has no type/department to auto-fill; add it as a row.</p>
          )}
          {!overAllocated && remainderPaise === 0 && (
            <p className="mt-1 font-normal">✓ Fully allocated</p>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 font-medium">{error}</div>
      )}

      {/* Submit */}
      <button onClick={submit} disabled={saving || !sumOk || !reasonOk}
        className="w-full py-3 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm">
        {saving ? 'Raising JV...' : 'Raise Journal Voucher'}
      </button>
    </div>
  )
}

export default GVForm