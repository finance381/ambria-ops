import { useState, useEffect, lazy, Suspense } from 'react'
import { ROLE_COLORS } from '../../lib/constants'

var RateCardEditor = lazy(function () { return import('../../modules/quote/RateCardEditor') })
var PendingReview = lazy(function () { return import('../../modules/categories/PendingReview') })
var Events = lazy(function () { return import('../../modules/events/Events') })
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
    <div className="flex gap-6 mb-6 border-b border-gray-200">
      {tabs.map(function (t) {
        return (
          <button key={t.key} onClick={function () { onChange(t.key) }}
            className={"px-1 pb-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors " +
              (active === t.key ? "text-gray-900 border-gray-900" : "text-gray-400 border-transparent hover:text-gray-600")}>
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

var SUB_TAB_CONFIG = {
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
  { key: 'overview', label: 'Overview', icon: 'ti-home' },
  { key: 'analytics', label: 'Analytics', icon: 'ti-chart-line' },
  { key: 'inventory', label: 'Inventory', icon: 'ti-package' },
  { key: 'events', label: 'Events', icon: 'ti-calendar-event' },
  { key: 'masters', label: 'Masters', icon: 'ti-adjustments' },
  { key: 'users', label: 'Users', icon: 'ti-users' },
  { key: 'expenses', label: 'Finance', icon: 'ti-wallet' },
  { key: 'procurement', label: 'Procurement', icon: 'ti-shopping-cart' },
]

function makeTabbedModule(configKey) {
  return function (props) {
    return <TabbedSection config={SUB_TAB_CONFIG[configKey]} profile={props.profile} onNavigate={props.onNavigate} activeSubTab={props.activeSubTab} />
  }
}

var MODULES = {
  overview: Overview,
  analytics: Analytics,
  inventory: makeTabbedModule('inventory'),
  events: Events,
  masters: makeTabbedModule('masters'),
  users: makeTabbedModule('users'),
  expenses: makeTabbedModule('expenses'),
  procurement: makeTabbedModule('procurement'),
}

function AdminShell({ profile, onSignOut }) {
  var [active, setActive] = useState('overview')
  var [subTab, setSubTab] = useState(null)

  var ActiveModule = MODULES[active] || null
  var activeLabel = ADMIN_TABS.find(function (t) { return t.key === active })?.label || ''

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-slate-900 flex flex-col sticky top-0 h-screen z-40">
        <div className="px-4 py-4 border-b border-white/10">
          <h1 className="text-white text-sm font-bold tracking-tight">Ambria Ops</h1>
          <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400 mt-0.5 font-medium">Admin</p>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {ADMIN_TABS.map(function (tab) {
            var isActive = active === tab.key
            return (
              <button
                key={tab.key}
                onClick={function () { setActive(tab.key); setSubTab(null) }}
                className={"w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-left transition-colors " +
                  (isActive
                    ? "bg-amber-500/15 text-white font-semibold"
                    : "text-slate-300 hover:bg-white/5")}
              >
                <i className={"ti " + tab.icon + " text-[16px] leading-none " + (isActive ? "text-amber-400" : "text-slate-400")} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="px-4 py-3 border-t border-white/10">
          <div className="text-[13px] text-slate-200 truncate">{profile.name}</div>
          <button
            onClick={onSignOut}
            className="mt-1 text-[11px] text-slate-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 px-8 py-6">
        {active !== 'overview' && <h2 className="text-xl font-bold text-gray-800 mb-5">{activeLabel}</h2>}
        {ActiveModule && (
          <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
            <ActiveModule profile={profile} onNavigate={function (tab, sub) { setActive(tab); setSubTab(sub || null) }} activeSubTab={subTab} />
          </Suspense>
        )}
        {!ActiveModule && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-400 text-sm">{active} — coming soon</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default AdminShell