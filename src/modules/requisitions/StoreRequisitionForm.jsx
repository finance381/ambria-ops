import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import EventDatePicker from '../../components/ui/EventDatePicker'
import Icon from '../../components/ui/Icon'
import { appConfirm } from '../../components/ui/AppDialog'

var KITCHEN_SECTIONS = ['Indian', 'Chinese', 'Chaat', 'Tandoor', 'Conti', 'Halwai', 'Staff Food', 'KST']

function emptyDeptRow(id) {
  return {
    id: id, departmentId: '', subDepartmentId: '', section: '', remarks: '',
    showInventory: false, showCasual: false,
    invSearch: '', invResults: [], invSearching: false,
    inventoryRows: [], casualRows: [],
  }
}

// Ranks a name match by how early/exact the hit is, so "Water Glass" beats
// "Golgappa Water Dispenser Glass" for a search of "water" instead of
// whichever order the database happened to return rows in.
function matchRank(name, term) {
  var n = name.toLowerCase()
  if (n === term) return 0
  if (n.indexOf(term) === 0) return 1
  var wordStart = n.indexOf(' ' + term)
  if (wordStart !== -1) return 2
  return 3
}

function rupees(paise) { return '₹' + Math.round((paise || 0) / 100).toLocaleString('en-IN') }

// ── Auto-save draft (new-requisition only) — same pattern as ExpenseForm's:
// debounced localStorage save, a restore banner on mount, a safety save on
// tab close, and a discard that only fires once the user actually submits.
// Nothing here is a File/Blob, so unlike ExpenseForm's draft there's no
// metadata-only stand-in to serialize — the live row shape saves as-is,
// just with the transient search box/results cleared out.
var DRAFT_KEY_PREFIX = 'ambria_storereq_draft_'
var DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
var DRAFT_DEBOUNCE_MS = 800

function serializeDraftRow(r) {
  return Object.assign({}, r, { invSearch: '', invResults: [], invSearching: false })
}

function isEmptyDraftRow(r) {
  if (!r) return true
  if (r.departmentId || r.subDepartmentId || r.section) return false
  if (r.remarks && r.remarks.trim()) return false
  if ((r.inventoryRows || []).length > 0) return false
  if ((r.casualRows || []).length > 0) return false
  return true
}

function isEmptyDraftState(s) {
  if (s.dateFrom || s.dateTo) return false
  if ((s.selectedEventIds || []).length > 0) return false
  if (!s.deptRows || s.deptRows.length === 0) return true
  return s.deptRows.every(isEmptyDraftRow)
}

function formatDraftAge(ts) {
  if (!ts) return ''
  var s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return s + 's ago'
  var m = Math.floor(s / 60)
  if (m < 60) return m + 'm ago'
  var h = Math.floor(m / 60)
  if (h < 24) return h + 'h ago'
  return Math.floor(h / 24) + 'd ago'
}

