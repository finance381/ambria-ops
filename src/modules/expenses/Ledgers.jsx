import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate, formatDateTime } from '../../lib/format'
import { pushBack } from '../../lib/backNav'
import { registerPdfFont } from '../../lib/pdfFont'
import { openOrSharePdf } from '../../lib/pdfOutput'
import { plainParticularsLines, plainDateLines, makeStatementCellHooks } from '../../lib/pdfStatementTable'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { useExpenseDetailModal } from '../../hooks/useExpenseDetailModal.jsx'
import SearchField from '../../components/ui/SearchField'
import Icon from '../../components/ui/Icon'

var STATUS_LABELS = { recorded: 'Recorded', flagged: 'Resubmit', acknowledged: 'Acknowledged', deducted: 'Deducted' }

// One template for the header and all three levels of row. It was written out
// four times, which is four chances for a column to stop lining up with its own
// heading. The money columns are wider than they were: a lakh in points is
// eleven characters and 80px was cutting them to the edge of the cell.
var COLS = 'grid grid-cols-[1fr_104px_104px_104px_120px_44px] gap-2'

// The per-row export. Three of them, one per level.
var PDF_BTN = 'shrink-0 px-2.5 inline-flex items-center gap-1 border-l border-slate-100 text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors'
var STATUS_COLORS = {
  recorded: 'bg-amber-100 text-amber-700',
  flagged: 'bg-orange-100 text-orange-700',
  acknowledged: 'bg-green-100 text-green-700',
  deducted: 'bg-indigo-100 text-indigo-700',
}
var PAGE_SIZE = 50

var SUB_MODE_LABEL = { upi: 'UPI', bank_transfer: 'Bank Transfer', cheque: 'Cheque', paytm_card_machine: 'Paytm Card', hdfc_card_machine: 'HDFC Card' }

function _paymentLabel(mode, subMode) {
  if (!mode) return '—'
  if (mode === 'cash') return 'Cash'
  return 'Bank' + (subMode ? ' · ' + (SUB_MODE_LABEL[subMode] || subMode) : '')
}

