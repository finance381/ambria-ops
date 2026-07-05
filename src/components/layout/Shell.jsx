import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { ROLE_COLORS } from '../../lib/constants'
import Inventory from '../../modules/inventory/Inventory'
import InventoryForm from '../../modules/inventory/InventoryForm'
import Events from '../../modules/events/Events'
import AdminReview from '../../modules/categories/AdminReview'
import DeptReview from '../../modules/categories/DeptReview'
import { useLang } from '../../lib/i18n.jsx'
import QuoteCalculator from '../../modules/quote/QuoteCalculator'
import Requisitions from '../../modules/requisitions/Requisitions'
import Purchase from '../../modules/purchase/Purchase'
import Expenses from '../../modules/expenses/Expenses'
import ProductionOrders from '../../modules/production/ProductionOrders'
import Boxes from '../../modules/boxes/Boxes'
import Challans from '../../modules/challans/Challans'
import RateCardEditor from '../../modules/quote/RateCardEditor'
import AdminMobile from '../../modules/categories/AdminMobile.jsx'

var GROUPS = [
  {
    key: 'inventory', label: 'Inventory', icon: '📦', items: [
      { key: 'feature_add', label: 'Add Item', icon: '📝', tab: 'add' },
      { key: 'feature_items', label: 'Item List', icon: '📋', tab: 'my' },
      { key: 'feature_production', label: 'Production', icon: '🔧', tab: 'production' },
      { key: 'feature_boxes', label: 'Boxes', icon: '🗃️', tab: 'boxes' },
    ]
  },
  {
    key: 'review', label: 'Review', icon: '✅', items: [
      { key: 'feature_dept_review', label: 'Dept Review', icon: '✅', tab: 'dept_review' },
      { key: 'feature_pending', label: 'Pending Review', icon: '⏳', tab: 'pending_review' },
    ]
  },
  {
    key: 'events', label: 'Events', icon: '📅', items: [
      { key: 'feature_events', label: 'Events', icon: '📅', tab: 'events' },
      { key: 'feature_quote', label: 'Quote Calc', icon: '🧮', tab: 'quote' },
      { key: 'feature_ratecard', label: 'Rate Card', icon: '💲', tab: 'ratecard' },
    ]
  },
  {
    key: 'procurement', label: 'Procurement', icon: '🛒', items: [
      { key: 'feature_requisitions', label: 'Requisitions', icon: '📋', tab: 'requisitions' },
      { key: 'feature_purchase', label: 'Purchase Orders', icon: '🛒', tab: 'purchase' },
    ]
  },
  {
    key: 'logistics', label: 'Logistics', icon: '🚛', items: [
      { key: 'feature_receive', label: 'Receive Items', icon: '📦', tab: 'receive' },
      { key: 'feature_challans', label: 'Challans', icon: '🚛', tab: 'challans' },
    ]
  },
  {
    key: 'expenses', label: 'Expenses', icon: '💰', items: [
      { key: 'feature_expenses', label: 'PC & Direct Expenses', icon: '💰', tab: 'expenses' },
    ]
  },
  {
    key: 'admin', label: 'Admin', icon: '⚙️', items: [
      { key: 'feature_admin', label: 'Admin', icon: '⚙️', tab: 'admin' },
    ]
  },
]

import { pushBack, goBack as navBack } from '../../lib/backNav'
import { formatPoints } from '../../lib/format'

