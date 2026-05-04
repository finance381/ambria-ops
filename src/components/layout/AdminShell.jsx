import { useState, useEffect, lazy, Suspense } from 'react'
import { ROLE_COLORS } from '../../lib/constants'
import RateCardEditor from '../../modules/quote/RateCardEditor'

var PendingReview = lazy(function () { return import('../../modules/categories/PendingReview') })
var Events = lazy(function () { return import('../../modules/events/Events') })
var AdminItems = lazy(function () { return import('../../modules/inventory/AdminItems') })
var Categories = lazy(function () { return import('../../modules/categories/Categories') })
var Users = lazy(function () { return import('../../modules/users/Users') })
var ActivityLogs = lazy(function () { return import('../../modules/logs/ActivityLogs') })
var Expenses = lazy(function () { return import('../../modules/expenses/Expenses') })
var Dashboard = lazy(function () { return import('../../modules/dashboard/Dashboard') })
var Boxes = lazy(function () { return import('../../modules/boxes/Boxes') })
var ProductionOrders = lazy(function () { return import('../../modules/production/ProductionOrders') })
var Challans = lazy(function () { return import('../../modules/challans/Challans') })
var Purchase = lazy(function () { return import('../../modules/purchase/Purchase') })
var Calendar = lazy(function () { return import('../../modules/calendar/Calendar') })
var Vendors = lazy(function () { return import('../../modules/vendors/Vendors') })
var Requisitions = lazy(function () { return import('../../modules/requisitions/Requisitions') })
var Analytics = lazy(function () { return import('../../modules/analytics/Analytics') })
var Overview = lazy(function () { return import('../../modules/overview/Overview') })


// ── Sub-tab switcher ──
function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-0.5 w-fit">
      {tabs.map(function (t) {
        return (
          <button key={t.key} onClick={function () { onChange(t.key) }}
            className={"px-4 py-2 text-sm font-semibold rounded-md transition-colors " +
              (active === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
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
    { key: 'ratecard', label: 'Rate Card', component: RateCardEditor },
  ],
  users: [
    { key: 'users', label: 'Users', component: Users },
    { key: 'logs', label: 'Activity Logs', component: ActivityLogs },
  ],
  procurement: [
    { key: 'requisitions', label: 'Requisitions', component: Requisitions },
    { key: 'purchase', label: 'Purchase Orders', component: Purchase },
    { key: 'vendors', label: 'Vendors', component: Vendors },
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
  { key: 'overview', label: 'Overview', icon: '🏠' },
  { key: 'analytics', label: 'Analytics', icon: '📊' },
  { key: 'inventory', label: 'Inventory', icon: '📦' },
  { key: 'events', label: 'Events', icon: '📅' },
  { key: 'masters', label: 'Masters', icon: '⚙️' },
  { key: 'users', label: 'Users', icon: '👥' },
  { key: 'expenses', label: 'Expenses', icon: '💰' },
  { key: 'procurement', label: 'Procurement', icon: '🛒' },
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
  expenses: Expenses,
  procurement: makeTabbedModule('procurement'),
}

function AdminShell({ profile, onSignOut }) {
  var [active, setActive] = useState('overview')
  var [subTab, setSubTab] = useState(null)

  var ActiveModule = MODULES[active] || null
  var activeLabel = ADMIN_TABS.find(function (t) { return t.key === active })?.label || ''

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-gray-900 text-white">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold tracking-tight">Ambria Ops</h1>
            <span className="text-[11px] px-2 py-0.5 rounded bg-white/10 font-medium uppercase tracking-wider">
              Admin Dashboard
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-300">{profile.name}</span>
            <button
              onClick={onSignOut}
              className="text-xs px-3 py-1 border border-white/20 rounded text-gray-300 hover:text-white hover:border-white/40 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Tab nav */}
      <nav className="bg-white border-b border-gray-200 sticky top-[52px] z-40">
        <div className="max-w-[1200px] mx-auto flex overflow-x-auto px-6">
          {ADMIN_TABS.map(function (tab) {
            var isActive = active === tab.key
            return (
              <button
                key={tab.key}
                onClick={function () { setActive(tab.key); setSubTab(null) }}
                className={
                  "px-4 py-3 text-[13px] font-semibold whitespace-nowrap border-b-[2.5px] transition-colors " +
                  (isActive
                    ? "text-gray-900 border-amber-500"
                    : "text-gray-400 border-transparent hover:text-gray-600")
                }
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-[1200px] mx-auto px-6 py-6">
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