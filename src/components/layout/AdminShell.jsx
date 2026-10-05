import { useState, useEffect, lazy, Suspense } from 'react'
import { ROLE_COLORS } from '../../lib/constants'
import { hasPerm } from '../../lib/permissions'
import { supabase } from '../../lib/supabase'
import PageWave from '../ui/PageWave'
import Logo from '../ui/Logo'
import Icon from '../ui/Icon'
import NotificationBell from '../ui/NotificationBell'
// Inventory's photograph: warm light through leaves across a pale wall,
// vases and a bowl — the ground behind the top of the Inventory section.
import inventoryBg from '../../assets/inventory-bg.webp'

// lazy(), but the importer stays reachable on the component it produced.
//
// A tab's code is only asked for once the tab is clicked, so every first visit
// pays a round trip while the button sits there doing nothing. A pointer
// arrives over a tab a good while before it presses it, which is enough time
// to have the chunk on its way — and by the time the click lands the module is
// usually already in the browser's cache, so the tab opens on the next frame.
//
// Calling load() again is free: a module that is already being fetched, or is
// already in memory, resolves from the module map without touching the network.
function lazyTab(load) {
  var C = lazy(load)
  C.load = load
  return C
}

function prefetchTab(cfg) {
  if (cfg && cfg.component && cfg.component.load) cfg.component.load()
}

var RateCardEditor = lazyTab(function () { return import('../../modules/quote/RateCardEditor') })
var Events = lazyTab(function () { return import('../../modules/events/Events') })
var ContractList = lazyTab(function () { return import('../../modules/events/ContractList') })
var ExtraPlateCollect = lazyTab(function () { return import('../../modules/events/ExtraPlateCollect') })
var AdminItems = lazyTab(function () { return import('../../modules/inventory/AdminItems') })
var Categories = lazyTab(function () { return import('../../modules/categories/Categories') })
var Users = lazyTab(function () { return import('../../modules/users/Users') })
var ActivityLogs = lazyTab(function () { return import('../../modules/logs/ActivityLogs') })
var Expenses = lazyTab(function () { return import('../../modules/expenses/Expenses') })
var Payments = lazyTab(function () { return import('../../modules/expenses/Payments') })
var Wallet = lazyTab(function () { return import('../../modules/expenses/Wallet') })
var GVLog = lazyTab(function () { return import('../../modules/expenses/GVLog') })
var Dashboard = lazyTab(function () { return import('../../modules/dashboard/Dashboard') })
var Boxes = lazyTab(function () { return import('../../modules/boxes/Boxes') })
var ProductionOrders = lazyTab(function () { return import('../../modules/production/ProductionOrders') })
var Challans = lazyTab(function () { return import('../../modules/challans/Challans') })
var Purchase = lazyTab(function () { return import('../../modules/purchase/Purchase') })
// Shell.jsx (mobile) has its own "Receive Items" tile that renders the same
// Purchase.jsx in mode="receive" — TabbedSection only ever passes the fixed
// profile/onNavigate/inAdmin props to a sub-tab's component, so this exists
// purely to pin that one extra prop. Desktop had no entry point into this at
// all: the Inventory top-level tab already gated on inventory.receive (see
// anyPerm below) but nothing was ever wired to it.
function PurchaseReceive(props) { return <Purchase {...props} mode="receive" /> }
PurchaseReceive.load = Purchase.load
var Calendar = lazyTab(function () { return import('../../modules/calendar/Calendar') })
var Vendors = lazyTab(function () { return import('../../modules/vendors/Vendors') })
var Requisitions = lazyTab(function () { return import('../../modules/requisitions/Requisitions') })
var StoreRequisitions = lazyTab(function () { return import('../../modules/requisitions/StoreRequisitions') })
var CasualRoster = lazyTab(function () { return import('../../modules/manpower/CasualRoster') })
var Analytics = lazyTab(function () { return import('../../modules/analytics/Analytics') })
var Overview = lazyTab(function () { return import('../../modules/overview/Overview') })
var JobDepartments = lazyTab(function () { return import('../../modules/employees/JobDepartments') })
var Employees = lazyTab(function () { return import('../../modules/employees/Employees') })
var RoleTemplates = lazyTab(function () { return import('../../modules/users/RoleTemplates') })
var EmployeeDocTypes = lazyTab(function () { return import('../../modules/employees/EmployeeDocTypes') })
var SalaryLedger = lazyTab(function () { return import('../../modules/employees/SalaryLedger') })
var SalaryPayouts = lazyTab(function () { return import('../../modules/expenses/SalaryPayouts') })
// Two round trips, not one: the hub arrives and only then asks for whichever
// ledger is active, so warming the hub alone would still leave the second wait
// in place. Expense is the tab it opens on, so it is fetched alongside the hub
// rather than after it.
var LedgersHub = lazyTab(function () {
  var hub = import('../../modules/expenses/LedgersHub')
  import('../../modules/expenses/Ledgers')
  return hub
})
var Projects = lazyTab(function () { return import('../../modules/projects/Projects') })
var Reviews = lazyTab(function () { return import('../../modules/reviews/Reviews') })
var BroadcastHub = lazyTab(function () { return import('../../modules/broadcast/BroadcastHub') })
var BroadcastTemplates = lazyTab(function () { return import('../../modules/broadcast/Templates') })
var BroadcastContacts = lazyTab(function () { return import('../../modules/broadcast/Contacts') })
var BroadcastLists = lazyTab(function () { return import('../../modules/broadcast/Lists') })
var BroadcastCampaigns = lazyTab(function () { return import('../../modules/broadcast/Campaigns') })
var BroadcastInbox = lazyTab(function () { return import('../../modules/broadcast/Inbox') })
var BroadcastAutoReplies = lazyTab(function () { return import('../../modules/broadcast/AutoReplies') })
var BroadcastSettings = lazyTab(function () { return import('../../modules/broadcast/Settings') })

