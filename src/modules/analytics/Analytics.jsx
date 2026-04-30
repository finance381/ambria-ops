import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPaise, formatDate, titleCase } from '../../lib/format'

// ── Period helpers ──
var PERIODS = [
  { key: 'month', label: 'This Month' },
  { key: '30d', label: '30 Days' },
  { key: '90d', label: '90 Days' },
  { key: 'year', label: 'This Year' },
]

var MONTHS_SHORT = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',')

function getPeriodDates(p) {
  var now = new Date()
  var today = now.toISOString().split('T')[0]
  var from, prevFrom, prevTo
  if (p === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
    prevTo = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
  } else if (p === '30d') {
    from = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]
    prevFrom = new Date(now.getTime() - 60 * 86400000).toISOString().split('T')[0]
    prevTo = from
  } else if (p === '90d') {
    from = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0]
    prevFrom = new Date(now.getTime() - 180 * 86400000).toISOString().split('T')[0]
    prevTo = from
  } else {
    from = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0]
    prevFrom = new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0]
    prevTo = new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0]
  }
  return { from: from, to: today, prevFrom: prevFrom, prevTo: prevTo }
}

function pctChange(curr, prev) {
  if (!prev || prev === 0) return curr > 0 ? 100 : 0
  return Math.round(((curr - prev) / prev) * 100)
}

