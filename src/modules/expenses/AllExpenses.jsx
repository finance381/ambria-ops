import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'
import FilterDropdown from '../../components/ui/FilterDropdown'
import { registerPdfFont } from '../../lib/pdfFont'

var PAGE_SIZE = 20



function extraFieldChips(exp) {
  var meta = exp.metadata || {}
  var typeFields = (exp.expense_types && exp.expense_types.extra_fields) || []
  var subFields = (exp.expense_sub_types && exp.expense_sub_types.extra_fields) || []
  var chips = []
  typeFields.concat(subFields).forEach(function (f) {
    if (!f || !f.key || f.type === 'lookup') return
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

function AllExpenses({ onBack, onOpenDetail, embedded, scopeDeptIds }) {
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
  var [expTypeOptions, setExpTypeOptions] = useState([])
  var [expSubTypeOptions, setExpSubTypeOptions] = useState([])
  var [expTypeMap, setExpTypeMap] = useState({})
  var [expSubTypeMap, setExpSubTypeMap] = useState({})
  var [venueOptions, setVenueOptions] = useState([])
  var [venueMap, setVenueMap] = useState({})
  var [userOptions, setUserOptions] = useState([])

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
      supabase.from('expense_types').select('id, name, department_id').eq('active', true).order('name'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('venues').select('id, code, name').eq('active', true).order('name'),
      supabase.from('profiles').select('id, name').order('name'),
      supabase.from('expense_sub_types').select('id, name, expense_type_id').eq('active', true).order('name'),
    ]).then(function (res) {
      var ets = res[0].data || []
      var etMap = {}
      ets.forEach(function (t) { etMap[t.id] = t.name })
      setExpTypeMap(etMap)
      setExpTypeOptions(ets)
      setDeptOptions(res[1].data || [])
      var vs = res[2].data || []
      setVenueOptions(vs)
      var vMap = {}
      vs.forEach(function (v) { vMap[v.id] = v.code || v.name })
      setVenueMap(vMap)
      setUserOptions(res[3].data || [])
      var ests = res[4].data || []
      var estMap = {}
      ests.forEach(function (s) { estMap[s.id] = s.name })
      setExpSubTypeMap(estMap)
      setExpSubTypeOptions(ests)
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
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, delete_reason, deleted_by, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name), ' + allocEmbed)
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
          .select('id, user_id, amount_paise, tax_paise, description, status, expense_date, deleted_at, vendor_name, metadata, expense_type_id, expense_sub_type_id, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), ' + allocEmbed)
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

        var lines = [head]
        if (e.description) lines.push(e.description.trim())

        // Vendor + extra_field chips
        var chipParts = []
        if (e.vendor_name) chipParts.push('Vendor: ' + e.vendor_name)
        var chips = extraFieldChips(e)
        chips.forEach(function (c) { chipParts.push(c.label + ': ' + c.value) })
        if (chipParts.length) lines.push(chipParts.join('  |  '))

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
          lines.push('  ' + label + ' — ' + fmtAmt(a.amount_paise || 0))
        })

        // Subtotal + GST
        if ((e.tax_paise || 0) > 0) {
          var subtotal = allocs.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0)
          lines.push('  Subtotal: ' + fmtAmt(subtotal) + '   GST: ' + fmtAmt(e.tax_paise))
        }

        if (e.status && e.status !== 'recorded') lines.push('(' + e.status + ')')

        body.push([
          e.expense_date || '',
          '#' + e.id,
          nameMap[e.user_id] || '—',
          lines.join('\n'),
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
        head: [['Date', 'Voucher', 'User', 'Particulars', 'Debit ₹', 'Credit ₹']],
        body: body,
        styles: { font: FONT, fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 18 },
          2: { cellWidth: 35 },
          3: { cellWidth: 'auto' },
          4: { cellWidth: 30, halign: 'right' },
          5: { cellWidth: 30, halign: 'right' },
        },
        margin: { left: 10, right: 10 },
        didDrawPage: function (data) {
          doc.setFontSize(7); doc.setTextColor(120)
          doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' })
          doc.setTextColor(0)
        },
      })

      doc.save('expenses_' + new Date().toISOString().split('T')[0] + '.pdf')
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  var allExpTotal = allExps.reduce(function (s, e) { return s + (e.amount_paise || 0) }, 0)

  return (
    <div className="space-y-4">
      <div>
        {!embedded && (
          <button onClick={onBack}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
        )}
        <div className="flex items-center justify-between">
          <div>
            {!embedded && <h2 className="text-lg font-bold text-gray-900">All Expenses</h2>}
          </div>
          {allExps.length > 0 && (
            <div className="flex gap-2">
              <button onClick={exportAllExpCSV}
                className="px-3 py-1.5 text-xs font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                📥 CSV
              </button>
              <button onClick={exportAllExpPDF} disabled={pdfBusy}
                className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-40">
                {pdfBusy ? '⏳ Generating...' : '📄 PDF'}
              </button>
            </div>
          )}
        </div>
      </div>

      <input type="text" value={allExpSearch} onChange={function (e) { setAllExpSearch(e.target.value) }}
        placeholder="Search description..."
        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        style={{ fontSize: '16px' }} />

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
            <div className="flex gap-2">
              <button onClick={function () { setFiltersOpen(!filtersOpen) }}
                className={"flex-1 py-2 text-xs font-bold rounded-lg border transition-colors " + (filtersOpen ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                {filtersOpen ? '▲' : '▼'} Filters{count > 0 ? ' · ' + count : ''}
              </button>
              {count > 0 && (
                <button onClick={resetFilters}
                  className="px-3 py-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                  Reset
                </button>
              )}
            </div>
            {filtersOpen && (
              <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Status</label>
                  <div className="flex gap-2 flex-wrap">
                    {['', 'recorded', 'acknowledged', 'flagged', 'deducted', 'deleted'].map(function (s) {
                      var label = s === 'deleted' ? 'Deleted' : (s ? APPROVAL_STATUS_LABELS[s] : 'All')
                      return (
                        <button key={s} onClick={function () { setAllExpStatus(s === allExpStatus ? '' : s) }}
                          className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                            (allExpStatus === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {userOptions.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">User</label>
                    <FilterDropdown value={userFilter} placeholder="All users"
                      options={userOptions.map(function (u) { return { label: u.name || '—', value: String(u.id) } })}
                      onChange={setUserFilter} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Department</label>
                    <FilterDropdown value={deptFilter} placeholder="All departments"
                      options={deptOptions.map(function (d) { return { label: d.name, value: String(d.id) } })}
                      onChange={function (v) { setDeptFilter(v); setExpTypeFilter(''); setExpSubTypeFilter('') }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Type</label>
                    <FilterDropdown value={expTypeFilter} placeholder="All types"
                      options={typesForDept.map(function (t) { return { label: t.name, value: String(t.id) } })}
                      onChange={function (v) { setExpTypeFilter(v); setExpSubTypeFilter('') }} />
                  </div>
                  <div className={expTypeFilter ? '' : 'opacity-50 pointer-events-none'}>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sub-Type</label>
                    <FilterDropdown value={expSubTypeFilter} placeholder={expTypeFilter ? 'All sub-types' : 'Pick type first'}
                      options={subTypesForType.map(function (s) { return { label: s.name, value: String(s.id) } })}
                      onChange={setExpSubTypeFilter} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Venue</label>
                    <FilterDropdown value={venueFilter} placeholder="All venues"
                      options={venueOptions.map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })}
                      onChange={setVenueFilter} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Min (pts)</label>
                    <input type="number" min="0" step="any" inputMode="decimal" value={amountMin}
                      onChange={function (e) { setAmountMin(e.target.value) }}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Max (pts)</label>
                    <input type="number" min="0" step="any" inputMode="decimal" value={amountMax}
                      onChange={function (e) { setAmountMax(e.target.value) }}
                      placeholder="∞"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
                    <input type="date" value={allExpFrom}
                      onChange={function (e) { setAllExpFrom(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
                    <input type="date" value={allExpTo}
                      onChange={function (e) { setAllExpTo(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {allExpLoading && <p className="text-gray-400 text-sm text-center py-4">Loading...</p>}

      {!allExpLoading && allExps.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No expenses found</p>
        </div>
      )}

      {!allExpLoading && allExps.length > 0 && (
        <div className="px-1 text-xs text-gray-600">
          <span className="font-semibold text-gray-900">{allExps.length}{allExpFullCount > allExps.length ? ' of ' + allExpFullCount : ''}</span> shown ·
          Total: <span className="text-base font-bold text-indigo-700">{formatPoints(allExpFullTotal)}</span>
        </div>
      )}

      {!allExpLoading && (
        <div className="space-y-3">
          {allExps.map(function (exp) {
            return (
              <div key={exp.id}
                onClick={function () { onOpenDetail(exp) }}
                className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md active:bg-gray-50 cursor-pointer transition-all">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {(function () {
                        var typeName = exp.expense_types?.name || ''
                        var subTypeName = exp.expense_sub_types?.name || ''
                        return typeName ? typeName + (subTypeName ? ' › ' + subTypeName : '') : 'Expense'
                      })()}
                    </p>
                    {exp.description && (
                      <p className="text-xs text-gray-600 mt-0.5 truncate">{exp.description}</p>
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
                              <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-[10px]">
                                <span className="text-gray-500">{c.label}:</span>
                                <span className="text-gray-800 font-medium">{c.value}</span>
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
                      return (
                        <div className="mt-1.5 border-t border-gray-100 pt-1.5 space-y-0.5">
                          {allocs.map(function (a, i) {
                            var venue = a.venue_id ? venueMap[a.venue_id] : ''
                            var dept = a.department || ''
                            var subType = a.expense_sub_type_id ? (expSubTypeMap[a.expense_sub_type_id] || '') : ''
                            var parts = []
                            if (venue) parts.push('[' + venue + ']')
                            if (dept) parts.push(dept)
                            if (subType) parts.push('› ' + subType)
                            var label = parts.join(' ')
                            return (
                              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-gray-500 truncate">{label || '—'}{a.remarks ? ' · ' + a.remarks : ''}</span>
                                <span className="text-gray-700 font-semibold flex-shrink-0">{formatPoints(a.amount_paise || 0)}</span>
                              </div>
                            )
                          })}
                          {tax > 0 && (
                            <div className="flex items-center justify-between gap-2 text-[11px] border-t border-gray-100 pt-1 mt-1">
                              <span className="text-gray-500">Subtotal</span>
                              <span className="text-gray-700 font-semibold">{formatPoints(subtotal)}</span>
                            </div>
                          )}
                          {tax > 0 && (
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="text-gray-500">GST</span>
                              <span className="text-gray-700 font-semibold">{formatPoints(tax)}</span>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    <p className="text-[11px] text-gray-400 mt-1">
                      {(exp.profiles?.name || '—') + ' · '}
                      {formatDate(exp.expense_date)}
                    </p>
                    {(function () {
                      if (exp.deleted_at && exp._deleterName) {
                        return <p className="text-[11px] text-gray-500 mt-0.5">🗑 Deleted by <span className="font-semibold">{exp._deleterName}</span></p>
                      }
                      if (exp.status === 'deducted' && exp._penalizerName) {
                        return <p className="text-[11px] text-orange-600 mt-0.5">⚠️ Deducted by <span className="font-semibold">{exp._penalizerName}</span></p>
                      }
                      if (exp.status === 'flagged' && exp._reviewerName) {
                        return <p className="text-[11px] text-red-600 mt-0.5">🚩 Flagged by <span className="font-semibold">{exp._reviewerName}</span></p>
                      }
                      if (exp.status === 'acknowledged' && exp._acknowledgerName) {
                        return <p className="text-[11px] text-green-700 mt-0.5">✓ Acknowledged by <span className="font-semibold">{exp._acknowledgerName}</span></p>
                      }
                      return null
                    })()}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                    <span className="text-sm font-bold text-gray-800">{formatPoints(exp.amount_paise)}</span>
                    <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (exp.deleted_at ? "bg-gray-200 text-gray-600" : (APPROVAL_STATUS_COLORS[exp.status] || 'bg-gray-100 text-gray-600'))}>
                      {exp.deleted_at ? '🗑 Deleted' : (APPROVAL_STATUS_LABELS[exp.status] || exp.status)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {allExpHasMore && (
        <button onClick={function () { loadAllExps(true) }} disabled={allExpLoadingMore}
          className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          {allExpLoadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  )
}

export default AllExpenses