function ExpenseTypesMaster(props) {
  return <Expenses profile={props.profile} masterMode={true} />
}

// ── Sub-tab switcher ──
// large: Inventory's tabs, which sit on a photograph — a size up, darker, with
// bigger glyphs, so they read clearly over the picture. Everywhere else the
// row keeps its ordinary size.
function SubTabs({ tabs, active, onChange, large }) {
  return (
    // overflow-y-hidden is deliberate: overflow-x-auto makes the other axis
    // compute to auto as well, and -mb-px then gives it 1px to scroll, which
    // renders as a pair of stray scrollbar arrows down the side.
    <div className={"flex mb-4 sm:mb-5 border-b overflow-x-auto overflow-y-hidden sm:overflow-x-visible sm:overflow-y-visible " + (large ? "gap-2 sm:gap-4 border-transparent" : "gap-1 border-slate-200")}>
      {tabs.map(function (t) {
        return (
          <button key={t.key} onClick={function () { onChange(t.key) }}
            // The pointer reaching the tab is the signal to fetch its code.
            // pointerenter covers a tap too — it fires on the finger landing,
            // just before pointerdown, so a touch still gets a head start.
            onPointerEnter={function () { prefetchTab(t) }}
            onFocus={function () { prefetchTab(t) }}
            className={"shrink-0 inline-flex items-center border-b-2 -mb-px whitespace-nowrap origin-bottom transform-gpu transition-all duration-150 " +
              (large
                // Inventory: packed to the left, not spread across the row.
                // Spread, the right-hand tabs sat over the vases in the
                // photograph and on its light, sunlit side where white text
                // disappeared; packed, they stay on the dark shade and leave
                // the vases clear. Bold, with a soft shadow, to read on it.
                ? "gap-2 px-3 sm:px-4 py-3 text-[14px] sm:text-[15px] font-bold [text-shadow:0_1px_3px_rgba(0,0,0,0.35)] "
                : "sm:flex-1 sm:shrink sm:justify-center gap-1.5 px-2.5 sm:px-3 py-2.5 text-[12.5px] sm:text-[13px] font-semibold ") +
              (active === t.key
                ? (large ? "border-indigo-300 text-indigo-200 " : "border-indigo-600 text-indigo-700 ")
                // The tint has rounded top corners only: the bottom edge is
                // where the underline lives, and a fully rounded pill would
                // lift the label off the rule the whole row is aligned to.
                // The grey underline previews where the indigo one will land,
                // so the row does not jump when you commit.
                // One step darker than it was. At 13px semibold on white,
                // slate-500 is a weight you glance past, and these are the
                // labels you read to find out where you are.
                : (large
                  ? "text-white border-transparent rounded-t-lg hover:text-white hover:border-white/50 hover:bg-white/10 hover:scale-[1.05]"
                  : "text-slate-600 border-transparent rounded-t-lg hover:text-slate-900 hover:border-slate-300 hover:bg-slate-900/[0.04] hover:scale-[1.05]"))}>
            {t.icon && <Icon name={t.icon} size={large ? 18 : 14} strokeWidth={large ? 2.3 : undefined} />}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

var SUB_TAB_CONFIG = {
  events: [
    { key: 'events',       label: 'Events',        icon: 'calendar', component: Events,            perm: 'events.list' },
    { key: 'contracts',    label: 'Contracts',     icon: 'fileText', component: ContractList,      perm: 'events.list' },
    { key: 'extra_plates', label: 'Extra Plates',  icon: 'utensils', component: ExtraPlateCollect, perm: 'events.extra_plate_collect' },
  ],
  inventory: [
    // No Pending Review pill: pending inventory is reviewed under Reviews.
    { key: 'items',      label: 'All Items',      icon: 'box',      component: AdminItems,       perm: 'inventory.items' },
    { key: 'production', label: 'Production',     icon: 'wrench',   component: ProductionOrders, perm: 'inventory.production' },
    { key: 'boxes',      label: 'Boxes',          icon: 'tag',      component: Boxes,            perm: 'inventory.boxes' },
    { key: 'challans',   label: 'Challans',       icon: 'truck',    component: Challans,         perm: 'inventory.challans' },
    { key: 'receive',    label: 'Receive Items',  icon: 'download', component: PurchaseReceive,  perm: 'inventory.receive' },
  ],
  masters: [
    { key: 'categories',         label: 'Categories',      icon: 'tag',        component: Categories,         perm: 'admin.masters' },
    { key: 'job_departments',    label: 'Job Departments', icon: 'users',      component: JobDepartments,     perm: 'admin.masters' },
    { key: 'ratecard',           label: 'Rate Card',       icon: 'calculator', component: RateCardEditor,     anyPerm: ['admin.masters','events.ratecard'] },
    { key: 'staff_roles',        label: 'Casual Roster',   icon: 'idCard',     component: CasualRoster,       anyPerm: ['admin.masters', 'hr.casual_roster'] },
    { key: 'expense_types',      label: 'Expense Types',   icon: 'receipt',    component: ExpenseTypesMaster, perm: 'admin.masters' },
    { key: 'employee_doc_types', label: 'Employee Docs',   icon: 'fileText',   component: EmployeeDocTypes,   perm: 'admin.masters' },
  ],
  users: [
    { key: 'users',          label: 'Users',          icon: 'users',  component: Users,         perm: 'admin.users' },
    { key: 'role_templates', label: 'Role Templates', icon: 'lock',   component: RoleTemplates, perm: 'admin.users' },
    { key: 'employees',      label: 'Employees',      icon: 'idCard', component: Employees,     perm: 'hr.employees' },
    { key: 'logs',           label: 'Activity Logs',  icon: 'clock',  component: ActivityLogs,  perm: 'admin.users' },
  ],
  procurement: [
    { key: 'requisitions', label: 'Requisitions',    icon: 'fileText', component: Requisitions, perm: 'procurement.requisitions' },
    { key: 'storereq',     label: 'Store Requisition', icon: 'box',    component: StoreRequisitions, perm: 'procurement.requisitions' },
    { key: 'purchase',     label: 'Purchase Orders', icon: 'cart',     component: Purchase,     perm: 'procurement.purchase_orders' },
    { key: 'vendors',      label: 'Vendors',         icon: 'truck',    component: Vendors,      perm: 'procurement.vendors' },
  ],
  broadcast: [
    { key: 'templates', label: 'Templates', icon: 'fileText', component: BroadcastTemplates, perm: 'broadcast.templates.view' },
    { key: 'contacts',  label: 'Contacts',  icon: 'users',    component: BroadcastContacts,  perm: 'broadcast.contacts.view' },
    { key: 'lists',     label: 'Lists',     icon: 'list',     component: BroadcastLists,     perm: 'broadcast.contacts.view' },
    { key: 'campaigns', label: 'Campaigns', icon: 'send',     component: BroadcastCampaigns, perm: 'broadcast.campaigns.view' },
    { key: 'inbox',     label: 'Inbox',     icon: 'inbox',    component: BroadcastInbox,     perm: 'broadcast.inbox.view' },
    { key: 'autoreplies', label: 'Auto-Replies', icon: 'send', component: BroadcastAutoReplies, perm: 'broadcast.settings' },
    { key: 'settings',  label: 'Settings',  icon: 'settings', component: BroadcastSettings,  perm: 'broadcast.settings' },
  ],
  expenses: [
    { key: 'wallet',         label: 'Wallet',         icon: 'wallet',     component: Wallet,         perm: 'finance.wallet' },
    { key: 'expenses',       label: 'Expenses',       icon: 'receipt',    component: Expenses,       perm: 'finance.expenses' },
    { key: 'payments',       label: 'Payments',       icon: 'transfer',   component: Payments,       perm: 'finance.payments' },
    { key: 'salary_payouts', label: 'Salary Payouts', icon: 'banknote',   component: SalaryPayouts,  perm: 'finance.salary_payouts' },
    { key: 'ledgers',        label: 'Ledgers',        icon: 'list',       component: LedgersHub,
      anyPerm: ['finance.ledgers.expense','finance.ledgers.event','finance.ledgers.vendor','finance.ledgers.salary','finance.ledgers.inventory','finance.ledgers.cost_transfer','finance.ledgers.gv'] },
  ],
}

function subTabAllowed(cfg, permsNew) {
  if (cfg.perm) return hasPerm(permsNew, cfg.perm)
  if (cfg.anyPerm) {
    for (var i = 0; i < cfg.anyPerm.length; i++) {
      if (hasPerm(permsNew, cfg.anyPerm[i])) return true
    }
    return false
  }
  return true
}

function TabbedSection({ config, profile, onNavigate, activeSubTab, deepLinkExpense, onDeepLinkHandled, onSubTabMeta, navNonce, invSubDept, onInvSubDeptChange, largeTabs, deepLinkTransferId, deepLinkContractId }) {
  var permsNew = profile.permsNew || []
  var visibleConfig = config.filter(function (c) { return subTabAllowed(c, permsNew) })

  var _initial = activeSubTab && visibleConfig.find(function (c) { return c.key === activeSubTab })
    ? activeSubTab
    : (visibleConfig.length > 0 ? visibleConfig[0].key : null)
  var [sub, setSub] = useState(_initial)

  // The breadcrumb lives in the shell, one component up, which has no way to
  // know which pill within this row is lit — so this pushes it up on every
  // change (click or deep link) and clears it again on unmount, which covers
  // navigating away to a section that has no sub-tabs at all.
  useEffect(function () {
    if (!onSubTabMeta) return
    var current = visibleConfig.find(function (c) { return c.key === sub })
    onSubTabMeta(current ? { key: current.key, label: current.label } : null)
    return function () { onSubTabMeta(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub])

  // deepLinkExpense is in the dependency list (not just activeSubTab) because a
  // deep-linked navigation always targets the same sub-tab key ('expenses') —
  // if the shell's subTab was already 'expenses' from an earlier deep link and
  // the user has since clicked into a different sub-tab by hand (which only
  // ever updates this component's own `sub` state below, never the shell's),
  // activeSubTab alone never changes value and this effect would never re-fire,
  // leaving `sub` stuck wherever it was clicked. deepLinkExpense is a fresh
  // object on every navigation, so it forces the reassertion through even when
  // activeSubTab's value happens to be unchanged.
  useEffect(function () {
    if (activeSubTab && visibleConfig.find(function (c) { return c.key === activeSubTab })) {
      setSub(activeSubTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab, deepLinkExpense, deepLinkTransferId, deepLinkContractId, navNonce])

  var _isAllowed = visibleConfig.find(function (c) { return c.key === sub }) != null
  var Active = _isAllowed ? config.find(function (c) { return c.key === sub })?.component : null

  if (visibleConfig.length === 0) {
    return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center"><p className="text-slate-400 text-sm">No access</p></div>
  }

  return (
    <div>
      <SubTabs tabs={visibleConfig} active={sub} onChange={setSub} large={largeTabs} />
      <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
        {Active && <Active profile={profile} onNavigate={onNavigate} inAdmin
          onNavigateToExpenses={function (expenseId, mode) { onNavigate('expenses', 'expenses', expenseId ? { id: expenseId, mode: mode } : null) }}
          deepLinkExpense={deepLinkExpense} onDeepLinkHandled={onDeepLinkHandled}
          deepLinkTransferId={deepLinkTransferId}
          deepLinkContractId={deepLinkContractId}
          invSubDept={invSubDept} navNonce={navNonce} onInvSubDeptChange={onInvSubDeptChange} />}
      </Suspense>
    </div>
  )
}

var ADMIN_TABS = [
  { key: 'overview',    label: 'Overview',    icon: 'home',       perm: 'admin.overview' },
  // blurb: the line under the page title. Overview and API Marketing draw
  // their own headers, so they need none here.
  { key: 'analytics',   label: 'Analytics',   icon: 'chart',      perm: 'admin.analytics',
    blurb: 'The numbers behind the operation.' },
  { key: 'inventory',   label: 'Inventory',   icon: 'box',
    blurb: 'Items, production runs, boxes and challans.',
    anyPerm: ['inventory.add','inventory.items','inventory.production','inventory.boxes','inventory.challans','inventory.receive'] },
  { key: 'events',      label: 'Events',      icon: 'calendar',
    blurb: 'Every booked event and its extra-plate collection.',
    // Gated on exactly the perms that unlock a sub-tab inside this section
    // (see SUB_TAB_CONFIG.events below) — events.quote isn't one of them:
    // Quote Calc lives only in the separate mobile Shell.jsx nav, not here.
    // Including it just showed this tab to quote-only users with nothing
    // behind it to open.
    anyPerm: ['events.list','events.extra_plate_collect'] },
  { key: 'masters',     label: 'Masters',     icon: 'settings',
    blurb: 'The lists every other screen picks from.',
    anyPerm: ['admin.masters', 'hr.casual_roster'] },
  { key: 'users',       label: 'Users',       icon: 'users',
    blurb: 'Accounts, roles, employees and the activity trail.',
    anyPerm: ['admin.users','hr.employees'] },
  { key: 'broadcast',   label: 'API Marketing', icon: 'send',
    anyPerm: ['broadcast.templates.view','broadcast.contacts.view','broadcast.campaigns.view','broadcast.inbox.view'] },
  { key: 'projects',    label: 'Projects',    icon: 'building',   perm: 'projects.view',
    blurb: 'Work in progress across the company.' },
  { key: 'reviews',     label: 'Reviews',     icon: 'star',
    blurb: 'Everything waiting on your approval.',
    anyPerm: ['review.inventory','review.item_receipts','review.expenses','review.requisitions','review.vendor_payments'] },
  { key: 'expenses',    label: 'Finance',     icon: 'creditCard',
    blurb: 'Track and manage all your financial activities in one place.',
    anyPerm: ['finance.wallet','finance.expenses','finance.payments','finance.salary_payouts','finance.cost_transfers','finance.ledgers.expense','finance.ledgers.event','finance.ledgers.vendor','finance.ledgers.salary','finance.ledgers.inventory','finance.ledgers.cost_transfer','finance.ledgers.gv'] },
  { key: 'procurement', label: 'Procurement', icon: 'cart',
    blurb: 'Requisitions, purchase orders and vendors.',
    anyPerm: ['procurement.requisitions','procurement.purchase_orders','procurement.vendors'] },
]

// ── sidebar chrome ──────────────────────────────────────────────────────
// A vertical gradient rather than one flat fill: the nav is a full-height
// column, and a single colour over 100vh reads as a dead slab. The lift
// toward the bottom is what the artwork sits in.
var SIDEBAR_GROUND = {
  background: 'linear-gradient(180deg, #0B1120 0%, #0D1424 45%, #141D35 100%)',
  // A hairline seam instead of a border, so it cannot take part in layout.
  boxShadow: 'inset -1px 0 0 rgba(148,163,184,0.10)',
}

// The active item. A gradient plus an inner top highlight makes the pill read
// as a raised object; the coloured drop shadow is what separates it from the
// near-black ground, which a flat fill at this size does not.
var ACTIVE_PILL = {
  background: 'linear-gradient(180deg, #4F46E5 0%, #4235C8 100%)',
  boxShadow: '0 8px 18px -6px rgba(79,70,229,0.75), inset 0 1px 0 rgba(255,255,255,0.18)',
}

var AVATAR_TILE = { background: 'linear-gradient(135deg, #A78BFA 0%, #6366F1 100%)' }

// Faint bands across the lower half. Purely decorative, so it is aria-hidden
// and pointer-transparent — and it is drawn as one stretched SVG rather than
// a tiled image so it scales with whatever height the viewport has.
function SidebarArt() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -bottom-24 -left-16 w-72 h-72 rounded-full ambria-glow-drift"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0) 70%)' }} />
      <svg className="absolute bottom-0 left-0 w-full h-[46%] ambria-rail-drift" viewBox="0 0 248 340"
        preserveAspectRatio="none" fill="none" stroke="rgba(203,213,225,0.13)" strokeWidth="1.25">
        <path d="M-30 330C40 268 96 196 300 92" />
        <path d="M-30 300C46 232 110 156 300 44" />
        <path d="M-30 268C52 196 124 116 300 -4" />
        <path d="M-30 236C58 160 138 76 300 -52" />
      </svg>
    </div>
  )
}

// "Vikash Anthwal" → "VA". A single-word name gets one letter rather than two
// from the same word, which reads as a typo on a two-letter avatar.
function initialsOf(name) {
  var parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

// The role column stores the short key; the sidebar has room for the word.
var ROLE_LABELS = { admin: 'Administrator', sales: 'Sales', production: 'Production', logistics: 'Logistics', auditor: 'Auditor' }
function roleLabelOf(role) {
  if (!role) return ''
  return ROLE_LABELS[role] || (role.charAt(0).toUpperCase() + role.slice(1))
}

function tabAllowed(tab, permsNew) {
  if (tab.perm) return hasPerm(permsNew, tab.perm)
  if (tab.anyPerm) {
    for (var i = 0; i < tab.anyPerm.length; i++) {
      if (hasPerm(permsNew, tab.anyPerm[i])) return true
    }
    return false
  }
  return true
}

function makeTabbedModule(configKey) {
  return function (props) {
    return <TabbedSection config={SUB_TAB_CONFIG[configKey]} profile={props.profile} onNavigate={props.onNavigate} activeSubTab={props.activeSubTab}
      deepLinkExpense={props.deepLinkExpense} onDeepLinkHandled={props.onDeepLinkHandled} onSubTabMeta={props.onSubTabMeta}
      deepLinkTransferId={props.deepLinkTransferId}
      deepLinkContractId={props.deepLinkContractId}
      navNonce={props.navNonce} invSubDept={props.invSubDept} onInvSubDeptChange={props.onInvSubDeptChange}
      largeTabs={configKey === 'inventory'} />
  }
}

var MODULES = {
  overview: Overview,
  analytics: Analytics,
  inventory: makeTabbedModule('inventory'),
  events: makeTabbedModule('events'),
  masters: makeTabbedModule('masters'),
  users: makeTabbedModule('users'),
  expenses: makeTabbedModule('expenses'),
  procurement: makeTabbedModule('procurement'),
  projects: Projects,
  reviews: Reviews,
  broadcast: BroadcastHub,
}

function AdminShell({ profile, onSignOut }) {
  var permsNew = profile.permsNew || []
  var visibleTabs = ADMIN_TABS.filter(function (t) { return tabAllowed(t, permsNew) })

  // TabbedSection only re-syncs its own `sub` state from activeSubTab when
  // that prop is truthy (see its useEffect) — passing null there is a no-op,
  // it will not snap back to the first pill. So jumping to a section's
  // landing sub-tab from the breadcrumb needs the actual key, not null.
  function defaultSubTabKey(tabKey) {
    var cfg = SUB_TAB_CONFIG[tabKey]
    if (!cfg) return null
    var visible = cfg.filter(function (c) { return subTabAllowed(c, permsNew) })
    return visible.length > 0 ? visible[0].key : null
  }

  var _defaultTab = visibleTabs.length > 0 ? visibleTabs[0].key : null
  var [active, setActive] = useState(_defaultTab)
  var [subTab, setSubTab] = useState(null)
  var [subTabMeta, setSubTabMeta] = useState(null)
  var [navOpen, setNavOpen] = useState(false)
  // Set by onNavigate's 3rd arg when a ledger screen sends the user to a
  // specific expense's edit/Raise JV view instead of just the Expenses tab.
  var [deepLinkExpense, setDeepLinkExpense] = useState(null)
  var [deepLinkTransferId, setDeepLinkTransferId] = useState(null)
  var [deepLinkContractId, setDeepLinkContractId] = useState(null)

  // Resolves a notification's `link` string — same simple string formats
  // Shell.jsx's mobile equivalent uses, since there's no URL router here either.
  function navigateFromNotification(link) {
    if (link === 'broadcast:inbox') {
      setActive('broadcast'); setSubTab('inbox'); setDeepLinkExpense(null)
    } else if (link === 'wallet' || (link && link.indexOf('wallet:') === 0)) {
      setActive('expenses'); setSubTab('wallet'); setDeepLinkExpense(null)
      setDeepLinkTransferId(link.indexOf('wallet:') === 0 ? link.slice('wallet:'.length) : null)
    } else if (link && link.indexOf('expense:') === 0) {
      setActive('expenses'); setSubTab('expenses')
      setDeepLinkExpense({ id: link.slice('expense:'.length), mode: null })
    } else if (link === 'events') {
      setActive('events'); setSubTab(null); setDeepLinkExpense(null)
    } else if (link && link.indexOf('contracts:') === 0) {
      setActive('events'); setSubTab('contracts'); setDeepLinkExpense(null)
      setDeepLinkContractId(link.slice('contracts:'.length))
    }
  }

  // Inventory's master sub-departments, listed under Inventory in the rail so
  // a sub-department is one click from the sidebar rather than a dropdown
  // inside All Items. invSubDept is the one picked ('' for all); navNonce
  // bumps on every pick so TabbedSection moves to All Items even when the
  // shell already thinks it is there (the pills change only the section's
  // own state). The list loads the first time Inventory is opened.
  var canSeeInvItems = hasPerm(permsNew, 'inventory.items')
  var [invSubDepts, setInvSubDepts] = useState(null)
  var [invSubDept, setInvSubDept] = useState('')
  var [navNonce, setNavNonce] = useState(0)
  // Whether the list under Inventory is showing. Opening Inventory opens it;
  // pressing Inventory again while it is open folds the list away and a
  // further press brings it back — the chevron on the row says which.
  var [invListOpen, setInvListOpen] = useState(true)
  // Only the sub-departments of the department marked ★ Inventory Default in
  // Masters (is_inventory_default) — the inventory master's own — not every
  // sub-department in the company. Switched-off sub-departments stay out.
  useEffect(function () {
    if (active !== 'inventory' || !canSeeInvItems || invSubDepts) return
    ;(async function () {
      var depRes = await supabase.from('departments').select('id')
        .eq('is_inventory_default', true).eq('active', true)
      var ids = (depRes.data || []).map(function (d) { return d.id })
      if (ids.length === 0) { setInvSubDepts([]); return }
      var sdRes = await supabase.from('sub_departments').select('id, name')
        .in('department_id', ids).eq('active', true).order('name')
      setInvSubDepts(sdRes.data || [])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  function pickInvSubDept(id, closeOnClick) {
    setActive('inventory')
    setSubTab('items')
    setInvSubDept(id)
    setNavNonce(function (n) { return n + 1 })
    if (closeOnClick) setNavOpen(false)
    // A new sub-department is a new list: start it from the top rather than
    // wherever the last one was scrolled to. The window is the scroller.
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }

  var _isVisible = visibleTabs.find(function (t) { return t.key === active }) != null
  var ActiveModule = _isVisible ? (MODULES[active] || null) : null
  var activeTab = ADMIN_TABS.find(function (t) { return t.key === active })

  // The breadcrumb bar has two jobs that want opposite things. At the top of
  // the page it should not be there at all — any tint of its own makes the top
  // of the page a lighter strip than the band below it. Once the page moves it
  // has to hide what is passing under it, which needs to be nearly opaque.
  //
  // So it is told which of the two it is doing. The window is the scroller —
  // the shell root is min-h-screen with no overflow of its own — so scrollY is
  // the whole of it.
  var [pageScrolled, setPageScrolled] = useState(false)
  useEffect(function () {
    function onScroll() { setPageScrolled(window.scrollY > 4) }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return function () { window.removeEventListener('scroll', onScroll) }
  }, [])
  var activeLabel = activeTab?.label || ''

  // The icon inherits currentColor, so one colour per state covers both the
  // glyph and the label and they can never drift apart.
  //
  // aria-current marks the section for a screen reader: the pill says which
  // item is active visually and nothing else did.
  function renderNavItems(closeOnClick) {
    return visibleTabs.map(function (tab) {
      var isActive = active === tab.key
      var btn = (
        <button
          key={tab.key}
          onClick={function () {
            if (tab.key === 'inventory' && canSeeInvItems) {
              if (isActive) { setInvListOpen(!invListOpen); return }
              setInvListOpen(true)
            }
            setActive(tab.key); setSubTab(null); setSubTabMeta(null); if (closeOnClick) setNavOpen(false)
          }}
          aria-expanded={tab.key === 'inventory' && canSeeInvItems ? (isActive && invListOpen) : undefined}
          aria-current={isActive ? 'page' : undefined}
          className={"group relative overflow-hidden w-full flex items-center gap-3 px-3 h-[38px] rounded-xl text-[13px] text-left transition-all duration-150 " +
            (isActive
              ? "text-white font-semibold"
              : "font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] hover:translate-x-0.5")}
          style={isActive ? ACTIVE_PILL : null}
        >
          {/* keyed on the tab, so React remounts it when the selection moves
              and the one-shot animation replays. Rendered before the label and
              left unpositioned, so the positioned icon and label paint over
              it rather than under. */}
          {isActive && (
            <span key={tab.key} aria-hidden="true"
              className="ambria-sheen absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          )}
          <span className="relative shrink-0">
            <Icon name={tab.icon} size={17} strokeWidth={isActive ? 2.05 : 1.8} />
          </span>
          <span className="relative truncate">{tab.label}</span>
          {tab.key === 'inventory' && canSeeInvItems && (
            <span aria-hidden="true" className="relative ml-auto shrink-0 opacity-80">
              <Icon name={isActive && invListOpen ? 'chevronUp' : 'chevronDown'} size={15} strokeWidth={2.2} />
            </span>
          )}
        </button>
      )
      if (tab.key !== 'inventory' || !isActive || !canSeeInvItems || !invListOpen) return btn
      return (
        <div key={tab.key}>
          {btn}
          {/* A thin rule down the left joins the list to Inventory above it.
              "All items" clears the filter; each sub-department sets it. */}
          <div className="mt-1 mb-1.5 ml-[21px] pl-2.5 border-l border-white/10 space-y-0.5">
            {[{ id: '', name: 'All Items' }].concat(invSubDepts || []).map(function (sd) {
              var on = String(invSubDept) === String(sd.id)
              return (
                <button key={sd.id || 'all'} type="button" onClick={function () { pickInvSubDept(String(sd.id), closeOnClick) }}
                  aria-current={on ? 'true' : undefined}
                  className={"group/sd w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-[12.5px] text-left transition-all duration-150 " +
                    (on ? "bg-white/10 text-white font-semibold" : "text-slate-400 hover:text-white hover:bg-white/[0.06] hover:translate-x-0.5")}>
                  {/* Same hover as the sections above — a lift of colour and a
                      half-step to the right — and the dot brightens and grows
                      with it. */}
                  <span aria-hidden="true" className={"shrink-0 w-1.5 h-1.5 rounded-full transition-all duration-150 " + (on ? "bg-indigo-300" : "bg-slate-600 group-hover/sd:bg-indigo-300 group-hover/sd:scale-125")} />
                  <span className="truncate">{sd.name}</span>
                </button>
              )
            })}
            {!invSubDepts && <p className="px-2.5 py-1.5 text-[12px] text-slate-500">Loading…</p>}
          </div>
        </div>
      )
    })
  }

  // The identity block, shared by the desktop rail and the drawer. Sign out
  // is its own full-width row under the name rather than an icon tucked
  // beside it: it is the one thing in the sidebar that ends your session, and
  // a 32px square shared a row with two lines of text that are not buttons.
  function renderUserCard() {
    return (
      <div className="relative z-10 shrink-0 px-2.5 py-2.5 border-t border-white/10 space-y-0.5">
        <div className="flex items-center gap-2.5 px-0.5 py-1">
          <span aria-hidden="true" data-notranslate
            className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-[12px] font-bold text-white"
            style={AVATAR_TILE}>
            {initialsOf(profile.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-white truncate">{profile.name}</span>
            <span className="block text-[10.5px] text-slate-400 truncate">{roleLabelOf(profile.role)}</span>
          </span>
        </div>
        <button onClick={onSignOut}
          className="w-full flex items-center gap-3 px-3 h-[34px] rounded-xl text-[12.5px] font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors">
          <span className="shrink-0"><Icon name="logout" size={16} /></span>
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar — desktop only; collapses to a drawer below md so the page
          never gets wider than the viewport on mobile.

          overflow-hidden clips the artwork to the rail. It is safe on the
          sticky element itself — only overflow on an *ancestor* breaks
          sticky — and the nav keeps its own scroller inside. */}
      <aside className="hidden md:flex w-[248px] shrink-0 flex-col sticky top-0 h-screen z-40 overflow-hidden" style={SIDEBAR_GROUND}>
        <SidebarArt />
        <div className="relative z-10 shrink-0 flex items-center gap-2.5 px-4 pt-4 pb-3.5 border-b border-white/10">
          <Logo size={32} />
          <span className="font-display text-white text-[15px] font-extrabold tracking-[-0.02em] truncate">Ambria Ops</span>
        </div>
        {/* overflow-x-hidden: with overflow-y auto, the other axis computes to
            auto too, so the 2px hover nudge on a row overflowed sideways and
            the rail scrolled under a resting mouse. overscroll-contain keeps
            a wheel at the rail's end from scrolling the page behind it. */}
        <nav className="relative z-10 flex-1 min-h-0 px-2.5 py-3 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain ambria-thin-scroll">
          {renderNavItems(false)}
        </nav>
        {renderUserCard()}
      </aside>


      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-3 py-2.5" style={SIDEBAR_GROUND}>
        <button onClick={function () { setNavOpen(true) }} aria-label="Open menu"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-white hover:bg-white/10 transition-colors">
          <Icon name="menu" size={19} />
        </button>
        <span className="text-white text-sm font-bold truncate">{subTabMeta ? subTabMeta.label : (activeLabel || 'Ambria Ops')}</span>
        <span className="w-9" />
      </div>

      {/* Mobile off-canvas nav drawer */}
      {navOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="relative w-64 max-w-[80vw] h-full flex flex-col overflow-hidden" style={SIDEBAR_GROUND}>
            <SidebarArt />
            <div className="relative z-10 shrink-0 px-4 pt-4 pb-3.5 border-b border-white/10 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <Logo size={32} />
                <span className="font-display text-white text-[15px] font-extrabold tracking-[-0.02em] truncate">Ambria Ops</span>
              </div>
              <button onClick={function () { setNavOpen(false) }} aria-label="Close menu"
                className="shrink-0 -mr-1 inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                <Icon name="close" size={17} />
              </button>
            </div>
            <nav className="relative z-10 flex-1 min-h-0 px-2.5 py-3 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain ambria-thin-scroll">
              {renderNavItems(true)}
            </nav>
            {renderUserCard()}
          </div>
          <div className="flex-1 bg-black/40" onClick={function () { setNavOpen(false) }} />
        </div>
      )}

      {/* The content column owns the top bar and the page below it.

          --app-header-h tells anything inside how much chrome sits above it:
          the expense form's sticky tab bar parks under the bar instead of
          behind it, and BroadcastHub's full-height layout subtracts it rather
          than overflowing by exactly the bar's height. */}
      <div className="relative isolate flex-1 min-w-0 flex flex-col" style={{ '--app-header-h': '3.5rem' }}>
        {/* The two sections that carry artwork, drawn here rather than inside
            each module.

            API Marketing used to draw its own, from inside <main> — which is
            below this bar, so the bar stayed a white strip across a tinted
            page no matter how transparent it was made. Nothing inside main can
            reach above it; the column can.

            On the other sections it would be decoration nobody asked for,
            sitting behind dense tables where a calm ground matters more. */}
        {(active === 'expenses' || active === 'broadcast') && <PageWave offset="var(--app-header-h, 0px)" />}

        {/* Inventory's ground: the photograph behind the whole section — a
            pale wall, leaf shadows, vases on a ledge at the top right — drawn
            at the column's full width and continued below its foot in the
            picture's own last colour, so a long page never shows an edge. The
            picture is light enough by itself that nothing needs washing out. */}
        {active === 'inventory' && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" style={{ backgroundColor: '#F2EAE5' }}>
            {/* The photograph pinned to the top-right corner at a fixed height,
                not stretched across the column: at full width it grew so tall
                that the vases ran down behind the tabs and the toolbar. At
                500px they finish above the toolbar, clear. Its left and
                bottom edges fade into the wall colour behind it, so it has no
                edge of its own. */}
            <div className="absolute right-0 top-0 h-[500px] aspect-[2000/1127]"
              style={{
                backgroundImage: 'url(' + inventoryBg + ')',
                backgroundSize: 'cover',
                backgroundPosition: 'right top',
                WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%), linear-gradient(180deg, #000 62%, transparent 100%)',
                WebkitMaskComposite: 'source-in',
                maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%), linear-gradient(180deg, #000 62%, transparent 100%)',
                maskComposite: 'intersect',
              }} />
            {/* A slate-indigo shade over the top left, easing off toward the
                sunlit right (where the vases are) and down toward the cards.
                The heading, breadcrumb and tabs sit on it in white; the
                toolbar and cards below it stay on the light picture. */}
            <div className="absolute inset-x-0 top-0 h-[360px]"
              style={{
                background: 'linear-gradient(100deg, rgba(34,41,70,0.86) 0%, rgba(52,60,94,0.74) 34%, rgba(78,84,116,0.3) 55%, rgba(78,84,116,0) 70%)',
                WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 58%, transparent 100%)',
                maskImage: 'linear-gradient(180deg, #000 0%, #000 58%, transparent 100%)',
              }} />
          </div>
        )}

        {/* Desktop only — the phone gets the fixed bar further down, which
            carries the drawer trigger this one has no need for.

            Glass, and barely that: the page ground runs behind it, so any tint
            of its own makes the top of the page a lighter strip than the band
            below it — two surfaces where there is one page. At 40% white with a
            border under it, that strip and the line across it were the first
            things you saw. 20% and no border is enough to mute what scrolls
            underneath without becoming a surface of its own; the blur does the
            rest of that work. */}
        {/* Nothing of its own until the page moves, then frosted. Any tint at
            rest makes the top of the page a lighter strip than the band below
            it, which reads as two surfaces; once the page moves it has to hide
            what is passing underneath. */}
        <div className={(pageScrolled
          ? 'bg-white/55 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_1px_12px_rgba(15,23,42,0.06)] '
          : '') +
          "hidden md:flex sticky top-0 z-30 shrink-0 h-14 items-center justify-between gap-4 px-8 transition-colors duration-200"}>
          {/* The sub-tab segment only appears once a tabbed section reports
              which pill within it is lit (see TabbedSection's onSubTabMeta) —
              sections with no sub-tabs (Overview, Analytics, Projects, ...)
              never set it, so the trail stops at the section for those. */}
          {/* On Inventory's shade the trail is white; once the page scrolls
              and the bar frosts white, it goes back to ink. */}
          <nav aria-label="Breadcrumb" className={"flex items-center gap-2 min-w-0 text-[13px] " + (active === 'inventory' && !pageScrolled ? "ambria-crumbs-light" : "")}>
            <button
              onClick={function () {
                var home = visibleTabs.find(function (t) { return t.key === 'overview' }) || visibleTabs[0]
                if (!home) return
                setActive(home.key); setSubTab(null); setSubTabMeta(null)
              }}
              aria-label="Home" className="text-slate-400 hover:text-indigo-600 transition-colors">
              <Icon name="home" size={15} />
            </button>
            <span className="text-slate-300" aria-hidden="true">/</span>
            {subTabMeta ? (
              <button
                onClick={function () { setSubTab(defaultSubTabKey(active)); setSubTabMeta(null) }}
                className="text-slate-500 hover:text-indigo-600 font-medium truncate transition-colors">
                {activeLabel}
              </button>
            ) : (
              <span className="font-semibold text-slate-900 truncate">{activeLabel}</span>
            )}
            {subTabMeta && (
              <>
                <span className="text-slate-300" aria-hidden="true">/</span>
                <span className="font-semibold text-slate-900 truncate">{subTabMeta.label}</span>
              </>
            )}
          </nav>
          <NotificationBell profile={profile} onNavigate={navigateFromNotification} />
        </div>

      {/* Content. relative isolate + a full-height flex item is what
          PageBackdrop needs: something at least a screen tall to cover, and a
          stacking context so its -z-10 does not fall behind the page. The
          sidebar is sticky at z-40, so it stays above this context. */}
      <main className="relative flex-1 min-w-0 px-4 py-4 pt-[4.5rem] md:px-8 md:py-6 md:pt-6">
        {/* Overview and API Marketing draw their own page headers, with an
            icon and a line of context this generic one cannot carry. */}
        {active !== 'overview' && active !== 'broadcast' && activeTab && (
          <div className="flex items-start justify-between gap-3 sm:gap-4 mb-4 sm:mb-5">
            <div className="flex items-center sm:items-start gap-2.5 sm:gap-3 min-w-0">
              <span aria-hidden="true" className={"shrink-0 inline-flex items-center justify-center text-indigo-600 " +
                (active === 'inventory'
                  ? "w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white shadow-[0_6px_18px_-4px_rgba(15,23,42,0.35)]"
                  : "w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-indigo-100")}>
                <Icon name={activeTab.icon} className="w-[22px] h-[22px] sm:w-[30px] sm:h-[30px]" strokeWidth={2.1} />
              </span>
              <div className="min-w-0">
                {/* Inventory's title is set in a serif, larger — the section
                    has a photograph behind it and the heading reads as its
                    masthead. Every other section keeps the display face. */}
                <h2 className={active === 'inventory'
                  ? "font-serif text-[26px] sm:text-[36px] font-bold text-white tracking-[-0.01em] leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                  : "font-display text-[20px] sm:text-[23px] font-extrabold text-slate-900 tracking-[-0.025em] leading-tight"}>{activeLabel}</h2>
                {activeTab.blurb && (
                  <p className={"hidden sm:block leading-snug line-clamp-2 " + (active === 'inventory' ? "text-[14px] text-white/85 mt-2" : "text-[12.5px] text-slate-500 mt-0.5")}>{activeTab.blurb}</p>
                )}
              </div>
            </div>
            {/* A slot for the section's own header controls. A module that
                wants something up here (Inventory's search and Add Item)
                portals it in; the rest leave it empty. */}
            <div id="admin-page-header-slot" className="flex items-center gap-3 min-w-0" />
          </div>
        )}
        {ActiveModule && (
          <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
            <ActiveModule profile={profile}
              onNavigate={function (tab, sub, deepLink) { setActive(tab); setSubTab(sub || null); setDeepLinkExpense(deepLink || null) }}
              activeSubTab={subTab} inAdmin
              deepLinkExpense={deepLinkExpense}
              onDeepLinkHandled={function () { setDeepLinkExpense(null) }}
              deepLinkTransferId={deepLinkTransferId}
              deepLinkContractId={deepLinkContractId}
              onSubTabMeta={setSubTabMeta}
              navNonce={navNonce} invSubDept={invSubDept} onInvSubDeptChange={setInvSubDept} />
          </Suspense>
        )}
        {!ActiveModule && (
          <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-sm">{active} — coming soon</p>
          </div>
        )}
      </main>
      </div>
    </div>
  )
}

export default AdminShell