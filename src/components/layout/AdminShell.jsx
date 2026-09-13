import { useState, useEffect, lazy, Suspense } from 'react'
import { ROLE_COLORS } from '../../lib/constants'
import { hasPerm } from '../../lib/permissions'
import PageWave from '../ui/PageWave'
import Logo from '../ui/Logo'
import Icon from '../ui/Icon'

var RateCardEditor = lazy(function () { return import('../../modules/quote/RateCardEditor') })
var PendingReview = lazy(function () { return import('../../modules/categories/PendingReview') })
var Events = lazy(function () { return import('../../modules/events/Events') })
var ExtraPlateCollect = lazy(function () { return import('../../modules/events/ExtraPlateCollect') })
var AdminItems = lazy(function () { return import('../../modules/inventory/AdminItems') })
var Categories = lazy(function () { return import('../../modules/categories/Categories') })
var Users = lazy(function () { return import('../../modules/users/Users') })
var ActivityLogs = lazy(function () { return import('../../modules/logs/ActivityLogs') })
var Expenses = lazy(function () { return import('../../modules/expenses/Expenses') })
var Payments = lazy(function () { return import('../../modules/expenses/Payments') })
var Wallet = lazy(function () { return import('../../modules/expenses/Wallet') })
var GVLog = lazy(function () { return import('../../modules/expenses/GVLog') })
var Dashboard = lazy(function () { return import('../../modules/dashboard/Dashboard') })
var Boxes = lazy(function () { return import('../../modules/boxes/Boxes') })
var ProductionOrders = lazy(function () { return import('../../modules/production/ProductionOrders') })
var Challans = lazy(function () { return import('../../modules/challans/Challans') })
var Purchase = lazy(function () { return import('../../modules/purchase/Purchase') })
var Calendar = lazy(function () { return import('../../modules/calendar/Calendar') })
var Vendors = lazy(function () { return import('../../modules/vendors/Vendors') })
var Requisitions = lazy(function () { return import('../../modules/requisitions/Requisitions') })
var StaffRoles = lazy(function () { return import('../../modules/manpower/StaffRoles') })
var Analytics = lazy(function () { return import('../../modules/analytics/Analytics') })
var Overview = lazy(function () { return import('../../modules/overview/Overview') })
var JobDepartments = lazy(function () { return import('../../modules/employees/JobDepartments') })
var Employees = lazy(function () { return import('../../modules/employees/Employees') })
var RoleTemplates = lazy(function () { return import('../../modules/users/RoleTemplates') })
var EmployeeDocTypes = lazy(function () { return import('../../modules/employees/EmployeeDocTypes') })
var SalaryLedger = lazy(function () { return import('../../modules/employees/SalaryLedger') })
var SalaryPayouts = lazy(function () { return import('../../modules/expenses/SalaryPayouts') })
var LedgersHub = lazy(function () { return import('../../modules/expenses/LedgersHub') })
var Projects = lazy(function () { return import('../../modules/projects/Projects') })
var Reviews = lazy(function () { return import('../../modules/reviews/Reviews') })
var BroadcastHub = lazy(function () { return import('../../modules/broadcast/BroadcastHub') })
var BroadcastTemplates = lazy(function () { return import('../../modules/broadcast/Templates') })
var BroadcastContacts = lazy(function () { return import('../../modules/broadcast/Contacts') })
var BroadcastCampaigns = lazy(function () { return import('../../modules/broadcast/Campaigns') })
var BroadcastInbox = lazy(function () { return import('../../modules/broadcast/Inbox') })
var BroadcastSettings = lazy(function () { return import('../../modules/broadcast/Settings') })

function ExpenseTypesMaster(props) {
  return <Expenses profile={props.profile} masterMode={true} />
}