// ── Reusable bar chart ──
function HBars({ items, valKey, labelKey, fmtFn, color, secondaryKey, secondaryFmt }) {
  var maxVal = 0
  items.forEach(function (it) { if (it[valKey] > maxVal) maxVal = it[valKey] })
  if (maxVal === 0 || items.length === 0) return <p className="text-sm text-gray-400 py-4 text-center">No data</p>
  return (
    <div className="space-y-3">
      {items.map(function (it, idx) {
        var pct = Math.max(Math.round((it[valKey] / maxVal) * 100), 2)
        return (
          <div key={idx}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-700 font-medium truncate flex-1 mr-2">{it[labelKey]}</span>
              <div className="flex items-center gap-3 flex-shrink-0">
                {secondaryKey && <span className="text-gray-400">{secondaryFmt ? secondaryFmt(it[secondaryKey]) : it[secondaryKey]}</span>}
                <span className="text-gray-600 font-semibold">{fmtFn(it[valKey])}</span>
              </div>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full">
              <div className={"h-full rounded-full transition-all " + (color || 'bg-indigo-500')} style={{ width: pct + '%' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Section wrapper ──
function Section({ title, icon, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{icon} {title}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ── KPI Card ──
function KpiCard({ label, value, change, sub, color }) {
  var changeColor = change > 0 ? 'text-red-600 bg-red-50' : change < 0 ? 'text-green-600 bg-green-50' : 'text-gray-500 bg-gray-50'
  // For events/POs, up is neutral not bad
  if (color === 'neutral') changeColor = change !== 0 ? 'text-blue-600 bg-blue-50' : 'text-gray-500 bg-gray-50'
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <div className="flex items-center gap-2 mt-1">
        {change !== undefined && change !== null && (
          <span className={"text-[10px] font-bold px-1.5 py-0.5 rounded " + changeColor}>
            {change > 0 ? '▲' : change < 0 ? '▼' : '='} {Math.abs(change)}%
          </span>
        )}
        {sub && <span className="text-[10px] text-gray-400">{sub}</span>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
function Analytics({ profile }) {
  var [period, setPeriod] = useState('30d')
  var [loading, setLoading] = useState(true)
  var [d, setD] = useState({})

  useEffect(function () { loadAll() }, [period])

  async function loadAll() {
    setLoading(true)
    var dates = getPeriodDates(period)
    var today = new Date().toISOString().split('T')[0]

    // 6-month floor for trend
    var trendFloor = new Date()
    trendFloor.setMonth(trendFloor.getMonth() - 6)
    var trendFloorStr = trendFloor.toISOString().split('T')[0]

    var results = await Promise.allSettled([
      // 0: Expenses in period (approved)
      supabase.from('expenses')
        .select('id, amount_paise, expense_date, user_id, expense_type_id, status, expense_types(name)')
        .gte('expense_date', dates.from).lte('expense_date', dates.to)
        .in('status', ['approved', 'paid'])
        .limit(2000),

      // 1: Previous period expenses
      supabase.from('expenses')
        .select('id, amount_paise, status')
        .gte('expense_date', dates.prevFrom).lte('expense_date', dates.prevTo)
        .in('status', ['approved', 'paid'])
        .limit(2000),

      // 2: PO items (purchased/received in period)
      supabase.from('purchase_order_items')
        .select('id, item_name, vendor_name, vendor_rate_paise, estimated_cost_paise, actual_cost_paise, actual_qty, qty_ordered, unit, status, purchased_at, received_at')
        .not('purchased_at', 'is', null)
        .gte('purchased_at', dates.from)
        .limit(1000),

      // 3: POs created in period
      supabase.from('purchase_orders')
        .select('id, status, created_at, updated_at')
        .gte('created_at', dates.from)
        .limit(500),

      // 4: Requisitions in period
      supabase.from('requisitions')
        .select('id, status, department, created_at')
        .gte('created_at', dates.from)
        .limit(500),

      // 5: Inventory snapshot
      supabase.from('inventory_items')
        .select('id, name, qty, category_id, status, categories(name)')
        .eq('status', 'approved')
        .order('qty', { ascending: true })
        .limit(1000),

      // 6: Catering store snapshot
      supabase.from('catering_store_items')
        .select('id, name, qty, category_id, status, categories(name)')
        .eq('status', 'approved')
        .order('qty', { ascending: true })
        .limit(1000),

      // 7: Upcoming events
      supabase.from('events_safe')
        .select('id, contract_date, venue_name, department, total_plates, status')
        .gte('contract_date', today)
        .order('contract_date')
        .limit(500),

      // 8: Profiles for name lookup
      supabase.from('profiles')
        .select('id, name')
        .eq('active', true),

      // 9: 6-month expense trend
      supabase.from('expenses')
        .select('id, amount_paise, expense_date, status')
        .gte('expense_date', trendFloorStr)
        .in('status', ['approved', 'paid'])
        .limit(5000),

      // 10: Previous period PO items (for KPI change)
      supabase.from('purchase_order_items')
        .select('id, actual_cost_paise')
        .not('purchased_at', 'is', null)
        .gte('purchased_at', dates.prevFrom).lte('purchased_at', dates.prevTo)
        .limit(1000),
    ])

    var expenses = (results[0].value?.data || [])
    var prevExpenses = (results[1].value?.data || [])
    var poItems = (results[2].value?.data || [])
    var pos = (results[3].value?.data || [])
    var reqs = (results[4].value?.data || [])
    var invItems = (results[5].value?.data || [])
    var csItems = (results[6].value?.data || [])
    var upEvents = (results[7].value?.data || [])
    var profiles = (results[8].value?.data || [])
    var trendExpenses = (results[9].value?.data || [])
    var prevPoItems = (results[10].value?.data || [])

    // Profile name map
    var nameMap = {}
    profiles.forEach(function (p) { nameMap[p.id] = p.name })

    // ═══ KPIs ═══
    var totalExpPaise = 0
    expenses.forEach(function (e) { totalExpPaise += (e.amount_paise || 0) })
    var prevExpPaise = 0
    prevExpenses.forEach(function (e) { prevExpPaise += (e.amount_paise || 0) })

    var totalProcActual = 0; var totalProcEst = 0
    poItems.forEach(function (it) {
      if (it.actual_cost_paise) totalProcActual += it.actual_cost_paise
      if (it.estimated_cost_paise) totalProcEst += it.estimated_cost_paise
    })
    var prevProcActual = 0
    prevPoItems.forEach(function (it) { prevProcActual += (it.actual_cost_paise || 0) })

    var avgVariance = totalProcEst > 0 ? Math.round(((totalProcActual - totalProcEst) / totalProcEst) * 100) : 0

    // ═══ Expense by type ═══
    var expByType = {}
    expenses.forEach(function (e) {
      var t = e.expense_types?.name || 'Other'
      if (!expByType[t]) expByType[t] = 0
      expByType[t] += (e.amount_paise || 0)
    })
    var expTypeArr = Object.keys(expByType).map(function (k) { return { name: k, paise: expByType[k] } })
    expTypeArr.sort(function (a, b) { return b.paise - a.paise })

    // ═══ Top spenders ═══
    var expByUser = {}
    expenses.forEach(function (e) {
      var uname = nameMap[e.user_id] || 'Unknown'
      if (!expByUser[uname]) expByUser[uname] = 0
      expByUser[uname] += (e.amount_paise || 0)
    })
    var topSpenders = Object.keys(expByUser).map(function (k) { return { name: k, paise: expByUser[k] } })
    topSpenders.sort(function (a, b) { return b.paise - a.paise })
    topSpenders = topSpenders.slice(0, 7)

    // ═══ Monthly trend ═══
    var monthBuckets = {}
    for (var mi = 5; mi >= 0; mi--) {
      var md = new Date()
      md.setMonth(md.getMonth() - mi)
      var mk = md.getFullYear() + '-' + (md.getMonth() + 1 < 10 ? '0' : '') + (md.getMonth() + 1)
      monthBuckets[mk] = { label: MONTHS_SHORT[md.getMonth()], paise: 0 }
    }
    trendExpenses.forEach(function (e) {
      if (!e.expense_date) return
      var mk = e.expense_date.substring(0, 7)
      if (monthBuckets[mk]) monthBuckets[mk].paise += (e.amount_paise || 0)
    })
    var trendArr = Object.keys(monthBuckets).map(function (k) { return monthBuckets[k] })
    var maxTrend = 0
    trendArr.forEach(function (m) { if (m.paise > maxTrend) maxTrend = m.paise })

    // ═══ PO status ═══
    var poByStatus = { draft: 0, confirmed: 0, completed: 0, closed: 0 }
    pos.forEach(function (po) { if (poByStatus[po.status] !== undefined) poByStatus[po.status]++ })

    // ═══ Top variance items ═══
    var varianceItems = poItems
      .filter(function (it) { return it.estimated_cost_paise && it.actual_cost_paise })
      .map(function (it) {
        var diff = it.actual_cost_paise - it.estimated_cost_paise
        return { name: it.item_name, vendor: it.vendor_name || '—', est: it.estimated_cost_paise, actual: it.actual_cost_paise, diff: diff, pct: Math.round((diff / it.estimated_cost_paise) * 100) }
      })
      .sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff) })
      .slice(0, 8)

    // ═══ Vendor spend ═══
    var vendorSpend = {}
    poItems.forEach(function (it) {
      if (!it.vendor_name) return
      if (!vendorSpend[it.vendor_name]) vendorSpend[it.vendor_name] = { paise: 0, items: 0 }
      vendorSpend[it.vendor_name].paise += (it.actual_cost_paise || it.estimated_cost_paise || 0)
      vendorSpend[it.vendor_name].items++
    })
    var topVendors = Object.keys(vendorSpend).map(function (k) { return { name: k, paise: vendorSpend[k].paise, items: vendorSpend[k].items } })
    topVendors.sort(function (a, b) { return b.paise - a.paise })
    topVendors = topVendors.slice(0, 10)

    // ═══ Vendor rate comparison (items with 2+ vendors) ═══
    var itemVendors = {}
    poItems.forEach(function (it) {
      if (!it.vendor_name || !it.vendor_rate_paise) return
      var key = (it.item_name || '').toLowerCase().trim()
      if (!itemVendors[key]) itemVendors[key] = { item_name: it.item_name, unit: it.unit, vendors: {} }
      if (!itemVendors[key].vendors[it.vendor_name]) itemVendors[key].vendors[it.vendor_name] = []
      itemVendors[key].vendors[it.vendor_name].push(it.vendor_rate_paise)
    })
    var rateComparison = Object.keys(itemVendors)
      .filter(function (k) { return Object.keys(itemVendors[k].vendors).length > 1 })
      .map(function (k) {
        var item = itemVendors[k]
        var vArr = Object.keys(item.vendors).map(function (v) {
          var rates = item.vendors[v]
          var avg = Math.round(rates.reduce(function (s, r) { return s + r }, 0) / rates.length)
          return { vendor: v, avgRate: avg }
        })
        vArr.sort(function (a, b) { return a.avgRate - b.avgRate })
        return { item_name: item.item_name, unit: item.unit, vendors: vArr, bestRate: vArr[0]?.avgRate || 0 }
      })

    // ═══ Requisitions ═══
    var reqByStatus = {}
    reqs.forEach(function (r) {
      var s = r.status || 'unknown'
      if (!reqByStatus[s]) reqByStatus[s] = 0
      reqByStatus[s]++
    })
    var reqByDept = {}
    reqs.forEach(function (r) {
      var dept = r.department || 'Unknown'
      if (!reqByDept[dept]) reqByDept[dept] = 0
      reqByDept[dept]++
    })
    var reqDeptArr = Object.keys(reqByDept).map(function (k) { return { name: k, count: reqByDept[k] } })
    reqDeptArr.sort(function (a, b) { return b.count - a.count })

    // ═══ Inventory ═══
    var allInv = invItems.concat(csItems)
    var invByCat = {}
    allInv.forEach(function (it) {
      var cat = it.categories?.name || 'Uncategorized'
      if (!invByCat[cat]) invByCat[cat] = { count: 0, qty: 0 }
      invByCat[cat].count++
      invByCat[cat].qty += (it.qty || 0)
    })
    var invCatArr = Object.keys(invByCat).map(function (k) { return { name: k, count: invByCat[k].count, qty: invByCat[k].qty } })
    invCatArr.sort(function (a, b) { return b.count - a.count })
    var lowStock = allInv.filter(function (it) { return it.qty !== undefined && it.qty <= 10 }).slice(0, 10)

    // ═══ Events ═══
    var eventsByVenue = {}
    var totalPlates = 0
    upEvents.forEach(function (e) {
      var v = e.venue_name || 'Unknown'
      if (!eventsByVenue[v]) eventsByVenue[v] = { count: 0, plates: 0 }
      eventsByVenue[v].count++
      eventsByVenue[v].plates += (e.total_plates || 0)
      totalPlates += (e.total_plates || 0)
    })
    var eventVenueArr = Object.keys(eventsByVenue).map(function (k) { return { name: k, count: eventsByVenue[k].count, plates: eventsByVenue[k].plates } })
    eventVenueArr.sort(function (a, b) { return b.count - a.count })

    setD({
      totalExpPaise: totalExpPaise, expChange: pctChange(totalExpPaise, prevExpPaise),
      totalProcActual: totalProcActual, procChange: pctChange(totalProcActual, prevProcActual), avgVariance: avgVariance,
      totalPOs: pos.length, poByStatus: poByStatus,
      totalUpcoming: upEvents.length, totalPlates: totalPlates,
      expTypeArr: expTypeArr, topSpenders: topSpenders,
      trendArr: trendArr, maxTrend: maxTrend,
      varianceItems: varianceItems,
      topVendors: topVendors, rateComparison: rateComparison,
      reqByStatus: reqByStatus, reqDeptArr: reqDeptArr, totalReqs: reqs.length,
      invCatArr: invCatArr, lowStock: lowStock, totalInv: allInv.length,
      eventVenueArr: eventVenueArr,
    })
    setLoading(false)
  }

  // ═══ STATUS PILLS ═══
  var REQ_STATUS_COLORS = {
    pending_dept: 'bg-yellow-100 text-yellow-700',
    pending: 'bg-orange-100 text-orange-700',
    approved: 'bg-blue-100 text-blue-700',
    fulfilled: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-600',
  }
  var PO_STATUS_COLORS = {
    draft: 'bg-gray-100 text-gray-600',
    confirmed: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    closed: 'bg-gray-200 text-gray-500',
  }

  // ═══ RENDER ═══
  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">System Analytics</h2>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {PERIODS.map(function (p) {
            return (
              <button key={p.key} onClick={function () { setPeriod(p.key) }}
                className={"px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors " +
                  (period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      )}

      {!loading && (
        <>
          {/* ═══ KPI ROW ═══ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Total Expenses" value={formatPaise(d.totalExpPaise || 0)} change={d.expChange} sub="vs prev period" />
            <KpiCard label="Procurement Spend" value={formatPaise(d.totalProcActual || 0)} change={d.procChange} sub={'Variance ' + (d.avgVariance > 0 ? '+' : '') + (d.avgVariance || 0) + '%'} />
            <KpiCard label="Purchase Orders" value={d.totalPOs || 0} sub={(d.poByStatus?.confirmed || 0) + ' active'} color="neutral" />
            <KpiCard label="Upcoming Events" value={d.totalUpcoming || 0} sub={((d.totalPlates || 0)).toLocaleString('en-IN') + ' plates booked'} color="neutral" />
          </div>

          {/* ═══ EXPENSE TREND ═══ */}
          <Section title="Expense Trend" icon="📈">
            <div className="flex items-end gap-2 h-36 px-1">
              {(d.trendArr || []).map(function (m, i) {
                var pct = d.maxTrend > 0 ? Math.max(Math.round((m.paise / d.maxTrend) * 100), 3) : 3
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                    <div className="w-full max-w-[48px] bg-indigo-400 rounded-t transition-all hover:bg-indigo-500"
                      style={{ height: pct + '%' }} title={formatPaise(m.paise)} />
                    <p className="text-[10px] text-gray-400 mt-2 font-medium">{m.label}</p>
                    <p className="text-[10px] text-gray-600 font-semibold">{formatPaise(m.paise)}</p>
                  </div>
                )
              })}
            </div>
          </Section>

          {/* ═══ TWO COLUMN: Expense Breakdown + Top Spenders ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Expenses by Type" icon="💰">
              <HBars items={d.expTypeArr || []} valKey="paise" labelKey="name" fmtFn={formatPaise} color="bg-amber-500" />
            </Section>
            <Section title="Top Spenders" icon="👤">
              <HBars items={d.topSpenders || []} valKey="paise" labelKey="name" fmtFn={formatPaise} color="bg-rose-500" />
            </Section>
          </div>

          {/* ═══ PROCUREMENT ═══ */}
          <Section title="Procurement" icon="🛒">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* PO Status */}
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase mb-3">PO Status Distribution</p>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(d.poByStatus || {}).map(function (s) {
                    var count = (d.poByStatus || {})[s] || 0
                    if (count === 0) return null
                    return (
                      <span key={s} className={"px-3 py-1.5 rounded-full text-xs font-bold " + (PO_STATUS_COLORS[s] || 'bg-gray-100 text-gray-600')}>
                        {titleCase(s)} · {count}
                      </span>
                    )
                  })}
                </div>
                {/* Est vs Actual summary */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Estimated</p>
                    <p className="text-sm font-bold text-gray-700">{formatPaise(d.totalProcEst || 0)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Actual</p>
                    <p className="text-sm font-bold text-gray-900">{formatPaise(d.totalProcActual || 0)}</p>
                  </div>
                  <div className={"rounded-lg p-3 text-center " + (d.avgVariance > 0 ? 'bg-red-50' : d.avgVariance < 0 ? 'bg-green-50' : 'bg-gray-50')}>
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Variance</p>
                    <p className={"text-sm font-bold " + (d.avgVariance > 0 ? 'text-red-600' : d.avgVariance < 0 ? 'text-green-600' : 'text-gray-700')}>
                      {d.avgVariance > 0 ? '+' : ''}{d.avgVariance || 0}%
                    </p>
                  </div>
                </div>
              </div>

              {/* Top variance items */}
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase mb-3">Highest Variance Items</p>
                {(d.varianceItems || []).length === 0 && <p className="text-sm text-gray-400 py-4">No variance data yet</p>}
                <div className="space-y-2">
                  {(d.varianceItems || []).map(function (it, idx) {
                    var isOver = it.diff > 0
                    return (
                      <div key={idx} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-gray-50">
                        <div className="flex-1 min-w-0 mr-2">
                          <span className="text-gray-700 font-medium">{titleCase(it.name)}</span>
                          <span className="text-gray-400 ml-1.5">{it.vendor}</span>
                        </div>
                        <span className={"font-bold flex-shrink-0 " + (isOver ? 'text-red-600' : 'text-green-600')}>
                          {isOver ? '+' : ''}{it.pct}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </Section>

          {/* ═══ TWO COLUMN: Vendors + Rate Comparison ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Top Vendors by Spend" icon="🏪">
              <HBars items={d.topVendors || []} valKey="paise" labelKey="name" fmtFn={formatPaise} color="bg-emerald-500"
                secondaryKey="items" secondaryFmt={function (n) { return n + ' items' }} />
            </Section>
            <Section title="Vendor Rate Comparison" icon="⚖️">
              {(d.rateComparison || []).length === 0 && <p className="text-sm text-gray-400 py-4 text-center">Need 2+ vendors per item to compare</p>}
              <div className="space-y-4">
                {(d.rateComparison || []).map(function (item, idx) {
                  return (
                    <div key={idx}>
                      <p className="text-xs font-semibold text-gray-700 mb-1">{titleCase(item.item_name)} <span className="text-gray-400 font-normal">/{item.unit || 'unit'}</span></p>
                      <div className="space-y-1">
                        {item.vendors.map(function (v, vi) {
                          var isBest = v.avgRate === item.bestRate && item.vendors.length > 1
                          return (
                            <div key={vi} className={"flex items-center justify-between text-[11px] px-2 py-1 rounded " + (isBest ? 'bg-green-50' : 'bg-gray-50')}>
                              <span className={isBest ? 'text-green-700 font-medium' : 'text-gray-600'}>{v.vendor}</span>
                              <span className={"font-bold " + (isBest ? 'text-green-700' : 'text-gray-700')}>{formatPaise(v.avgRate)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          </div>

          {/* ═══ TWO COLUMN: Requisitions + Inventory ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title={'Requisitions · ' + (d.totalReqs || 0)} icon="📋">
              {/* Status pills */}
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.keys(d.reqByStatus || {}).map(function (s) {
                  var count = (d.reqByStatus || {})[s] || 0
                  return (
                    <span key={s} className={"px-3 py-1.5 rounded-full text-xs font-bold " + (REQ_STATUS_COLORS[s] || 'bg-gray-100 text-gray-600')}>
                      {titleCase(s.replace('_', ' '))} · {count}
                    </span>
                  )
                })}
              </div>
              <p className="text-xs font-bold text-gray-400 uppercase mb-2">By Department</p>
              <HBars items={d.reqDeptArr || []} valKey="count" labelKey="name" fmtFn={function (n) { return n + ' reqs' }} color="bg-violet-500" />
            </Section>

            <Section title={'Inventory · ' + (d.totalInv || 0) + ' items'} icon="📦">
              <HBars items={(d.invCatArr || []).slice(0, 8)} valKey="count" labelKey="name" fmtFn={function (n) { return n + ' items' }} color="bg-sky-500"
                secondaryKey="qty" secondaryFmt={function (n) { return 'qty: ' + n }} />
              {(d.lowStock || []).length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-bold text-red-500 uppercase mb-2">⚠ Low Stock (≤ 10)</p>
                  <div className="space-y-1">
                    {(d.lowStock || []).map(function (it) {
                      return (
                        <div key={it.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-red-50">
                          <span className="text-gray-700">{titleCase(it.name)}</span>
                          <span className="font-bold text-red-600">{it.qty} left</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </Section>
          </div>

          {/* ═══ EVENTS ═══ */}
          <Section title={'Upcoming Events · ' + (d.totalUpcoming || 0)} icon="📅">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase mb-3">By Venue</p>
                <HBars items={d.eventVenueArr || []} valKey="count" labelKey="name" fmtFn={function (n) { return n + ' events' }} color="bg-teal-500"
                  secondaryKey="plates" secondaryFmt={function (n) { return n.toLocaleString('en-IN') + ' plates' }} />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase mb-3">Summary</p>
                <div className="grid grid-cols-2 gap-3">
                  {(d.eventVenueArr || []).map(function (v) {
                    return (
                      <div key={v.name} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-[10px] text-gray-400 font-bold uppercase truncate">{v.name}</p>
                        <p className="text-lg font-bold text-gray-900">{v.count}</p>
                        <p className="text-[10px] text-gray-500">{v.plates.toLocaleString('en-IN')} plates</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

export default Analytics
