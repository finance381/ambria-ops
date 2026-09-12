import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDateTime, formatPoints } from '../../lib/format'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'
import FilterDropdown from '../../components/ui/FilterDropdown'
import EventDatePicker from '../../components/ui/EventDatePicker'
import { registerPdfFont } from '../../lib/pdfFont'
import { openOrSharePdf } from '../../lib/pdfOutput'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { deptInk, STATUS_RAIL } from '../../lib/ui'
import Icon from '../../components/ui/Icon'
import SearchField from '../../components/ui/SearchField'

function byName(a, b) { return (a.name || '').localeCompare(b.name || '') }

var PAGE_SIZE = 20



// vendorMap (optional) resolves lookup-type extra fields sourced from vendors
// (e.g. a "Vendor Name" field on a repair sub-type) into a readable name —
// without it, lookup fields are skipped entirely, same as before.
function extraFieldChips(exp, vendorMap) {
  var meta = exp.metadata || {}
  var typeFields = (exp.expense_types && exp.expense_types.extra_fields) || []
  var subFields = (exp.expense_sub_types && exp.expense_sub_types.extra_fields) || []
  var chips = []
  typeFields.concat(subFields).forEach(function (f) {
    if (!f || !f.key) return
    if (f.type === 'lookup') {
      if (f.source !== 'vendors' || !vendorMap) return
      var vId = meta[f.key]
      if (vId == null || vId === '') return
      var vName = vendorMap[String(vId)]
      if (!vName) return
      chips.push({ label: f.label || f.key, value: vName })
      return
    }
    var v = meta[f.key]
    if (v == null || v === '') return
    chips.push({ label: f.label || f.key, value: String(v) })
  })
  return chips
}

// Filter state cache — survives mount/unmount within a tab session.
// Cleared on hard refresh. Not persisted to storage on purpose.
var _savedFilters = {
  status: '', from: '', to: '', search: '', filtersOpen: false,
  dept: '', expType: '', expSubType: '', venue: '', user: '', amountMin: '', amountMax: ''
}

