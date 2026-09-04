import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { ROLE_COLORS } from '../../lib/constants'
import Inventory from '../../modules/inventory/Inventory'
import InventoryForm from '../../modules/inventory/InventoryForm'
import Events from '../../modules/events/Events'
import ExtraPlateCollect from '../../modules/events/ExtraPlateCollect'
import AdminReview from '../../modules/categories/AdminReview'
import DeptReview from '../../modules/categories/DeptReview'
import { useLang } from '../../lib/i18n.jsx'
import QuoteCalculator from '../../modules/quote/QuoteCalculator'
import Requisitions from '../../modules/requisitions/Requisitions'

import Purchase from '../../modules/purchase/Purchase'
import Expenses from '../../modules/expenses/Expenses'
import Ledgers from '../../modules/expenses/Ledgers'
import VendorLedger from '../../modules/expenses/VendorLedger'
import Payments from '../../modules/expenses/Payments'
import CostTransfers from '../../modules/expenses/CostTransfers'
import SalaryPayouts from '../../modules/expenses/SalaryPayouts'
import SalaryLedger from '../../modules/employees/SalaryLedger'
import Wallet from '../../modules/expenses/Wallet'
import ProductionOrders from '../../modules/production/ProductionOrders'
import Boxes from '../../modules/boxes/Boxes'
import Challans from '../../modules/challans/Challans'
import RateCardEditor from '../../modules/quote/RateCardEditor'
import Vendors from '../../modules/vendors/Vendors'
import Employees from '../../modules/employees/Employees'
import AdminMobile from '../../modules/categories/AdminMobile.jsx'
import MyProfile from '../../modules/employees/MyProfile'
import { hasPerm } from '../../lib/permissions'

var GROUPS = [
  {
    key: 'me', label: 'My Profile', icon: '🪪', items: [
      { key: 'personal.profile', label: 'My Profile', icon: '🪪', tab: 'my_profile' },
    ]
  },
  {
    key: 'inventory', label: 'Inventory', icon: '📦', items: [
      { key: 'inventory.add', label: 'Add Item', icon: '📝', tab: 'add' },
      { key: 'inventory.items', label: 'Item List', icon: '📋', tab: 'my' },
      { key: 'inventory.production', label: 'Production', icon: '🔧', tab: 'production' },
      { key: 'inventory.boxes', label: 'Boxes', icon: '🗃️', tab: 'boxes' },
    ]
  },
  {
    key: 'review', label: 'Review', icon: '✅', items: [
      { key: 'review.dept', label: 'Dept Review', icon: '✅', tab: 'dept_review' },
      { key: 'review.pending', label: 'Pending Review', icon: '⏳', tab: 'pending_review' },
    ]
  },
  {
    key: 'events', label: 'Events', icon: '📅', items: [
      { key: 'events.list', label: 'Events', icon: '📅', tab: 'events' },
      { key: 'events.quote', label: 'Quote Calc', icon: '🧮', tab: 'quote' },
      { key: 'events.ratecard', label: 'Rate Card', icon: '💲', tab: 'ratecard' },
      { key: 'events.extra_plate_collect', label: 'Extra Plates', icon: '🍽️', tab: 'extra_plates' },
    ]
  },
  {
    key: 'procurement', label: 'Procurement', icon: '🛒', items: [
      { key: 'procurement.requisitions', label: 'Requisitions', icon: '📋', tab: 'requisitions' },
      { key: 'procurement.purchase_orders', label: 'Purchase Orders', icon: '🛒', tab: 'purchase' },
      { key: 'procurement.vendors', label: 'Vendors', icon: '🏭', tab: 'vendors' },
    ]
  },
  {
    key: 'logistics', label: 'Logistics', icon: '🚛', items: [
      { key: 'inventory.receive', label: 'Receive Items', icon: '📦', tab: 'receive' },
      { key: 'inventory.challans', label: 'Challans', icon: '🚛', tab: 'challans' },
    ]
  },
  {
    key: 'expenses', label: 'Finance', icon: '💰', items: [
      { key: 'finance.wallet', label: 'Wallet', icon: '👛', tab: 'wallet' },
      { key: 'finance.expenses', label: 'PC & Direct Expenses', icon: '💰', tab: 'expenses' },
      { key: 'finance.cost_transfers', label: 'Cost Transfers', icon: '↔️', tab: 'cost_transfers' },
      { key: 'finance.ledgers.expense', label: 'Expense Ledger', icon: '📒', tab: 'ledgers' },
      { key: 'finance.payments', label: 'Payments', icon: '💳', tab: 'payments' },
      { key: 'finance.salary_payouts', label: 'Salary Payouts', icon: '💵', tab: 'salary_payouts' },
      { key: 'finance.ledgers.vendor', label: 'Vendor Ledger', icon: '🏭', tab: 'vendor_ledger' },
    ]
  },
  {
    key: 'hr', label: 'HR', icon: '👔', items: [
      { key: 'hr.employees', label: 'Employees', icon: '👤', tab: 'employees' },
      { key: 'finance.ledgers.salary', label: 'Salary Ledger', icon: '📒', tab: 'salary_ledger' },
    ]
  },
  {
    key: 'admin', label: 'Admin', icon: '⚙️', items: [
      { key: 'admin.dashboard', label: 'Admin', icon: '⚙️', tab: 'admin' },
    ]
  },
]

