import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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
import Projects from '../../modules/projects/Projects'
import Reviews from '../../modules/reviews/Reviews'
import BroadcastHub from '../../modules/broadcast/BroadcastHub.jsx'
import { hasPerm } from '../../lib/permissions'

var GROUPS = [
  {
    key: 'me', label: 'My Profile', icon: 'idCard', items: [
      { key: 'personal.profile', label: 'My Profile', icon: 'idCard', tab: 'my_profile' },
    ]
  },
  {
    key: 'inventory', label: 'Inventory', icon: 'box', items: [
      { key: 'inventory.add', label: 'Add Item', icon: 'edit', tab: 'add' },
      { key: 'inventory.items', label: 'Item List', icon: 'fileText', tab: 'my' },
      { key: 'inventory.production', label: 'Production', icon: 'wrench', tab: 'production' },
      { key: 'inventory.boxes', label: 'Boxes', icon: 'box', tab: 'boxes' },
    ]
  },
  {
    // All 6 items point at the same unified 'reviews' tab — the group is visible if the
    // user has ANY one of the domain permissions (the existing visibleGroups filter already
    // does this "union" for free), and however many are visible, Reviews.jsx itself decides
    // which domain tab to open first. The old review.dept/review.pending tabs (dept_review/
    // pending_review) are left rendering below, unreached from this nav, until Phase 8.
    key: 'review', label: 'Review', icon: 'checkCircle', items: [
      { key: 'review.inventory',       label: 'Inventory Review',       icon: 'box', tab: 'reviews' },
      { key: 'review.item_receipts',   label: 'Item Receipts Review',   icon: 'receipt', tab: 'reviews' },
      { key: 'review.expenses',        label: 'Expenses Review',        icon: 'banknote', tab: 'reviews' },
      { key: 'review.requisitions',    label: 'Requisitions Review',    icon: 'inbox', tab: 'reviews' },
      { key: 'review.vendor_payments', label: 'Vendor Payments Review', icon: 'creditCard', tab: 'reviews' },
      { key: 'review.masters',         label: 'Category/Sub-category Review', icon: 'tag', tab: 'reviews' },
    ]
  },
  {
    key: 'events', label: 'Events', icon: 'calendar', items: [
      { key: 'events.list', label: 'Events', icon: 'calendar', tab: 'events' },
      { key: 'events.quote', label: 'Quote Calc', icon: 'calculator', tab: 'quote' },
      { key: 'events.ratecard', label: 'Rate Card', icon: 'tag', tab: 'ratecard' },
      { key: 'events.extra_plate_collect', label: 'Extra Plates', icon: 'utensils', tab: 'extra_plates' },
    ]
  },
  {
    key: 'procurement', label: 'Procurement', icon: 'cart', items: [
      { key: 'procurement.requisitions', label: 'Requisitions', icon: 'inbox', tab: 'requisitions' },
      { key: 'procurement.purchase_orders', label: 'Purchase Orders', icon: 'cart', tab: 'purchase' },
      { key: 'procurement.vendors', label: 'Vendors', icon: 'building', tab: 'vendors' },
    ]
  },
  {
    key: 'logistics', label: 'Logistics', icon: 'truck', items: [
      { key: 'inventory.receive', label: 'Receive Items', icon: 'download', tab: 'receive' },
      { key: 'inventory.challans', label: 'Challans', icon: 'truck', tab: 'challans' },
    ]
  },
  {
    key: 'projects', label: 'Projects', icon: 'wrench', items: [
      { key: 'projects.view', label: 'Projects', icon: 'wrench', tab: 'projects' },
    ]
  },
  {
    key: 'expenses', label: 'Finance', icon: 'wallet', items: [
      { key: 'finance.wallet', label: 'Wallet', icon: 'wallet', tab: 'wallet' },
      { key: 'finance.expenses', label: 'PC & Direct Expenses', icon: 'banknote', tab: 'expenses' },
      { key: 'finance.cost_transfers', label: 'Cost Transfers', icon: 'transfer', tab: 'cost_transfers' },
      { key: 'finance.ledgers.expense', label: 'Expense Ledger', icon: 'fileText', tab: 'ledgers' },
      { key: 'finance.payments', label: 'Payments', icon: 'creditCard', tab: 'payments' },
      { key: 'finance.salary_payouts', label: 'Salary Payouts', icon: 'bank', tab: 'salary_payouts' },
      { key: 'finance.ledgers.vendor', label: 'Vendor Ledger', icon: 'building', tab: 'vendor_ledger' },
    ]
  },
  {
    key: 'hr', label: 'HR', icon: 'users', items: [
      { key: 'hr.employees', label: 'Employees', icon: 'user', tab: 'employees' },
      { key: 'finance.ledgers.salary', label: 'Salary Ledger', icon: 'fileText', tab: 'salary_ledger' },
    ]
  },
  {
    // All 4 view perms point at the same 'broadcast' tab — BroadcastHub.jsx
    // owns the sub-nav, same pattern as the Review group above. `sub` is which
    // of its pages the tile means; without it every tile landed on Templates.
    // broadcast.quicksend is deliberately NOT listed here — sales-only users
    // shouldn't see this tile; they reach QuickSend from inline contexts only.
    key: 'broadcast', label: 'API Marketing', icon: 'send', items: [
      { key: 'broadcast.templates.view', label: 'Templates', icon: 'fileText', tab: 'broadcast', sub: 'templates' },
      { key: 'broadcast.contacts.view',  label: 'Contacts',  icon: 'users', tab: 'broadcast', sub: 'contacts' },
      { key: 'broadcast.campaigns.view', label: 'Campaigns', icon: 'send', tab: 'broadcast', sub: 'campaigns' },
      { key: 'broadcast.inbox.view',     label: 'Inbox',     icon: 'inbox', tab: 'broadcast', sub: 'inbox' },
    ]
  },
  {
    key: 'admin', label: 'Admin', icon: 'settings', items: [
      { key: 'admin.dashboard', label: 'Admin', icon: 'settings', tab: 'admin' },
    ]
  },
]

