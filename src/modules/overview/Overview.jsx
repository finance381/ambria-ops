  import { useState, useEffect } from 'react'
  import { supabase } from '../../lib/supabase'
  import { formatPaise, formatDate } from '../../lib/format'

  var CARDS = [
    { key: 'inventory', icon: '📦', label: 'Inventory Review', color: 'amber', desc: 'Items awaiting approval' },
    { key: 'requisitions', icon: '📋', label: 'Requisitions', color: 'violet', desc: 'Pending approval' },
    { key: 'expenses', icon: '💰', label: 'Expenses', color: 'rose', desc: 'Awaiting review' },
    { key: 'po_draft', icon: '🛒', label: 'Draft POs', color: 'blue', desc: 'Need confirmation' },
    { key: 'po_unassigned', icon: '👤', label: 'Unassigned PO Items', color: 'orange', desc: 'No vendor or purchaser' },
    { key: 'receiving', icon: '📥', label: 'Awaiting Receiving', color: 'teal', desc: 'Purchased, not received' },
    { key: 'vendors', icon: '🏪', label: 'Incomplete Vendors', color: 'pink', desc: 'Missing details' },
    { key: 'events', icon: '📅', label: 'Events This Week', color: 'indigo', desc: 'Upcoming 7 days' },
    { key: 'challans_active', icon: '🚛', label: 'Active Challans', color: 'cyan', desc: 'Dispatched, not closed' },
    { key: 'shortages', icon: '⚠️', label: 'Shortages', color: 'red', desc: 'Received less than sent' },
]

  var COLOR_MAP = {
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-500', text: 'text-amber-700', hover: 'hover:border-amber-400' },
    violet: { bg: 'bg-violet-50', border: 'border-violet-200', badge: 'bg-violet-500', text: 'text-violet-700', hover: 'hover:border-violet-400' },
    rose: { bg: 'bg-rose-50', border: 'border-rose-200', badge: 'bg-rose-500', text: 'text-rose-700', hover: 'hover:border-rose-400' },
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-500', text: 'text-blue-700', hover: 'hover:border-blue-400' },
    orange: { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-500', text: 'text-orange-700', hover: 'hover:border-orange-400' },
    teal: { bg: 'bg-teal-50', border: 'border-teal-200', badge: 'bg-teal-500', text: 'text-teal-700', hover: 'hover:border-teal-400' },
    pink: { bg: 'bg-pink-50', border: 'border-pink-200', badge: 'bg-pink-500', text: 'text-pink-700', hover: 'hover:border-pink-400' },
    indigo: { bg: 'bg-indigo-50', border: 'border-indigo-200', badge: 'bg-indigo-500', text: 'text-indigo-700', hover: 'hover:border-indigo-400' },
    cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', badge: 'bg-cyan-500', text: 'text-cyan-700', hover: 'hover:border-cyan-400' },
    red: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-500', text: 'text-red-700', hover: 'hover:border-red-400' },
}

  // Navigation map: which admin tab + sub-tab to open
  var NAV_MAP = {
    inventory: { tab: 'inventory', sub: 'pending' },
    requisitions: { tab: 'procurement', sub: 'requisitions' },
    expenses: { tab: 'expenses' },
    po_draft: { tab: 'procurement', sub: 'purchase' },
    po_unassigned: { tab: 'procurement', sub: 'purchase' },
    receiving: { tab: 'procurement', sub: 'purchase' },
    vendors: { tab: 'procurement', sub: 'vendors' },
    events: { tab: 'events' },
    challans_active: { tab: 'inventory', sub: 'challans' },
    shortages: { tab: 'inventory', sub: 'challans' },
}

  function Overview({ profile, onNavigate }) {
    var [counts, setCounts] = useState({})
    var [details, setDetails] = useState({})
    var [loading, setLoading] = useState(true)

    useEffect(function () { loadCounts() }, [])

    async function loadCounts() {
      setLoading(true)
      var today = new Date().toISOString().split('T')[0]
      var weekOut = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

      var results = await Promise.allSettled([
        // 0: Pending inventory
        supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('status', 'pending'),

        // 1: Pending requisitions
        supabase.from('requisitions').select('id', { count: 'exact', head: true }).in('status', ['pending', 'pending_dept']),

        // 2: Pending expenses
        supabase.from('expenses').select('id, amount_paise', { count: 'exact' }).eq('status', 'pending').limit(100),

        // 3: Draft POs
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('status', 'draft'),

        // 4: PO items without vendor
        supabase.from('purchase_order_items').select('id', { count: 'exact', head: true }).eq('status', 'pending').is('vendor_name', null),

        // 5: Purchased not received
        supabase.from('purchase_order_items').select('id', { count: 'exact', head: true }).eq('status', 'purchased'),

        // 6: Incomplete vendors (no phone or no address)
        supabase.from('vendors').select('id, name, phone, address', { count: 'exact' }).eq('active', true).limit(200),

        // 7: Events this week
        supabase.from('events_safe').select('id, function_date, contract_date, venue_name, department, status')
          .or('function_date.gte.' + today + ',function_date.is.null')
          .lte('function_date', weekOut)
          .order('function_date', { ascending: true, nullsFirst: false }).limit(50),

        // 8: Pending catering store items
        supabase.from('catering_store_items').select('id', { count: 'exact', head: true }).eq('status', 'pending'),

        // 9: Active challans (dispatched or received, not closed)
        supabase.from('challans').select('id', { count: 'exact', head: true }).in('status', ['dispatched', 'received']),

        // 10: Shortage items (qty_received < qty_sent)
        supabase.from('challan_items').select('id, qty_sent, qty_received').not('qty_received', 'is', null).limit(500),
    ])

      var pendingInv = (results[0].value?.count || 0) + (results[8].value?.count || 0)
      var pendingReqs = results[1].value?.count || 0

      var pendingExpenses = results[2].value?.data || []
      var pendingExpCount = results[2].value?.count || pendingExpenses.length
      var pendingExpTotal = 0
      pendingExpenses.forEach(function (e) { pendingExpTotal += (e.amount_paise || 0) })

      var draftPos = results[3].value?.count || 0
      var unassignedItems = results[4].value?.count || 0
      var awaitingReceive = results[5].value?.count || 0

      var allVendors = results[6].value?.data || []
      var incompleteVendors = allVendors.filter(function (v) { return !v.phone || !v.address })
      var incompleteNames = incompleteVendors.slice(0, 5).map(function (v) { return v.name })

      var weekEvents = results[7].value?.data || []

      var activeChallans = results[9].value?.count || 0
      var shortageItems = (results[10].value?.data || []).filter(function (ci) {
        return ci.qty_received < ci.qty_sent
    })

    setCounts({
        inventory: pendingInv,
        requisitions: pendingReqs,
        expenses: pendingExpCount,
        po_draft: draftPos,
        po_unassigned: unassignedItems,
        receiving: awaitingReceive,
        vendors: incompleteVendors.length,
        events: weekEvents.length,
        challans_active: activeChallans,
        shortages: shortageItems.length,
    })

      setDetails({
        expenseTotal: pendingExpTotal,
        vendorNames: incompleteNames,
        events: weekEvents.slice(0, 5),
      })

      setLoading(false)
    }

    var totalActions = 0
    CARDS.forEach(function (c) { if (c.key !== 'events') totalActions += (counts[c.key] || 0) })

    function handleCardClick(key) {
      var nav = NAV_MAP[key]
      if (nav && onNavigate) onNavigate(nav.tab, nav.sub)
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      )
    }

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {profile.name?.split(' ')[0] || 'Admin'}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {totalActions > 0
                ? totalActions + ' pending action' + (totalActions !== 1 ? 's' : '') + ' across the system'
                : 'All clear — no pending actions'}
            </p>
          </div>
          <button onClick={loadCounts} className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 font-medium">
            ↻ Refresh
          </button>
        </div>

        {/* Action cards grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {CARDS.map(function (card) {
            var count = counts[card.key] || 0
            var c = COLOR_MAP[card.color]
            var isZero = count === 0
            return (
              <div key={card.key}
                onClick={function () { if (!isZero) handleCardClick(card.key) }}
                className={"rounded-xl border p-4 transition-all " +
                  (isZero
                    ? "bg-gray-50 border-gray-100 opacity-50"
                    : c.bg + " " + c.border + " " + c.hover + " cursor-pointer shadow-sm hover:shadow-md")}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-xl">{card.icon}</span>
                  {!isZero && (
                    <span className={"text-white text-[11px] font-bold px-2 py-0.5 rounded-full min-w-[24px] text-center " + c.badge}>
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                  {isZero && (
                    <span className="text-[10px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full">✓</span>
                  )}
                </div>
                <p className={"text-sm font-bold " + (isZero ? "text-gray-400" : c.text)}>{card.label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{card.desc}</p>

                {/* Extra detail for expenses */}
                {card.key === 'expenses' && !isZero && details.expenseTotal > 0 && (
                  <p className="text-[10px] font-bold text-rose-600 mt-1.5">{formatPaise(details.expenseTotal)} pending</p>
                )}
              </div>
            )
          })}
        </div>

        {/* Incomplete vendors list */}
        {(details.vendorNames || []).length > 0 && (
          <div className="bg-pink-50 rounded-xl border border-pink-200 p-4">
            <p className="text-xs font-bold text-pink-700 uppercase mb-2">🏪 Vendors needing details</p>
            <div className="flex flex-wrap gap-2">
              {details.vendorNames.map(function (name, i) {
                return (
                  <span key={i} className="px-2.5 py-1 bg-white rounded-lg text-xs font-medium text-gray-700 border border-pink-100">{name}</span>
                )
              })}
              {(counts.vendors || 0) > 5 && (
                <span className="px-2.5 py-1 text-xs text-pink-500 font-medium">+{counts.vendors - 5} more</span>
              )}
            </div>
          </div>
        )}

        {/* This week's events */}
        {(details.events || []).length > 0 && (
          <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-4">
            <p className="text-xs font-bold text-indigo-700 uppercase mb-3">📅 Events — Next 7 Days</p>
            <div className="space-y-2">
              {details.events.map(function (ev) {
                return (
                  <div key={ev.id} className="flex items-center justify-between py-1.5 px-3 bg-white rounded-lg border border-indigo-100">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-gray-700">{ev.venue_name || '—'}</span>
                      <span className="text-[10px] text-gray-400 ml-2">{ev.department || ''}</span>
                    </div>
                    <span className="text-[11px] font-bold text-indigo-600 flex-shrink-0">{formatDate(ev.function_date || ev.contract_date)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  export default Overview