function AllExpenses({ onBack, onOpenDetail, embedded, scopeDeptIds, glass }) {
  var [allExps, setAllExps] = useState([])
  var [allExpHasMore, setAllExpHasMore] = useState(false)
  var [allExpStatus, setAllExpStatus] = useState(function () { return _savedFilters.status })
  var [allExpFrom, setAllExpFrom] = useState(function () { return _savedFilters.from })
  var [allExpTo, setAllExpTo] = useState(function () { return _savedFilters.to })
  var [allExpSearch, setAllExpSearch] = useState(function () { return _savedFilters.search })
  var [allExpSearchD, setAllExpSearchD] = useState(function () { return _savedFilters.search })
  var [allExpLoading, setAllExpLoading] = useState(false)
  var [allExpLoadingMore, setAllExpLoadingMore] = useState(false)
  var [allExpFullTotal, setAllExpFullTotal] = useState(0)
  var [allExpFullCount, setAllExpFullCount] = useState(0)
  var [pdfBusy, setPdfBusy] = useState(false)
  // Filter panel state
  var [filtersOpen, setFiltersOpen] = useState(function () { return _savedFilters.filtersOpen })
  var [deptFilter, setDeptFilter] = useState(function () { return _savedFilters.dept })
  var [expTypeFilter, setExpTypeFilter] = useState(function () { return _savedFilters.expType })
  var [expSubTypeFilter, setExpSubTypeFilter] = useState(function () { return _savedFilters.expSubType })
  var [venueFilter, setVenueFilter] = useState(function () { return _savedFilters.venue })
  var [userFilter, setUserFilter] = useState(function () { return _savedFilters.user })
  var [amountMin, setAmountMin] = useState(function () { return _savedFilters.amountMin })
  var [amountMax, setAmountMax] = useState(function () { return _savedFilters.amountMax })

  // Filter lookups
  var [deptOptions, setDeptOptions] = useState([])
  var [userOptions, setUserOptions] = useState([])
  var refData = useReferenceData()
  var expTypeOptions = useMemo(function () {
    return refData.expenseTypes.filter(function (t) { return t.active }).slice().sort(byName)
  }, [refData.expenseTypes])
  var expSubTypeOptions = useMemo(function () {
    return refData.expenseSubTypes.filter(function (t) { return t.active }).slice().sort(byName)
  }, [refData.expenseSubTypes])
  var venueOptions = useMemo(function () {
    return refData.venues.filter(function (v) { return v.active }).slice().sort(byName)
  }, [refData.venues])
  var expTypeMap = useMemo(function () {
    var m = {}; expTypeOptions.forEach(function (t) { m[t.id] = t.name }); return m
  }, [expTypeOptions])
  var expSubTypeMap = useMemo(function () {
    var m = {}; expSubTypeOptions.forEach(function (s) { m[s.id] = s.name }); return m
  }, [expSubTypeOptions])
  var venueMap = useMemo(function () {
    var m = {}; venueOptions.forEach(function (v) { m[v.id] = v.code || v.name }); return m
  }, [venueOptions])

  useEffect(function () {
    var timer = setTimeout(function () { setAllExpSearchD(allExpSearch) }, 400)
    return function () { clearTimeout(timer) }
  }, [allExpSearch])

  // Persist every filter change to the module-level cache so re-mount (after opening a detail) restores state.
  useEffect(function () {
    _savedFilters = {
      status: allExpStatus, from: allExpFrom, to: allExpTo, search: allExpSearch, filtersOpen: filtersOpen,
      dept: deptFilter, expType: expTypeFilter, expSubType: expSubTypeFilter, venue: venueFilter,
      user: userFilter, amountMin: amountMin, amountMax: amountMax
    }
  }, [allExpStatus, allExpFrom, allExpTo, allExpSearch, filtersOpen, deptFilter, expTypeFilter, expSubTypeFilter, venueFilter, userFilter, amountMin, amountMax])

  useEffect(function () {
    Promise.all([
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('profiles').select('id, name').order('name'),
    ]).then(function (res) {
      setDeptOptions(res[0].data || [])
      setUserOptions(res[1].data || [])
    })
  }, [])

  useEffect(function () {
    loadAllExps(false)
  }, [allExpStatus, allExpFrom, allExpTo, allExpSearchD, deptFilter, expTypeFilter, expSubTypeFilter, venueFilter, userFilter, amountMin, amountMax, (scopeDeptIds || []).join(',')])

  async function loadAllExps(append) {
    var offset = append ? allExps.length : 0
    if (append) setAllExpLoadingMore(true)
    else setAllExpLoading(true)

    var hasScope = scopeDeptIds && scopeDeptIds.length > 0
    var hasAllocFilter = !!(deptFilter || expTypeFilter || expSubTypeFilter || venueFilter) || hasScope
    var allocEmbed = hasAllocFilter
      ? 'expense_allocations!inner(department, department_id, venue_id, amount_paise, expense_type_id, expense_sub_type_id, remarks)'
      : 'expense_allocations(department, department_id, venue_id, amount_paise, expense_type_id, expense_sub_type_id, remarks)'

    var query = supabase.from('expenses')
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, delete_reason, deleted_by, payment_cash_paise, payment_credit_paise, payment_credit_cash_paise, payment_credit_bank_paise, cash_due_date, bank_due_date, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name), ' + allocEmbed)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (allExpStatus === 'deleted') {
      query = query.not('deleted_at', 'is', null)
    } else if (allExpStatus) {
      query = query.eq('status', allExpStatus).is('deleted_at', null)
    }
    if (allExpFrom) query = query.gte('expense_date', allExpFrom)
    if (allExpTo) query = query.lte('expense_date', allExpTo)
    if (allExpSearchD) query = query.ilike('description', '%' + allExpSearchD + '%')
    if (userFilter) query = query.eq('user_id', userFilter)
    if (deptFilter) query = query.eq('expense_allocations.department_id', Number(deptFilter))
    if (expTypeFilter) query = query.eq('expense_allocations.expense_type_id', Number(expTypeFilter))
    if (expSubTypeFilter) query = query.eq('expense_allocations.expense_sub_type_id', Number(expSubTypeFilter))
    if (venueFilter) query = query.eq('expense_allocations.venue_id', Number(venueFilter))
    if (hasScope) query = query.in('expense_allocations.department_id', scopeDeptIds)
    if (amountMin) query = query.gte('amount_paise', Math.round(Number(amountMin) * 100))
    if (amountMax) query = query.lte('amount_paise', Math.round(Number(amountMax) * 100))

    var { data, error } = await query
    if (error) { alert('Failed: ' + error.message); setAllExpLoading(false); setAllExpLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    var aUserIds = []
    function pushId(id) { if (id && aUserIds.indexOf(id) === -1) aUserIds.push(id) }
    rows.forEach(function (r) {
      pushId(r.user_id)
      pushId(r.reviewed_by)
      pushId(r.acknowledged_by)
      pushId(r.penalized_by)
      pushId(r.deleted_by)
    })
    var aMap = {}
    if (aUserIds.length > 0) {
      var { data: aNames } = await supabase.rpc('get_profile_names', { p_ids: aUserIds })
      ;(aNames || []).forEach(function (n) { aMap[n.id] = n.name })
    }
    rows = rows.map(function (r) {
      return Object.assign({}, r, {
        profiles: { name: aMap[r.user_id] || null },
        _reviewerName: aMap[r.reviewed_by] || null,
        _acknowledgerName: aMap[r.acknowledged_by] || null,
        _penalizerName: aMap[r.penalized_by] || null,
        _deleterName: aMap[r.deleted_by] || null,
      })
    })
    if (append) {
      setAllExps(function (prev) { return prev.concat(rows) })
    } else {
      setAllExps(rows)
    }
    setAllExpHasMore(hasMore)
    setAllExpLoading(false)
    setAllExpLoadingMore(false)

    // Full-match total across all filters (ignores pagination). Only on fresh loads.
    if (!append) {
      var totalQuery = supabase.from('expenses')
        .select('amount_paise' + (hasAllocFilter ? ', expense_allocations!inner(id)' : ''), { count: 'exact' })
      if (allExpStatus === 'deleted') totalQuery = totalQuery.not('deleted_at', 'is', null)
      else if (allExpStatus) totalQuery = totalQuery.eq('status', allExpStatus).is('deleted_at', null)
      if (allExpFrom) totalQuery = totalQuery.gte('expense_date', allExpFrom)
      if (allExpTo) totalQuery = totalQuery.lte('expense_date', allExpTo)
      if (allExpSearchD) totalQuery = totalQuery.ilike('description', '%' + allExpSearchD + '%')
      if (userFilter) totalQuery = totalQuery.eq('user_id', userFilter)
      if (deptFilter) totalQuery = totalQuery.eq('expense_allocations.department_id', Number(deptFilter))
      if (expTypeFilter) totalQuery = totalQuery.eq('expense_allocations.expense_type_id', Number(expTypeFilter))
      if (expSubTypeFilter) totalQuery = totalQuery.eq('expense_allocations.expense_sub_type_id', Number(expSubTypeFilter))
      if (venueFilter) totalQuery = totalQuery.eq('expense_allocations.venue_id', Number(venueFilter))
      if (hasScope) totalQuery = totalQuery.in('expense_allocations.department_id', scopeDeptIds)
      if (amountMin) totalQuery = totalQuery.gte('amount_paise', Math.round(Number(amountMin) * 100))
      if (amountMax) totalQuery = totalQuery.lte('amount_paise', Math.round(Number(amountMax) * 100))
      var totalRes = await totalQuery
      if (!totalRes.error) {
        var full = (totalRes.data || []).reduce(function (s, r) { return s + (r.amount_paise || 0) }, 0)
        setAllExpFullTotal(full)
        setAllExpFullCount(totalRes.count || 0)
      }
    }
  }

  function exportAllExpCSV() {
    if (!allExps.length) return
    var headers = ['Date', 'User', 'Department', 'Type', 'Sub-Type', 'Amount (pts)', 'Description', 'Status']
    var rows = allExps.map(function (e) {
      var firstAlloc = (e.expense_allocations && e.expense_allocations[0]) || {}
      var deptName = firstAlloc.department || ''
      var typeName = firstAlloc.expense_type_id ? (expTypeMap[firstAlloc.expense_type_id] || '') : ''
      var subTypeName = firstAlloc.expense_sub_type_id ? (expSubTypeMap[firstAlloc.expense_sub_type_id] || '') : ''
      return [
        e.expense_date || '',
        e.profiles?.name || '',
        deptName,
        typeName,
        subTypeName,
        e.amount_paise ? (e.amount_paise / 100) : 0,
        (e.description || '').replace(/,/g, ';'),
        e.status || '',
      ].join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'all_expenses_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }

  async function exportAllExpPDF() {
    if (pdfBusy) return
    if (!allExps.length && !allExpFullCount) return
    setPdfBusy(true)
    try {
      // ─ Fetch ALL matching rows across pagination ─
      var hasScope = scopeDeptIds && scopeDeptIds.length > 0
      var hasAllocFilter = !!(deptFilter || expTypeFilter || expSubTypeFilter || venueFilter) || hasScope
      var allocEmbed = hasAllocFilter
        ? 'expense_allocations!inner(department, department_id, venue_id, amount_paise, expense_type_id, expense_sub_type_id, remarks)'
        : 'expense_allocations(department, department_id, venue_id, amount_paise, expense_type_id, expense_sub_type_id, remarks)'
      var CHUNK = 1000
      var fromIdx = 0
      var fullRows = []
      while (true) {
        var q = supabase.from('expenses')
          .select('id, user_id, amount_paise, tax_paise, description, status, expense_date, created_at, deleted_at, vendor_name, metadata, expense_type_id, expense_sub_type_id, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), ' + allocEmbed)
          .order('expense_date', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .range(fromIdx, fromIdx + CHUNK - 1)
        if (allExpStatus === 'deleted') q = q.not('deleted_at', 'is', null)
        else if (allExpStatus) q = q.eq('status', allExpStatus).is('deleted_at', null)
        if (allExpFrom) q = q.gte('expense_date', allExpFrom)
        if (allExpTo) q = q.lte('expense_date', allExpTo)
        if (allExpSearchD) q = q.ilike('description', '%' + allExpSearchD + '%')
        if (userFilter) q = q.eq('user_id', userFilter)
        if (deptFilter) q = q.eq('expense_allocations.department_id', Number(deptFilter))
        if (expTypeFilter) q = q.eq('expense_allocations.expense_type_id', Number(expTypeFilter))
        if (expSubTypeFilter) q = q.eq('expense_allocations.expense_sub_type_id', Number(expSubTypeFilter))
        if (venueFilter) q = q.eq('expense_allocations.venue_id', Number(venueFilter))
        if (hasScope) q = q.in('expense_allocations.department_id', scopeDeptIds)
        if (amountMin) q = q.gte('amount_paise', Math.round(Number(amountMin) * 100))
        if (amountMax) q = q.lte('amount_paise', Math.round(Number(amountMax) * 100))
        var { data: chunk, error: chunkErr } = await q
        if (chunkErr) throw new Error(chunkErr.message)
        if (!chunk || chunk.length === 0) break
        fullRows = fullRows.concat(chunk)
        if (chunk.length < CHUNK) break
        fromIdx += CHUNK
      }

      // ─ Fetch user names in one RPC ─
      var uIds = []
      fullRows.forEach(function (r) { if (r.user_id && uIds.indexOf(r.user_id) === -1) uIds.push(r.user_id) })
      var nameMap = {}
      if (uIds.length > 0) {
        var { data: nm } = await supabase.rpc('get_profile_names', { p_ids: uIds })
        ;(nm || []).forEach(function (x) { nameMap[x.id] = x.name })
      }

      // ─ Fetch vendor names for any lookup-type extra field sourced from vendors ─
      var vendorIds = []
      fullRows.forEach(function (r) {
        var meta = r.metadata || {}
        var typeFields = (r.expense_types && r.expense_types.extra_fields) || []
        var subFields = (r.expense_sub_types && r.expense_sub_types.extra_fields) || []
        typeFields.concat(subFields).forEach(function (f) {
          if (!f || f.type !== 'lookup' || f.source !== 'vendors') return
          var vId = meta[f.key]
          if (vId != null && vId !== '' && vendorIds.indexOf(vId) === -1) vendorIds.push(vId)
        })
      })
      var vendorMap = {}
      if (vendorIds.length > 0) {
        var { data: vRows } = await supabase.from('vendors').select('id, name').in('id', vendorIds)
        ;(vRows || []).forEach(function (v) { vendorMap[String(v.id)] = v.name })
      }

      // ─ Build PDF ─
      var jsPDFmod = await import('jspdf')
      var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
      var autoTableMod = await import('jspdf-autotable')
      var autoTable = autoTableMod.default || autoTableMod

      var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      var pageW = doc.internal.pageSize.getWidth()

      var fontOk = await registerPdfFont(doc)
      var FONT = fontOk ? 'NotoSans' : 'helvetica'

      doc.setFont(FONT, 'bold'); doc.setFontSize(14)
      doc.text('Expense Statement', 14, 15)
      doc.setFont(FONT, 'normal'); doc.setFontSize(9)
      doc.text('Generated: ' + new Date().toLocaleString('en-IN'), pageW - 14, 15, { align: 'right' })

      var fParts = []
      if (allExpFrom || allExpTo) fParts.push('Period: ' + (allExpFrom || '…') + ' to ' + (allExpTo || '…'))
      if (allExpStatus) fParts.push('Status: ' + allExpStatus)
      if (userFilter) {
        var u = userOptions.find(function (x) { return String(x.id) === String(userFilter) })
        fParts.push('User: ' + (u ? u.name : userFilter))
      }
      if (deptFilter) {
        var d = deptOptions.find(function (x) { return String(x.id) === String(deptFilter) })
        fParts.push('Dept: ' + (d ? d.name : deptFilter))
      }
      if (expTypeFilter) fParts.push('Type: ' + (expTypeMap[expTypeFilter] || expTypeFilter))
      if (expSubTypeFilter) fParts.push('Sub-Type: ' + (expSubTypeMap[expSubTypeFilter] || expSubTypeFilter))
      if (venueFilter) {
        var v = venueOptions.find(function (x) { return String(x.id) === String(venueFilter) })
        fParts.push('Venue: ' + (v ? v.name : venueFilter))
      }
      if (amountMin) fParts.push('Min: ₹' + amountMin)
      if (amountMax) fParts.push('Max: ₹' + amountMax)
      if (allExpSearch) fParts.push('Search: "' + allExpSearch + '"')

      doc.setFontSize(8); doc.setTextColor(80)
      if (fParts.length) {
        doc.text('Filters: ' + fParts.join('  ·  '), 14, 21, { maxWidth: pageW - 28 })
      } else {
        doc.text('Filters: none (all expenses)', 14, 21)
      }
      doc.setTextColor(0)

      var body = []
      var totalDebit = 0
      var totalCredit = 0

      // Parallel to `body` (one entry per real expense row, not the trailing
      // GRAND TOTAL/NET rows) — didDrawCell below reads these to hand-draw the
      // Date and Particulars cells instead of relying on autoTable's default
      // single-style text flow, so the Expense/Entered dates get their own
      // labeled zones and every allocation amount lands on one right edge
      // regardless of how long its label is.
      var dateMeta = []
      var particularsMeta = []

      function fmtAmt(paise) {
        return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      }

      fullRows.forEach(function (e) {
        var isRefund = e.status === 'deleted' || e.status === 'rejected' || !!e.deleted_at
        var amt = e.amount_paise || 0
        var debit = isRefund ? 0 : amt
        var credit = isRefund ? amt : 0
        totalDebit += debit
        totalCredit += credit

        // Header: parent expense type › sub-type
        var typeName = e.expense_types?.name || ''
        var subTypeName = e.expense_sub_types?.name || ''
        var head = typeName ? typeName + (subTypeName ? ' > ' + subTypeName : '') : 'Expense'

        var pLines = [{ kind: 'header', text: head }]
        if (e.description) pLines.push({ kind: 'desc', text: e.description.trim() })

        // Vendor + extra_field chips
        var chipParts = []
        if (e.vendor_name) chipParts.push('Vendor: ' + e.vendor_name)
        var chips = extraFieldChips(e, vendorMap)
        chips.forEach(function (c) { chipParts.push(c.label + ': ' + c.value) })
        if (chipParts.length) pLines.push({ kind: 'chip', text: chipParts.join('   ·   ') })

        // Per-allocation split
        var allocs = e.expense_allocations || []
        allocs.forEach(function (a) {
          var venue = a.venue_id ? venueMap[a.venue_id] : ''
          var dept = a.department || ''
          var aSubType = a.expense_sub_type_id ? (expSubTypeMap[a.expense_sub_type_id] || '') : ''
          var parts = []
          if (venue) parts.push('[' + venue + ']')
          if (dept) parts.push(dept)
          if (aSubType) parts.push('> ' + aSubType)
          var label = parts.join(' ') || '—'
          if (a.remarks) label = label + ' | ' + a.remarks
          pLines.push({ kind: 'alloc', text: label, amount: fmtAmt(a.amount_paise || 0) })
        })

        // Subtotal + GST
        if ((e.tax_paise || 0) > 0) {
          var subtotal = allocs.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0)
          pLines.push({ kind: 'foot', text: 'Subtotal ' + fmtAmt(subtotal) + '   GST', amount: fmtAmt(e.tax_paise) })
        }

        if (e.status && e.status !== 'recorded') pLines.push({ kind: 'status', text: e.status })

        particularsMeta.push(pLines)
        dateMeta.push({
          expense: e.expense_date ? formatDate(e.expense_date) : '—',
          entry: e.created_at ? formatDateTime(e.created_at) : '',
        })

        // Plain-text fallback — what actually seeds autoTable's automatic row-height
        // calculation, and what a reader gets from copy/paste or a screen reader.
        // The hand-drawn cells below reproduce the same line count.
        var plainLines = pLines.map(function (l) {
          if (l.kind === 'alloc' || l.kind === 'foot') return '  ' + l.text + '   ' + l.amount
          if (l.kind === 'status') return '(' + l.text + ')'
          return l.text
        })

        body.push([
          dateMeta[dateMeta.length - 1].expense + '\n\n' + (dateMeta[dateMeta.length - 1].entry ? 'Entered ' + dateMeta[dateMeta.length - 1].entry : ''),
          '#' + e.id,
          nameMap[e.user_id] || '—',
          plainLines.join('\n'),
          debit ? fmtAmt(debit) : '',
          credit ? fmtAmt(credit) : '',
        ])
      })

      var net = totalDebit - totalCredit
      body.push([
        { content: 'GRAND TOTAL', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold', fillColor: [230, 230, 230] } },
        { content: (totalDebit / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), styles: { halign: 'right', fontStyle: 'bold', fillColor: [230, 230, 230] } },
        { content: (totalCredit / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), styles: { halign: 'right', fontStyle: 'bold', fillColor: [230, 230, 230] } },
      ])
      body.push([
        { content: 'NET (Debit − Credit)', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold', fillColor: [245, 245, 245] } },
        { content: '₹' + (net / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), styles: { halign: 'right', fontStyle: 'bold', fillColor: [245, 245, 245] } },
      ])

      autoTable(doc, {
        startY: fParts.length ? 27 : 25,
        // columnStyles' halign only ever reaches body cells (jspdf-autotable applies
        // it exclusively to sectionName === 'body'), so the Debit/Credit headers need
        // their own per-cell halign here to land over the right-aligned figures below.
        head: [['Date', 'Voucher', 'User', 'Particulars',
          { content: 'Debit ₹', styles: { halign: 'right' } },
          { content: 'Credit ₹', styles: { halign: 'right' } }]],
        body: body,
        styles: { font: FONT, fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' },
        // No blanket halign here — each column's own halign below applies to its
        // header too, so "Debit ₹"/"Credit ₹" line up over their numbers instead
        // of sitting centered above right-aligned figures.
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 30, fontSize: 7, halign: 'left' },
          1: { cellWidth: 16, halign: 'left' },
          2: { cellWidth: 30, halign: 'left' },
          3: { cellWidth: 'auto', halign: 'left' },
          4: { cellWidth: 26, halign: 'right' },
          5: { cellWidth: 26, halign: 'right' },
        },
        margin: { left: 10, right: 10 },
        // Date (0) and Particulars (3) are hand-drawn in didDrawCell below, so
        // suppress autoTable's own text for those two cells first — guarded to
        // real expense rows only. The trailing GRAND TOTAL/NET rows use colSpan
        // starting at column 0 and must keep their default-rendered text, and a
        // row whose content is too tall to fit a page gets split by autoTable
        // into a synthetic "remainder" row with index -1 for the continuation on
        // the next page — that one falls outside our meta arrays too, so it also
        // keeps its default (plain-text-fallback) rendering instead of crashing.
        willDrawCell: function (data) {
          if (data.section !== 'body' || data.row.index < 0 || data.row.index >= particularsMeta.length) return
          if (data.column.index === 0 || data.column.index === 3) data.cell.text = []
        },
        didDrawCell: function (data) {
          if (data.section !== 'body' || data.row.index < 0 || data.row.index >= particularsMeta.length) return
          var rowIdx = data.row.index
          var x0 = data.cell.x, y0 = data.cell.y, w = data.cell.width
          var padL = data.cell.padding('left')
          var padT = data.cell.padding('top')
          var innerW = w - padL - data.cell.padding('right')

          if (data.column.index === 0) {
            var dm = dateMeta[rowIdx]
            var y = y0 + padT + 2.2
            doc.setFont(FONT, 'normal'); doc.setFontSize(5.6); doc.setTextColor(130)
            doc.text('EXPENSE', x0 + padL, y)
            y += 3.4
            doc.setFont(FONT, 'bold'); doc.setFontSize(7.5); doc.setTextColor(20)
            doc.text(dm.expense, x0 + padL, y)
            y += 2.6
            doc.setDrawColor(210); doc.setLineWidth(0.15)
            doc.line(x0 + padL, y, x0 + padL + 10, y)
            if (dm.entry) {
              y += 3.4
              doc.setFont(FONT, 'normal'); doc.setFontSize(5.6); doc.setTextColor(130)
              doc.text('ENTERED', x0 + padL, y)
              y += 3.2
              doc.setFont(FONT, 'normal'); doc.setFontSize(6.8); doc.setTextColor(90)
              doc.text(dm.entry, x0 + padL, y)
            }
            doc.setTextColor(0)
          }

          if (data.column.index === 3) {
            var lines = particularsMeta[rowIdx]
            var yy = y0 + padT + 2.6
            var lineH = 3.6
            lines.forEach(function (l) {
              if (l.kind === 'header') {
                doc.setFont(FONT, 'bold'); doc.setFontSize(8); doc.setTextColor(20)
                doc.splitTextToSize(l.text, innerW).forEach(function (wl) { doc.text(wl, x0 + padL, yy); yy += lineH })
              } else if (l.kind === 'desc') {
                doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(40)
                doc.splitTextToSize(l.text, innerW).forEach(function (wl) { doc.text(wl, x0 + padL, yy); yy += lineH })
              } else if (l.kind === 'chip') {
                doc.setFont(FONT, 'normal'); doc.setFontSize(6.8); doc.setTextColor(80)
                doc.splitTextToSize(l.text, innerW).forEach(function (wl) { doc.text(wl, x0 + padL, yy); yy += lineH - 0.3 })
              } else if (l.kind === 'alloc' || l.kind === 'foot') {
                var indentX = x0 + padL + 2
                doc.setDrawColor(220); doc.setLineWidth(0.15)
                doc.line(indentX - 1.2, yy - 2.6, indentX - 1.2, yy + 0.6)
                doc.setFont(FONT, 'normal'); doc.setFontSize(7)
                doc.setTextColor(l.kind === 'foot' ? 130 : 90)
                var labelWrapped = doc.splitTextToSize(l.text, innerW - 22)
                doc.text(labelWrapped[0], indentX, yy)
                doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(20)
                doc.text(l.amount, x0 + w - data.cell.padding('right'), yy, { align: 'right' })
                yy += lineH
              } else if (l.kind === 'status') {
                doc.setFont(FONT, 'normal'); doc.setFontSize(6.8); doc.setTextColor(120)
                doc.text('(' + l.text + ')', x0 + padL, yy); yy += lineH
              }
            })
            doc.setTextColor(0)
          }
        },
        didDrawPage: function (data) {
          doc.setFontSize(7); doc.setTextColor(120)
          doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' })
          doc.setTextColor(0)
        },
      })

      await openOrSharePdf(doc, 'expenses_' + new Date().toISOString().split('T')[0] + '.pdf')
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  var allExpTotal = allExps.reduce(function (s, e) { return s + (e.amount_paise || 0) }, 0)

  return (
    <div className="space-y-4">
      {!embedded && (
        <div>
          <button onClick={onBack}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
          <h2 className="text-lg font-bold text-slate-900">All Expenses</h2>
        </div>
      )}

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          <Icon name="search" size={15} />
        </span>
        <SearchField
          value={allExpSearch}
          onChange={function (v) { setAllExpSearch(v) }}
          placeholder="Search description..."
          className="w-full"
        />
      </div>

      {(function () {
        var count = 0
        if (allExpStatus) count++
        if (allExpFrom) count++
        if (allExpTo) count++
        if (userFilter) count++
        if (deptFilter) count++
        if (expTypeFilter) count++
        if (expSubTypeFilter) count++
        if (venueFilter) count++
        if (amountMin) count++
        if (amountMax) count++
        function resetFilters() {
          setAllExpStatus(''); setAllExpFrom(''); setAllExpTo('')
          setUserFilter(''); setDeptFilter(''); setExpTypeFilter(''); setExpSubTypeFilter(''); setVenueFilter('')
          setAmountMin(''); setAmountMax('')
        }
        // Types scoped to selected dept (dept-agnostic types always visible)
        var typesForDept = deptFilter
          ? expTypeOptions.filter(function (t) { return !t.department_id || String(t.department_id) === deptFilter })
          : expTypeOptions
        var subTypesForType = expTypeFilter
          ? expSubTypeOptions.filter(function (s) { return String(s.expense_type_id) === expTypeFilter })
          : []
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[11.5px] text-slate-600">
                {!allExpLoading && allExps.length > 0 && (
                  <>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {allExps.length + (allExpFullCount > allExps.length ? ' of ' + allExpFullCount : '')}
                    </span>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span className="font-bold text-indigo-700 tabular-nums">{formatPoints(allExpFullTotal)}</span>
                  </>
                )}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                {/* Two exports are errands, not decisions — a green pill and a
                    red pill once made them the brightest things on the page. */}
                {allExps.length > 0 && (
                  <>
                    <button onClick={exportAllExpCSV}
                      className="inline-flex items-center gap-1.5 h-9 px-2.5 text-[12px] font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all">
                      <Icon name="download" size={14} />
                      CSV
                    </button>
                    <button onClick={exportAllExpPDF} disabled={pdfBusy}
                      className="inline-flex items-center gap-1.5 h-9 px-2.5 text-[12px] font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] disabled:opacity-40 transition-all">
                      <Icon name={pdfBusy ? 'refresh' : 'fileText'} size={14} />
                      {pdfBusy ? 'Generating…' : 'PDF'}
                    </button>
                    <span aria-hidden="true" className="w-px h-5 bg-slate-200 mx-0.5" />
                  </>
                )}
                {count > 0 && (
                  <button onClick={resetFilters}
                    className="inline-flex items-center gap-1.5 h-9 px-2.5 text-[12px] font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all">
                    <Icon name="close" size={13} />
                    Clear
                  </button>
                )}
                <button onClick={function () { setFiltersOpen(!filtersOpen) }}
                  className={"inline-flex items-center gap-1.5 h-9 px-3 text-[12px] font-semibold rounded-xl border transition-colors " + (filtersOpen ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")}>
                  <Icon name="filter" size={14} />
                  Filters
                  {count > 0 && <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold tabular-nums">{count}</span>}
                  <Icon name={filtersOpen ? 'chevronUp' : 'chevronDown'} size={13} />
                </button>
              </div>
            </div>
            {filtersOpen && (
              <div className={(glass ? "ambria-glass-card" : "bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.05)]") + " rounded-2xl p-3.5 space-y-3.5"}>
                <div>
                  <label className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5">Status</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {['', 'recorded', 'acknowledged', 'flagged', 'deducted', 'deleted'].map(function (s) {
                      // Never trust the map for the visible text: a status with
                      // no entry used to render a chip with nothing in it.
                      var label = s ? (APPROVAL_STATUS_LABELS[s] || (s.charAt(0).toUpperCase() + s.slice(1))) : 'All'
                      return (
                        <button key={s} onClick={function () { setAllExpStatus(s === allExpStatus ? '' : s) }}
                          className={"h-7 px-2.5 text-[11px] font-semibold rounded-full border transition-colors " +
                            (allExpStatus === s ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {userOptions.length > 0 && (
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5">User</label>
                    <FilterDropdown value={userFilter} placeholder="All users"
                      options={userOptions.map(function (u) { return { label: u.name || '—', value: String(u.id) } })}
                      onChange={setUserFilter} />
                  </div>
                )}
                {/* Department narrows Type, which narrows Sub-type, so the one
                    that drives the other two spans the row and they sit under
                    it. Sub-type used to take half a row on its own and leave a
                    hole beside it. */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5">Department</label>
                    <FilterDropdown value={deptFilter} placeholder="All departments"
                      options={deptOptions.map(function (d) { return { label: d.name, value: String(d.id) } })}
                      onChange={function (v) { setDeptFilter(v); setExpTypeFilter(''); setExpSubTypeFilter('') }} />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5">Type</label>
                      <FilterDropdown value={expTypeFilter} placeholder="All types"
                        options={typesForDept.map(function (t) { return { label: t.name, value: String(t.id) } })}
                        onChange={function (v) { setExpTypeFilter(v); setExpSubTypeFilter('') }} />
                    </div>
                    <div className={expTypeFilter ? '' : 'opacity-50 pointer-events-none'}>
                      <label className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5">Sub-type</label>
                      <FilterDropdown value={expSubTypeFilter} placeholder={expTypeFilter ? 'All sub-types' : 'Pick a type'}
                        options={subTypesForType.map(function (s) { return { label: s.name, value: String(s.id) } })}
                        onChange={setExpSubTypeFilter} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5">Venue</label>
                    <FilterDropdown value={venueFilter} placeholder="All venues"
                      options={venueOptions.map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })}
                      onChange={setVenueFilter} />
                  </div>
                </div>

                {/* The two ranges, on a rule of their own: everything above
                    picks one value from a list, these two bracket it. */}
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5">Amount (pts)</label>
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" step="any" inputMode="decimal" value={amountMin}
                        onChange={function (e) { setAmountMin(e.target.value) }}
                        placeholder="Min"
                        className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 tabular-nums placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                        style={{ fontSize: '16px' }} />
                      <span className="shrink-0 text-slate-400"><Icon name="minus" size={12} /></span>
                      <input type="number" min="0" step="any" inputMode="decimal" value={amountMax}
                        onChange={function (e) { setAmountMax(e.target.value) }}
                        placeholder="Max"
                        className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 tabular-nums placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                        style={{ fontSize: '16px' }} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5">Date</label>
                    {/* The app's own picker rather than <input type="date">:
                        the native control prints mm/dd/yyyy or dd/mm/yyyy at
                        the browser's whim, in its own typeface, and no CSS
                        changes either. `plain` drops the event dots and the
                        venue legend, which mean nothing to an expense date. */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <EventDatePicker value={allExpFrom} onChange={setAllExpFrom} collapsible includePast plain />
                      </div>
                      <span className="shrink-0 text-slate-400"><Icon name="minus" size={12} /></span>
                      <div className="flex-1 min-w-0">
                        <EventDatePicker value={allExpTo} onChange={setAllExpTo} collapsible includePast plain />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {allExpLoading && <p className="text-slate-500 text-sm text-center py-4">Loading...</p>}

      {!allExpLoading && allExps.length === 0 && (
        <div className={(glass ? "ambria-glass-card" : "bg-white border border-slate-200") + " rounded-xl p-8 text-center"}>
          <p className="text-slate-500 text-sm">No expenses found</p>
        </div>
      )}


      {!allExpLoading && (
        <div className="space-y-3">
          {allExps.map(function (exp, ei) {
            return (
              <div key={exp.id}
                onClick={function () { onOpenDetail(exp) }}
                style={{ animationDelay: (Math.min(ei, 8) * 25) + 'ms' }}
                className={"ambria-rise relative overflow-hidden rounded-2xl pl-4 pr-3.5 py-3 transform-gpu hover:shadow-lg hover:-translate-y-px hover:scale-[1.006] active:scale-100 cursor-pointer transition-all duration-150 " +
                  (glass ? "ambria-glass-card" : "bg-white border border-slate-200 hover:border-indigo-200 active:bg-slate-50")}>
                {/* 3px rail: status reads before a single word does and costs
                    no height, so the pill no longer has to shout from the
                    amount column. */}
                <span aria-hidden="true"
                  className={"absolute left-0 top-0 bottom-0 w-[3px] " + (exp.deleted_at ? 'bg-slate-400' : (STATUS_RAIL[exp.status] || 'bg-slate-300'))} />
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-slate-900 leading-snug truncate">
                      {(function () {
                        var typeName = exp.expense_types?.name || ''
                        var subTypeName = exp.expense_sub_types?.name || ''
                        return typeName ? typeName + (subTypeName ? ' › ' + subTypeName : '') : 'Expense'
                      })()}
                    </p>
                    {exp.description && (
                      <p className="text-[12px] text-slate-600 leading-snug mt-0.5 truncate">{exp.description}</p>
                    )}
                    {(function () {
                      var chips = extraFieldChips(exp)
                      var hasVendor = !!exp.vendor_name
                      if (chips.length === 0 && !hasVendor) return null
                      return (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {hasVendor && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 text-[10px]">
                              <span className="text-indigo-500">Vendor:</span>
                              <span className="text-indigo-800 font-medium">{exp.vendor_name}</span>
                            </span>
                          )}
                          {chips.map(function (c, i) {
                            return (
                              <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-[10px]">
                                <span className="text-slate-500">{c.label}:</span>
                                <span className="text-slate-800 font-medium">{c.value}</span>
                              </span>
                            )
                          })}
                        </div>
                      )
                    })()}
                    {(function () {
                      var allocs = exp.expense_allocations || []
                      if (allocs.length === 0) return null
                      var subtotal = allocs.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0)
                      var tax = exp.tax_paise || 0
                      // With one allocation carrying the whole amount, its
                      // figure is the card total printed a second time three
                      // lines below itself. The breadcrumb still earns its
                      // line — it says which department and sub-type the
                      // money went to — so only the number goes.
                      //
                      // Compared, not assumed: an expense with GST splits its
                      // allocation at the net amount, so the two numbers are
                      // genuinely different and both belong on screen.
                      var oneAllocIsWhole = allocs.length === 1 &&
                        (allocs[0].amount_paise || 0) === exp.amount_paise
                      return (
                        <div className="mt-1.5 border-t border-slate-100 pt-1.5">
                          <div className="space-y-0.5">
                          {allocs.map(function (a, i) {
                            var venue = a.venue_id ? venueMap[a.venue_id] : ''
                            var dept = a.department || ''
                            var subType = a.expense_sub_type_id ? (expSubTypeMap[a.expense_sub_type_id] || '') : ''
                            var tail = (subType ? ' › ' + subType : '') + (a.remarks ? ' · ' + a.remarks : '')
                            return (
                              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-slate-500 truncate">
                                  {venue ? '[' + venue + '] ' : ''}
                                  {dept ? <span className={deptInk(dept)}>{dept}</span> : null}
                                  {!venue && !dept && !subType ? '—' : ''}
                                  {tail}
                                </span>
                                {!oneAllocIsWhole && (
                                  <span className="text-slate-700 font-semibold tabular-nums flex-shrink-0">{formatPoints(a.amount_paise || 0)}</span>
                                )}
                              </div>
                            )
                          })}
                          </div>
                          {/* Subtotal and GST are totals of the block above,
                              not more rows of it, so they sit under the first
                              column on their own rule. */}
                          {tax > 0 && (
                            <div className="mt-1 pt-1 border-t border-slate-100 space-y-0.5">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-slate-500">Subtotal</span>
                                <span className="text-slate-700 font-semibold tabular-nums">{formatPoints(subtotal)}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-slate-500">GST</span>
                                <span className="text-slate-700 font-semibold tabular-nums">{formatPoints(tax)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    <p className="mt-1.5 flex items-center gap-1.5 min-w-0">
                      <span className={"shrink-0 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded " + (exp.deleted_at ? "bg-slate-200 text-slate-600" : (APPROVAL_STATUS_COLORS[exp.status] || 'bg-slate-100 text-slate-600'))}>
                        {exp.deleted_at ? 'Deleted' : (APPROVAL_STATUS_LABELS[exp.status] || exp.status)}
                      </span>
                      <span className="text-[11px] text-slate-500 truncate">
                        {(exp.profiles?.name || '—') + ' · '}
                        {formatDate(exp.expense_date)}
                      </span>
                    </p>
                    {(function () {
                      function actor(icon, tone, verb, who) {
                        return (
                          <p className={"flex items-center gap-1.5 text-[11px] mt-1 " + tone}>
                            <Icon name={icon} size={12} />
                            <span className="truncate">{verb} <span className="font-semibold">{who}</span></span>
                          </p>
                        )
                      }
                      if (exp.deleted_at && exp._deleterName) return actor('trash', 'text-slate-500', 'Deleted by', exp._deleterName)
                      if (exp.status === 'deducted' && exp._penalizerName) return actor('banknote', 'text-orange-600', 'Deducted by', exp._penalizerName)
                      if (exp.status === 'flagged' && exp._reviewerName) return actor('undo', 'text-red-600', 'Sent back by', exp._reviewerName)
                      if (exp.status === 'acknowledged' && exp._acknowledgerName) return actor('checkCircle', 'text-indigo-700', 'Acknowledged by', exp._acknowledgerName)
                      return null
                    })()}
                  </div>
                  <span className="shrink-0 text-[14px] font-bold text-slate-900 tabular-nums tracking-[-0.01em]">
                    {formatPoints(exp.amount_paise)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {allExpHasMore && (
        <button onClick={function () { loadAllExps(true) }} disabled={allExpLoadingMore}
          className="w-full inline-flex items-center justify-center gap-2 py-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.99] disabled:opacity-50 transition-all">
          <Icon name={allExpLoadingMore ? 'refresh' : 'chevronDown'} size={15} />
          {allExpLoadingMore ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}

export default AllExpenses
