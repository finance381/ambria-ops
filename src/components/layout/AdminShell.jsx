import { useState, useEffect, lazy, Suspense } from 'react'
import { ROLE_COLORS } from '../../lib/constants'
import { hasPerm } from '../../lib/permissions'

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

function ExpenseTypesMaster(props) {
  return <Expenses profile={props.profile} masterMode={true} />
}

// ── Sub-tab switcher ──
function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-6 mb-6 border-b border-slate-200">
      {tabs.map(function (t) {
        return (
          <button key={t.key} onClick={function () { onChange(t.key) }}
            className={"px-1 pb-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors " +
              (active === t.key ? "border-emerald-500 text-emerald-600" : "text-slate-400 border-transparent hover:text-slate-600")}>
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

var SUB_TAB_CONFIG = {
  events: [
    { key: 'events', label: 'Events', component: Events },
    { key: 'extra_plates', label: 'Extra Plates', component: ExtraPlateCollect },
  ],
  inventory: [
    { key: 'pending', label: 'Pending Review', component: PendingReview },
    { key: 'items', label: 'All Items', component: AdminItems },
    { key: 'production', label: 'Production', component: ProductionOrders },
    { key: 'boxes', label: 'Boxes', component: Boxes },
    { key: 'challans', label: 'Challans', component: Challans },
  ],
  masters: [
    { key: 'categories', label: 'Categories', component: Categories },
    { key: 'job_departments', label: 'Job Departments', component: JobDepartments },
    { key: 'ratecard', label: 'Rate Card', component: RateCardEditor },
    { key: 'staff_roles', label: 'Staff Roles', component: StaffRoles },
    { key: 'expense_types', label: 'Expense Types', component: ExpenseTypesMaster },
    { key: 'employee_doc_types', label: 'Employee Docs', component: EmployeeDocTypes },
  ],
  users: [
    { key: 'users', label: 'Users', component: Users },
    { key: 'role_templates', label: 'Role Templates', component: RoleTemplates },
    { key: 'employees', label: 'Employees', component: Employees },
    { key: 'logs', label: 'Activity Logs', component: ActivityLogs },
  ],
  procurement: [
    { key: 'requisitions', label: 'Requisitions', component: Requisitions },
    { key: 'purchase', label: 'Purchase Orders', component: Purchase },
    { key: 'vendors', label: 'Vendors', component: Vendors },
  ],
  expenses: [
    { key: 'wallet', label: 'Wallet', component: Wallet },
    { key: 'expenses', label: 'Expenses', component: Expenses },
    { key: 'payments', label: 'Payments', component: Payments },
    { key: 'salary_payouts', label: 'Salary Payouts', component: SalaryPayouts },
    { key: 'ledgers', label: 'Ledgers', component: LedgersHub },
  ],
}

function TabbedSection({ config, profile, onNavigate, activeSubTab }) {
  var [sub, setSub] = useState(activeSubTab || config[0].key)

  useEffect(function () {
    if (activeSubTab && config.find(function (c) { return c.key === activeSubTab })) {
      setSub(activeSubTab)
    }
  }, [activeSubTab])
  var Active = config.find(function (c) { return c.key === sub })?.component
  return (
    <div>
      <SubTabs tabs={config} active={sub} onChange={setSub} />
      <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
        {Active && <Active profile={profile} onNavigate={onNavigate} />}
      </Suspense>
    </div>
  )
}

var ADMIN_TABS = [
  { key: 'overview',    label: 'Overview',    icon: 'ti-home',           perm: 'admin.overview' },
  { key: 'analytics',   label: 'Analytics',   icon: 'ti-chart-line',     perm: 'admin.analytics' },
  { key: 'inventory',   label: 'Inventory',   icon: 'ti-package',
    anyPerm: ['inventory.add','inventory.items','inventory.production','inventory.boxes','inventory.challans','inventory.receive','review.pending'] },
  { key: 'events',      label: 'Events',      icon: 'ti-calendar-event',
    anyPerm: ['events.list','events.manpower','events.quote'] },
  { key: 'masters',     label: 'Masters',     icon: 'ti-adjustments',    perm: 'admin.masters' },
  { key: 'users',       label: 'Users',       icon: 'ti-users',
    anyPerm: ['admin.users','hr.employees'] },
  { key: 'expenses',    label: 'Finance',     icon: 'ti-wallet',
    anyPerm: ['finance.wallet','finance.expenses','finance.payments','finance.salary_payouts','finance.cost_transfers','finance.ledgers.expense','finance.ledgers.event','finance.ledgers.vendor','finance.ledgers.salary','finance.ledgers.inventory','finance.ledgers.cost_transfer','finance.ledgers.gv'] },
  { key: 'procurement', label: 'Procurement', icon: 'ti-shopping-cart',
    anyPerm: ['procurement.requisitions','procurement.purchase_orders','procurement.vendors'] },
]

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
}

function AdminShell({ profile, onSignOut }) {
  var permsNew = profile.permsNew || []
  var visibleTabs = ADMIN_TABS.filter(function (t) { return tabAllowed(t, permsNew) })

  var _defaultTab = visibleTabs.length > 0 ? visibleTabs[0].key : null
  var [active, setActive] = useState(_defaultTab)
  var [subTab, setSubTab] = useState(null)

  var _isVisible = visibleTabs.find(function (t) { return t.key === active }) != null
  var ActiveModule = _isVisible ? (MODULES[active] || null) : null
  var activeLabel = ADMIN_TABS.find(function (t) { return t.key === active })?.label || ''

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col sticky top-0 h-screen z-40" style={{ background: '#111827', boxShadow: '1px 0 0 #1F2937' }}>
        <div className="px-4 py-4 border-b border-white/8">
          <h1 className="text-white text-sm font-bold tracking-tight">Ambria Ops</h1>
          <p className="text-[10px] uppercase tracking-[0.12em] mt-0.5 font-medium" style={{ color: 'rgba(148,163,184,.6)' }}>Admin</p>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {visibleTabs.map(function (tab) {
            var isActive = active === tab.key
            return (
              <button
                key={tab.key}
                onClick={function () { setActive(tab.key); setSubTab(null) }}
                className={"w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-left transition-colors " +
                  (isActive
                    ? "text-white font-semibold"
                    : "text-slate-300 hover:bg-white/5")}
                style={isActive ? { background: 'rgba(16,185,129,.15)' } : {}}
              >
                <i className={"ti " + tab.icon + " text-[16px] leading-none"} style={{ color: isActive ? '#6EE7B7' : 'rgba(156,163,175,.7)' }} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="px-4 py-3 border-t border-white/8">
          <div className="text-[13px] truncate" style={{ color: 'rgba(226,232,240,.9)' }}>{profile.name}</div>
          <button
            onClick={onSignOut}
            className="mt-1 text-[11px] transition-colors hover:text-white"
            style={{ color: 'rgba(148,163,184,.6)' }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 px-8 py-6">
        {active !== 'overview' && <h2 className="text-xl font-bold mb-5" style={{ color: '#0F172A' }}>{activeLabel}</h2>}
        {ActiveModule && (
          <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
            <ActiveModule profile={profile} onNavigate={function (tab, sub) { setActive(tab); setSubTab(sub || null) }} activeSubTab={subTab} />
          </Suspense>
        )}
        {!ActiveModule && (
          <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-sm">{active} — coming soon</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default AdminShell