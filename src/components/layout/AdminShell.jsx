import { useState, lazy, Suspense } from 'react'
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
var Purchase = lazy(function () { return import('../../modules/purchase/Purchase') })
var Calendar = lazy(function () { return import('../../modules/calendar/Calendar') })
var Vendors = lazy(function () { return import('../../modules/vendors/Vendors') })
var Analytics = lazy(function () { return import('../../modules/analytics/Analytics') })


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

function InventoryTab({ profile }) {
  var [sub, setSub] = useState('pending')
  return (
    <div>
      <SubTabs tabs={[{ key: 'pending', label: 'Pending Review' }, { key: 'items', label: 'All Items' }]} active={sub} onChange={setSub} />
      <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
        {sub === 'pending' && <PendingReview profile={profile} />}
        {sub === 'items' && <AdminItems profile={profile} />}
      </Suspense>
    </div>
  )
}

function MastersTab({ profile }) {
  var [sub, setSub] = useState('categories')
  return (
    <div>
      <SubTabs tabs={[{ key: 'categories', label: 'Categories' }, { key: 'ratecard', label: 'Rate Card' }]} active={sub} onChange={setSub} />
      <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
        {sub === 'categories' && <Categories profile={profile} />}
        {sub === 'ratecard' && <RateCardEditor profile={profile} />}
      </Suspense>
    </div>
  )
}

function UsersTab({ profile }) {
  var [sub, setSub] = useState('users')
  return (
    <div>
      <SubTabs tabs={[{ key: 'users', label: 'Users' }, { key: 'logs', label: 'Activity Logs' }]} active={sub} onChange={setSub} />
      <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
        {sub === 'users' && <Users profile={profile} />}
        {sub === 'logs' && <ActivityLogs profile={profile} />}
      </Suspense>
    </div>
  )
}

function ProcurementTab({ profile }) {
  var [sub, setSub] = useState('purchase')
  return (
    <div>
      <SubTabs tabs={[{ key: 'purchase', label: 'Purchase Orders' }, { key: 'vendors', label: 'Vendors' }]} active={sub} onChange={setSub} />
      <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
        {sub === 'purchase' && <Purchase profile={profile} />}
        {sub === 'vendors' && <Vendors profile={profile} />}
      </Suspense>
    </div>
  )
}

var ADMIN_TABS = [
  { key: 'analytics', label: 'Analytics', icon: '📊' },
  { key: 'inventory', label: 'Inventory', icon: '📦' },
  { key: 'events', label: 'Events', icon: '📅' },
  { key: 'masters', label: 'Masters', icon: '⚙️' },
  { key: 'users', label: 'Users', icon: '👥' },
  { key: 'expenses', label: 'Expenses', icon: '💰' },
  { key: 'procurement', label: 'Procurement', icon: '🛒' },
]

var MODULES = {
  analytics: Analytics,
  inventory: InventoryTab,
  events: Events,
  masters: MastersTab,
  users: UsersTab,
  expenses: Expenses,
  procurement: ProcurementTab,
}

function AdminShell({ profile, onSignOut }) {
  var [active, setActive] = useState('analytics')

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
                onClick={function () { setActive(tab.key) }}
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
        <h2 className="text-xl font-bold text-gray-800 mb-5">{activeLabel}</h2>
        {ActiveModule && (
          <Suspense fallback={<div className="text-center py-8 text-sm text-gray-400">Loading...</div>}>
            <ActiveModule profile={profile} />
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