import { pushBack, goBack as navBack } from '../../lib/backNav'
import { formatPoints } from '../../lib/format'
import Icon from '../ui/Icon'
import PageBackdrop from '../ui/PageBackdrop'
import PageWave from '../ui/PageWave'

function Shell({ profile, onSignOut }) {
  var [activeGroup, setActiveGroup] = useState(null)
  var [tab, setTab] = useState(null)
  // Which page inside a tab a tile asked for. Only the API Marketing group
  // uses it today; a tile without `sub` clears it, so the module falls back to
  // its own first page.
  var [subTab, setSubTab] = useState(null)
  // Set by navigateToExpenses when a ledger screen sends the user to a specific
  // expense's edit/Raise JV view instead of just the Expenses tab.
  var [deepLinkExpense, setDeepLinkExpense] = useState(null)
  var [menuOpen, setMenuOpen] = useState(false)
  var [menuPos, setMenuPos] = useState(null)
  var menuBtnRef = useRef(null)
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
      .then(function (res) {
        // Leaving walletBalance null hides the card entirely, which is honest:
        // showing "0 pts" for a failed read or a missing wallet row was not.
        if (res.error) { console.error('WALLET_FETCH_FAIL', res.error); setWalletBalance(null); return }
        if (!res.data) { console.warn('WALLET_MISSING for user', profile.id); setWalletBalance(null); return }
        setWalletBalance(res.data.balance_paise || 0)
      })
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
    pushBack(function () { setTab(null); setSubTab(null) })
    setTab(item.tab)
    setSubTab(item.sub || null)
  }

  // Lets a ledger/wallet screen send the user to Finance > PC & Direct Expenses
  // (e.g. "Edit"/"Raise JV" on an expense opened from a read-only ledger row,
  // which has no editing UI of its own) instead of just telling them to go there.
  // expenseId + mode ('edit' | 'gv') deep-link straight into that expense's
  // edit form or Raise JV view once Expenses.jsx mounts there.
  function navigateToExpenses(expenseId, mode) {
    var fromGroup = activeGroup, fromTab = tab, fromSub = subTab
    pushBack(function () { setActiveGroup(fromGroup); setTab(fromTab); setSubTab(fromSub) })
    setActiveGroup('expenses'); setTab('expenses'); setSubTab(null)
    setDeepLinkExpense(expenseId ? { id: expenseId, mode: mode } : null)
  }

  // Current group object
  var currentGroup = activeGroup ? visibleGroups.find(function (g) { return g.key === activeGroup }) : null

  // Header title
  var headerTitle = 'Ambria Ops'
  if (tab === 'reviews') {
    // The 'review' group's items all point at this one tab (domain switching now happens
    // inside Reviews.jsx itself), so picking a per-item label here would be arbitrary —
    // just label the page for what it is.
    headerTitle = 'Reviews'
  } else if (tab === 'broadcast') {
    // Same situation as 'reviews' above — all 4 items share this tab, sub-nav is internal.
    headerTitle = 'API Marketing'
  } else if (tab && currentGroup) {
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

    // Reviews badge — one query against v_review_queue (RLS-scoped to what this user
    // can see), split back out per domain key so groupBadge's per-item sum lands on
    // whichever of the 5 review.* keys this user actually holds. expense/vendor_payment
    // never appear in v_review_queue (read-only audit domains, no pending state) so
    // their keys are left at 0 deliberately, not fetched.
    if (hasPerm(permsNew, 'review.inventory') || hasPerm(permsNew, 'review.item_receipts') || hasPerm(permsNew, 'review.requisitions')) {
      promises.push(
        supabase.from('v_review_queue').select('domain').then(function (res) {
          var byDomain = { inventory: 0, item_receipt: 0, requisition: 0 }
          ;(res.data || []).forEach(function (r) { if (byDomain[r.domain] != null) byDomain[r.domain] += 1 })
          counts['review.inventory'] = byDomain.inventory
          counts['review.item_receipts'] = byDomain.item_receipt
          counts['review.requisitions'] = byDomain.requisition
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

    // Projects badge (pending approval — only nudge users who can actually approve)
    if (hasPerm(permsNew, 'projects.approve')) {
      promises.push(
        supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'pending')
          .then(function (res) { counts['projects.view'] = res.count || 0 })
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

  // No background colour on the root div: body owns the canvas now, so every
  // screen agrees on one ground instead of each hard-coding its own hex.
  // Every menu page — the home grid and each group's tile page — plus the
  // PC & Direct Expenses screen, which was designed against this backdrop.
  // Opening any other tile sets `tab` and the artwork stops: those screens are
  // dense lists, where a calm ground matters more than a patterned one.
  var pageArt = !tab || tab === 'expenses'
  var waveArt = tab === 'broadcast'

  return (
    <div className={"relative isolate " + (tab === 'quote' ? "min-h-screen lg:h-screen lg:overflow-hidden" : "min-h-screen")}
      style={{ '--app-header-h': tab !== 'quote' ? '3.5rem' : '0px' }}>
      {pageArt && <PageBackdrop />}
      {waveArt && <PageWave />}
      {/* Header — hidden on the quote screen, which carries its own topbar */}
      {/* backdrop-blur is safe here now: the menu's click-outside overlay is
          portalled to <body>, so it is no longer a fixed child of this header
          for backdrop-filter's containing block to capture. */}
      {tab !== 'quote' && (
      <header className={"sticky top-0 z-40 border-b " + (pageArt || waveArt ? "bg-white/70 backdrop-blur-md border-white/60" : "bg-white border-slate-200")}>
        <div className="max-w-[540px] mx-auto h-14 flex items-center gap-2 px-3">
          {(activeGroup || tab) && (
            <button
              onClick={goBack}
              aria-label="Back"
              className="-ml-1 w-9 h-9 shrink-0 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all"
            >
              <Icon name="arrowLeft" className="w-[18px] h-[18px]" />
            </button>
          )}

          {/* min-w-0 + truncate is what stops a long label like "PC & Direct
              Expenses" from wrapping the header onto a second line */}
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-bold text-slate-900 leading-tight tracking-[-0.01em] truncate">
              {headerTitle}
            </h1>
            {!activeGroup && !tab && (
              <p className="text-[11px] font-medium text-slate-500 leading-tight">Ambria</p>
            )}
          </div>

          {hasPerm(permsNew, 'finance.wallet') && walletBalance !== null && tab !== 'wallet' && (
            <button
              onClick={function () {
                var fromGroup = activeGroup, fromTab = tab, fromSub = subTab
                pushBack(function () { setActiveGroup(fromGroup); setTab(fromTab); setSubTab(fromSub) })
                setActiveGroup('expenses'); setTab('wallet'); setSubTab(null)
              }}
              aria-label={'Wallet balance ' + formatPoints(walletBalance) + (walletPending > 0 ? ', ' + walletPending + ' pending' : '')}
              className={"relative shrink-0 h-8 pl-2 pr-2.5 inline-flex items-center gap-1.5 rounded-lg border text-[11.5px] font-bold tabular-nums active:scale-95 transition-all " +
                (walletBalance < 0
                  ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100")}
            >
              <Icon name="wallet" className="w-[14px] h-[14px]" />
              <span data-notranslate>{formatPoints(walletBalance)}</span>
              {walletPending > 0 && (
                <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white" />
              )}
            </button>
          )}

          {/* Language stays on the bar — it is toggled often enough to earn the width */}
          <div className="flex h-8 shrink-0 bg-slate-100 rounded-lg p-0.5">
            {[{ code: 'en', label: 'EN' }, { code: 'hi', label: 'हिं' }].map(function (l) {
              var on = lang === l.code
              return (
                <button
                  key={l.code}
                  onClick={function () { switchLang(l.code) }}
                  aria-pressed={on}
                  className={"px-2 rounded-md text-[11.5px] font-bold leading-none transition-colors " +
                    (on ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900")}
                  style={l.code === 'hi' ? { fontFamily: '"Nirmala UI","Noto Sans Devanagari",sans-serif' } : {}}
                >
                  {l.label}
                </button>
              )
            })}
          </div>

          {/* Home / desktop / sign-out fold into one menu. Four separate
              controls ate the width the title needed. */}
          <div className="relative shrink-0">
            <button
              ref={menuBtnRef}
              onClick={function () {
                if (!menuOpen) {
                  var rect = menuBtnRef.current.getBoundingClientRect()
                  setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
                }
                setMenuOpen(!menuOpen)
              }}
              aria-label="More options"
              aria-expanded={menuOpen}
              className={"w-9 h-9 flex items-center justify-center rounded-xl transition-all active:scale-95 " +
                (menuOpen ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}
            >
              <Icon name="more" className="w-[18px] h-[18px]" />
            </button>
            {menuOpen && menuPos && createPortal(
              <>
                {/* Portalled together with the menu itself, not just this backdrop —
                    the header's backdrop-filter (frosted glass) makes it a stacking
                    context, and a menu left behind inside that context painted BELOW
                    this body-level backdrop despite its higher z-index, so every click
                    on Home/Desktop/Sign out was swallowed by the backdrop instead. */}
                <div className="fixed inset-0 z-30" onClick={function () { setMenuOpen(false) }} />
                <div className="fixed z-50 w-56 pb-1 bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] overflow-hidden"
                  style={{ top: menuPos.top, right: menuPos.right }}>
                  {/* Who you are. This was a card on the home screen, spending
                      ~60px of the phone's first screenful on something you
                      check once a week — and it belongs beside Sign out, which
                      is the one action that needs you to be sure whose account
                      you are in.

                      No email: one account per person, the name already says
                      which, and the address was the longest string in a column
                      540px wide.

                      Not a button. Nothing here is tappable — the profile
                      screen lives under Personal, not behind the avatar. */}
                  <div className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-50/70 border-b border-slate-100">
                    <span className="w-8 h-8 shrink-0 rounded-full bg-slate-900 flex items-center justify-center text-[12px] font-bold text-white">
                      {profile.name?.charAt(0) || '?'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-900 leading-snug truncate">{profile.name}</span>
                      <span className={"inline-block mt-1 text-[9.5px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider " + (ROLE_COLORS[profile.role] || '')}>
                        {profile.role}
                      </span>
                    </span>
                  </div>
                  {/* The landing site, not the app root. href="/" happened to
                      reach it on GitHub Pages, where the app is served from
                      /ambria-ops/ under the same user site — but it broke on a
                      dev server and would break again behind any other host or
                      a custom domain. Absolute, so it means the same thing
                      everywhere. */}
                  <a
                    href="https://finance381.github.io/"
                    className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 no-underline"
                  >
                    <Icon name="home" className="w-4 h-4 text-slate-400" />
                    Home
                  </a>
                  {(function () {
                    var canDesktop = profile.role === 'admin'
                                  || profile.role === 'auditor'
                                  || (profile.desktop_permissions || []).some(function (k) { return k !== 'personal.profile' })
                    if (!canDesktop) return null
                    return (
                      <a
                        href="?view=admin"
                        className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 no-underline"
                      >
                        <Icon name="monitor" className="w-4 h-4 text-slate-400" />
                        Desktop view
                      </a>
                    )
                  })()}
                  <div className="h-px bg-slate-100 my-1" />
                  <button
                    onClick={function () { setMenuOpen(false); onSignOut() }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-medium text-red-600 hover:bg-red-50"
                  >
                    <Icon name="logout" className="w-4 h-4" />
                    Sign out
                  </button>
                </div>
              </>,
              document.body
            )}
          </div>
        </div>
      </header>
      )}

      {/* The user bar that used to sit here is now the first row of the ⋯
          menu — same three facts minus the email, none of the vertical cost
          on the screen you look at most. */}

      {/* Success banner */}
      {showSuccess && (
        <div className="max-w-[540px] mx-auto px-4 pt-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5">
            <Icon name="checkCircle" className="w-[18px] h-[18px] shrink-0 text-emerald-600" />
            <span className="text-[13px] font-semibold text-emerald-800">Item submitted successfully</span>
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
          {/* The wallet card that used to head this screen is the chip on
              the bar now — visible everywhere instead of only here. */}
          <div className="grid grid-cols-2 auto-rows-fr gap-3 pt-2">
            {visibleGroups.map(function (g) {
              var badge = groupBadge(g)
              return (
                <button
                  key={g.key}
                  onClick={function () { openGroup(g) }}
                  className="relative ambria-glass-card rounded-2xl p-5 flex flex-col items-center justify-center gap-2 hover:bg-white/70 hover:shadow-[0_6px_20px_rgba(79,70,229,0.12)] active:scale-[0.98] transition-all"
                >
                  {badge > 0 && (
                    <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                  <Icon name={g.icon} className="w-6 h-6 text-slate-700" strokeWidth={1.7} />
                  <span className="text-[13px] font-semibold text-slate-900 text-center leading-snug">{g.label}</span>
                </button>
              )
            })}
            {visibleGroups.length === 0 && (
              <div className="col-span-2 text-center py-12 text-[13px] font-medium text-slate-500">
                No features assigned. Contact admin.
              </div>
            )}
          </div>
          </>
        )}

        {/* Level 1: Sub-Cards within a group */}
        {activeGroup && !tab && currentGroup && (
          /* auto-rows-fr: every row takes the height of the tallest tile in
             the grid, so a two-line label or an extra stat line does not make
             one row taller than the next. No fixed height — the tiles resize
             themselves if a label or a figure ever grows. */
          <div className="grid grid-cols-2 auto-rows-fr gap-3 pt-2">
            {currentGroup.items.map(function (f) {
              var extra = null
              if (f.key === 'finance.wallet' && walletBalance !== null) {
                extra = <span className={"text-xs font-bold " + (walletBalance < 0 ? "text-red-600" : "text-green-700")}>{formatPoints(walletBalance)}</span>
              } else if (f.key === 'finance.expenses' && financeStats.expMonthCount > 0) {
                extra = <span className="text-[11.5px] font-medium text-slate-500 tabular-nums">{financeStats.expMonthCount + ' · ' + formatPoints(financeStats.expMonthTotal)}</span>
              } else if (f.key === 'finance.ledgers.expense' && financeStats.ledgerMonthTotal > 0) {
                extra = <span className="text-[11.5px] font-medium text-slate-500 tabular-nums">{formatPoints(financeStats.ledgerMonthTotal) + ' this month'}</span>
              }
              return (
                <button
                  key={f.key}
                  onClick={function () { openModule(f) }}
                  /* Frosted: every menu page has artwork behind it now, and
                     opaque white cards would blank it out in rectangles. Hover
                     deepens the glass rather than adding a border, which on a
                     patterned ground reads as noise. */
                  className="relative ambria-glass-card rounded-2xl p-5 flex flex-col items-center justify-center gap-2 hover:bg-white/70 hover:shadow-[0_6px_20px_rgba(79,70,229,0.12)] active:scale-[0.98] transition-all"
                >
                  {badges[f.key] > 0 && (
                    <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {badges[f.key] > 99 ? '99+' : badges[f.key]}
                    </span>
                  )}
                  <Icon name={f.icon} className="w-6 h-6 text-slate-700" strokeWidth={1.7} />
                  <span className="text-[13px] font-semibold text-slate-900 text-center leading-snug">{f.label}</span>
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
        {tab === 'reviews' && (
          <Reviews profile={profile} />
        )}
        {tab === 'broadcast' && (
          <BroadcastHub profile={profile} activeSubTab={subTab} />
        )}
        {tab === 'requisitions' && (
          <Requisitions profile={profile} onBack={goBack} />
        )}
        {tab === 'wallet' && (
          <Wallet profile={profile} onNavigateToExpenses={navigateToExpenses} />
        )}
        {tab === 'expenses' && (
          <Expenses profile={profile} deepLinkExpense={deepLinkExpense} onDeepLinkHandled={function () { setDeepLinkExpense(null) }} />
        )}
        {tab === 'cost_transfers' && (
          <CostTransfers profile={profile} />
        )}
        {tab === 'ledgers' && (
          <Ledgers profile={profile} onNavigateToExpenses={navigateToExpenses} />
        )}
        {tab === 'vendor_ledger' && (
          <VendorLedger profile={profile} onNavigateToExpenses={navigateToExpenses} />
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
        {tab === 'projects' && (
          <Projects profile={profile} />
        )}
      </main>

      {/* Footer — home screen only. Inside a module it is decoration that sits
          below the action bar and reads as a gap. */}
      {!activeGroup && !tab && (
      /* slate-400, not 300: the home screen has artwork behind it now, and
         the lightest grey in the scale disappeared into the pattern. */
      <footer className="text-center py-4 text-[11px] text-slate-400 tracking-wider">
        Ambria <span className="text-amber-400">●</span> Ops
      </footer>
      )}
    </div>
  )
}

export default Shell