var SOURCE_BADGES = {
  allocation: { label: 'Allocation', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  auto_default: { label: 'No alloc', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  cost_transfer: { label: 'Transfer', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
}

function fmtISO(d) { return d.toISOString().split('T')[0] }

function getPresetRange(preset) {
  var d = new Date()
  if (preset === 'month') return { from: fmtISO(new Date(d.getFullYear(), d.getMonth(), 1)), to: fmtISO(d) }
  if (preset === 'lastMonth') return { from: fmtISO(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: fmtISO(new Date(d.getFullYear(), d.getMonth(), 0)) }
  if (preset === 'ytd') return { from: fmtISO(new Date(d.getFullYear(), 0, 1)), to: fmtISO(d) }
  return null
}

function Ledgers({ profile, onNavigateToExpenses }) {
  var isAdmin = hasPerm(profile?.permsNew, 'finance.ledgers.expense')
  var scopeDeptIds = isAdmin ? null : (profile?.event_dept_ids || [])
  var hasScope = !isAdmin && scopeDeptIds && scopeDeptIds.length > 0
  var { openExpenseDetail, expenseDetailModal } = useExpenseDetailModal(profile, isAdmin, function () { loadDrill(false) }, onNavigateToExpenses)

  // Date state
  var [datePreset, setDatePreset] = useState('month')
  var [dateFrom, setDateFrom] = useState(function () { return getPresetRange('month').from })
  var [dateTo, setDateTo] = useState(function () { return getPresetRange('month').to })

  // Filters
  var [search, setSearch] = useState('')
  var [searchDeb, setSearchDeb] = useState('')
  var [userFilter, setUserFilter] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('')
  var [pendingOnly, setPendingOnly] = useState(false)
  var [pdfBusy, setPdfBusy] = useState(false)

  // Master maps
  var [deptMap, setDeptMap] = useState({})
  var [userMap, setUserMap] = useState({})
  var [users, setUsers] = useState([])
  var refData = useReferenceData()
  var typeMap = useMemo(function () {
    var m = {}; refData.expenseTypes.forEach(function (t) { m[t.id] = t.name }); return m
  }, [refData.expenseTypes])
  var subTypeMap = useMemo(function () {
    var m = {}; refData.expenseSubTypes.forEach(function (s) { m[s.id] = s.name }); return m
  }, [refData.expenseSubTypes])
  var venueMap = useMemo(function () {
    var m = {}; refData.venues.forEach(function (v) { m[v.id] = v.name || v.code }); return m
  }, [refData.venues])
  var venues = useMemo(function () {
    return refData.venues.slice().sort(function (a, b) { return (a.name || a.code || '').localeCompare(b.name || b.code || '') })
  }, [refData.venues])

  // List state
  var [deptGroups, setDeptGroups] = useState([])
  var [totals, setTotals] = useState({ total: 0, pending: 0, committed: 0, credit: 0, allocs: 0 })
  var [loading, setLoading] = useState(false)
  var [collapsedDepts, setCollapsedDepts] = useState({})
  var [collapsedTypes, setCollapsedTypes] = useState({})
  var collapseInitializedRef = useRef(false)
  var [deptDelta, setDeptDelta] = useState({})
  var allocSnapshot = useRef({})
  var isFirstLoad = useRef(true)

  // Drill state
  var [drillGroup, setDrillGroup] = useState(null)
  var [drillRows, setDrillRows] = useState([])
  var [drillOffset, setDrillOffset] = useState(0)
  var [drillHasMore, setDrillHasMore] = useState(false)
  var [drillLoading, setDrillLoading] = useState(false)
  var [drillUserFilter, setDrillUserFilter] = useState('')
  var [drillStatusFilter, setDrillStatusFilter] = useState('')
  var [drillVenueFilter, setDrillVenueFilter] = useState('')

  var reloadTimer = useRef(null)

  useEffect(function () { loadMaps() }, [])

  useEffect(function () {
    var t = setTimeout(function () { setSearchDeb(search) }, 300)
    return function () { clearTimeout(t) }
  }, [search])

  useEffect(function () {
    isFirstLoad.current = true
    loadLedger()
  }, [dateFrom, dateTo, userFilter, venueFilter, statusFilter, (scopeDeptIds || []).join(',')])

  useEffect(function () {
    if (drillGroup) { setDrillOffset(0); loadDrill(false) }
  }, [drillGroup, drillUserFilter, drillStatusFilter, drillVenueFilter, dateFrom, dateTo])

  useEffect(function () {
    function schedule() {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(function () {
        loadLedger()
        if (drillGroup) { setDrillOffset(0); loadDrill(false) }
      }, 800)
    }
    var channel = supabase.channel('ledgers-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_allocations' }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'expenses' }, schedule)
      .subscribe()
    return function () {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      supabase.removeChannel(channel)
    }
  }, [dateFrom, dateTo, userFilter, venueFilter, statusFilter, drillGroup])

  async function loadMaps() {
    var res = await Promise.all([
      supabase.from('departments').select('id, name'),
      supabase.from('profiles').select('id, name'),
    ])
    var dm = {}; (res[0].data || []).forEach(function (d) { dm[d.id] = d.name })
    var um = {}; (res[1].data || []).forEach(function (u) { um[u.id] = u.name })
    setDeptMap(dm); setUserMap(um)
    setUsers((res[1].data || []).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') }))
  }

  async function loadLedger() {
    setLoading(true)
    var statusIn = statusFilter ? [statusFilter] : ['recorded', 'flagged', 'acknowledged', 'deducted']
    var rows = []; var from = 0; var pageSize = 1000
    while (true) {
      var q = supabase.from('v_ledger')
        .select('department_id, expense_type_id, expense_sub_type_id, amount_paise, pending_paise, committed_paise')
        .in('status', statusIn)
        .gte('expense_date', dateFrom)
        .lte('expense_date', dateTo)
        .range(from, from + pageSize - 1)
      if (hasScope) q = q.in('department_id', scopeDeptIds)
      if (userFilter) q = q.eq('user_id', userFilter)
      if (venueFilter) q = q.eq('venue_id', Number(venueFilter))
      var page = await q
      if (page.error) { alert('Load failed: ' + page.error.message); setLoading(false); return }
      var chunk = page.data || []
      rows = rows.concat(chunk)
      if (chunk.length < pageSize) break
      from += pageSize
      if (from > 50000) break
    }

    var byDept = {}
    var total = 0, pending = 0, committed = 0, credit = 0
    rows.forEach(function (r) {
      var deptKey = r.department_id != null ? String(r.department_id) : '__unassigned__'
      var typeKey = r.expense_type_id != null ? String(r.expense_type_id) : '__untyped__'
      var subKey = r.expense_sub_type_id != null ? String(r.expense_sub_type_id) : '__no_sub__'
      // Cost-transfer-out rows come through with a negative amount_paise (see v_ledger) —
      // those are credits against this dept/type/sub-type, not debits. Everything else
      // (real expense allocations + cost-transfer-in) is a debit, split acknowledged/pending.
      var isCredit = (r.amount_paise || 0) < 0
      if (!byDept[deptKey]) {
        byDept[deptKey] = { key: deptKey, deptId: r.department_id, total: 0, pending: 0, committed: 0, credit: 0, allocs: 0, typeMap: {} }
      }
      var g = byDept[deptKey]
      g.total += r.amount_paise || 0
      if (isCredit) { g.credit += -(r.amount_paise || 0) } else { g.pending += r.pending_paise || 0; g.committed += r.committed_paise || 0 }
      g.allocs += 1
      if (!g.typeMap[typeKey]) {
        g.typeMap[typeKey] = { typeKey: typeKey, typeId: r.expense_type_id, total: 0, pending: 0, committed: 0, credit: 0, allocs: 0, subMap: {} }
      }
      var t = g.typeMap[typeKey]
      t.total += r.amount_paise || 0
      if (isCredit) { t.credit += -(r.amount_paise || 0) } else { t.pending += r.pending_paise || 0; t.committed += r.committed_paise || 0 }
      t.allocs += 1
      if (!t.subMap[subKey]) {
        t.subMap[subKey] = { typeId: r.expense_type_id, subTypeId: r.expense_sub_type_id, total: 0, pending: 0, committed: 0, credit: 0, allocs: 0 }
      }
      var s = t.subMap[subKey]
      s.total += r.amount_paise || 0
      if (isCredit) { s.credit += -(r.amount_paise || 0) } else { s.pending += r.pending_paise || 0; s.committed += r.committed_paise || 0 }
      s.allocs += 1
      total += r.amount_paise || 0
      if (isCredit) { credit += -(r.amount_paise || 0) } else { pending += r.pending_paise || 0; committed += r.committed_paise || 0 }
    })
    var groups = Object.values(byDept).map(function (g) {
      var typeGroups = Object.values(g.typeMap).map(function (t) {
        var subRows = Object.values(t.subMap).sort(function (a, b) { return b.total - a.total })
        return { typeKey: t.typeKey, typeId: t.typeId, total: t.total, pending: t.pending, committed: t.committed, credit: t.credit, allocs: t.allocs, subRows: subRows }
      }).sort(function (a, b) { return b.total - a.total })
      return { key: g.key, deptId: g.deptId, total: g.total, pending: g.pending, committed: g.committed, credit: g.credit, allocs: g.allocs, typeGroups: typeGroups }
    })
    groups.sort(function (a, b) { return b.total - a.total })

    // Delta tracking
    var newDeltas = {}
    if (isFirstLoad.current) {
      var snap = {}
      groups.forEach(function (g) { snap[g.key] = g.allocs })
      allocSnapshot.current = snap
      isFirstLoad.current = false
    } else {
      groups.forEach(function (g) {
        var prev = allocSnapshot.current[g.key] || 0
        if (g.allocs > prev) newDeltas[g.key] = g.allocs - prev
      })
    }
    setDeptDelta(newDeltas)
    setDeptGroups(groups)
    setTotals({ total: total, pending: pending, committed: committed, credit: credit, allocs: rows.length })
    // On first load only, default all dept groups to collapsed.
    if (!collapseInitializedRef.current && groups.length > 0) {
      var allDeptCollapsed = {}
      var allTypeCollapsed = {}
      groups.forEach(function (g) {
        allDeptCollapsed[g.key] = true
        g.typeGroups.forEach(function (t) { allTypeCollapsed[g.key + '|' + t.typeKey] = true })
      })
      setCollapsedDepts(allDeptCollapsed)
      setCollapsedTypes(allTypeCollapsed)
      collapseInitializedRef.current = true
    }
    setLoading(false)
  }

  // Fetch individual alloc rows enriched with vendor + payment info. Used by PDF exports.
  // filter: { deptId?, typeId?, subTypeId? } — nulls treated as .is('...', null); undefined = no constraint on that col.
  async function fetchAllocDetail(filter) {
    var statusIn = statusFilter ? [statusFilter] : ['recorded', 'flagged', 'acknowledged', 'deducted']
    var rows = []; var from = 0; var pageSize = 1000
    while (true) {
      var q = supabase.from('v_ledger')
        .select('allocation_id, expense_id, department_id, expense_type_id, expense_sub_type_id, user_id, venue_id, amount_paise, pending_paise, committed_paise, remarks, expense_date, description, status, created_at, source')
        .in('status', statusIn)
        .gte('expense_date', dateFrom)
        .lte('expense_date', dateTo)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1)
      if (hasScope) q = q.in('department_id', scopeDeptIds)
      if (userFilter) q = q.eq('user_id', userFilter)
      if (venueFilter) q = q.eq('venue_id', Number(venueFilter))
      if (filter) {
        if (filter.deptId !== undefined) { if (filter.deptId === null) q = q.is('department_id', null); else q = q.eq('department_id', filter.deptId) }
        if (filter.typeId !== undefined) { if (filter.typeId === null) q = q.is('expense_type_id', null); else q = q.eq('expense_type_id', filter.typeId) }
        if (filter.subTypeId !== undefined) { if (filter.subTypeId === null) q = q.is('expense_sub_type_id', null); else q = q.eq('expense_sub_type_id', filter.subTypeId) }
      }
      var page = await q
      if (page.error) throw new Error(page.error.message)
      var chunk = page.data || []
      rows = rows.concat(chunk)
      if (chunk.length < pageSize) break
      from += pageSize
      if (from > 50000) break
    }
    if (pendingOnly) rows = rows.filter(function (r) { return (r.pending_paise || 0) > 0 })

    // Batch-fetch expenses meta (vendor_id, payment_mode, payment_sub_mode) for each expense_id
    var expenseIds = {}
    rows.forEach(function (r) { if (r.expense_id != null) expenseIds[r.expense_id] = true })
    var eIdList = Object.keys(expenseIds).map(Number)
    var expMap = {}
    var CHUNK = 500
    for (var i = 0; i < eIdList.length; i += CHUNK) {
      var eChunk = eIdList.slice(i, i + CHUNK)
      var eRes = await supabase.from('expenses').select('id, vendor_id, payment_mode, payment_sub_mode').in('id', eChunk)
      ;(eRes.data || []).forEach(function (e) { expMap[e.id] = e })
    }
    // Batch-fetch vendor names
    var vendorIds = {}
    Object.values(expMap).forEach(function (e) { if (e.vendor_id != null) vendorIds[e.vendor_id] = true })
    var vIdList = Object.keys(vendorIds).map(Number)
    var vMap = {}
    for (var j = 0; j < vIdList.length; j += CHUNK) {
      var vChunk = vIdList.slice(j, j + CHUNK)
      var vRes = await supabase.from('vendors').select('id, name').in('id', vChunk)
      ;(vRes.data || []).forEach(function (v) { vMap[v.id] = v.name })
    }
    // Merge
    return rows.map(function (r) {
      var e = expMap[r.expense_id] || {}
      return Object.assign({}, r, {
        _vendorName: e.vendor_id ? (vMap[e.vendor_id] || ('#' + e.vendor_id)) : '—',
        _paymentMode: e.payment_mode || null,
        _paymentSubMode: e.payment_sub_mode || null,
      })
    })
  }

  async function loadDrill(append) {
    if (!drillGroup) return
    setDrillLoading(true)
    var offset = append ? drillOffset : 0
    var q = supabase.from('v_ledger')
      .select('allocation_id, expense_id, user_id, venue_id, amount_paise, remarks, expense_date, description, status, created_at, source')
      .in('status', ['recorded', 'flagged', 'acknowledged', 'deducted'])
      .gte('expense_date', dateFrom)
      .lte('expense_date', dateTo)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)
    if (drillGroup.deptId) q = q.eq('department_id', drillGroup.deptId)
    else q = q.is('department_id', null)
    if (drillGroup.typeId) q = q.eq('expense_type_id', drillGroup.typeId)
    else q = q.is('expense_type_id', null)
    if (drillGroup.subTypeId) q = q.eq('expense_sub_type_id', drillGroup.subTypeId)
    else q = q.is('expense_sub_type_id', null)
    if (drillUserFilter) q = q.eq('user_id', drillUserFilter)
    if (drillStatusFilter) q = q.eq('status', drillStatusFilter)
    if (drillVenueFilter) q = q.eq('venue_id', Number(drillVenueFilter))

    var { data, error } = await q
    if (error) { alert('Drill load failed: ' + error.message); setDrillLoading(false); return }
    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    // Enrich with this sub-type's custom field values (e.g. which employee a
    // salary-type expense was paid to) — v_ledger doesn't expose expenses.metadata.
    var subType = drillGroup.subTypeId ? refData.expenseSubTypes.find(function (s) { return s.id === drillGroup.subTypeId }) : null
    var extraFields = (subType && subType.extra_fields) || []
    if (extraFields.length > 0 && rows.length > 0) {
      var eIds = Array.from(new Set(rows.map(function (r) { return r.expense_id }).filter(function (v) { return v != null })))
      var metaRes = await supabase.from('expenses').select('id, metadata').in('id', eIds)
      var metaMap = {}
      ;(metaRes.data || []).forEach(function (e) { metaMap[e.id] = e.metadata || {} })

      // job_departments/venues are already preloaded in refData; vendors aren't.
      var vendorLookupFields = extraFields.filter(function (f) { return f.type === 'lookup' && f.source === 'vendors' })
      var vendorMap = {}
      if (vendorLookupFields.length > 0) {
        var vendorIds = new Set()
        rows.forEach(function (r) {
          var meta = metaMap[r.expense_id] || {}
          vendorLookupFields.forEach(function (f) { if (meta[f.key]) vendorIds.add(meta[f.key]) })
        })
        if (vendorIds.size > 0) {
          var vRes = await supabase.from('vendors').select('id, name').in('id', Array.from(vendorIds))
          ;(vRes.data || []).forEach(function (v) { vendorMap[v.id] = v.name })
        }
      }

      var resolveField = function (field, rawValue) {
        if (rawValue == null || rawValue === '') return null
        if (field.type === 'lookup') {
          if (field.source === 'job_departments') {
            var emp = refData.employees.find(function (e) { return String(e.id) === String(rawValue) })
            return emp ? emp.full_name : ('#' + rawValue)
          }
          if (field.source === 'venues') {
            var ven = refData.venues.find(function (v) { return String(v.id) === String(rawValue) })
            return ven ? (ven.name || ven.code) : ('#' + rawValue)
          }
          if (field.source === 'vendors') return vendorMap[rawValue] || ('#' + rawValue)
        }
        return String(rawValue)
      }

      rows = rows.map(function (r) {
        var meta = metaMap[r.expense_id] || {}
        var chips = extraFields.map(function (f) {
          var resolved = resolveField(f, meta[f.key])
          return resolved ? { label: f.label, value: resolved } : null
        }).filter(Boolean)
        return Object.assign({}, r, { _fieldChips: chips })
      })
    }

    if (append) setDrillRows(function (prev) { return prev.concat(rows) })
    else setDrillRows(rows)
    setDrillHasMore(hasMore)
    setDrillOffset(offset + rows.length)
    setDrillLoading(false)
  }

  function openRow(g, r) {
    var deptName = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
    var typeName = r.typeId ? (typeMap[r.typeId] || 'Untyped') : 'Untyped'
    var subTypeName = r.subTypeId ? (subTypeMap[r.subTypeId] || '—') : '—'
    pushBack(function () { setDrillGroup(null); setDrillRows([]); setDrillOffset(0); setDrillUserFilter(''); setDrillStatusFilter(''); setDrillVenueFilter('') })
    setDrillGroup({
      deptId: g.deptId, typeId: r.typeId, subTypeId: r.subTypeId,
      deptName: deptName, typeName: typeName, subTypeName: subTypeName,
      total: r.total, pending: r.pending, committed: r.committed
    })
  }

  function closeDrill() {
    setDrillGroup(null); setDrillRows([]); setDrillOffset(0)
    setDrillUserFilter(''); setDrillStatusFilter(''); setDrillVenueFilter('')
  }

  function toggleDept(deptKey, currentAllocs) {
    setCollapsedDepts(function (prev) {
      var next = Object.assign({}, prev)
      next[deptKey] = !prev[deptKey]
      return next
    })
    allocSnapshot.current[deptKey] = currentAllocs
    setDeptDelta(function (prev) {
      var next = Object.assign({}, prev)
      delete next[deptKey]
      return next
    })
  }

  function toggleType(deptKey, typeKey) {
    var key = deptKey + '|' + typeKey
    setCollapsedTypes(function (prev) {
      var next = Object.assign({}, prev)
      next[key] = !prev[key]
      return next
    })
  }

  function applyPreset(preset) {
    setDatePreset(preset)
    if (preset === 'custom') return
    var r = getPresetRange(preset)
    if (r) { setDateFrom(r.from); setDateTo(r.to) }
  }

  function exportListCSV() {
    if (!deptGroups.length) return
    function esc(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    var lines = ['Department,Type,Sub-Type,Net Total (pts),Debits Acknowledged (pts),Debits Pending (pts),Credit (pts),Allocations']
    deptGroups.forEach(function (g) {
      var d = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
      lines.push(esc(d) + ' (subtotal),,,' + (g.total / 100) + ',' + (g.committed / 100) + ',' + (g.pending / 100) + ',' + (g.credit / 100) + ',' + g.allocs)
      g.typeGroups.forEach(function (t) {
        var tn = t.typeId ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
        lines.push(esc(d) + ',' + esc(tn) + ' (subtotal),,' + (t.total / 100) + ',' + (t.committed / 100) + ',' + (t.pending / 100) + ',' + (t.credit / 100) + ',' + t.allocs)
        t.subRows.forEach(function (r) {
          var s = r.subTypeId ? (subTypeMap[r.subTypeId] || '—') : '—'
          lines.push(esc(d) + ',' + esc(tn) + ',' + esc(s) + ',' + (r.total / 100) + ',' + (r.committed / 100) + ',' + (r.pending / 100) + ',' + (r.credit / 100) + ',' + r.allocs)
        })
      })
    })
    var csv = '\uFEFF' + lines.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ledgers_' + dateFrom + '_' + dateTo + '.csv'; a.click()
  }

  // Shared PDF setup: creates doc, prints header + filter line. Returns { doc, FONT, pageW, pageH, startY, autoTable }.
  async function _pdfSetup(title) {
    var jsPDFmod = await import('jspdf')
    var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
    var autoTableMod = await import('jspdf-autotable')
    var autoTable = autoTableMod.default || autoTableMod
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    var pageW = doc.internal.pageSize.getWidth()
    var pageH = doc.internal.pageSize.getHeight()
    var fontOk = await registerPdfFont(doc)
    var FONT = fontOk ? 'NotoSans' : 'helvetica'
    doc.setFont(FONT, 'bold'); doc.setFontSize(13)
    doc.text(title, 14, 14)
    doc.setFont(FONT, 'normal'); doc.setFontSize(8)
    doc.text('Generated: ' + new Date().toLocaleString('en-IN'), pageW - 14, 14, { align: 'right' })
    var fParts = []
    if (dateFrom || dateTo) fParts.push('Period: ' + (dateFrom || '…') + ' to ' + (dateTo || '…'))
    if (userFilter) { var u = users.find(function (x) { return String(x.id) === String(userFilter) }); fParts.push('User: ' + (u ? u.name : userFilter)) }
    if (venueFilter) { var v = venues.find(function (x) { return String(x.id) === String(venueFilter) }); fParts.push('Venue: ' + (v ? (v.name || v.code) : venueFilter)) }
    if (statusFilter) fParts.push('Status: ' + statusFilter)
    if (pendingOnly) fParts.push('Pending only')
    if (searchDeb) fParts.push('Search: "' + searchDeb + '"')
    doc.setFontSize(7); doc.setTextColor(80)
    doc.text(fParts.length ? 'Filters: ' + fParts.join('  ·  ') : 'Filters: none', 14, 19, { maxWidth: pageW - 28 })
    doc.setTextColor(0)
    return { doc: doc, FONT: FONT, pageW: pageW, pageH: pageH, startY: fParts.length ? 24 : 22, autoTable: autoTable }
  }

  function _fmtPts(paise) { return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) }

  // Renders one alloc-detail table section starting at nextY. Returns new Y after the table.
  function _renderAllocSection(ctx, title, allocs) {
    var doc = ctx.doc, FONT = ctx.FONT, autoTable = ctx.autoTable, pageW = ctx.pageW, pageH = ctx.pageH
    var subCommitted = 0, subPending = 0, subTotal = 0
    var dateMeta = []
    var particularsMeta = []
    var body = allocs.map(function (a) {
      subCommitted += (a.committed_paise || 0); subPending += (a.pending_paise || 0); subTotal += (a.amount_paise || 0)
      var uName = userMap[a.user_id] || '—'
      var vName = venueMap[a.venue_id] || '—'

      var pLines = [{ kind: 'desc', text: a.description || a.remarks || '—' }]
      var chipParts = []
      if (a._vendorName && a._vendorName !== '—') chipParts.push('Vendor: ' + a._vendorName)
      var payLabel = _paymentLabel(a._paymentMode, a._paymentSubMode)
      if (payLabel !== '—') chipParts.push(payLabel)
      if (chipParts.length) pLines.push({ kind: 'chip', text: chipParts.join('   ·   ') })
      if (a.status && a.status !== 'recorded') pLines.push({ kind: 'status', text: STATUS_LABELS[a.status] || a.status })
      particularsMeta.push(pLines)

      var dm = { top: a.expense_date ? formatDate(a.expense_date) : '—', bottom: a.created_at ? formatDateTime(a.created_at) : '' }
      dateMeta.push(dm)

      return [
        plainDateLines(dm, 'Logged '),
        uName,
        vName,
        plainParticularsLines(pLines).join('\n'),
        { content: _fmtPts(a.committed_paise || 0), styles: { halign: 'right', textColor: [20, 100, 60] } },
        { content: _fmtPts(a.pending_paise || 0), styles: { halign: 'right', textColor: [140, 90, 20] } },
        { content: _fmtPts(a.amount_paise || 0), styles: { halign: 'right', fontStyle: 'bold' } },
      ]
    })
    body.push([
      { content: 'Subtotal (' + allocs.length + ')', colSpan: 4, styles: { fontStyle: 'bold', fillColor: [235, 240, 250] } },
      { content: _fmtPts(subCommitted), styles: { fontStyle: 'bold', fillColor: [235, 240, 250], halign: 'right', textColor: [20, 100, 60] } },
      { content: _fmtPts(subPending), styles: { fontStyle: 'bold', fillColor: [235, 240, 250], halign: 'right', textColor: [140, 90, 20] } },
      { content: _fmtPts(subTotal), styles: { fontStyle: 'bold', fillColor: [235, 240, 250], halign: 'right' } },
    ])
    doc.setFont(FONT, 'bold'); doc.setFontSize(10); doc.setTextColor(30, 30, 90)
    doc.text(title, 14, ctx.startY)
    doc.setTextColor(0)
    var statementHooks = makeStatementCellHooks(doc, FONT, {
      dateCol: 0, particularsCol: 3, dateMeta: dateMeta, particularsMeta: particularsMeta,
      topLabel: 'EXPENSE', bottomLabel: 'LOGGED',
    })
    autoTable(doc, {
      startY: ctx.startY + 3,
      // columnStyles' halign only ever reaches body cells (jspdf-autotable applies it
      // exclusively to sectionName === 'body'), so Committed/Pending/Total need their
      // own per-cell halign here to land over the right-aligned figures below.
      head: [['Date', 'User', 'Venue', 'Particulars',
        { content: 'Committed', styles: { halign: 'right' } },
        { content: 'Pending', styles: { halign: 'right' } },
        { content: 'Total', styles: { halign: 'right' } }]],
      body: body,
      styles: { font: FONT, fontSize: 7, cellPadding: 1.2, overflow: 'linebreak', valign: 'top' },
      headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 26, fontSize: 6.3 }, 1: { cellWidth: 22 }, 2: { cellWidth: 18 }, 3: { cellWidth: 'auto' },
        4: { cellWidth: 18, halign: 'right' }, 5: { cellWidth: 18, halign: 'right' }, 6: { cellWidth: 20, halign: 'right' },
      },
      margin: { left: 10, right: 10 },
      didParseCell: statementHooks.didParseCell,
      willDrawCell: statementHooks.willDrawCell,
      didDrawCell: statementHooks.didDrawCell,
      didDrawPage: function () {
        doc.setFontSize(6); doc.setTextColor(120)
        doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 14, pageH - 5, { align: 'right' })
        doc.setTextColor(0)
      },
    })
    ctx.startY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : ctx.startY) + 8
  }

  async function exportListPDF() {
    if (pdfBusy) return
    var groups = visibleGroups
    if (!groups.length) return
    setPdfBusy(true)
    try {
      var ctx = await _pdfSetup('Expense Ledger — Detailed')
      var allocs = await fetchAllocDetail(null)
      if (allocs.length === 0) {
        ctx.doc.setFontSize(10); ctx.doc.text('No allocations in range.', 14, ctx.startY + 6)
      } else {
        // Group by dept > type > sub-type in memory
        var tree = {}
        allocs.forEach(function (a) {
          var dKey = a.department_id != null ? String(a.department_id) : '__u'
          var tKey = a.expense_type_id != null ? String(a.expense_type_id) : '__u'
          var sKey = a.expense_sub_type_id != null ? String(a.expense_sub_type_id) : '__u'
          if (!tree[dKey]) tree[dKey] = { deptId: a.department_id, types: {} }
          if (!tree[dKey].types[tKey]) tree[dKey].types[tKey] = { typeId: a.expense_type_id, subs: {} }
          if (!tree[dKey].types[tKey].subs[sKey]) tree[dKey].types[tKey].subs[sKey] = { subTypeId: a.expense_sub_type_id, rows: [] }
          tree[dKey].types[tKey].subs[sKey].rows.push(a)
        })
        Object.values(tree).forEach(function (d) {
          var dName = d.deptId != null ? (deptMap[d.deptId] || 'Unassigned') : 'Unallocated'
          Object.values(d.types).forEach(function (t) {
            var tName = t.typeId != null ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
            Object.values(t.subs).forEach(function (s) {
              var sName = s.subTypeId != null ? (subTypeMap[s.subTypeId] || '—') : '—'
              _renderAllocSection(ctx, dName + ' → ' + tName + ' → ' + sName, s.rows)
            })
          })
        })
      }
      await openOrSharePdf(ctx.doc, 'ledger_detailed_' + dateFrom + '_' + dateTo + '.pdf')
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  // Level auto-inferred: pass deptId alone for dept-level, deptId+typeId for type-level, all three for sub-type level.
  async function exportScopedPDF(deptId, typeId, subTypeId) {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      var dName = deptId != null ? (deptMap[deptId] || 'Unassigned') : 'Unallocated'
      var tName = typeId != null ? (typeMap[typeId] || 'Untyped') : null
      var sName = subTypeId != null ? (subTypeMap[subTypeId] || '—') : null
      var level, titleLabel, fileTag
      if (sName != null) { level = 'sub'; titleLabel = 'Sub-Type Ledger — ' + sName; fileTag = sName }
      else if (tName != null) { level = 'type'; titleLabel = 'Expense Type Ledger — ' + tName; fileTag = tName }
      else { level = 'dept'; titleLabel = 'Department Ledger — ' + dName; fileTag = dName }
      var ctx = await _pdfSetup(titleLabel)
      var filter = { deptId: deptId != null ? deptId : null }
      if (typeId !== undefined) filter.typeId = typeId != null ? typeId : null
      if (subTypeId !== undefined) filter.subTypeId = subTypeId != null ? subTypeId : null
      var allocs = await fetchAllocDetail(filter)
      if (allocs.length === 0) {
        ctx.doc.setFontSize(10); ctx.doc.text('No allocations in this scope for the current filter.', 14, ctx.startY + 6)
      } else if (level === 'sub') {
        _renderAllocSection(ctx, dName + ' → ' + tName + ' → ' + sName, allocs)
      } else if (level === 'type') {
        // Group by sub-type
        var subMap = {}
        allocs.forEach(function (a) {
          var k = a.expense_sub_type_id != null ? String(a.expense_sub_type_id) : '__u'
          if (!subMap[k]) subMap[k] = { subTypeId: a.expense_sub_type_id, rows: [] }
          subMap[k].rows.push(a)
        })
        Object.values(subMap).forEach(function (s) {
          var sn = s.subTypeId != null ? (subTypeMap[s.subTypeId] || '—') : '—'
          _renderAllocSection(ctx, dName + ' → ' + tName + ' → ' + sn, s.rows)
        })
      } else {
        // Dept level: group by type → sub-type
        var typeMap2 = {}
        allocs.forEach(function (a) {
          var tk = a.expense_type_id != null ? String(a.expense_type_id) : '__u'
          var sk = a.expense_sub_type_id != null ? String(a.expense_sub_type_id) : '__u'
          if (!typeMap2[tk]) typeMap2[tk] = { typeId: a.expense_type_id, subs: {} }
          if (!typeMap2[tk].subs[sk]) typeMap2[tk].subs[sk] = { subTypeId: a.expense_sub_type_id, rows: [] }
          typeMap2[tk].subs[sk].rows.push(a)
        })
        Object.values(typeMap2).forEach(function (t) {
          var tn = t.typeId != null ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
          Object.values(t.subs).forEach(function (s) {
            var sn = s.subTypeId != null ? (subTypeMap[s.subTypeId] || '—') : '—'
            _renderAllocSection(ctx, dName + ' → ' + tn + ' → ' + sn, s.rows)
          })
        })
      }
      await openOrSharePdf(ctx.doc, 'ledger_' + fileTag.replace(/[^a-z0-9]+/gi, '_') + '_' + dateFrom + '_' + dateTo + '.pdf')
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  // Client-side filter: search + pendingOnly (nested dept -> type -> sub-type)
  var visibleGroups = deptGroups.map(function (g) {
    var deptName = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
    var q = searchDeb.toLowerCase()
    var deptMatch = !q || deptName.toLowerCase().indexOf(q) !== -1
    if (pendingOnly && g.pending === 0) return null
    var filteredTypes = g.typeGroups.map(function (t) {
      var tn = t.typeId ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
      var typeMatch = deptMatch || (q && tn.toLowerCase().indexOf(q) !== -1)
      var subRows = t.subRows.filter(function (r) {
        if (pendingOnly && r.pending === 0) return false
        if (!q) return true
        if (typeMatch) return true
        var sn = r.subTypeId ? (subTypeMap[r.subTypeId] || '') : ''
        return sn.toLowerCase().indexOf(q) !== -1
      })
      if (pendingOnly && t.pending === 0 && subRows.length === 0) return null
      if (q && !typeMatch && subRows.length === 0) return null
      return Object.assign({}, t, { subRows: subRows, typeName: tn })
    }).filter(Boolean)
    if (q && !deptMatch && filteredTypes.length === 0) return null
    return Object.assign({}, g, { typeGroups: filteredTypes, deptName: deptName })
  }).filter(Boolean)

  // ─── DRILL VIEW ───
  if (drillGroup) {
    return (
      <div className="space-y-4">
        <div>
          <button onClick={closeDrill}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Ledgers</button>
          <h2 className="text-lg font-bold text-gray-900">{drillGroup.deptName}</h2>
          <p className="text-xs text-gray-500">{drillGroup.typeName} › {drillGroup.subTypeName}</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2 text-center">
            <p className="text-[9px] font-bold text-indigo-400 uppercase">Total</p>
            <p className="text-sm font-bold text-indigo-700">{formatPoints(drillGroup.total)}</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
            <p className="text-[9px] font-bold text-green-500 uppercase">Committed</p>
            <p className="text-sm font-bold text-green-700">{formatPoints(drillGroup.committed)}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
            <p className="text-[9px] font-bold text-amber-500 uppercase">Pending</p>
            <p className="text-sm font-bold text-amber-700">{formatPoints(drillGroup.pending)}</p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="grid grid-cols-3 gap-2">
            <select value={drillUserFilter} onChange={function (e) { setDrillUserFilter(e.target.value) }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-md" style={{ fontSize: '16px' }}>
              <option value="">All Users</option>
              {users.map(function (u) { return <option key={u.id} value={u.id}>{u.name}</option> })}
            </select>
            <select value={drillStatusFilter} onChange={function (e) { setDrillStatusFilter(e.target.value) }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-md" style={{ fontSize: '16px' }}>
              <option value="">All Status</option>
              <option value="recorded">Recorded</option>
              <option value="flagged">Resubmit</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="deducted">Deducted</option>
            </select>
            <select value={drillVenueFilter} onChange={function (e) { setDrillVenueFilter(e.target.value) }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-md" style={{ fontSize: '16px' }}>
              <option value="">All Venues</option>
              {venues.map(function (v) { return <option key={v.id} value={v.id}>{v.code ? (v.code + ' — ' + v.name) : v.name}</option> })}
            </select>
          </div>
        </div>

        {drillLoading && drillRows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">Loading...</p>
        ) : drillRows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">No allocations in range</p>
        ) : (
          <div className="space-y-2">
            {drillRows.map(function (r) {
              return (
                <div key={r.allocation_id} onClick={function () { openExpenseDetail(r.expense_id) }}
                  className="bg-white border border-gray-200 rounded-xl p-3 cursor-pointer hover:bg-indigo-50/40 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500">{formatDate(r.expense_date)}</span>
                        <span className="text-[10px] text-gray-400">· logged {formatDateTime(r.created_at)}</span>
                        <span className="text-xs font-semibold text-gray-700">{userMap[r.user_id] || '—'}</span>
                        <span className={"text-[10px] px-1.5 py-0.5 rounded font-semibold " + (STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600')}>
                          {STATUS_LABELS[r.status] || r.status}
                        </span>
                        {(function () {
                          var sb = SOURCE_BADGES[r.source] || SOURCE_BADGES.allocation
                          return (
                            <span className={"text-[9px] px-1.5 py-0.5 rounded border font-semibold " + sb.cls}>
                              {sb.label}
                            </span>
                          )
                        })()}
                      </div>
                      <p className="text-sm text-gray-800 truncate mt-1">{r.description || '—'}</p>
                      {r.remarks && <p className="text-xs italic text-gray-500 mt-0.5">"{r.remarks}"</p>}
                      {r.venue_id && <p className="text-[10px] text-gray-400 mt-0.5">Venue: {venueMap[r.venue_id] || '—'}</p>}
                      {r._fieldChips && r._fieldChips.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {r._fieldChips.map(function (c, i) {
                            return (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                                {c.label}: <b>{c.value}</b>
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <span className="text-sm font-bold text-gray-800 ml-3 flex-shrink-0">{formatPoints(r.amount_paise)}</span>
                  </div>
                </div>
              )
            })}
            {drillHasMore && (
              <button onClick={function () { loadDrill(true) }} disabled={drillLoading}
                className="w-full py-2 text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                {drillLoading ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
        {expenseDetailModal}
      </div>
    )
  }

  function PresetChip(props) {
    var active = datePreset === props.k
    return (
      /* One group, so the four read as one choice. An unpicked one leans
         towards the white pill it would become rather than only darkening its
         text; the picked one does not answer the pointer, because pressing it
         again does nothing. */
      <button type="button" onClick={function () { applyPreset(props.k) }} aria-pressed={active}
        className={"h-9 px-4 text-[12.5px] font-bold rounded-lg transition-all duration-150 " +
          (active
            ? "bg-white text-indigo-700 shadow-[0_1px_3px_rgba(15,23,42,0.10)]"
            : "text-slate-500 hover:text-slate-900 hover:bg-white/70")}>
        {props.label}
      </button>
    )
  }

  // ─── LIST VIEW ───
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Ledgers</h2>
        <p className="text-xs text-gray-400">Live financial tracker · {totals.allocs} allocation{totals.allocs !== 1 ? 's' : ''}</p>
      </div>

      <div className="sticky top-0 z-10 bg-gray-50 pt-1 pb-3 border-b border-gray-200 space-y-2">
        {/* Left-aligned, and the figure given the size of the thing it is. A
            9px label centred over a 16px number made four cards you had to lean
            in to read; ranged left they also line up with everything below
            them. */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-[0.08em]">Debits Acknowledged</p>
            <p className="mt-1.5 text-[19px] font-extrabold text-emerald-700 tabular-nums leading-none" data-notranslate>{formatPoints(totals.committed)}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-[0.08em]">Debits Pending</p>
            <p className="mt-1.5 text-[19px] font-extrabold text-amber-700 tabular-nums leading-none" data-notranslate>{formatPoints(totals.pending)}</p>
          </div>
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold text-rose-600 uppercase tracking-[0.08em]">Total Credits</p>
            <p className="mt-1.5 text-[19px] font-extrabold text-rose-700 tabular-nums leading-none" data-notranslate>{formatPoints(totals.credit)}</p>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-[0.08em]">Net Total</p>
            <p className="mt-1.5 text-[19px] font-extrabold text-indigo-700 tabular-nums leading-none" data-notranslate>{formatPoints(totals.total)}</p>
          </div>
        </div>

        {/* One toolbar. The period, what to look in it for, and what to take
            away with you were three separate rows of controls at three
            different sizes. */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <PresetChip k="month" label="This month" />
            <PresetChip k="lastMonth" label="Last month" />
            <PresetChip k="ytd" label="YTD" />
            <PresetChip k="custom" label="Custom" />
          </div>
          {datePreset === 'custom' && (
            <>
              <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value) }}
                className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-[12.5px] text-slate-700 hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 flex-1 min-w-[130px]" style={{ fontSize: '16px' }} />
              <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value) }}
                className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-[12.5px] text-slate-700 hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 flex-1 min-w-[130px]" style={{ fontSize: '16px' }} />
            </>
          )}
          <div className="flex-1 min-w-[220px]">
            <SearchField
              value={search}
              onChange={function (v) { setSearch(v) }}
              placeholder="Search dept / type / sub-type..."
              className="w-full"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5 items-center">
          <select value={userFilter} onChange={function (e) { setUserFilter(e.target.value) }}
            aria-label="Filter by user"
            className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-[12.5px] text-slate-700 hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 flex-1 min-w-[130px]" style={{ fontSize: '16px' }}>
            <option value="">All users</option>
            {users.map(function (u) { return <option key={u.id} value={u.id}>{u.name}</option> })}
          </select>
          <select value={venueFilter} onChange={function (e) { setVenueFilter(e.target.value) }}
            aria-label="Filter by venue"
            className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-[12.5px] text-slate-700 hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 flex-1 min-w-[130px]" style={{ fontSize: '16px' }}>
            <option value="">All venues</option>
            {venues.map(function (v) { return <option key={v.id} value={v.id}>{v.code ? (v.code + ' — ' + v.name) : v.name}</option> })}
          </select>
          <select value={statusFilter} onChange={function (e) { setStatusFilter(e.target.value) }}
            aria-label="Filter by status"
            className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-[12.5px] text-slate-700 hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 flex-1 min-w-[130px]" style={{ fontSize: '16px' }}>
            <option value="">All status</option>
            <option value="recorded">Recorded</option>
            <option value="flagged">Resubmit</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="deducted">Deducted</option>
          </select>
          <button type="button" onClick={function () { setPendingOnly(!pendingOnly) }} aria-pressed={pendingOnly}
            className={"h-9 px-3.5 inline-flex items-center gap-2 text-[12.5px] font-bold rounded-lg border transition-all duration-150 " +
              (pendingOnly
                ? "bg-amber-50 border-amber-300 text-amber-800"
                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900")}>
            {/* A switch, so its state is visible without having to remember
                what the unpressed colour looked like. */}
            <span aria-hidden="true" className={"w-8 h-[18px] rounded-full p-0.5 transition-colors " + (pendingOnly ? "bg-amber-500" : "bg-slate-300")}>
              <span className={"block w-[14px] h-[14px] rounded-full bg-white transition-transform " + (pendingOnly ? "translate-x-[14px]" : "")} />
            </span>
            Pending only
          </button>
          {/* Both of these do the same harmless thing, so they look the same.
              Green and red on a pair of downloads read as a verdict on the file,
              when the only difference is the format the word already names. */}
          <button type="button" onClick={exportListCSV} disabled={!deptGroups.length}
            className="h-9 px-3.5 inline-flex items-center gap-2 text-[12.5px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 transition-all duration-150">
            <Icon name="download" size={14} className="text-slate-400" />
            CSV
          </button>
          <button type="button" onClick={exportListPDF} disabled={!visibleGroups.length || pdfBusy}
            className="h-9 px-3.5 inline-flex items-center gap-2 text-[12.5px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 transition-all duration-150">
            <Icon name={pdfBusy ? 'refresh' : 'fileText'} size={14} className="text-slate-400" />
            {pdfBusy ? 'Generating…' : 'PDF'}
          </button>
        </div>
      </div>

      {loading && deptGroups.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">Loading ledger...</p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">No matches in this range</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {/* One table, not a stack of cards. Every department used to carry its
              own border and its own rounded corners, so four departments were
              four objects with four sets of columns that only happened to line
              up with each other. */}
          <div className="flex items-stretch bg-slate-50 border-b border-slate-200">
            <div className={"flex-1 " + COLS + " px-3 py-2.5"}>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Department / Type</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right">Acknowledged</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right">Pending</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right">Credit</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right">Net Total</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right">#</span>
            </div>
            <span className="shrink-0 px-2.5 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Export</span>
          </div>
          {visibleGroups.map(function (g) {
            var deptCollapsed = collapsedDepts[g.key]
            var delta = deptDelta[g.key] || 0
            return (
              <div key={g.key} className="border-t border-slate-100 first:border-t-0">
                <div className="flex items-stretch hover:bg-slate-50 transition-colors">
                  <button onClick={function () { toggleDept(g.key, g.allocs) }}
                    className={"flex-1 " + COLS + " items-center px-3 py-2.5 text-left"}>
                    <div className="flex items-center gap-2 min-w-0">
                      {/* A drawn chevron that turns, not two different characters.
                          ▸ and ▾ are different glyphs at different widths, so the
                          label beside them shifted a pixel on every expand. */}
                      <Icon name="chevronRight" size={14}
                        className={"shrink-0 text-slate-400 transition-transform duration-150 " + (deptCollapsed ? "" : "rotate-90")} />
                      <span className="text-[13.5px] font-bold text-slate-900 truncate">{g.deptName}</span>
                      <span className="shrink-0 min-w-[20px] px-1.5 py-0.5 rounded-md bg-slate-100 text-[10.5px] font-bold text-slate-500 tabular-nums text-center" data-notranslate>{g.typeGroups.length}</span>
                      {delta > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex-shrink-0 animate-pulse">
                          +{delta}
                        </span>
                      )}
                    </div>
                    <span className="text-[12.5px] text-right font-semibold text-emerald-700 tabular-nums whitespace-nowrap" data-notranslate>{formatPoints(g.committed)}</span>
                    <span className="text-[12.5px] text-right font-semibold text-amber-700 tabular-nums whitespace-nowrap" data-notranslate>{formatPoints(g.pending)}</span>
                    <span className="text-[12.5px] text-right font-semibold text-rose-700 tabular-nums whitespace-nowrap" data-notranslate>{g.credit > 0 ? formatPoints(g.credit) : '—'}</span>
                    <span className="text-[13px] text-right font-extrabold text-slate-900 tabular-nums whitespace-nowrap" data-notranslate>{formatPoints(g.total)}</span>
                    <span className="text-[11px] text-right text-slate-400 tabular-nums" data-notranslate>{g.allocs}</span>
                  </button>
                  <button onClick={function (e) { e.stopPropagation(); exportScopedPDF(g.deptId) }}
                    disabled={pdfBusy}
                    title="Open department PDF in new tab"
                    className={PDF_BTN}>
                    <Icon name="fileText" size={13} />
                    PDF
                  </button>
                </div>
                {!deptCollapsed && g.typeGroups.map(function (t) {
                  var typeKeyFull = g.key + '|' + t.typeKey
                  var typeCollapsed = collapsedTypes[typeKeyFull]
                  var typeName = t.typeId ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
                  return (
                    <div key={t.typeKey}>
                      <div className="flex items-stretch border-t border-slate-100 bg-slate-50/70 hover:bg-slate-100 transition-colors">
                        <button onClick={function () { toggleType(g.key, t.typeKey) }}
                          className={"flex-1 " + COLS + " items-center px-3 py-2 pl-9 text-left"}>
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon name="chevronRight" size={13}
                              className={"shrink-0 text-slate-400 transition-transform duration-150 " + (typeCollapsed ? "" : "rotate-90")} />
                            <span className="text-[12.5px] font-semibold text-slate-800 truncate">{typeName}</span>
                            <span className="shrink-0 min-w-[20px] px-1.5 py-0.5 rounded-md bg-white text-[10.5px] font-bold text-slate-500 tabular-nums text-center" data-notranslate>{t.subRows.length}</span>
                          </div>
                          <span className="text-[12px] text-right text-emerald-700 tabular-nums whitespace-nowrap" data-notranslate>{formatPoints(t.committed)}</span>
                          <span className="text-[12px] text-right text-amber-700 tabular-nums whitespace-nowrap" data-notranslate>{formatPoints(t.pending)}</span>
                          <span className="text-[12px] text-right text-rose-700 tabular-nums whitespace-nowrap" data-notranslate>{t.credit > 0 ? formatPoints(t.credit) : '—'}</span>
                          <span className="text-[12px] text-right font-bold text-slate-800 tabular-nums whitespace-nowrap" data-notranslate>{formatPoints(t.total)}</span>
                          <span className="text-[11px] text-right text-slate-400 tabular-nums" data-notranslate>{t.allocs}</span>
                        </button>
                        <button onClick={function (e) { e.stopPropagation(); exportScopedPDF(g.deptId, t.typeId) }}
                          disabled={pdfBusy}
                          title="Open expense-type PDF in new tab"
                          className={PDF_BTN}>
                          <Icon name="fileText" size={13} />
                          PDF
                        </button>
                      </div>
                      {!typeCollapsed && t.subRows.map(function (r, i) {
                        var subTypeName = r.subTypeId ? (subTypeMap[r.subTypeId] || '—') : '—'
                        return (
                          <div key={i} className="flex items-stretch border-t border-slate-100 hover:bg-indigo-50/60 transition-colors">
                            <button onClick={function () { openRow(g, r) }}
                              className={"flex-1 " + COLS + " items-center px-3 py-2 pl-14 text-left"}>
                              <div className="min-w-0">
                                <p className="text-[12.5px] text-slate-600 truncate">{subTypeName}</p>
                              </div>
                              <span className="text-[12px] text-right text-emerald-700 tabular-nums whitespace-nowrap" data-notranslate>{formatPoints(r.committed)}</span>
                              <span className="text-[12px] text-right text-amber-700 tabular-nums whitespace-nowrap" data-notranslate>{formatPoints(r.pending)}</span>
                              <span className="text-[12px] text-right text-rose-700 tabular-nums whitespace-nowrap" data-notranslate>{r.credit > 0 ? formatPoints(r.credit) : '—'}</span>
                              <span className="text-[12px] text-right font-bold text-slate-800 tabular-nums whitespace-nowrap" data-notranslate>{formatPoints(r.total)}</span>
                              <span className="text-[11px] text-right text-slate-400 tabular-nums" data-notranslate>{r.allocs}</span>
                            </button>
                            <button onClick={function (e) { e.stopPropagation(); exportScopedPDF(g.deptId, r.typeId, r.subTypeId) }}
                              disabled={pdfBusy}
                              title="Open sub-type PDF in new tab"
                              className={PDF_BTN}>
                              <Icon name="fileText" size={13} />
                              PDF
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {visibleGroups.length > 0 && (
        <p className="text-[12px] text-slate-500">
          Showing
          <span className="mx-1 font-bold text-slate-900 tabular-nums" data-notranslate>{visibleGroups.length}</span>
          of
          <span className="mx-1 font-bold text-slate-900 tabular-nums" data-notranslate>{deptGroups.length}</span>
          departments
        </p>
      )}
    </div>
  )
}

export default Ledgers