function StoreRequisitionForm({ profile, onDone, onCancel, editId }) {
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [contracts, setContracts] = useState([])
  var [contractsLoading, setContractsLoading] = useState(false)
  var [selectedEventIds, setSelectedEventIds] = useState([])

  var [departments, setDepartments] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [casualRoster, setCasualRoster] = useState([])

  var [deptRows, setDeptRows] = useState([emptyDeptRow(1)])
  var [nextRowId, setNextRowId] = useState(2)
  var [nextLineId, setNextLineId] = useState(1)
  var [loadingExisting, setLoadingExisting] = useState(!!editId)

  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  // Draft (new-requisition only) — restore banner + debounced save + save-indicator
  var [draftRestorable, setDraftRestorable] = useState(null)
  var [draftSavedAt, setDraftSavedAt] = useState(null)
  var [draftTick, setDraftTick] = useState(0)  // forces "Xs ago" refresh
  var draftSaveTimer = useRef(null)
  var draftKey = profile ? DRAFT_KEY_PREFIX + profile.id : null

  // ─── Draft: check localStorage on mount ───
  useEffect(function () {
    if (editId || !draftKey) return
    try {
      var raw = localStorage.getItem(draftKey)
      if (!raw) return
      var parsed = JSON.parse(raw)
      if (!parsed || !parsed.savedAt) return
      if (Date.now() - parsed.savedAt > DRAFT_EXPIRY_MS) { localStorage.removeItem(draftKey); return }
      if (isEmptyDraftState(parsed)) { localStorage.removeItem(draftKey); return }
      setDraftRestorable(parsed)
    } catch (_) {}
  }, [])

  // ─── Draft: debounced auto-save on changes ───
  useEffect(function () {
    if (editId || !draftKey || saving || loadingExisting) return
    if (draftRestorable) return  // don't clobber a pending restore with the blank default
    var state = { dateFrom: dateFrom, dateTo: dateTo, selectedEventIds: selectedEventIds, deptRows: deptRows, nextRowId: nextRowId, nextLineId: nextLineId }
    if (isEmptyDraftState(state)) return
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    draftSaveTimer.current = setTimeout(function () {
      try {
        var payload = Object.assign({ savedAt: Date.now() }, state, { deptRows: deptRows.map(serializeDraftRow) })
        localStorage.setItem(draftKey, JSON.stringify(payload))
        setDraftSavedAt(payload.savedAt)
      } catch (_) {}
    }, DRAFT_DEBOUNCE_MS)
    return function () { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current) }
  }, [dateFrom, dateTo, selectedEventIds, deptRows, nextRowId, nextLineId, editId, saving, draftRestorable, loadingExisting])

  // ─── Draft: safety-save on tab close / navigate away ───
  useEffect(function () {
    if (editId || !draftKey) return
    function handler() {
      try {
        var state = { dateFrom: dateFrom, dateTo: dateTo, selectedEventIds: selectedEventIds, deptRows: deptRows, nextRowId: nextRowId, nextLineId: nextLineId }
        if (isEmptyDraftState(state)) return
        var payload = Object.assign({ savedAt: Date.now() }, state, { deptRows: deptRows.map(serializeDraftRow) })
        localStorage.setItem(draftKey, JSON.stringify(payload))
      } catch (_) {}
    }
    window.addEventListener('beforeunload', handler)
    return function () { window.removeEventListener('beforeunload', handler) }
  }, [dateFrom, dateTo, selectedEventIds, deptRows, nextRowId, nextLineId, editId])

  // ─── Draft: tick "Xs ago" indicator every 15s ───
  useEffect(function () {
    if (!draftSavedAt) return
    var iv = setInterval(function () { setDraftTick(function (x) { return x + 1 }) }, 15000)
    return function () { clearInterval(iv) }
  }, [draftSavedAt])

  function restoreDraft() {
    if (!draftRestorable) return
    try {
      setDateFrom(draftRestorable.dateFrom || '')
      setDateTo(draftRestorable.dateTo || '')
      setSelectedEventIds(draftRestorable.selectedEventIds || [])
      setDeptRows((draftRestorable.deptRows && draftRestorable.deptRows.length > 0) ? draftRestorable.deptRows : [emptyDeptRow(1)])
      setNextRowId(draftRestorable.nextRowId || 2)
      setNextLineId(draftRestorable.nextLineId || 1)
      setDraftSavedAt(draftRestorable.savedAt)
    } catch (_) {}
    setDraftRestorable(null)
  }

  function discardDraft() {
    try { if (draftKey) localStorage.removeItem(draftKey) } catch (_) {}
    setDraftRestorable(null)
    setDraftSavedAt(null)
  }

  // The "clear" link sits one tap away from destroying everything entered so
  // far, with no undo. The restore banner's "Start fresh" is already a
  // deliberate choice between two buttons, so only this one asks.
  async function confirmDiscardDraft() {
    if (!(await appConfirm('Clear the saved draft? Anything entered but not submitted will be lost.'))) return
    discardDraft()
  }

  function clearDraftAfterSubmit() {
    try { if (draftKey) localStorage.removeItem(draftKey) } catch (_) {}
    setDraftSavedAt(null)
  }

  useEffect(function () {
    supabase.from('departments').select('id, name').eq('active', true).eq('hide_from_lists', false).order('name')
      .then(function (res) { setDepartments(res.data || []) })
    supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name')
      .then(function (res) { setSubDepartments(res.data || []) })
    supabase.from('casual_roster').select('id, department_id, sub_department_id, casual_type, rate_type, rate_paise').eq('is_active', true).order('casual_type')
      .then(function (res) { setCasualRoster(res.data || []) })
  }, [])

  // Editing loads the saved dept rows/items/casuals back into the exact same
  // shape handleSubmit already knows how to build a payload from, so edit
  // and create share every line of submit logic below.
  useEffect(function () {
    if (!editId) return
    setLoadingExisting(true)
    Promise.all([
      supabase.from('store_requisitions').select('date_from, date_to, event_ids').eq('id', editId).single(),
      supabase.from('store_requisition_dept_rows').select('id, department_id, sub_department_id, section, remarks, sort_order').eq('store_requisition_id', editId).order('sort_order'),
    ]).then(function (res) {
      var reqRow = res[0].data
      var drRows = res[1].data || []
      if (reqRow) { setDateFrom(reqRow.date_from); setDateTo(reqRow.date_to); setSelectedEventIds(reqRow.event_ids || []) }
      var drIds = drRows.map(function (r) { return r.id })
      if (drIds.length === 0) {
        setDeptRows([emptyDeptRow(1)]); setNextRowId(2); setLoadingExisting(false); return
      }
      Promise.all([
        supabase.from('store_requisition_items').select('*').in('dept_row_id', drIds),
        supabase.from('store_requisition_casuals').select('*').in('dept_row_id', drIds),
      ]).then(function (res2) {
        var items = res2[0].data || []
        var casuals = res2[1].data || []
        var lineId = 1
        var rowId = 1
        var built = drRows.map(function (dr) {
          var rowItems = items.filter(function (it) { return it.dept_row_id === dr.id }).map(function (it) {
            return { id: lineId++, itemSource: it.item_source, itemId: it.item_id, name: it.item_name, unit: it.unit, qty: Number(it.qty), ratePaise: it.rate_paise }
          })
          var rowCasuals = casuals.filter(function (c) { return c.dept_row_id === dr.id }).map(function (c) {
            return { id: lineId++, casualRosterId: c.casual_roster_id != null ? String(c.casual_roster_id) : '', qty: Number(c.qty) }
          })
          return {
            id: rowId++,
            departmentId: String(dr.department_id), subDepartmentId: String(dr.sub_department_id), section: dr.section || '', remarks: dr.remarks || '',
            showInventory: rowItems.length > 0, showCasual: rowCasuals.length > 0,
            invSearch: '', invResults: [], invSearching: false,
            inventoryRows: rowItems, casualRows: rowCasuals,
          }
        })
        setDeptRows(built)
        setNextRowId(rowId)
        setNextLineId(lineId)
        setLoadingExisting(false)
      })
    })
  }, [editId])

  useEffect(function () {
    if (!dateFrom || !dateTo) { setContracts([]); return }
    setContractsLoading(true)
    supabase.from('events_safe')
      .select('id, event_name, client_name, venue_name, function_date, department, total_plates, complementary_plates')
      .in('department', ['Venue', 'Catering'])
      .gte('function_date', dateFrom).lte('function_date', dateTo)
      .is('merged_into_id', null)
      .order('function_date')
      .then(function (evRes) {
        var events = evRes.data || []
        var eventIds = events.map(function (e) { return e.id })
        if (eventIds.length === 0) { setContracts([]); setContractsLoading(false); return }
        Promise.all([
          supabase.from('extra_plate_issues').select('event_id, plates_count, status').in('event_id', eventIds),
          supabase.from('extra_plate_collections').select('event_id, extras_charged, plates_returned, status').in('event_id', eventIds),
        ]).then(function (res) {
          var issues = res[0].data || []
          var colls = res[1].data || []
          var rows = events.map(function (e) {
            var issued = issues.filter(function (i) { return i.event_id === e.id && i.status === 'active' })
              .reduce(function (s, i) { return s + Number(i.plates_count || 0) }, 0)
            var activeColls = colls.filter(function (c) { return c.event_id === e.id && (!c.status || c.status === 'active') })
            var charged = activeColls.reduce(function (s, c) { return s + Number(c.extras_charged || 0) }, 0)
            var returned = activeColls.reduce(function (s, c) { return s + Number(c.plates_returned || 0) }, 0)
            var balance = Math.max(0, issued - charged - returned)
            return {
              id: e.id,
              event: e.event_name || e.client_name || '—',
              venueDate: (e.venue_name || '—') + ' · ' + e.function_date,
              booking: e.total_plates || 0,
              extra: issued,
              balance: balance,
              actual: (e.total_plates || 0) + charged,
            }
          })
          setContracts(rows)
          setContractsLoading(false)
        })
      })
  }, [dateFrom, dateTo])

  function patchRow(rowId, patch) {
    setDeptRows(function (prev) { return prev.map(function (r) { return r.id === rowId ? Object.assign({}, r, patch) : r }) })
  }

  function addDeptRow() {
    setDeptRows(function (prev) { return prev.concat([emptyDeptRow(nextRowId)]) })
    setNextRowId(function (n) { return n + 1 })
  }
  function removeDeptRow(rowId) {
    setDeptRows(function (prev) { return prev.filter(function (r) { return r.id !== rowId }) })
  }

  function subDeptsFor(departmentId) {
    return subDepartments.filter(function (sd) { return String(sd.department_id) === String(departmentId) })
  }
  function isKitchenRow(row) {
    var dept = departments.find(function (d) { return String(d.id) === String(row.departmentId) })
    var sub = subDepartments.find(function (sd) { return String(sd.id) === String(row.subDepartmentId) })
    return !!(dept && dept.name === 'Catering' && sub && sub.name === 'Kitchen')
  }
  function casualsFor(departmentId) {
    return casualRoster.filter(function (c) { return String(c.department_id) === String(departmentId) })
  }

  function onChangeDepartment(rowId, e) {
    var deptId = e.target.value
    var firstSub = subDeptsFor(deptId)[0]
    patchRow(rowId, { departmentId: deptId, subDepartmentId: firstSub ? firstSub.id : '', section: '' })
  }
  function onChangeSubDepartment(rowId, e) {
    patchRow(rowId, { subDepartmentId: e.target.value, section: '' })
  }
  function onChangeSection(rowId, e) {
    patchRow(rowId, { section: e.target.value })
  }
  function onChangeRemarks(rowId, e) {
    patchRow(rowId, { remarks: e.target.value })
  }

  function toggleEvent(eventId) {
    setSelectedEventIds(function (prev) {
      return prev.indexOf(eventId) !== -1 ? prev.filter(function (id) { return id !== eventId }) : prev.concat([eventId])
    })
  }

  function onInvSearchChange(rowId, e) {
    var term = e.target.value
    patchRow(rowId, { invSearch: term })
    if (term.trim().length < 2) { patchRow(rowId, { invResults: [] }); return }
    var termLower = term.trim().toLowerCase()
    patchRow(rowId, { invSearching: true })
    Promise.all([
      supabase.from('inventory_items').select('id, name, unit, rate_paise').ilike('name', '%' + term.trim() + '%').eq('status', 'approved').limit(20),
      supabase.from('catering_store_items').select('id, name, unit, rate_paise').ilike('name', '%' + term.trim() + '%').eq('status', 'approved').limit(20),
    ]).then(function (res) {
      var inv = (res[0].data || []).map(function (it) { return { itemSource: 'inventory', itemId: it.id, name: it.name, unit: it.unit, ratePaise: it.rate_paise != null ? it.rate_paise : null } })
      var cs = (res[1].data || []).map(function (it) { return { itemSource: 'catering_store', itemId: it.id, name: it.name, unit: it.unit, ratePaise: it.rate_paise != null ? it.rate_paise : null } })
      // A name-anywhere ilike match returns rows in whatever order the table
      // happens to store them — "Golgappa Water Dispenser Glass" ahead of
      // "Water Glass" for a search of "water". Re-sorted so an exact/
      // starts-with/word-start hit always outranks a mid-word one.
      var combined = inv.concat(cs).sort(function (a, b) {
        var ra = matchRank(a.name, termLower), rb = matchRank(b.name, termLower)
        if (ra !== rb) return ra - rb
        return a.name.length - b.name.length
      }).slice(0, 12)
      patchRow(rowId, { invResults: combined, invSearching: false })
    })
  }

  async function addInventoryItem(row, pick) {
    var latestRate = pick.ratePaise
    var res = await supabase.rpc('fn_item_latest_rate', { p_item_id: pick.itemId, p_item_source: pick.itemSource })
    if (!res.error && res.data != null) latestRate = res.data
    var lineId = nextLineId
    setNextLineId(function (n) { return n + 1 })
    var newLine = { id: lineId, itemSource: pick.itemSource, itemId: pick.itemId, name: pick.name, unit: pick.unit, qty: '', ratePaise: latestRate == null ? '' : latestRate }
    patchRow(row.id, { inventoryRows: row.inventoryRows.concat([newLine]), invSearch: '', invResults: [] })
  }
  // Kept as the raw typed string (not coerced to a number) so the field can
  // actually be empty — a store requisition that starts every new line at
  // "1" risked someone submitting a qty they never meant to confirm.
  function changeInvQty(row, lineId, e) {
    var q = e.target.value
    patchRow(row.id, {
      inventoryRows: row.inventoryRows.map(function (l) { return l.id === lineId ? Object.assign({}, l, { qty: q }) : l })
    })
  }
  function removeInventoryRow(row, lineId) {
    patchRow(row.id, { inventoryRows: row.inventoryRows.filter(function (l) { return l.id !== lineId }) })
  }
  // Rate is pre-filled from the most recent purchase, but a store
  // requisition needs to accept whatever's actually happening on the
  // ground — let someone override it by hand when the auto-fetched rate
  // isn't right.
  function changeInvRate(row, lineId, e) {
    var raw = e.target.value
    var paise = raw === '' ? '' : Math.round((Number(raw) || 0) * 100)
    patchRow(row.id, {
      inventoryRows: row.inventoryRows.map(function (l) { return l.id === lineId ? Object.assign({}, l, { ratePaise: paise }) : l })
    })
  }

  function addCasualRow(row) {
    var first = casualsFor(row.departmentId)[0]
    var lineId = nextLineId
    setNextLineId(function (n) { return n + 1 })
    var newLine = { id: lineId, casualRosterId: first ? first.id : '', qty: 1 }
    patchRow(row.id, { casualRows: row.casualRows.concat([newLine]) })
  }
  function changeCasualType(row, lineId, e) {
    var id = e.target.value
    patchRow(row.id, {
      casualRows: row.casualRows.map(function (l) { return l.id === lineId ? Object.assign({}, l, { casualRosterId: id }) : l })
    })
  }
  function changeCasualQty(row, lineId, e) {
    var q = Number(e.target.value) || 0
    patchRow(row.id, {
      casualRows: row.casualRows.map(function (l) { return l.id === lineId ? Object.assign({}, l, { qty: q }) : l })
    })
  }
  function removeCasualRow(row, lineId) {
    patchRow(row.id, { casualRows: row.casualRows.filter(function (l) { return l.id !== lineId }) })
  }

  function casualRateFor(id) {
    var c = casualRoster.find(function (x) { return String(x.id) === String(id) })
    return c ? c.rate_paise : 0
  }
  function rowInvSubtotal(row) { return row.inventoryRows.reduce(function (s, l) { return s + (Number(l.qty) || 0) * l.ratePaise }, 0) }
  function rowCasSubtotal(row) { return row.casualRows.reduce(function (s, l) { return s + l.qty * casualRateFor(l.casualRosterId) }, 0) }
  function rowTotal(row) { return rowInvSubtotal(row) + rowCasSubtotal(row) }
  var grandTotal = deptRows.reduce(function (s, r) { return s + rowTotal(r) }, 0)

  var canSubmit = dateFrom && dateTo && deptRows.length > 0 &&
    deptRows.every(function (r) {
      return r.departmentId && r.subDepartmentId && (r.inventoryRows.length > 0 || r.casualRows.length > 0) &&
        r.inventoryRows.every(function (l) { return Number(l.qty) > 0 }) &&
        r.casualRows.every(function (l) { return Number(l.qty) > 0 })
    })

  async function handleSubmit() {
    if (!canSubmit || saving) return
    setSaving(true); setError('')
    var payload = deptRows.map(function (r) {
      return {
        department_id: Number(r.departmentId),
        sub_department_id: Number(r.subDepartmentId),
        section: isKitchenRow(r) ? r.section : null,
        remarks: r.remarks ? r.remarks.trim() : null,
        items: r.inventoryRows.map(function (l) {
          return { item_source: l.itemSource, item_id: l.itemId, item_name: l.name, unit: l.unit, qty: Number(l.qty) || 0, rate_paise: Number(l.ratePaise) || 0 }
        }),
        casuals: r.casualRows.map(function (l) {
          var c = casualRoster.find(function (x) { return String(x.id) === String(l.casualRosterId) })
          return { casual_roster_id: l.casualRosterId || null, casual_type: c ? c.casual_type : '', qty: Number(l.qty) || 0, rate_paise: c ? c.rate_paise : 0 }
        }),
      }
    })
    var res = editId
      ? await supabase.rpc('rpc_update_store_requisition', { p_id: editId, p_date_from: dateFrom, p_date_to: dateTo, p_dept_rows: payload, p_event_ids: selectedEventIds })
      : await supabase.rpc('rpc_submit_store_requisition', { p_date_from: dateFrom, p_date_to: dateTo, p_dept_rows: payload, p_event_ids: selectedEventIds })
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    try { await logActivity(editId ? 'STORE_REQUISITION_EDIT' : 'STORE_REQUISITION_SUBMIT', dateFrom + ' to ' + dateTo + ' · ' + rupees(grandTotal)) } catch (_) {}
    clearDraftAfterSubmit()
    if (onDone) onDone(res.data)
  }

  var CARD = 'bg-white border border-gray-200 rounded-2xl p-4 space-y-3'
  var CTRL = 'w-full h-9 px-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
  var LABEL = 'block text-[11px] font-semibold text-gray-500 mb-0.5'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{editId ? 'Edit Store Requisition' : 'New Store Requisition'}</h2>
          <p className="text-xs text-gray-400">Record inventory and casual labour consumed between two dates.</p>
        </div>
        <button onClick={onCancel} className="px-3 py-2 text-sm font-semibold text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
      </div>

      {!editId && draftRestorable && (
        <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-indigo-900 leading-snug">Restore your previous data?</p>
            <p className="text-[11px] font-medium text-indigo-500/90 tabular-nums">
              Last saved {formatDraftAge(draftRestorable.savedAt)} · {(draftRestorable.deptRows || []).length} row{(draftRestorable.deptRows || []).length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={restoreDraft}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
              <Icon name="undo" size={14} /> Restore
            </button>
            <button type="button" onClick={discardDraft}
              className="inline-flex items-center justify-center h-9 px-4 rounded-lg text-[13px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors">
              Start fresh
            </button>
          </div>
        </div>
      )}

      {!editId && !draftRestorable && draftSavedAt && (
        <div className="flex justify-end">
          <div className="inline-flex items-center h-7 rounded-full overflow-hidden text-[11px] bg-gray-100 border border-gray-200">
            <span className="inline-flex items-center gap-1.5 pl-2.5 pr-2 font-semibold text-gray-700 whitespace-nowrap">
              <span className="relative flex w-1.5 h-1.5">
                <span key={draftSavedAt} style={{ animationIterationCount: 2 }}
                  className="absolute inset-0 rounded-full bg-emerald-500 opacity-60 animate-ping motion-reduce:hidden" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </span>
              Draft saved
              <span className="font-medium text-gray-400">{formatDraftAge(draftSavedAt + draftTick * 0)}</span>
            </span>
            <span aria-hidden="true" className="w-px h-3.5 bg-gray-300" />
            <button type="button" onClick={confirmDiscardDraft} aria-label="Discard saved draft"
              className="inline-flex items-center gap-1 h-full pl-2 pr-2.5 font-semibold text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors">
              <Icon name="trash" size={11} /> Clear
            </button>
          </div>
        </div>
      )}

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {loadingExisting && <p className="text-gray-400 text-sm text-center py-8">Loading…</p>}

      {!loadingExisting && <>

      <div className={CARD}>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Period</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>From date</label>
            <EventDatePicker value={dateFrom} placeholder="From" collapsible plain includePast onChange={function (v) { setDateFrom(v) }} />
          </div>
          <div>
            <label className={LABEL}>To date</label>
            <EventDatePicker value={dateTo} placeholder="To" collapsible plain includePast onChange={function (v) { setDateTo(v) }} />
          </div>
        </div>
      </div>

      {(dateFrom && dateTo) && (
        <div className={CARD}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Contracts in this period</p>
            {selectedEventIds.length > 0 && (
              <p className="text-xs font-semibold text-indigo-600">{selectedEventIds.length} selected</p>
            )}
          </div>
          {contractsLoading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading contracts…</p>
          ) : contracts.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No venue/catering contracts in this window.</p>
          ) : (
            <div className="space-y-1.5">
              {contracts.map(function (c) {
                var isSel = selectedEventIds.indexOf(c.id) !== -1
                return (
                  <button key={c.id} type="button" onClick={function () { toggleEvent(c.id) }}
                    className={'w-full text-left rounded-lg border px-3 py-2 transition-colors ' + (isSel ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-gray-200 active:bg-gray-50')}>
                    <div className="flex items-center gap-2.5">
                      <span className={'shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center ' + (isSel ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300')}>
                        {isSel && <Icon name="check" size={11} className="text-white" />}
                      </span>
                      <p className="min-w-0 flex-1 font-bold text-gray-900 text-sm truncate">{c.event}</p>
                      <p className="shrink-0 text-sm font-bold text-indigo-600 tabular-nums">{c.actual}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5 pl-[26px]">
                      <p className="text-[11px] text-gray-500 truncate">{c.venueDate}</p>
                      <p className="shrink-0 text-[11px] text-gray-400 tabular-nums">{c.booking} · {c.extra} · {c.balance}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">What was taken out</p>
        <button onClick={addDeptRow} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-indigo-600 border border-dashed border-gray-300 rounded-lg hover:bg-indigo-50">
          <Icon name="plus" size={13} /> Add Dept Row
        </button>
      </div>

      {deptRows.map(function (row, idx) {
        var isKitchen = isKitchenRow(row)
        var deptName = (departments.find(function (d) { return String(d.id) === String(row.departmentId) }) || {}).name || ''
        return (
          <div key={row.id} className={CARD}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-800">Dept Row {idx + 1}</p>
              <button onClick={function () { removeDeptRow(row.id) }} aria-label="Remove row" className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100">
                <Icon name="close" size={13} />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div>
                <label className={LABEL}>Department</label>
                <select value={row.departmentId} onChange={function (e) { onChangeDepartment(row.id, e) }} className={CTRL}>
                  <option value="">Select…</option>
                  {departments.map(function (d) { return <option key={d.id} value={d.id}>{d.name}</option> })}
                </select>
              </div>
              <div>
                <label className={LABEL}>Sub-Department</label>
                <select value={row.subDepartmentId} onChange={function (e) { onChangeSubDepartment(row.id, e) }} disabled={!row.departmentId} className={CTRL}>
                  <option value="">Select…</option>
                  {subDeptsFor(row.departmentId).map(function (sd) { return <option key={sd.id} value={sd.id}>{sd.name}</option> })}
                </select>
              </div>
              {isKitchen && (
                <div className="col-span-2 sm:col-span-1">
                  <label className={LABEL}>Section</label>
                  <select value={row.section} onChange={function (e) { onChangeSection(row.id, e) }} className={CTRL + ' bg-amber-50 border-amber-300'}>
                    <option value="">Select…</option>
                    {KITCHEN_SECTIONS.map(function (s) { return <option key={s} value={s}>{s}</option> })}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className={LABEL}>Remarks</label>
              <input type="text" value={row.remarks} onChange={function (e) { onChangeRemarks(row.id, e) }}
                placeholder="Optional note for this row…" className={CTRL} style={{ fontSize: '16px' }} />
            </div>

            <div className="flex gap-2">
              <button onClick={function () { patchRow(row.id, { showInventory: !row.showInventory }) }}
                className={'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border ' + (row.showInventory ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-600')}>
                <Icon name="plus" size={13} /> Add Inventory
              </button>
              <button onClick={function () { patchRow(row.id, { showCasual: !row.showCasual }) }}
                className={'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border ' + (row.showCasual ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-600')}>
                <Icon name="plus" size={13} /> Add Casual
              </button>
            </div>

            {row.showInventory && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                <p className="text-xs font-bold text-gray-500">Inventory used</p>
                {row.inventoryRows.length > 0 && (
                  <div className="space-y-2">
                    {row.inventoryRows.map(function (l) {
                      return (
                        <div key={l.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm text-gray-800 truncate">{l.name}</p>
                              <p className="text-xs text-gray-400">{l.unit}</p>
                            </div>
                            <button onClick={function () { removeInventoryRow(row, l.id) }} aria-label="Remove item"
                              className="shrink-0 w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100">
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                          <div className="flex items-end gap-2 mt-2">
                            <div className="flex-1">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">Qty</label>
                              <input type="number" value={l.qty} onChange={function (e) { changeInvQty(row, l.id, e) }} placeholder="0"
                                className="w-full h-9 px-2 text-right border border-gray-300 rounded-lg" style={{ fontSize: '16px' }} />
                            </div>
                            <div className="flex-1">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">Rate</label>
                              <input type="number" value={l.ratePaise === '' ? '' : l.ratePaise / 100} onChange={function (e) { changeInvRate(row, l.id, e) }} placeholder="0"
                                className="w-full h-9 px-2 text-right border border-gray-300 rounded-lg text-gray-700" style={{ fontSize: '16px' }} />
                            </div>
                            <div className="flex-1 text-right pb-1.5">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">Total</label>
                              <p className="text-sm font-bold text-gray-900">{rupees((Number(l.qty) || 0) * l.ratePaise)}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {row.inventoryRows.length > 0 && (
                  <p className="text-right text-xs text-gray-500">Inventory subtotal <span className="font-bold text-gray-900">{rupees(rowInvSubtotal(row))}</span></p>
                )}
                <div className="relative">
                  <input type="text" value={row.invSearch} onChange={function (e) { onInvSearchChange(row.id, e) }}
                    placeholder="Search inventory items to add..." className={CTRL + ' pl-8'} style={{ fontSize: '16px' }} />
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"><Icon name="search" size={14} /></span>
                  {row.invResults.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 bottom-full mb-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                      {row.invResults.map(function (r) {
                        return (
                          <button key={r.itemSource + ':' + r.itemId} onClick={function () { addInventoryItem(row, r) }}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50 border-b border-gray-100 last:border-0">
                            <span className="font-semibold">{r.name}</span>
                            <span className="text-gray-400 text-xs">{r.unit}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {row.showCasual && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-gray-500">Casuals used</p>
                  <button onClick={function () { addCasualRow(row) }} disabled={!row.departmentId}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-indigo-600 border border-gray-300 rounded-md bg-white disabled:opacity-40">
                    <Icon name="plus" size={11} /> Add Row
                  </button>
                </div>
                {row.casualRows.length > 0 && (
                  <div className="space-y-2">
                    {row.casualRows.map(function (l) {
                      var rate = casualRateFor(l.casualRosterId)
                      return (
                        <div key={l.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
                          <div className="flex items-start gap-2">
                            <select value={l.casualRosterId} onChange={function (e) { changeCasualType(row, l.id, e) }}
                              className="flex-1 h-9 min-w-0 px-2 border border-gray-300 rounded-lg font-semibold text-sm" style={{ fontSize: '16px' }}>
                              {casualsFor(row.departmentId).map(function (c) { return <option key={c.id} value={c.id}>{c.casual_type}</option> })}
                            </select>
                            <button onClick={function () { removeCasualRow(row, l.id) }} aria-label="Remove casual"
                              className="shrink-0 w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-100">
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                          <div className="flex items-end gap-2 mt-2">
                            <div className="flex-1">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">Qty</label>
                              <input type="number" value={l.qty} onChange={function (e) { changeCasualQty(row, l.id, e) }}
                                className="w-full h-9 px-2 text-right border border-gray-300 rounded-lg" style={{ fontSize: '16px' }} />
                            </div>
                            <div className="flex-1 text-right pb-1.5">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">Rate</label>
                              <p className="text-sm text-gray-500">{rupees(rate)}</p>
                            </div>
                            <div className="flex-1 text-right pb-1.5">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">Total</label>
                              <p className="text-sm font-bold text-gray-900">{rupees(l.qty * rate)}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {row.casualRows.length > 0 && (
                  <p className="text-right text-xs text-gray-500">Casual subtotal <span className="font-bold text-gray-900">{rupees(rowCasSubtotal(row))}</span></p>
                )}
              </div>
            )}

            <div className="flex justify-end border-t border-gray-100 pt-2">
              <p className="text-sm">Row total <span className="font-bold text-indigo-600">{rupees(rowTotal(row))}</span></p>
            </div>
          </div>
        )
      })}

      <div className="bg-gray-900 rounded-2xl px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Grand total</p>
          <p className="text-xl font-bold text-white mt-0.5">{rupees(grandTotal)}</p>
        </div>
        <button onClick={handleSubmit} disabled={!canSubmit || saving}
          className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors">
          {saving ? 'Saving…' : (editId ? 'Save Changes' : 'Submit Requisition')}
        </button>
      </div>

      </>}
    </div>
  )
}

export default StoreRequisitionForm
