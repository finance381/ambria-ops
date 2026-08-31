import { useState, useEffect, useMemo } from 'react'
import { supabase, fetchAll } from '../../lib/supabase'
import { formatDate, formatPaise } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import { registerPdfFont } from '../../lib/pdfFont'
import ExpenseDetail from './ExpenseDetail'
import MultiSearchDropdown from '../../components/ui/MultiSearchDropdown'
import { hasPerm } from '../../lib/permissions'

var PAGE_SIZE = 50

function InventoryLedger({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var isAdmin = profile && (profile.role === 'admin' || profile.role === 'auditor')
  var canView = isAdmin || hasPerm(permsNew, 'finance.ledgers.inventory')

  var [items, setItems] = useState([])
  var [history, setHistory] = useState([])
  var [loading, setLoading] = useState(true)
  var [selectedItem, setSelectedItem] = useState(null)
  var [search, setSearch] = useState('')
  var [catFilters, setCatFilters] = useState([])
  var [subCatFilters, setSubCatFilters] = useState([])
  var [sourceFilters, setSourceFilters] = useState([])
  var [vendorFilters, setVendorFilters] = useState([])
  var [sortBy, setSortBy] = useState('name')  // name | value_desc | value_asc | rate_desc | rate_asc
  var [showNoHistory, setShowNoHistory] = useState(false)
  var [page, setPage] = useState(0)
  var [exporting, setExporting] = useState(false)

  function fmtQty(n) {
    var num = Number(n || 0)
    if (!isFinite(num)) return '0'
    // Round to 2 decimals, then strip trailing zeros. Handles float artifacts like 404.400000000000801.
    var rounded = Math.round(num * 100) / 100
    return String(rounded)
  }

  var [expenseDetailTarget, setExpenseDetailTarget] = useState(null)
  var [expenseDetailLoading, setExpenseDetailLoading] = useState(false)

  useEffect(function () {
    if (canView) loadAll()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useRealtime(['inventory_items', 'catering_store_items', 'purchase_order_items', 'expenses'], function () {
    if (canView) loadAll()
  })

  useEffect(function () { setPage(0) }, [search, catFilters, subCatFilters, sourceFilters, vendorFilters, sortBy, showNoHistory])

  async function loadAll() {
    setLoading(true)
    try {
      var results = await Promise.all([
        fetchAll(supabase.from('inventory_items')
          .select('id, name, inventory_id, qty, rate_paise, categories(id, name), sub_categories(id, name)')
          .order('name', { ascending: true })),
        fetchAll(supabase.from('catering_store_items')
          .select('id, name, inventory_id, qty, rate_paise, categories(id, name), sub_categories(id, name)')
          .order('name', { ascending: true })),
        fetchAll(supabase.from('v_item_purchase_history')
          .select('item_id, item_source, vendor_name, qty, unit, rate_paise, amount_paise, txn_date, source_type, source_id, source_ref'))
      ])
      var invRes = results[0] || []
      var csRes = results[1] || []
      var histRes = results[2] || []

      // Creator name lookup: expenses.user_id (source_type='expense') + purchase_orders.created_by (source_type='po')
      var expIds = []
      var poItemIds = []
      histRes.forEach(function (h) {
        if (!h.source_id) return
        if (h.source_type === 'expense') {
          var n = Number(h.source_id)
          if (isFinite(n) && expIds.indexOf(n) === -1) expIds.push(n)
        } else if (h.source_type === 'po') {
          if (poItemIds.indexOf(h.source_id) === -1) poItemIds.push(h.source_id)
        }
      })
      var userIdBySource = {}  // key: source_type + ':' + source_id → user_id
      var allUserIds = []
      function addUid(u) { if (u && allUserIds.indexOf(u) === -1) allUserIds.push(u) }
      if (expIds.length > 0) {
        var CHUNK = 500
        for (var i = 0; i < expIds.length; i += CHUNK) {
          var eChunk = expIds.slice(i, i + CHUNK)
          var eRes = await supabase.from('expenses').select('id, user_id').in('id', eChunk)
          ;(eRes.data || []).forEach(function (r) {
            userIdBySource['expense:' + r.id] = r.user_id
            addUid(r.user_id)
          })
        }
      }
      if (poItemIds.length > 0) {
        var poIdSet = []
        for (var j = 0; j < poItemIds.length; j += 500) {
          var iChunk = poItemIds.slice(j, j + 500)
          var iRes = await supabase.from('purchase_order_items').select('id, po_id').in('id', iChunk)
          ;(iRes.data || []).forEach(function (pi) {
            userIdBySource['po_item_map:' + pi.id] = pi.po_id  // temp store po_id
            if (pi.po_id && poIdSet.indexOf(pi.po_id) === -1) poIdSet.push(pi.po_id)
          })
        }
        var poCreatorById = {}
        for (var k = 0; k < poIdSet.length; k += 500) {
          var pChunk = poIdSet.slice(k, k + 500)
          var pRes = await supabase.from('purchase_orders').select('id, created_by').in('id', pChunk)
          ;(pRes.data || []).forEach(function (po) { poCreatorById[po.id] = po.created_by; addUid(po.created_by) })
        }
        // Resolve po_item_map → final creator user_id under po:<source_id>
        poItemIds.forEach(function (piId) {
          var poId = userIdBySource['po_item_map:' + piId]
          if (poId && poCreatorById[poId]) userIdBySource['po:' + piId] = poCreatorById[poId]
          delete userIdBySource['po_item_map:' + piId]
        })
      }
      var nameById = {}
      if (allUserIds.length > 0) {
        var { data: profRows } = await supabase.from('profiles').select('id, name').in('id', allUserIds)
        ;(profRows || []).forEach(function (p) { nameById[p.id] = p.name || null })
      }
      histRes = histRes.map(function (h) {
        var key = h.source_type + ':' + h.source_id
        var uid = userIdBySource[key]
        var nm = uid ? nameById[uid] : null
        return nm ? Object.assign({}, h, { _creatorName: nm }) : h
      })

      var merged = []
      invRes.forEach(function (r) {
        merged.push({
          _key: 'inventory:' + r.id, _source: 'inventory', id: r.id,
          name: r.name || '', code: r.inventory_id || '',
          cat: r.categories && r.categories.name || '', subcat: r.sub_categories && r.sub_categories.name || '',
          rate_paise: r.rate_paise || 0, live_qty: Number(r.qty || 0)
        })
      })
      csRes.forEach(function (r) {
        merged.push({
          _key: 'catering_store:' + r.id, _source: 'catering_store', id: r.id,
          name: r.name || '', code: r.inventory_id || '',
          cat: r.categories && r.categories.name || '', subcat: r.sub_categories && r.sub_categories.name || '',
          rate_paise: r.rate_paise || 0, live_qty: Number(r.qty || 0)
        })
      })
      merged.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') })
      setItems(merged)
      setHistory(histRes)
    } catch (e) {
      console.error('INVENTORY_LEDGER_LOAD_FAIL', e)
    }
    setLoading(false)
  }

  var historyByItem = useMemo(function () {
    var m = {}
    history.forEach(function (h) {
      var k = h.item_source + ':' + h.item_id
      if (!m[k]) m[k] = []
      m[k].push(h)
    })
    Object.keys(m).forEach(function (k) {
      m[k].sort(function (a, b) {
        return (b.txn_date || '0000-00-00').localeCompare(a.txn_date || '0000-00-00')
      })
    })
    return m
  }, [history])

  function computeTrend(rows) {
    var byVendor = {}
    rows.forEach(function (r) {
      if (!byVendor[r.vendor_name]) byVendor[r.vendor_name] = []
      byVendor[r.vendor_name].push(r)
    })
    Object.keys(byVendor).forEach(function (v) {
      byVendor[v].sort(function (a, b) {
        return (b.txn_date || '').localeCompare(a.txn_date || '')
      })
    })
    return rows.map(function (r) {
      var vendorRows = byVendor[r.vendor_name] || []
      var idx = -1
      for (var i = 0; i < vendorRows.length; i++) {
        if (vendorRows[i].source_type === r.source_type && vendorRows[i].source_id === r.source_id) { idx = i; break }
      }
      var prev = idx >= 0 ? vendorRows[idx + 1] : null
      var trend = null
      if (prev && prev.rate_paise != null && r.rate_paise != null) {
        if (r.rate_paise > prev.rate_paise) trend = 'up'
        else if (r.rate_paise < prev.rate_paise) trend = 'down'
        else trend = 'same'
      } else if (!prev) trend = 'new'
      return Object.assign({}, r, { _trend: trend, _prev_rate: prev ? prev.rate_paise : null })
    })
  }

  function aggregateItem(item) {
    var rows = historyByItem[item._key] || []
    if (vendorFilters.length > 0) rows = rows.filter(function (r) { return vendorFilters.indexOf(r.vendor_name) !== -1 })
    var vendors = []
    var vendorStats = {}
    var totalSpend = 0
    var totalQty = 0
    var bestRate = null
    rows.forEach(function (r) {
      if (r.vendor_name) {
        if (vendors.indexOf(r.vendor_name) === -1) vendors.push(r.vendor_name)
        if (!vendorStats[r.vendor_name]) vendorStats[r.vendor_name] = { spend: 0, qty: 0, count: 0 }
        vendorStats[r.vendor_name].spend += Number(r.amount_paise || 0)
        vendorStats[r.vendor_name].qty += Number(r.qty || 0)
        vendorStats[r.vendor_name].count += 1
      }
      totalSpend += Number(r.amount_paise || 0)
      totalQty += Number(r.qty || 0)
      if (r.rate_paise != null && (bestRate == null || r.rate_paise < bestRate)) bestRate = r.rate_paise
    })
    var avgRate = totalQty > 0 ? Math.round(totalSpend / totalQty) : null
    var cheapest = null
    Object.keys(vendorStats).forEach(function (v) {
      var s = vendorStats[v]
      if (s.qty <= 0) return
      var avg = Math.round(s.spend / s.qty)
      if (!cheapest || avg < cheapest.avgRate) cheapest = { vendor: v, avgRate: avg, count: s.count }
    })
    return {
      vendors: vendors, last3: computeTrend(rows.slice(0, 3)),
      totalSpend: totalSpend, totalQty: totalQty, txnCount: rows.length,
      avgRate: avgRate, bestRate: bestRate, cheapest: cheapest,
      allRows: computeTrend(rows)
    }
  }

  var allVendors = useMemo(function () {
    var s = {}
    history.forEach(function (h) { if (h.vendor_name) s[h.vendor_name] = true })
    return Object.keys(s).sort()
  }, [history])

  var allCats = useMemo(function () {
    var s = {}
    items.forEach(function (i) { if (i.cat) s[i.cat] = true })
    return Object.keys(s).sort()
  }, [items])

  var allSubCats = useMemo(function () {
    var s = {}
    items.forEach(function (i) {
      if (i.subcat && (catFilters.length === 0 || catFilters.indexOf(i.cat) !== -1)) s[i.subcat] = true
    })
    return Object.keys(s).sort()
  }, [items, catFilters])

  var filteredItems = useMemo(function () {
    var q = search.trim().toLowerCase()
    return items.filter(function (i) {
      var rows = historyByItem[i._key] || []
      if (!showNoHistory && rows.length === 0) return false
      if (sourceFilters.length > 0 && sourceFilters.indexOf(i._source) === -1) return false
      if (catFilters.length > 0 && catFilters.indexOf(i.cat) === -1) return false
      if (subCatFilters.length > 0 && subCatFilters.indexOf(i.subcat) === -1) return false
      if (vendorFilters.length > 0) {
        var has = false
        for (var k = 0; k < rows.length; k++) { if (vendorFilters.indexOf(rows[k].vendor_name) !== -1) { has = true; break } }
        if (!has) return false
      }
      if (q) {
        var hay = (i.name + ' ' + (i.code || '') + ' ' + (i.cat || '') + ' ' + (i.subcat || '')).toLowerCase()
        if (hay.indexOf(q) === -1) return false
      }
      return true
    })
  }, [items, search, catFilters, subCatFilters, sourceFilters, vendorFilters, historyByItem, showNoHistory])

  var sortedItems = useMemo(function () {
    if (sortBy === 'name') return filteredItems
    var arr = filteredItems.slice()
    if (sortBy === 'value_desc' || sortBy === 'value_asc') {
      arr.sort(function (a, b) {
        var va = (a.live_qty || 0) * (a.rate_paise || 0)
        var vb = (b.live_qty || 0) * (b.rate_paise || 0)
        return sortBy === 'value_desc' ? vb - va : va - vb
      })
    } else if (sortBy === 'rate_desc' || sortBy === 'rate_asc') {
      arr.sort(function (a, b) {
        var aa = aggregateItem(a).avgRate
        var ab = aggregateItem(b).avgRate
        // Nulls (no history) sink to bottom regardless of direction
        if (aa == null && ab == null) return 0
        if (aa == null) return 1
        if (ab == null) return -1
        return sortBy === 'rate_desc' ? ab - aa : aa - ab
      })
    }
    return arr
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredItems, sortBy, historyByItem, vendorFilters])

  var pagedItems = useMemo(function () {
    return sortedItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  }, [sortedItems, page])

  var totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE))

  var totalValue = useMemo(function () {
    var sum = 0
    filteredItems.forEach(function (i) { sum += (i.live_qty || 0) * (i.rate_paise || 0) })
    return sum
  }, [filteredItems])

  var totalSpendFiltered = useMemo(function () {
    var sum = 0
    filteredItems.forEach(function (i) {
      var rows = historyByItem[i._key] || []
      if (vendorFilters.length > 0) rows = rows.filter(function (r) { return vendorFilters.indexOf(r.vendor_name) !== -1 })
      rows.forEach(function (r) { sum += Number(r.amount_paise || 0) })
    })
    return sum
  }, [filteredItems, historyByItem, vendorFilters])

  async function openExpenseDetail(expenseId) {
    if (!expenseId) return
    setExpenseDetailLoading(true)
    setExpenseDetailTarget({ _placeholder: true, id: expenseId })
    var { data: row, error } = await supabase.from('expenses')
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name), expense_allocations(department, department_id, venue_id, amount_paise)')
      .eq('id', Number(expenseId)).maybeSingle()
    setExpenseDetailLoading(false)
    if (error || !row) { alert('Expense not found: ' + (error?.message || 'missing')); setExpenseDetailTarget(null); return }
    setExpenseDetailTarget(row)
  }

  function closeExpenseDetail() { setExpenseDetailTarget(null) }

  function renderExpenseDetailModal() {
    if (!expenseDetailTarget) return null
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
        onClick={closeExpenseDetail}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl p-4 sm:p-5 min-h-screen sm:min-h-0 sm:max-h-[92vh] overflow-y-auto"
          onClick={function (ev) { ev.stopPropagation() }}>
          {expenseDetailLoading || expenseDetailTarget._placeholder ? (
            <div className="py-16 text-center text-sm text-gray-500">Loading expense…</div>
          ) : (
            <ExpenseDetail key={expenseDetailTarget.id} exp={expenseDetailTarget} profile={profile} isAdmin={isAdmin} isDeptApprover={false}
              onBack={closeExpenseDetail} onUpdated={closeExpenseDetail}
              onEdit={function () { alert('To edit this expense, please open the Expenses tab.'); closeExpenseDetail() }}
              onRaiseGV={function () { alert('To raise a General Voucher, please open the Expenses tab.'); closeExpenseDetail() }} />
          )}
        </div>
      </div>
    )
  }

  function exportCSV() {
    var esc = function (v) { if (v == null) return ''; var s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    var lines = ['Item,Code,Category,Sub-category,Source,Live Qty,Master Rate (₹),Value (₹),Vendors,Transactions,Total Spend (₹),Total Qty Purchased,Avg Rate (₹),Best Rate (₹),Best Avg Vendor,Best Avg Rate (₹)']
    filteredItems.forEach(function (i) {
      var a = aggregateItem(i)
      var value = (i.live_qty || 0) * (i.rate_paise || 0)
      lines.push([
        esc(i.name), esc(i.code), esc(i.cat), esc(i.subcat), esc(i._source),
        i.live_qty || 0, ((i.rate_paise || 0) / 100).toFixed(2), (value / 100).toFixed(2),
        esc(a.vendors.join('; ')), a.txnCount, (a.totalSpend / 100).toFixed(2),
        a.totalQty, a.avgRate != null ? (a.avgRate / 100).toFixed(2) : '',
        a.bestRate != null ? (a.bestRate / 100).toFixed(2) : '',
        esc(a.cheapest ? a.cheapest.vendor : ''),
        a.cheapest ? (a.cheapest.avgRate / 100).toFixed(2) : ''
      ].join(','))
    })
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url; a.download = 'inventory_ledger_' + new Date().toISOString().slice(0, 10) + '.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function exportPDF() {
    if (exporting) return
    setExporting(true)
    try {
      var jsPDFmod = await import('jspdf')
      var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
      var autoTableMod = await import('jspdf-autotable')
      var autoTable = autoTableMod.default || autoTableMod.autoTable
      var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      var fontRegistered = false
      try { await registerPdfFont(doc); fontRegistered = true } catch (_) {}
      var baseFont = fontRegistered ? 'NotoSans' : 'helvetica'
      doc.setFont(baseFont, 'bold'); doc.setFontSize(14)
      doc.text('INVENTORY LEDGER', 10, 12)
      doc.setFont(baseFont, 'normal'); doc.setFontSize(9)
      doc.text('Generated ' + new Date().toLocaleString('en-IN'), 10, 18)
      doc.text('Items shown: ' + filteredItems.length, 10, 23)
      var rows = filteredItems.map(function (i) {
        var a = aggregateItem(i)
        var value = (i.live_qty || 0) * (i.rate_paise || 0)
        return [
          i.name + (i.code ? '\n' + i.code : ''),
          (i.cat || '—') + (i.subcat ? ' › ' + i.subcat : ''),
          String(i.live_qty || 0),
          i.rate_paise > 0 ? formatPaise(i.rate_paise) : '—',
          value > 0 ? formatPaise(value) : '—',
          String(a.txnCount),
          a.totalSpend > 0 ? formatPaise(a.totalSpend) : '—',
          a.avgRate != null ? formatPaise(a.avgRate) : '—',
          a.cheapest ? a.cheapest.vendor + '\n' + formatPaise(a.cheapest.avgRate) : '—'
        ]
      })
      autoTable(doc, {
        startY: 28,
        head: [['Item', 'Category', 'Qty', 'Rate', 'Value', 'Txns', 'Total Spend', 'Avg Rate', 'Best Vendor']],
        body: rows,
        styles: { font: baseFont, fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [55, 65, 81], textColor: [255, 255, 255], font: baseFont, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 55 }, 1: { cellWidth: 45 },
          2: { cellWidth: 15, halign: 'right' }, 3: { cellWidth: 22, halign: 'right' },
          4: { cellWidth: 25, halign: 'right' }, 5: { cellWidth: 12, halign: 'right' },
          6: { cellWidth: 28, halign: 'right' }, 7: { cellWidth: 22, halign: 'right' },
          8: { cellWidth: 40 }
        }
      })
      doc.save('inventory_ledger_' + new Date().toISOString().slice(0, 10) + '.pdf')
    } catch (e) {
      alert('PDF export failed: ' + (e.message || e))
    }
    setExporting(false)
  }

  function TrendIcon(props) {
    if (props.trend === 'up') return <span className="text-red-600 font-bold" title={'Previously ' + formatPaise(props.prev)}>↑</span>
    if (props.trend === 'down') return <span className="text-green-600 font-bold" title={'Previously ' + formatPaise(props.prev)}>↓</span>
    if (props.trend === 'same') return <span className="text-gray-400" title="Same as previous">→</span>
    if (props.trend === 'new') return <span className="text-[10px] text-indigo-600 font-bold" title="First purchase from this vendor">NEW</span>
    return null
  }

  if (!canView) return <div className="text-center py-12 text-sm text-gray-500">You don't have permission to view the Inventory Ledger.</div>
  if (loading) return <div className="text-center py-12 text-sm text-gray-400">Loading...</div>

  if (selectedItem) {
    var agg = aggregateItem(selectedItem)
    return (
      <div>
        <button onClick={function () { setSelectedItem(null) }}
          className="text-sm text-indigo-600 hover:text-indigo-800 mb-3 font-semibold">← Back to items</button>

        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <div className="flex items-start justify-between pb-3 border-b border-gray-100 flex-wrap gap-2">
            <div>
              <div className="text-lg font-bold text-gray-900">{selectedItem.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {selectedItem.code}
                {selectedItem.cat && <span> · {selectedItem.cat}{selectedItem.subcat ? ' › ' + selectedItem.subcat : ''}</span>}
                {selectedItem.rate_paise > 0 && <span> · Master rate: {formatPaise(selectedItem.rate_paise)}</span>}
                {selectedItem._source === 'catering_store' && <span className="ml-1 text-purple-600 font-semibold">· Catering</span>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Total spend (all-time)</div>
              <div className="text-xl font-bold text-gray-900 mt-0.5">{formatPaise(agg.totalSpend)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
            <div><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Transactions</div><div className="text-sm font-semibold text-gray-900 mt-0.5">{agg.txnCount}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Total qty</div><div className="text-sm font-semibold text-gray-900 mt-0.5">{fmtQty(agg.totalQty)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Avg rate</div><div className="text-sm font-semibold text-gray-900 mt-0.5">{agg.avgRate != null ? formatPaise(agg.avgRate) : '—'}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Best rate</div><div className="text-sm font-semibold text-green-700 mt-0.5">{agg.bestRate != null ? formatPaise(agg.bestRate) : '—'}</div></div>
          </div>

          {agg.cheapest && vendorFilters.length === 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-xs">
              <span className="text-amber-500">★</span>
              <span className="text-gray-600">Best avg rate:</span>
              <span className="font-bold text-gray-900">{agg.cheapest.vendor}</span>
              <span className="text-green-700 font-semibold">{formatPaise(agg.cheapest.avgRate)}</span>
              <span className="text-gray-400">({agg.cheapest.count} purchases)</span>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-200 flex justify-between items-center">
            <span>Purchase history</span>
            {vendorFilters.length > 0 && <span className="text-[10px] text-indigo-600 normal-case tracking-normal">Filtered: {vendorFilters.join(', ')}</span>}
          </div>
          {agg.allRows.length === 0 && <div className="text-center text-sm text-gray-400 py-8">No purchase history{vendorFilters.length > 0 ? ' for ' + vendorFilters.join(', ') : ''}.</div>}
          {agg.allRows.length > 0 && (
            <div>
              <div className="grid grid-cols-[90px_1fr_70px_100px_30px_100px_100px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-100">
                <div>Date</div><div>Vendor</div><div className="text-right">Qty</div><div className="text-right">Rate</div><div></div><div className="text-right">Amount</div><div className="text-right">Source</div>
              </div>
              {agg.allRows.map(function (h, i) {
                var isExp = h.source_type === 'expense'
                var srcColor = isExp ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700'
                var chip = (
                  <span className={"inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold " + srcColor}>{h.source_ref}</span>
                )
                function handleRowClick() {
                  if (isExp && h.source_id) openExpenseDetail(h.source_id)
                }
                return (
                  <div key={i} onClick={handleRowClick}
                    className={"grid grid-cols-[90px_1fr_70px_100px_30px_100px_100px] gap-2 px-4 py-2 text-xs border-b border-gray-50 items-center " +
                      (isExp ? "cursor-pointer hover:bg-indigo-50/40 transition-colors" : "")}>
                    <div className="text-gray-600">{h.txn_date ? formatDate(h.txn_date) : '—'}</div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{h.vendor_name || '—'}</p>
                      {h._creatorName && <p className="text-[10px] text-gray-400 truncate">by {h._creatorName}</p>}
                    </div>
                    <div className="text-right font-semibold text-gray-900">{fmtQty(h.qty)}{h.unit ? ' ' + h.unit : ''}</div>
                    <div className="text-right font-semibold text-gray-900">{formatPaise(h.rate_paise || 0)}</div>
                    <div className="text-center"><TrendIcon trend={h._trend} prev={h._prev_rate} /></div>
                    <div className="text-right font-semibold text-gray-900">{formatPaise(h.amount_paise || 0)}</div>
                    <div className="text-right">{chip}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {renderExpenseDetailModal()}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input type="text" value={search} onChange={function (e) { setSearch(e.target.value) }}
            placeholder="Search items, code, category..."
            style={{ fontSize: '16px' }}
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-lg" />
          <button onClick={exportCSV} className="px-3 py-2 text-xs font-bold bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100">📊 CSV</button>
          <button onClick={exportPDF} disabled={exporting} className="px-3 py-2 text-xs font-bold bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50">📄 {exporting ? 'PDF...' : 'PDF'}</button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
          <MultiSearchDropdown
            items={[{ value: 'inventory', label: 'Inventory' }, { value: 'catering_store', label: 'Catering Store' }]}
            values={sourceFilters}
            onChange={setSourceFilters}
            placeholder="All sources" />
          <MultiSearchDropdown
            items={allCats.map(function (c) { return { value: c, label: c } })}
            values={catFilters}
            onChange={function (next) { setCatFilters(next); setSubCatFilters([]) }}
            placeholder="All categories" />
          <MultiSearchDropdown
            items={allSubCats.map(function (s) { return { value: s, label: s } })}
            values={subCatFilters}
            onChange={setSubCatFilters}
            placeholder="All sub-categories" />
          <MultiSearchDropdown
            items={allVendors.map(function (v) { return { value: v, label: v } })}
            values={vendorFilters}
            onChange={setVendorFilters}
            placeholder="All vendors" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="text-gray-500">{filteredItems.length} of {items.length} items</span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-500">Total value: <span className="font-bold text-gray-900">{formatPaise(totalValue)}</span></span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-500">Total spend: <span className="font-bold text-gray-900">{formatPaise(totalSpendFiltered)}</span></span>
            {vendorFilters.length > 0 && <span className="text-indigo-600 font-semibold">· vendors: {vendorFilters.join(', ')}</span>}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={function () { setShowNoHistory(function (v) { return !v }) }}
              className={"flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors " +
                (showNoHistory
                  ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                  : "bg-white text-gray-500 border-gray-200 hover:border-gray-300")}>
              <span className={"w-3.5 h-3.5 rounded flex items-center justify-center text-[10px] leading-none " + (showNoHistory ? "bg-amber-500 text-white" : "border border-gray-300")}>
                {showNoHistory ? '✓' : ''}
              </span>
              Show items with no history
            </button>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Sort</label>
              <select value={sortBy} onChange={function (e) { setSortBy(e.target.value) }}
                style={{ fontSize: '13px' }}
                className="px-2 py-1 border border-gray-200 rounded-md text-xs bg-white font-semibold text-gray-700">
                <option value="name">Name A–Z</option>
                <option value="value_desc">Value: high → low</option>
                <option value="value_asc">Value: low → high</option>
                <option value="rate_desc">Avg rate paid: high → low</option>
                <option value="rate_asc">Avg rate paid: low → high</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {pagedItems.map(function (item) {
          var a = aggregateItem(item)
          var value = (item.live_qty || 0) * (item.rate_paise || 0)
          return (
            <button key={item._key} onClick={function () { setSelectedItem(item) }}
              className="w-full text-left bg-white border border-gray-200 rounded-xl p-3 hover:border-indigo-300 hover:shadow-sm transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-[2fr_70px_90px_100px] gap-2 lg:gap-3 items-center">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{item.name}</div>
                  <div className="text-[11px] text-gray-500">
                    {item.code}
                    {item.cat && <span> · {item.cat}{item.subcat ? ' › ' + item.subcat : ''}</span>}
                    {item._source === 'catering_store' && <span className="ml-1 text-purple-600 font-semibold">· Catering</span>}
                  </div>
                </div>
                <div className="text-right"><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Qty</div><div className="text-sm font-semibold text-gray-900">{fmtQty(item.live_qty)}</div></div>
                <div className="text-right"><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Rate</div><div className="text-sm font-semibold text-gray-900">{item.rate_paise > 0 ? formatPaise(item.rate_paise) : '—'}</div></div>
                <div className="text-right"><div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Value</div><div className="text-sm font-semibold text-gray-900">{value > 0 ? formatPaise(value) : '—'}</div></div>
              </div>

              {a.txnCount > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3 lg:gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Vendors ({a.vendors.length})</div>
                    <div>
                      {a.vendors.slice(0, 4).map(function (v) {
                        return <span key={v} className="inline-block text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded mr-1 mb-1 font-semibold">{v}</span>
                      })}
                      {a.vendors.length > 4 && <span className="text-[10px] text-gray-400 font-semibold">+{a.vendors.length - 4}</span>}
                    </div>
                    {a.cheapest && vendorFilters.length === 0 && a.vendors.length > 1 && (
                      <div className="mt-1 flex items-center gap-1 text-[10px]">
                        <span className="text-amber-500">★</span>
                        <span className="text-gray-500">Best avg:</span>
                        <span className="font-bold text-gray-800">{a.cheapest.vendor}</span>
                        <span className="text-green-700 font-semibold">{formatPaise(a.cheapest.avgRate)}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Last 3 purchases</div>
                    {a.last3.map(function (h, i) {
                      return (
                        <div key={i} className="grid grid-cols-[1fr_auto_34px_auto] gap-2 text-[11px] py-0.5 items-baseline">
                          <span className="font-semibold text-gray-900 truncate">{h.vendor_name || '—'}</span>
                          <span className="font-semibold text-gray-900">{formatPaise(h.rate_paise || 0)}</span>
                          <span className="text-center"><TrendIcon trend={h._trend} prev={h._prev_rate} /></span>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">{h.txn_date ? formatDate(h.txn_date) : ''}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {a.txnCount === 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-400">No purchase history{vendorFilters.length > 0 ? ' for ' + vendorFilters.join(', ') : ''}</div>
              )}
            </button>
          )
        })}
        {pagedItems.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-10">No items match your filters.</div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex justify-center items-center gap-2 text-xs">
          <button onClick={function () { setPage(0) }} disabled={page === 0}
            className="px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 font-semibold hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed">« First</button>
          <button onClick={function () { setPage(page - 1) }} disabled={page === 0}
            className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 font-semibold hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed">‹ Prev</button>
          <span className="px-3 py-1.5 font-semibold text-gray-600">Page {page + 1} of {totalPages}</span>
          <button onClick={function () { setPage(page + 1) }} disabled={page >= totalPages - 1}
            className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 font-semibold hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed">Next ›</button>
          <button onClick={function () { setPage(totalPages - 1) }} disabled={page >= totalPages - 1}
            className="px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 font-semibold hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed">Last »</button>
        </div>
      )}
    </div>
  )
}

export default InventoryLedger