// ── Sub-tab switcher ──
function SubTabs({ tabs, active, onChange }) {
  return (
    // overflow-y-hidden is deliberate: overflow-x-auto makes the other axis
    // compute to auto as well, and -mb-px then gives it 1px to scroll, which
    // renders as a pair of stray scrollbar arrows down the side.
    <div className="flex gap-1 mb-4 sm:mb-5 border-b border-slate-200 overflow-x-auto overflow-y-hidden sm:overflow-x-visible sm:overflow-y-visible">
      {tabs.map(function (t) {
        return (
          <button key={t.key} onClick={function () { onChange(t.key) }}
            className={"shrink-0 sm:flex-1 sm:shrink sm:justify-center inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2.5 text-[12.5px] sm:text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap origin-bottom transform-gpu transition-all duration-150 " +
              (active === t.key
                ? "border-indigo-600 text-indigo-700"
                // The tint has rounded top corners only: the bottom edge is
                // where the underline lives, and a fully rounded pill would
                // lift the label off the rule the whole row is aligned to.
                // The grey underline previews where the indigo one will land,
                // so the row does not jump when you commit.
                : "text-slate-500 border-transparent rounded-t-lg hover:text-slate-900 hover:border-slate-300 hover:bg-slate-900/[0.04] hover:scale-[1.05]")}>
            {t.icon && <Icon name={t.icon} size={14} />}
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
    { key: 'extra_plates', label: 'Extra Plates',  icon: 'utensils', component: ExtraPlateCollect, perm: 'events.extra_plate_collect' },
  ],
  inventory: [
    { key: 'pending',    label: 'Pending Review', icon: 'clock',    component: PendingReview,    perm: 'review.pending' },
    { key: 'items',      label: 'All Items',      icon: 'box',      component: AdminItems,       perm: 'inventory.items' },
    { key: 'production', label: 'Production',     icon: 'wrench',   component: ProductionOrders, perm: 'inventory.production' },
    { key: 'boxes',      label: 'Boxes',          icon: 'tag',      component: Boxes,            perm: 'inventory.boxes' },
    { key: 'challans',   label: 'Challans',       icon: 'truck',    component: Challans,         perm: 'inventory.challans' },
  ],
  masters: [
    { key: 'categories',         label: 'Categories',      icon: 'tag',        component: Categories,         perm: 'admin.masters' },
    { key: 'job_departments',    label: 'Job Departments', icon: 'users',      component: JobDepartments,     perm: 'admin.masters' },
    { key: 'ratecard',           label: 'Rate Card',       icon: 'calculator', component: RateCardEditor,     anyPerm: ['admin.masters','events.ratecard'] },
    { key: 'staff_roles',        label: 'Staff Roles',     icon: 'idCard',     component: StaffRoles,         perm: 'admin.masters' },
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
    { key: 'purchase',     label: 'Purchase Orders', icon: 'cart',     component: Purchase,     perm: 'procurement.purchase_orders' },
    { key: 'vendors',      label: 'Vendors',         icon: 'truck',    component: Vendors,      perm: 'procurement.vendors' },
  ],
  broadcast: [
    { key: 'templates', label: 'Templates', icon: 'fileText', component: BroadcastTemplates, perm: 'broadcast.templates.view' },
    { key: 'contacts',  label: 'Contacts',  icon: 'users',    component: BroadcastContacts,  perm: 'broadcast.contacts.view' },
    { key: 'campaigns', label: 'Campaigns', icon: 'send',     component: BroadcastCampaigns, perm: 'broadcast.campaigns.view' },
    { key: 'inbox',     label: 'Inbox',     icon: 'inbox',    component: BroadcastInbox,     perm: 'broadcast.inbox.view' },
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

function TabbedSection({ config, profile, onNavigate, activeSubTab }) {
  var permsNew = profile.permsNew || []
  var visibleConfig = config.filter(function (c) { return subTabAllowed(c, permsNew) })

  var _initial = activeSubTab && visibleConfig.find(function (c) { return c.key === activeSubTab })
    ? activeSubTab
    : (visibleConfig.length > 0 ? visibleConfig[0].key : null)
  var [sub, setSub] = useState(_initial)

  useEffect(function () {
    if (activeSubTab && visibleConfig.find(function (c) { return c.key === activeSubTab })) {
      setSub(activeSubTab)
    }
  }, [activeSubTab])

  var _isAllowed = visibleConfig.find(function (c) { return c.key === sub }) != null
  var Active = _isAllowed ? config.find(function (c) { return c.key === sub })?.component : null

  if (visibleConfig.length === 0) {
    return <div className="bg-white rounded-lg border border-slate-200 p-8 text-center"><p className="text-slate-400 text-sm">No access</p></div>
  }

  return (
    <div>
      <SubTabs tabs={visibleConfig} active={sub} onChange={setSub} />
      <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
        {Active && <Active profile={profile} onNavigate={onNavigate} inAdmin
          onNavigateToExpenses={function () { onNavigate('expenses', 'expenses') }} />}
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
    anyPerm: ['inventory.add','inventory.items','inventory.production','inventory.boxes','inventory.challans','inventory.receive','review.pending'] },
  { key: 'events',      label: 'Events',      icon: 'calendar',
    blurb: 'Every booked event and its extra-plate collection.',
    anyPerm: ['events.list','events.quote'] },
  { key: 'masters',     label: 'Masters',     icon: 'settings',   perm: 'admin.masters',
    blurb: 'The lists every other screen picks from.' },
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
    tagline: ['Better insights.', 'Smarter decisions.'],
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
    return <TabbedSection config={SUB_TAB_CONFIG[configKey]} profile={props.profile} onNavigate={props.onNavigate} activeSubTab={props.activeSubTab} />
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

  var _defaultTab = visibleTabs.length > 0 ? visibleTabs[0].key : null
  var [active, setActive] = useState(_defaultTab)
  var [subTab, setSubTab] = useState(null)
  var [navOpen, setNavOpen] = useState(false)

  var _isVisible = visibleTabs.find(function (t) { return t.key === active }) != null
  var ActiveModule = _isVisible ? (MODULES[active] || null) : null
  var activeTab = ADMIN_TABS.find(function (t) { return t.key === active })
  var activeLabel = activeTab?.label || ''

  // The icon inherits currentColor, so one colour per state covers both the
  // glyph and the label and they can never drift apart.
  //
  // aria-current marks the section for a screen reader: the pill says which
  // item is active visually and nothing else did.
  function renderNavItems(closeOnClick) {
    return visibleTabs.map(function (tab) {
      var isActive = active === tab.key
      return (
        <button
          key={tab.key}
          onClick={function () { setActive(tab.key); setSubTab(null); if (closeOnClick) setNavOpen(false) }}
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
        </button>
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
        <nav className="relative z-10 flex-1 min-h-0 px-2.5 py-3 space-y-1 overflow-y-auto ambria-thin-scroll">
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
        <span className="text-white text-sm font-bold truncate">{activeLabel || 'Ambria Ops'}</span>
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
            <nav className="relative z-10 flex-1 min-h-0 px-2.5 py-3 space-y-1 overflow-y-auto ambria-thin-scroll">
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
        {/* API Marketing carries artwork; it is drawn here rather than inside
            the module.

            The hub used to draw its own, from inside <main> — which is below
            this bar, so the bar stayed a white strip across a tinted page no
            matter how transparent it was made. Nothing inside main can reach
            above the bar; the column can. BroadcastHub skips its own copy
            when it sees inAdmin.

            On the other sections it would be decoration nobody asked for,
            sitting behind dense tables where a calm ground matters more. */}
        {active === 'broadcast' && <PageWave offset="var(--app-header-h, 0px)" />}

        {/* Desktop only — the phone gets the fixed bar further down, which
            carries the drawer trigger this one has no need for.

            Glass, not white: the page ground runs behind it, and an opaque
            strip across the top of a tinted page reads as a piece of another
            screen. Still frosted and still bordered, because content scrolls
            underneath it. */}
        <div className="hidden md:flex sticky top-0 z-30 shrink-0 h-14 items-center justify-between gap-4 px-8 bg-white/40 backdrop-blur-md border-b border-white/50">
          {/* Two levels is all this shell has — the section, and the sub-tab
              inside it, which the tab row already shows. So the trail stops
              at the section rather than inventing depth. */}
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 min-w-0 text-[13px]">
            <span className="text-slate-400" aria-hidden="true"><Icon name="home" size={15} /></span>
            <span className="text-slate-300" aria-hidden="true">/</span>
            <span className="font-semibold text-slate-900 truncate">{activeLabel}</span>
          </nav>
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
              <span aria-hidden="true" className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-indigo-100 text-indigo-600 inline-flex items-center justify-center">
                <Icon name={activeTab.icon} className="w-[22px] h-[22px] sm:w-[30px] sm:h-[30px]" strokeWidth={2.1} />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-[20px] sm:text-[23px] font-extrabold text-slate-900 tracking-[-0.025em] leading-tight">{activeLabel}</h2>
                {activeTab.blurb && (
                  <p className="hidden sm:block text-[12.5px] text-slate-500 leading-snug mt-0.5 line-clamp-2">{activeTab.blurb}</p>
                )}
              </div>
            </div>
            {/* Only where a section has one — an invented line of copy per
                section would be filler, and filler in a header is noise.

                Indigo lead, muted second line: the same two-line block
                BroadcastHub prints, down to the sizes. */}
            {activeTab.tagline && (
              <div className="hidden lg:block text-right shrink-0">
                {activeTab.tagline.map(function (line, i) {
                  return (
                    <p key={i} className={i === 0
                      ? 'font-display text-[12.5px] font-extrabold text-indigo-600 leading-tight tracking-[-0.01em]'
                      : 'text-[11px] text-slate-400 leading-snug'}>
                      {line}
                    </p>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {ActiveModule && (
          <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
            <ActiveModule profile={profile} onNavigate={function (tab, sub) { setActive(tab); setSubTab(sub || null) }} activeSubTab={subTab} inAdmin />
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