import { pushBack, goBack as navBack } from '../../lib/backNav'
import { formatPoints } from '../../lib/format'

function Shell({ profile, onSignOut }) {
  var [activeGroup, setActiveGroup] = useState(null)
  var [tab, setTab] = useState(null)
  var [showSuccess, setShowSuccess] = useState(false)

  var permsNew = profile.permsNew || []
  var isAdmin = hasPerm(permsNew, 'admin.dashboard')
  var { lang, switchLang } = useLang()

  var [badges, setBadges] = useState({})
  var [lastBadgeLoad, setLastBadgeLoad] = useState(0)
  var [walletBalance, setWalletBalance] = useState(null)
  var [walletPending, setWalletPending] = useState(0)
  var [financeStats, setFinanceStats] = useState({ expMonthCount: 0, expMonthTotal: 0, ledgerMonthTotal: 0 })

  useEffect(function () {
    if (!profile?.id) return
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { setWalletBalance(res.data?.balance_paise || 0) })
    supabase.from('wallet_transfers').select('id', { count: 'exact', head: true })
      .eq('to_user_id', profile.id).eq('status', 'pending')
      .then(function (res) { setWalletPending(res.count || 0) })

    var monthStart = new Date().toISOString().slice(0, 7) + '-01'
    var hasExp = hasPerm(permsNew, 'finance.expenses')
    var hasLedger = hasPerm(permsNew, 'finance.ledgers.expense')
    if (hasExp || hasLedger) {
      Promise.all([
        hasExp
          ? supabase.from('expenses').select('amount_paise').eq('user_id', profile.id).gte('expense_date', monthStart).is('deleted_at', null).limit(5000)
          : Promise.resolve({ data: [] }),
        hasLedger
          ? supabase.from('v_ledger').select('amount_paise').gte('expense_date', monthStart).limit(10000)
          : Promise.resolve({ data: [] })
      ]).then(function (res) {
        var exps = res[0].data || []
        var ledgs = res[1].data || []
        setFinanceStats({
          expMonthCount: exps.length,
          expMonthTotal: exps.reduce(function (s, e) { return s + (e.amount_paise || 0) }, 0),
          ledgerMonthTotal: ledgs.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0),
        })
      })
    }
  }, [profile?.id, tab])

  // Filter groups: only show groups where user has at least one sub-feature permission
  // Items marked `always:true` bypass the permission check (personal / self-service features)
  var visibleGroups = GROUPS.map(function (g) {
    var visibleItems = g.items.filter(function (f) { return f.always === true || hasPerm(permsNew, f.key) })
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
    var isAdminRole = hasPerm(permsNew, 'admin.dashboard')
    var isDeptAppr = hasPerm(permsNew, 'review.dept.approve')
    var hasExpApprove = hasPerm(permsNew, 'finance.expenses.approve')

    var promises = []

    // Dept Review badge
    if (hasPerm(permsNew, 'review.dept')) {
      promises.push(
        Promise.all([
          supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('status', 'pending_dept'),
          supabase.from('catering_store_items').select('id', { count: 'exact', head: true }).eq('status', 'pending_dept'),
        ]).then(function (res) {
          counts['review.dept'] = (res[0].count || 0) + (res[1].count || 0)
        })
      )
    }

    // Pending Review badge
    if (hasPerm(permsNew, 'review.pending')) {
      promises.push(
        Promise.all([
          supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('catering_store_items').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        ]).then(function (res) {
          counts['review.pending'] = (res[0].count || 0) + (res[1].count || 0)
        })
      )
    }

   // Requisitions badge
    if (hasPerm(permsNew, 'procurement.requisitions')) {
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
    if (hasPerm(permsNew, 'finance.expenses')) {
      var expStatuses = ['recorded', 'flagged']
      if (expStatuses.length > 0) {
        promises.push(
          supabase.from('expenses')
            .select('id', { count: 'exact', head: true })
            .neq('user_id', profile.id)
            .in('status', expStatuses)
            .then(function (res) { counts['finance.expenses'] = res.count || 0 })
        )
      }
    }

    // Purchase Orders badge
    if (hasPerm(permsNew, 'procurement.purchase_orders')) {
      if (isAdminRole) {
        // Admin: count items in queue (approved req items without PO)
        promises.push(
          supabase.from('requisition_items')
            .select('id, requisitions!inner(status)', { count: 'exact', head: true })
            .is('po_item_id', null)
            .eq('item_status', 'po_queued')
            .eq('requisitions.status', 'approved')
            .then(function (res) { counts['procurement.purchase_orders'] = res.count || 0 })
            .catch(function () {
              // FK hint fallback — just show 0
              counts['procurement.purchase_orders'] = 0
            })
        )
      } else {
        // Purchaser: count confirmed POs assigned to them
        promises.push(
          supabase.from('purchase_orders')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_to', profile.id)
            .eq('status', 'confirmed')
            .then(function (res) { counts['procurement.purchase_orders'] = res.count || 0 })
        )
      }
    }

    // Challans badge (active dispatched)
    if (hasPerm(permsNew, 'inventory.challans')) {
      promises.push(
        supabase.from('challans')
          .select('id', { count: 'exact', head: true })
          .in('status', ['dispatched', 'received'])
          .then(function (res) { counts['inventory.challans'] = res.count || 0 })
      )
    }

    // Receive badge
    if (hasPerm(permsNew, 'inventory.receive')) {
      promises.push(
        supabase.from('purchase_order_items')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'purchased')
          .then(function (res) { counts['inventory.receive'] = res.count || 0 })
      )
    }

    // Payments badge (vendors with any overdue purchase)
    if (hasPerm(permsNew, 'finance.payments')) {
      promises.push(
        supabase.from('v_vendor_ledger')
          .select('vendor_id', { count: 'exact', head: true })
          .gt('overdue_count', 0)
          .then(function (res) { counts['finance.payments'] = res.count || 0 })
      )
    }

    // Salary Payouts badge (employees unpaid ≥ 30 days)
    // Extra gate: hr.employees.salary_view required alongside finance.salary_payouts
    if (hasPerm(permsNew, 'finance.salary_payouts') && hasPerm(permsNew, 'hr.employees.salary_view')) {
      promises.push(
        supabase.from('v_employee_ledger')
          .select('employee_id', { count: 'exact', head: true })
          .gte('unpaid_since_days', 30)
          .then(function (res) { counts['finance.salary_payouts'] = res.count || 0 })
      )
    }

    await Promise.allSettled(promises)
    if (isStale && isStale()) return
    counts['procurement.requisitions'] = (counts._req_approval || 0) + (counts._req_dispatch || 0)
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
    <div className={tab === 'quote' ? "min-h-screen lg:h-screen lg:overflow-hidden" : "min-h-screen"} style={{ background: '#F8FAFC' }}>
      {/* Header — hidden on the quote screen, which carries its own topbar */}
      {tab !== 'quote' && (
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200" style={{ boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        <div className="max-w-[540px] mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {(activeGroup || tab) && (
              <button
                onClick={goBack}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: '#94A3B8' }}
                onMouseEnter={function(e){ e.currentTarget.style.background='#F3F4F6'; e.currentTarget.style.color='#111827' }}
                onMouseLeave={function(e){ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#9CA3AF' }}
              >
                ←
              </button>
            )}
            <div>
              <div className="text-base font-bold leading-tight" style={{ color: '#0F172A' }}>
                {headerTitle}
              </div>
              <div className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>Ambria</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-slate-200 rounded-full overflow-hidden">
              <button
                onClick={function () { switchLang('en') }}
                className={"px-2.5 py-1 text-[11px] font-bold transition-colors " +
                  (lang === 'en' ? "text-white" : "text-slate-400")}
                style={lang === 'en' ? { background: '#0F172A' } : {}}
              >
                EN
              </button>
              <button
                onClick={function () { switchLang('hi') }}
                className={"px-2.5 py-1 text-[11px] font-bold transition-colors " +
                  (lang === 'hi' ? "text-white" : "text-slate-400")}
                style={lang === 'hi' ? { background: '#0F172A' } : {}}
              >
                हि
              </button>
            </div>
            <a href="/"
              className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg transition-colors no-underline"
              style={{ color: '#94A3B8' }}
              onMouseEnter={function(e){ e.currentTarget.style.color='#0284C7'; e.currentTarget.style.borderColor='#BAE6FD' }}
              onMouseLeave={function(e){ e.currentTarget.style.color='#94A3B8'; e.currentTarget.style.borderColor='#E2E8F0' }}
            >
              ⌂
            </a>
            {(function () {
              var canDesktop = profile.role === 'admin'
                            || profile.role === 'auditor'
                            || (profile.desktop_permissions || []).some(function (k) { return k !== 'personal.profile' })
              if (!canDesktop) return null
              return (
                <a href="?view=admin"
                  className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg transition-colors no-underline"
                  style={{ color: '#94A3B8' }}
                  title="Switch to desktop view"
                  onMouseEnter={function(e){ e.currentTarget.style.color='#7C3AED'; e.currentTarget.style.borderColor='#DDD6FE' }}
                  onMouseLeave={function(e){ e.currentTarget.style.color='#94A3B8'; e.currentTarget.style.borderColor='#E2E8F0' }}
                >
                  🖥
                </a>
              )
            })()}
            <button
              onClick={onSignOut}
              className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg transition-colors"
              style={{ color: '#94A3B8' }}
              onMouseEnter={function(e){ e.currentTarget.style.color='#DC2626'; e.currentTarget.style.borderColor='#FECACA' }}
              onMouseLeave={function(e){ e.currentTarget.style.color='#94A3B8'; e.currentTarget.style.borderColor='#E2E8F0' }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>
      )}

      {/* User bar */}
      {tab !== 'quote' && (
      <div className="max-w-[540px] mx-auto px-4 pt-3">
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: '#111827' }}>
            {profile.name?.charAt(0) || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: '#0F172A' }}>{profile.name}</div>
            <div className="text-[11px] truncate" style={{ color: '#94A3B8' }}>{profile.email || ''}</div>
          </div>
          <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider " + (ROLE_COLORS[profile.role] || '')}>
            {profile.role}
          </span>
        </div>
      </div>
      )}

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
      <main className={tab === 'quote'
        ? "w-full lg:h-full"
        : "max-w-[540px] mx-auto px-4 py-4 pb-8"}>

        {/* Level 0: Group Cards */}
        {!activeGroup && !tab && (
          <>
            {hasPerm(permsNew, 'finance.wallet') && walletBalance !== null && (
              <button
                onClick={function () { setActiveGroup('expenses'); setTab('wallet') }}
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
                  className="relative bg-white border border-slate-200 rounded-xl p-5 flex flex-col items-center gap-2 active:scale-[0.98] transition-all"
                  style={{ boxShadow: '0 1px 4px rgba(14,165,233,.06)' }}
                  onMouseEnter={function(e){ e.currentTarget.style.borderColor='#BAE6FD'; e.currentTarget.style.boxShadow='0 4px 14px rgba(14,165,233,.12)' }}
                  onMouseLeave={function(e){ e.currentTarget.style.borderColor='#E2E8F0'; e.currentTarget.style.boxShadow='0 1px 4px rgba(14,165,233,.06)' }}
                >
                  {badge > 0 && (
                    <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                  <span className="text-2xl">{g.icon}</span>
                  <span className="text-sm font-semibold" style={{ color: '#0F172A' }}>{g.label}</span>
                </button>
              )
            })}
            {visibleGroups.length === 0 && (
              <div className="col-span-2 text-center py-12 text-sm" style={{ color: '#94A3B8' }}>
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
              var extra = null
              if (f.key === 'finance.wallet' && walletBalance !== null) {
                extra = <span className={"text-xs font-bold " + (walletBalance < 0 ? "text-red-600" : "text-green-700")}>{formatPoints(walletBalance)}</span>
              } else if (f.key === 'finance.expenses' && financeStats.expMonthCount > 0) {
                extra = <span className="text-xs font-medium" style={{ color: '#64748B' }}>{financeStats.expMonthCount + ' · ' + formatPoints(financeStats.expMonthTotal)}</span>
              } else if (f.key === 'finance.ledgers.expense' && financeStats.ledgerMonthTotal > 0) {
                extra = <span className="text-xs font-medium" style={{ color: '#64748B' }}>{formatPoints(financeStats.ledgerMonthTotal) + ' this month'}</span>
              }
              return (
                <button
                  key={f.key}
                  onClick={function () { openModule(f) }}
                  className="relative bg-white border border-slate-200 rounded-xl p-5 flex flex-col items-center gap-2 active:scale-[0.98] transition-all"
                  style={{ boxShadow: '0 1px 4px rgba(14,165,233,.06)' }}
                  onMouseEnter={function(e){ e.currentTarget.style.borderColor='#BAE6FD'; e.currentTarget.style.boxShadow='0 4px 14px rgba(14,165,233,.12)' }}
                  onMouseLeave={function(e){ e.currentTarget.style.borderColor='#E2E8F0'; e.currentTarget.style.boxShadow='0 1px 4px rgba(14,165,233,.06)' }}
                >
                  {badges[f.key] > 0 && (
                    <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {badges[f.key] > 99 ? '99+' : badges[f.key]}
                    </span>
                  )}
                  <span className="text-2xl">{f.icon}</span>
                  <span className="text-sm font-semibold" style={{ color: '#0F172A' }}>{f.label}</span>
                  {extra}
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
        {tab === 'extra_plates' && (
          <ExtraPlateCollect profile={profile} />
        )}
        {tab === 'quote' && (
          <QuoteCalculator profile={profile} onExit={goBack} onSignOut={onSignOut} />
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
        {tab === 'wallet' && (
          <Wallet profile={profile} />
        )}
        {tab === 'expenses' && (
          <Expenses profile={profile} />
        )}
        {tab === 'cost_transfers' && (
          <CostTransfers profile={profile} />
        )}
        {tab === 'ledgers' && (
          <Ledgers profile={profile} />
        )}
        {tab === 'vendor_ledger' && (
          <VendorLedger profile={profile} />
        )}
        {tab === 'payments' && (
          <Payments profile={profile} />
        )}
        {tab === 'salary_payouts' && (
          <SalaryPayouts profile={profile} />
        )}
        {tab === 'salary_ledger' && (
          <SalaryLedger profile={profile} />
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
        {tab === 'vendors' && (
          <Vendors profile={profile} />
        )}
        {tab === 'employees' && (
          <Employees profile={profile} />
        )}
        {tab === 'admin' && isAdmin && (
          <AdminMobile profile={profile} />
        )}
        {tab === 'my_profile' && (
          <MyProfile profile={profile} />
        )}
      </main>

      {/* Footer */}
      {tab !== 'quote' && (
      <footer className="text-center py-4 text-[11px] text-gray-300 tracking-wider">
        Ambria <span className="text-amber-400">●</span> Ops
      </footer>
      )}
    </div>
  )
}

export default Shell