function Shell({ profile, onSignOut }) {
  var [activeGroup, setActiveGroup] = useState(null)
  var [tab, setTab] = useState(null)
  var [showSuccess, setShowSuccess] = useState(false)

  var isAdmin = profile.role === 'admin' || profile.role === 'auditor'
  var perms = profile.permissions || []
  var { lang, switchLang } = useLang()

  var [badges, setBadges] = useState({})
  var [lastBadgeLoad, setLastBadgeLoad] = useState(0)
  var [walletBalance, setWalletBalance] = useState(null)
  var [walletPending, setWalletPending] = useState(0)

  useEffect(function () {
    if (!profile?.id) return
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { setWalletBalance(res.data?.balance_paise || 0) })
    supabase.from('wallet_transfers').select('id', { count: 'exact', head: true })
      .eq('to_user_id', profile.id).eq('status', 'pending')
      .then(function (res) { setWalletPending(res.count || 0) })
  }, [profile?.id, tab])

  // Filter groups: only show groups where user has at least one sub-feature permission
  var visibleGroups = GROUPS.map(function (g) {
    var visibleItems = g.items.filter(function (f) { return perms.indexOf(f.key) !== -1 })
    if (visibleItems.length === 0) return null
    return Object.assign({}, g, { items: visibleItems })
  }).filter(Boolean)

  // Badge sum per group
  function groupBadge(group) {
    var total = 0
    group.items.forEach(function (f) { total += (badges[f.key] || 0) })
    return total
  }

  function goBack() {
    navBack()
  }

  function openGroup(group) {
    if (group.items.length === 1) {
      pushBack(function () { setTab(null); setActiveGroup(null) })
      setActiveGroup(group.key)
      setTab(group.items[0].tab)
    } else {
      pushBack(function () { setActiveGroup(null) })
      setActiveGroup(group.key)
      setTab(null)
    }
  }

  function openModule(item) {
    pushBack(function () { setTab(null) })
    setTab(item.tab)
  }

  // Current group object
  var currentGroup = activeGroup ? visibleGroups.find(function (g) { return g.key === activeGroup }) : null

  // Header title
  var headerTitle = 'Ambria Ops'
  if (tab && currentGroup) {
    var currentItem = currentGroup.items.find(function (f) { return f.tab === tab })
    headerTitle = currentItem?.label || currentGroup.label
  } else if (activeGroup && currentGroup) {
    headerTitle = currentGroup.label
  }

  useEffect(function () {
    if (activeGroup || tab) return
    if (Date.now() - lastBadgeLoad < 30000) return
    var stale = false
    loadBadges(function () { return stale })
    return function () { stale = true }
  }, [activeGroup, tab])

  async function loadBadges(isStale) {
    var counts = {}
    var isAdminRole = profile.role === 'admin' || profile.role === 'auditor'
    var isDeptAppr = perms.indexOf('dept_approve') >= 0
    var hasExpApprove = perms.indexOf('expense_approve') >= 0

    var promises = []

    // Dept Review badge
    if (perms.indexOf('feature_dept_review') !== -1) {
      promises.push(
        Promise.all([
          supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('status', 'pending_dept'),
          supabase.from('catering_store_items').select('id', { count: 'exact', head: true }).eq('status', 'pending_dept'),
        ]).then(function (res) {
          counts.feature_dept_review = (res[0].count || 0) + (res[1].count || 0)
        })
      )
    }

    // Pending Review badge
    if (perms.indexOf('feature_pending') !== -1) {
      promises.push(
        Promise.all([
          supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('catering_store_items').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        ]).then(function (res) {
          counts.feature_pending = (res[0].count || 0) + (res[1].count || 0)
        })
      )
    }

   // Requisitions badge
    if (perms.indexOf('feature_requisitions') !== -1) {
      // Approval badge for dept approvers / admins
      if (isDeptAppr || isAdminRole) {
        var reqStatuses = []
        if (isAdminRole) reqStatuses = isDeptAppr ? ['pending_dept', 'pending'] : ['pending']
        else if (isDeptAppr) reqStatuses = ['pending_dept']
        if (reqStatuses.length > 0) {
          promises.push(
            supabase.from('requisitions')
              .select('id', { count: 'exact', head: true })
              .neq('requested_by', profile.id)
              .in('status', reqStatuses)
              .then(function (res) { counts._req_approval = res.count || 0 })
          )
        }
      }
      // Dispatched items awaiting acknowledgment by this user
      promises.push(
        supabase.from('requisition_items')
          .select('id, requisitions!inner(requested_by)', { count: 'exact', head: true })
          .eq('item_status', 'dispatched')
          .eq('requisitions.requested_by', profile.id)
          .then(function (res) { counts._req_dispatch = res.count || 0 })
          .catch(function () {})
      )
    }

    // Expenses badge
    if (perms.indexOf('feature_expenses') !== -1) {
      var expStatuses = ['recorded', 'flagged']
      if (expStatuses.length > 0) {
        promises.push(
          supabase.from('expenses')
            .select('id', { count: 'exact', head: true })
            .neq('user_id', profile.id)
            .in('status', expStatuses)
            .then(function (res) { counts.feature_expenses = res.count || 0 })
        )
      }
    }

    // Purchase Orders badge
    if (perms.indexOf('feature_purchase') !== -1) {
      if (isAdminRole) {
        // Admin: count items in queue (approved req items without PO)
        promises.push(
          supabase.from('requisition_items')
            .select('id, requisitions!inner(status)', { count: 'exact', head: true })
            .is('po_item_id', null)
            .eq('item_status', 'po_queued')
            .eq('requisitions.status', 'approved')
            .then(function (res) { counts.feature_purchase = res.count || 0 })
            .catch(function () {
              // FK hint fallback — just show 0
              counts.feature_purchase = 0
            })
        )
      } else {
        // Purchaser: count confirmed POs assigned to them
        promises.push(
          supabase.from('purchase_orders')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_to', profile.id)
            .eq('status', 'confirmed')
            .then(function (res) { counts.feature_purchase = res.count || 0 })
        )
      }
    }

    // Challans badge (active dispatched)
    if (perms.indexOf('feature_challans') !== -1) {
      promises.push(
        supabase.from('challans')
          .select('id', { count: 'exact', head: true })
          .in('status', ['dispatched', 'received'])
          .then(function (res) { counts.feature_challans = res.count || 0 })
      )
    }

    // Receive badge
    if (perms.indexOf('feature_receive') !== -1) {
      promises.push(
        supabase.from('purchase_order_items')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'purchased')
          .then(function (res) { counts.feature_receive = res.count || 0 })
      )
    }
    

    await Promise.allSettled(promises)
    if (isStale && isStale()) return
    counts.feature_requisitions = (counts._req_approval || 0) + (counts._req_dispatch || 0)
    setBadges(counts)
    setLastBadgeLoad(Date.now())
  }

  function handleSaved() {
    setShowSuccess(true)
    setActiveGroup(null)
    setTab(null)
    setTimeout(function () { setShowSuccess(false) }, 3000)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
        <div className="max-w-[540px] mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {(activeGroup || tab) && (
              <button
                onClick={goBack}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              >
                ←
              </button>
            )}
            <div>
              <div className="text-base font-bold text-gray-900 leading-tight">
                {headerTitle}
              </div>
              <div className="text-[11px] text-gray-400 font-medium">Ambria</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-gray-200 rounded-full overflow-hidden">
              <button
                onClick={function () { switchLang('en') }}
                className={"px-2.5 py-1 text-[11px] font-bold transition-colors " +
                  (lang === 'en' ? "bg-gray-900 text-white" : "text-gray-400")}
              >
                EN
              </button>
              <button
                onClick={function () { switchLang('hi') }}
                className={"px-2.5 py-1 text-[11px] font-bold transition-colors " +
                  (lang === 'hi' ? "bg-gray-900 text-white" : "text-gray-400")}
              >
                हि
              </button>
            </div>
            <a href="/"
              className="text-[11px] px-2 py-1 border border-gray-200 rounded-lg text-gray-400 hover:text-indigo-500 hover:border-indigo-200 transition-colors no-underline"
            >
              ⌂
            </a>
            <button
              onClick={onSignOut}
              className="text-[11px] px-2 py-1 border border-gray-200 rounded-lg text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* User bar */}
      <div className="max-w-[540px] mx-auto px-4 pt-3">
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-sm">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600">
            {profile.name?.charAt(0) || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-800 truncate">{profile.name}</div>
            <div className="text-[11px] text-gray-400 truncate">{profile.email || ''}</div>
          </div>
          <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider " + (ROLE_COLORS[profile.role] || '')}>
            {profile.role}
          </span>
        </div>
      </div>

      {/* Success banner */}
      {showSuccess && (
        <div className="max-w-[540px] mx-auto px-4 pt-3">
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-green-600 text-lg">✓</span>
            <span className="text-sm text-green-700 font-medium">Item submitted successfully</span>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="max-w-[540px] mx-auto px-4 py-4 pb-8">

        {/* Level 0: Group Cards */}
        {!activeGroup && !tab && (
          <>
            {perms.indexOf('feature_expenses') !== -1 && walletBalance !== null && (
              <button
                onClick={function () { setActiveGroup('expenses'); setTab('expenses') }}
                className={"relative w-full mb-3 rounded-xl p-3 flex items-center justify-between border shadow-sm active:scale-[0.99] transition-all " + (walletBalance < 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200")}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">💰</span>
                  <div className="text-left">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Wallet Balance</p>
                    <p className={"text-lg font-bold " + (walletBalance < 0 ? "text-red-700" : "text-green-700")}>{formatPoints(walletBalance)}</p>
                  </div>
                </div>
                {walletPending > 0 && (
                  <span className="min-w-[24px] h-6 px-2 bg-amber-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
                    {walletPending} pending
                  </span>
                )}
              </button>
            )}
          <div className="grid grid-cols-2 gap-3 pt-2">
            {visibleGroups.map(function (g) {
              var badge = groupBadge(g)
              return (
                <button
                  key={g.key}
                  onClick={function () { openGroup(g) }}
                  className="relative bg-white border border-gray-200 rounded-xl p-5 flex flex-col items-center gap-2 shadow-sm hover:shadow-md hover:border-gray-300 active:scale-[0.98] transition-all"
                >
                  {badge > 0 && (
                    <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                  <span className="text-2xl">{g.icon}</span>
                  <span className="text-sm font-semibold text-gray-800">{g.label}</span>
                </button>
              )
            })}
            {visibleGroups.length === 0 && (
              <div className="col-span-2 text-center py-12 text-gray-400 text-sm">
                No features assigned. Contact admin.
              </div>
            )}
          </div>
          </>
        )}

        {/* Level 1: Sub-Cards within a group */}
        {activeGroup && !tab && currentGroup && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            {currentGroup.items.map(function (f) {
              return (
                <button
                  key={f.key}
                  onClick={function () { openModule(f) }}
                  className="relative bg-white border border-gray-200 rounded-xl p-5 flex flex-col items-center gap-2 shadow-sm hover:shadow-md hover:border-gray-300 active:scale-[0.98] transition-all"
                >
                  {badges[f.key] > 0 && (
                    <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {badges[f.key] > 99 ? '99+' : badges[f.key]}
                    </span>
                  )}
                  <span className="text-2xl">{f.icon}</span>
                  <span className="text-sm font-semibold text-gray-800">{f.label}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Level 2: Module */}
        {tab === 'add' && (
          <InventoryForm
            item={null}
            profile={profile}
            onClose={goBack}
            onSaved={handleSaved}
          />
        )}
        {tab === 'my' && (
          <Inventory profile={profile} />
        )}
        {tab === 'events' && (
          <Events profile={profile} />
        )}
        {tab === 'quote' && (
          <QuoteCalculator profile={profile} />
        )}
        {tab === 'dept_review' && (
          <DeptReview profile={profile} />
        )}
        {tab === 'pending_review' && (
          <AdminReview profile={profile} />
        )}
        {tab === 'requisitions' && (
          <Requisitions profile={profile} onBack={goBack} />
        )}
        {tab === 'expenses' && (
          <Expenses profile={profile} />
        )}
        {tab === 'purchase' && (
          <Purchase profile={profile} mode="purchase" />
        )}
        {tab === 'receive' && (
          <Purchase profile={profile} mode="receive" />
        )}
        {tab === 'production' && (
          <ProductionOrders profile={profile} />
        )}
        {tab === 'boxes' && (
          <Boxes profile={profile} />
        )}
        {tab === 'challans' && (
          <Challans profile={profile} />
        )}
        {tab === 'ratecard' && (
          <RateCardEditor profile={profile} />
        )}
        {tab === 'admin' && isAdmin && (
          <AdminMobile profile={profile} />
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-[11px] text-gray-300 tracking-wider">
        Ambria <span className="text-amber-400">●</span> Ops
      </footer>
    </div>
  )
}

export default Shell