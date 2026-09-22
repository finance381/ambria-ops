import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, fetchAll } from '../../lib/supabase'
import { formatDate, formatDateTime, formatPaise } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import { scrollToTopOf } from '../../lib/scrollToTop'
import { registerPdfFont } from '../../lib/pdfFont'
import { openOrSharePdf } from '../../lib/pdfOutput'
import { useExpenseDetailModal } from '../../hooks/useExpenseDetailModal.jsx'
import MultiSearchDropdown from '../../components/ui/MultiSearchDropdown'
import { hasPerm } from '../../lib/permissions'
import SearchField from '../../components/ui/SearchField'
import Icon from '../../components/ui/Icon'
import { CARD } from '../../lib/ui'
import { itemIcon } from '../../lib/itemThumb'

// How many rows a page holds, and the sizes offered. The rows carry a
// photograph now, so fifty of them is a very long page.
var PAGE_SIZES = [10, 25, 50, 100]

// The header band and the rows are separate elements that have to line up.
// Matching two flex rows by hand does not hold — a spacer one of them has and
// the other does not, or a border counted on one side only, and the headings
// sit a few pixels off the figures they name. One grid template, used by both,
// cannot drift: the columns are declared once and the browser places the cells.
//
// Cells hidden at a breakpoint leave the flow entirely, so the template has as
// many columns as there are visible cells at that width.
// Nine columns, declared once and used by the heading row and by every item
// row, so a column and the figures under it cannot drift apart. The picture
// and the name are two columns rather than one so the names start in the same
// place whether or not a photograph loaded.
var GRID = 'grid items-center gap-x-3 grid-cols-[2.5rem_minmax(11rem,1fr)_6.5rem_9rem_8.5rem_10rem_4.5rem_5.5rem_6.5rem_11rem]'

var COL_HEAD = 'text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500'

function InventoryLedger({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var isAdmin = hasPerm(profile?.permsNew, 'finance.ledgers.inventory')
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
  var [pageSize, setPageSize] = useState(25)
  var listRef = useRef(null)

  // Paging, and changing how many a page holds, both land you at the top of
  // the new page. Pressing Next at the foot of twenty-five rows otherwise
  // leaves you at the foot of the next twenty-five, reading upwards from the
  // end of something you never saw the start of.
  function goPage(n) {
    setPage(n)
    scrollToTopOf(listRef.current)
  }
  var [exporting, setExporting] = useState(false)
  var [showFilters, setShowFilters] = useState(false)

  function fmtQty(n) {
    var num = Number(n || 0)
    if (!isFinite(num)) return '0'
    // Round to 2 decimals, then strip trailing zeros. Handles float artifacts like 404.400000000000801.
    var rounded = Math.round(num * 100) / 100
    return String(rounded)
  }

  var { openExpenseDetail, expenseDetailModal } = useExpenseDetailModal(profile, isAdmin, function () { loadAll() })

  useEffect(function () {
    if (canView) loadAll()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useRealtime(['inventory_items', 'catering_store_items', 'purchase_order_items', 'expenses'], function () {
    if (canView) loadAll()
  })

  useEffect(function () { setPage(0) }, [search, catFilters, subCatFilters, sourceFilters, vendorFilters, sortBy, showNoHistory, pageSize])

  async function loadAll() {
    setLoading(true)
    try {
      var results = await Promise.all([
        fetchAll(supabase.from('inventory_items')
          .select('id, name, inventory_id, qty, rate_paise, image_path, categories(id, name), sub_categories(id, name)')
          .order('name', { ascending: true })),
        fetchAll(supabase.from('catering_store_items')
          .select('id, name, inventory_id, qty, rate_paise, image_path, categories(id, name), sub_categories(id, name)')
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
      var loggedAtBySource = {}  // key: source_type + ':' + source_id → system timestamp
      var allUserIds = []
      function addUid(u) { if (u && allUserIds.indexOf(u) === -1) allUserIds.push(u) }
      if (expIds.length > 0) {
        var CHUNK = 500
        for (var i = 0; i < expIds.length; i += CHUNK) {
          var eChunk = expIds.slice(i, i + CHUNK)
          var eRes = await supabase.from('expenses').select('id, user_id, created_at').in('id', eChunk)
          ;(eRes.data || []).forEach(function (r) {
            userIdBySource['expense:' + r.id] = r.user_id
            loggedAtBySource['expense:' + r.id] = r.created_at
            addUid(r.user_id)
          })
        }
      }
      if (poItemIds.length > 0) {
        var poIdSet = []
        for (var j = 0; j < poItemIds.length; j += 500) {
          var iChunk = poItemIds.slice(j, j + 500)
          var iRes = await supabase.from('purchase_order_items').select('id, po_id, purchased_at').in('id', iChunk)
          ;(iRes.data || []).forEach(function (pi) {
            userIdBySource['po_item_map:' + pi.id] = pi.po_id  // temp store po_id
            if (pi.purchased_at) loggedAtBySource['po:' + pi.id] = pi.purchased_at
            if (pi.po_id && poIdSet.indexOf(pi.po_id) === -1) poIdSet.push(pi.po_id)
          })
        }
        var poCreatorById = {}
        var poCreatedAtById = {}
        for (var k = 0; k < poIdSet.length; k += 500) {
          var pChunk = poIdSet.slice(k, k + 500)
          var pRes = await supabase.from('purchase_orders').select('id, created_by, created_at').in('id', pChunk)
          ;(pRes.data || []).forEach(function (po) { poCreatorById[po.id] = po.created_by; poCreatedAtById[po.id] = po.created_at; addUid(po.created_by) })
        }
        // Resolve po_item_map → final creator user_id under po:<source_id>
        poItemIds.forEach(function (piId) {
          var poId = userIdBySource['po_item_map:' + piId]
          if (poId && poCreatorById[poId]) userIdBySource['po:' + piId] = poCreatorById[poId]
          // Fall back to the PO's own created_at if the item was never marked purchased
          if (!loggedAtBySource['po:' + piId] && poId && poCreatedAtById[poId]) loggedAtBySource['po:' + piId] = poCreatedAtById[poId]
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
        var loggedAt = loggedAtBySource[key] || null
        return Object.assign({}, h, { _creatorName: nm || null, _loggedAt: loggedAt })
      })

      var merged = []
      invRes.forEach(function (r) {
        merged.push({
          _key: 'inventory:' + r.id, _source: 'inventory', id: r.id,
          name: r.name || '', code: r.inventory_id || '',
          cat: r.categories && r.categories.name || '', subcat: r.sub_categories && r.sub_categories.name || '',
          rate_paise: r.rate_paise || 0, live_qty: Number(r.qty || 0),
          img: r.image_path ? (supabase.storage.from('images').getPublicUrl(r.image_path).data?.publicUrl || '') : ''
        })
      })
      csRes.forEach(function (r) {
        merged.push({
          _key: 'catering_store:' + r.id, _source: 'catering_store', id: r.id,
          name: r.name || '', code: r.inventory_id || '',
          cat: r.categories && r.categories.name || '', subcat: r.sub_categories && r.sub_categories.name || '',
          rate_paise: r.rate_paise || 0, live_qty: Number(r.qty || 0),
          img: r.image_path ? (supabase.storage.from('images').getPublicUrl(r.image_path).data?.publicUrl || '') : ''
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

  // Everything the search and the four filters leave, with the no-history
  // rule applied or not. Asked both ways because "17 of 2,785" reads as the
  // filters having removed 2,768 when almost all of them are held back by a
  // default toggle instead.
  var matchesFilters = useMemo(function () {
    var q = search.trim().toLowerCase()
    return items.filter(function (i) {
      var rows = historyByItem[i._key] || []
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
  }, [items, search, catFilters, subCatFilters, sourceFilters, vendorFilters, historyByItem])

  var filteredItems = useMemo(function () {
    if (showNoHistory) return matchesFilters
    return matchesFilters.filter(function (i) { return (historyByItem[i._key] || []).length > 0 })
  }, [matchesFilters, historyByItem, showNoHistory])

  // Held back by the toggle, not by anything the reader chose.
  var hiddenNoHistory = matchesFilters.length - filteredItems.length

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

  var totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize))
  // Shrinking the page size can leave `page` past the end; clamp rather than
  // reset, so changing it keeps you near where you were.
  var pageNow = Math.min(page, totalPages - 1)
  var pagedItems = useMemo(function () {
    return sortedItems.slice(pageNow * pageSize, (pageNow + 1) * pageSize)
  }, [sortedItems, pageNow, pageSize])
  var firstShown = sortedItems.length === 0 ? 0 : pageNow * pageSize + 1
  var lastShown = Math.min((pageNow + 1) * pageSize, sortedItems.length)

  // 1 … 4 5 6 … 65, never sixty-five buttons.
  var pageButtons = []
  for (var pb = 0; pb < totalPages; pb++) {
    if (pb === 0 || pb === totalPages - 1 || (pb >= pageNow - 1 && pb <= pageNow + 1)) pageButtons.push(pb)
    else if (pageButtons[pageButtons.length - 1] !== '…') pageButtons.push('…')
  }

  var activeFilterCount = (sourceFilters.length > 0 ? 1 : 0) + (catFilters.length > 0 ? 1 : 0) +
    (subCatFilters.length > 0 ? 1 : 0) + (vendorFilters.length > 0 ? 1 : 0)

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
      await openOrSharePdf(doc, 'inventory_ledger_' + new Date().toISOString().slice(0, 10) + '.pdf')
    } catch (e) {
      alert('PDF export failed: ' + (e.message || e))
    }
    setExporting(false)
  }

  function TrendIcon(props) {
    if (props.trend === 'up') return <span className="text-red-600 font-bold" title={'Previously ' + formatPaise(props.prev)}>↑</span>
    if (props.trend === 'down') return <span className="text-green-600 font-bold" title={'Previously ' + formatPaise(props.prev)}>↓</span>
    if (props.trend === 'same') return <span className="text-gray-400" title="Same as previous">→</span>
    if (props.trend === 'new') return (
      <span title="First purchase from this vendor"
        className="shrink-0 inline-flex items-center h-[17px] px-1.5 rounded-md bg-indigo-50 text-[9.5px] font-bold uppercase tracking-[0.06em] text-indigo-600">
        New
      </span>
    )
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
                    <div className="text-gray-600">
                      {h.txn_date ? formatDate(h.txn_date) : '—'}
                      {h._loggedAt && <div className="text-[10px] text-gray-400">Logged {formatDateTime(h._loggedAt)}</div>}
                    </div>
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
        {expenseDetailModal}
      </div>
    )
  }

  return (
    <div className="@container space-y-3">
      {/* Search first, then what you can take away with you. There is no "add
          item" here on purpose: items are created and approved in Inventory →
          Items, and this screen is the ledger of what they cost. */}
      <div className={CARD + ' px-4 py-3 space-y-3'}>
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={search}
            onChange={function (v) { setSearch(v) }}
            placeholder="Search items, code, category..."
            className="flex-1 min-w-[220px]"
          />
          <button type="button" onClick={function () { setShowFilters(!showFilters) }} aria-pressed={showFilters}
            className={'h-10 px-3 inline-flex items-center gap-1.5 rounded-xl border text-[12.5px] font-bold transition-colors ' +
              (showFilters || activeFilterCount > 0
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
            <Icon name="filter" size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span data-notranslate className="px-1.5 rounded-md bg-indigo-600 text-white text-[10.5px] tabular-nums">{activeFilterCount}</span>
            )}
          </button>
          <button type="button" onClick={exportCSV}
            className="h-10 px-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 transition-colors">
            <Icon name="download" size={14} className="text-emerald-600" />
            CSV
          </button>
          <button type="button" onClick={exportPDF} disabled={exporting}
            className="h-10 px-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors">
            <Icon name="fileText" size={14} className="text-rose-600" />
            {exporting ? 'PDF…' : 'PDF'}
          </button>
        </div>

        {showFilters && (
        /* Four dropdowns that are empty most of the time were taking a row of
           the page whether or not anyone was narrowing anything. They sit
           behind the button now, on their own ground, and the button says how
           many of them are in force. */
        <div className="-mx-4 -mb-3 px-4 py-3.5 border-t border-slate-200 bg-slate-50/70">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Narrow the list</p>
            {activeFilterCount > 0 && (
              <button type="button"
                onClick={function () { setSourceFilters([]); setCatFilters([]); setSubCatFilters([]); setVendorFilters([]) }}
                className="text-[11.5px] font-bold text-rose-600 hover:text-rose-700 transition-colors">
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 @2xl:grid-cols-2 @4xl:grid-cols-4 gap-2">
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
        </div>
        )}
      </div>

      {/* Three figures the filters answer, and the two controls that change
          what is counted, on one line. */}
      {/* Three figures across the card rather than huddled at its left end.
          Dividers between them because they are three separate measurements of
          the same set, not a sentence; and on a phone they stack, where three
          abreast would each be too narrow to read. */}
      <div className={CARD + ' overflow-hidden grid grid-cols-1 @2xl:grid-cols-3 divide-y @2xl:divide-y-0 @2xl:divide-x divide-slate-200'}>
        {/* All three describe the items on screen, not the whole master, so
            none of them can be called "total": with the no-history toggle off
            that word sat over 17 while the store holds 2,785. Each says what
            it counts and carries the basis on hover. */}
        {[{ icon: 'box', tint: 'bg-indigo-50 text-indigo-600', label: 'Items shown',
            value: filteredItems.length.toLocaleString('en-IN'),
            hint: 'Items left by the search, the filters and the no-history toggle' },
          { icon: 'wallet', tint: 'bg-emerald-50 text-emerald-600', label: 'Stock value',
            value: formatPaise(totalValue),
            hint: 'Quantity on hand multiplied by each item’s master rate' },
          { icon: 'cart', tint: 'bg-rose-50 text-rose-600', label: 'Spend, all time',
            value: formatPaise(totalSpendFiltered),
            hint: 'Every purchase ever recorded against these items' }].map(function (st) {
          return (
            <div key={st.label} title={st.hint} className="flex items-center gap-3 px-4 py-3.5">
              <span className={'shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center ' + st.tint}>
                <Icon name={st.icon} size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{st.label}</span>
                <span data-notranslate className="block mt-1 font-display text-[19px] font-bold text-slate-900 tabular-nums leading-none tracking-[-0.015em] truncate">
                  {st.value}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      {/* One pill carries the count and the checkbox that changes it, rather
          than a floating sentence next to a separately-styled control. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3 h-10 pl-4 pr-3 rounded-full border border-slate-200 bg-white">
          <p className="text-[12.5px] font-semibold text-slate-600 whitespace-nowrap">
            Showing <span data-notranslate className="font-bold text-slate-900">{filteredItems.length.toLocaleString('en-IN')}</span>
            {' '}item{filteredItems.length === 1 ? '' : 's'}
          </p>

          {(showNoHistory || hiddenNoHistory > 0) && (
            <>
              <span aria-hidden="true" className="w-px h-5 bg-slate-200" />

              <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-slate-600 whitespace-nowrap cursor-pointer">
                <input type="checkbox" checked={showNoHistory}
                  onChange={function () { setShowNoHistory(function (v) { return !v }) }}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30" />
                Show items with no purchase history
              </label>

            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Sort by</span>
          <select value={sortBy} onChange={function (e) { setSortBy(e.target.value) }}
            style={{ fontSize: '13px' }}
            className="h-9 pl-2.5 pr-8 rounded-xl border border-slate-300 bg-white text-[12.5px] font-bold text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20">
            <option value="name">Name A–Z</option>
            <option value="value_desc">Value: high → low</option>
            <option value="value_asc">Value: low → high</option>
            <option value="rate_desc">Avg rate paid: high → low</option>
            <option value="rate_asc">Avg rate paid: low → high</option>
          </select>
        </div>
      </div>

      {/* One table rather than a stack of cards: every field the list is
          searched and filtered by gets a column of its own, so a reader can
          run an eye down "who did we buy this from" without reading a
          sentence on each row to find it. Below the table's own width the
          panel scrolls sideways — squeezing nine columns into a phone would
          make all nine unreadable. */}
      <div ref={listRef} className={CARD + ' overflow-hidden scroll-mt-4'}>
        <div className="overflow-x-auto ambria-thin-scroll">
          <div className="min-w-[1180px]">
            <div className={GRID + ' px-4 py-2.5 bg-slate-50 border-b border-slate-200 ' + COL_HEAD}>
              <span className="col-span-2">Item</span>
              <span>Code</span>
              <span>Category</span>
              <span>Sub-category</span>
              <span>Vendor</span>
              <span className="text-center">Qty</span>
              <span className="text-center">Rate</span>
              <span className="text-center">Value</span>
              <span className="border-l border-slate-200 pl-3.5 -my-2.5 py-2.5">Last purchase</span>
            </div>

            <div className="divide-y divide-slate-100">
              {pagedItems.map(function (item) {
                var a = aggregateItem(item)
                var value = (item.live_qty || 0) * (item.rate_paise || 0)
                var last = a.last3 && a.last3[0]
                var filed = item.subcat || (item._source === 'catering_store' ? 'Catering' : 'Inventory')
                return (
                  <div key={item._key} role="button" tabIndex={0}
                    onClick={function () { setSelectedItem(item) }}
                    onKeyDown={function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelectedItem(item) } }}
                    className={GRID + ' px-4 py-2.5 cursor-pointer hover:bg-indigo-50/40 transition-colors'}>

                    {/* The picture is how a storeman recognises a thing; the
                        code in the next column is how the system does — and
                        where there is no photograph, a tile drawn from what the
                        item says it is rather than the same grey box on every
                        row. */}
                    {/* One neutral tile for every item without a photograph.
                        A colour hashed from the name made the first column a
                        different pastel on every row, which is a lot of paint
                        spent on "there is no picture". The glyph still says
                        what kind of thing it is. */}
                    <span className="w-10 h-10 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden inline-flex items-center justify-center">
                      {item.img
                        ? <img src={item.img} alt="" loading="lazy" className="w-full h-full object-cover" />
                        : <Icon name={itemIcon(item.name, item.cat, item.subcat)} size={17} className="text-slate-400" />}
                    </span>
                    <span className="min-w-0 font-display text-[13px] font-bold text-slate-900 leading-snug truncate">
                      {item.name}
                    </span>

                    <span data-notranslate className="min-w-0 text-[12px] font-bold text-slate-500 tabular-nums truncate">
                      {item.code}
                    </span>

                    {/* Plain text, not chips. A chip per category, per
                        sub-category and per vendor put three coloured pills on
                        every row, and a colour hashed from a name means the
                        colours carry no meaning — three rows in, the table was
                        a fruit salad. Weight and shade separate the three
                        columns instead: the category leads, the filing steps
                        back, the vendor is a name and reads as one. */}
                    <span className="min-w-0 text-[12px] font-semibold text-slate-700 truncate">{item.cat || '—'}</span>
                    {/* Sub-category when the item has one; where it has none,
                        which is most of them, the store it belongs to — so the
                        column is never a row of blanks. */}
                    <span className="min-w-0 text-[12px] text-slate-500 truncate">{filed}</span>

                    <span className="min-w-0 flex items-baseline gap-1.5">
                      {a.vendors.length === 0
                        ? <span className="text-[12px] text-slate-300">{'—'}</span>
                        : (
                          <>
                            <span className="min-w-0 text-[12px] font-semibold text-slate-700 truncate">{a.vendors[0]}</span>
                            {a.vendors.length > 1 && (
                              <span data-notranslate title={a.vendors.join(', ')}
                                className="shrink-0 text-[10.5px] font-bold text-slate-400">+{a.vendors.length - 1}</span>
                            )}
                          </>
                        )}
                    </span>

                    <span data-notranslate className="text-center text-[13px] font-bold text-slate-900 tabular-nums">
                      {fmtQty(item.live_qty)}
                    </span>
                    <span data-notranslate className="text-center text-[13px] font-bold text-slate-900 tabular-nums">
                      {item.rate_paise > 0 ? formatPaise(item.rate_paise) : '—'}
                    </span>
                    <span data-notranslate className="text-center text-[13px] font-bold text-slate-900 tabular-nums">
                      {value > 0 ? formatPaise(value) : '—'}
                    </span>

                    {/* What it cost the last time somebody bought it, which is
                        the question this ledger exists to answer. A rule down
                        its left, and the padding to go with it: the last three
                        columns are all figures, and without it the price of a
                        purchase sat against the value of the stock as though
                        they were the same kind of number. */}
                    <span className="min-w-0 space-y-1 self-stretch border-l border-slate-100 pl-3.5 -my-2.5 py-2.5">
                      {last ? (
                        <>
                          <span className="flex items-center gap-1.5 h-[17px] min-w-0">
                            <Icon name="calendar" size={11} className="shrink-0 text-slate-400" />
                            <span data-notranslate className="text-[11.5px] font-semibold text-slate-600 tabular-nums truncate">
                              {last.txn_date ? formatDate(last.txn_date) : '—'}
                            </span>
                          </span>
                          <span className="flex items-center gap-2 h-[17px] min-w-0">
                            <span data-notranslate className="shrink-0 min-w-[68px] text-[13px] font-bold text-slate-900 tabular-nums">
                              {formatPaise(last.rate_paise || 0)}
                            </span>
                            <TrendIcon trend={last._trend} prev={last._prev_rate} />
                          </span>
                        </>
                      ) : (
                        <span className="flex items-center h-[17px] text-[11.5px] font-semibold text-slate-400">No purchase history</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>

            {pagedItems.length === 0 && (
              <div className="px-4 py-16 text-center">
                <Icon name="box" size={26} className="mx-auto text-slate-300" />
                <p className="mt-2 text-[13px] font-bold text-slate-600">No items match your filters</p>
                <p className="mt-0.5 text-[12px] font-medium text-slate-400">Clear a filter, or search for something else.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {sortedItems.length > 0 && (
        <div className={CARD + ' flex flex-wrap items-center justify-between gap-3 px-4 py-2.5'}>
          <p className="text-[12px] font-semibold text-slate-500" data-notranslate>
            Showing {firstShown}–{lastShown} of {sortedItems.length} item{sortedItems.length === 1 ? '' : 's'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" disabled={pageNow === 0} onClick={function () { goPage(pageNow - 1) }}
                  aria-label="Previous page"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <Icon name="chevronRight" size={14} className="rotate-180" />
                </button>
                {pageButtons.map(function (b, i) {
                  if (b === '…') return <span key={'g' + i} className="px-1 text-[12px] font-bold text-slate-300">…</span>
                  return (
                    <button key={b} type="button" onClick={function () { goPage(b) }}
                      className={'min-w-8 h-8 px-2 rounded-lg text-[12px] font-bold tabular-nums transition-colors ' +
                        (b === pageNow ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100')}
                      data-notranslate>{b + 1}</button>
                  )
                })}
                <button type="button" disabled={pageNow >= totalPages - 1} onClick={function () { goPage(pageNow + 1) }}
                  aria-label="Next page"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <Icon name="chevronRight" size={14} />
                </button>
              </div>
            )}
            {/* Changing the page size already resets to page one; without
                the scroll you were left at the foot of a list that had just
                grown or shrunk under you. */}
            <select value={pageSize}
              onChange={function (e) { setPageSize(Number(e.target.value)); scrollToTopOf(listRef.current) }}
              aria-label="Rows per page"
              style={{ fontSize: '13px' }}
              className="h-8 px-2 rounded-lg border border-slate-300 bg-white text-[12px] font-bold text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20">
              {PAGE_SIZES.map(function (n) { return <option key={n} value={n}>{n} / page</option> })}
            </select>
          </div>
        </div>
      )}

    </div>
  )
}

export default InventoryLedger