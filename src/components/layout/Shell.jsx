import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { ROLE_COLORS } from '../../lib/constants'
import Inventory from '../../modules/inventory/Inventory'
import InventoryForm from '../../modules/inventory/InventoryForm'
import AdminMobile from '../../modules/categories/AdminMobile'
import Events from '../../modules/events/Events'
import AdminReview from '../../modules/categories/AdminReview'
import DeptReview from '../../modules/categories/DeptReview'
import { useLang } from '../../lib/i18n.jsx'
import QuoteCalculator from '../../modules/quote/QuoteCalculator'
import Requisitions from '../../modules/requisitions/Requisitions'
import Expenses from '../../modules/expenses/Expenses'

var FEATURES = [
  { key: 'feature_add', label: 'Add Item', icon: '📝', tab: 'add' },
  { key: 'feature_items', label: 'My Items', icon: '📋', tab: 'my' },
  { key: 'feature_dept_review', label: 'Dept Review', icon: '✅', tab: 'dept_review' },
  { key: 'feature_pending', label: 'Pending Review', icon: '⏳', tab: 'pending_review' },
  { key: 'feature_events', label: 'Events', icon: '📅', tab: 'events' },
  { key: 'feature_requisitions', label: 'Requisitions', icon: '📋', tab: 'requisitions' },
  { key: 'feature_quote', label: 'Quote Calc', icon: '🧮', tab: 'quote' },
  { key: 'feature_expenses', label: 'PC & Direct Expenses', icon: '💰', tab: 'expenses' },
  { key: 'feature_admin', label: 'Admin', icon: '⚙️', tab: 'admin' },
]

function Shell({ profile, onSignOut }) {
  var [tab, setTab] = useState('home')
  var [showSuccess, setShowSuccess] = useState(false)

  var isAdmin = profile.role === 'admin' || profile.role === 'auditor'
  var perms = profile.permissions || []
  var { lang, switchLang } = useLang()

  // Admin/auditor see all cards; others see only granted features
  var badgeCounts = { feature_expenses: expBadge }

  var visibleFeatures = FEATURES.filter(function (f) {
    return perms.includes(f.key)
  })
  var [expBadge, setExpBadge] = useState(0)

  useEffect(function () {
    if (!perms.includes('feature_expenses')) return
    var isDeptAppr = perms.indexOf('dept_approve') !== -1
    var isAdminRole = profile.role === 'admin' || profile.role === 'auditor'
    var statuses = []
    if (isAdminRole) statuses = isDeptAppr ? ['pending_dept', 'pending'] : ['pending']
    else if (isDeptAppr) statuses = ['pending_dept']
    if (!statuses.length) return

    supabase.from('expenses')
      .select('id', { count: 'exact', head: true })
      .neq('user_id', profile.id)
      .in('status', statuses)
      .then(function (res) { setExpBadge(res.count || 0) })
  }, [tab])

  function handleSaved() {
    setShowSuccess(true)
    setTab('home')
    setTimeout(function () { setShowSuccess(false) }, 3000)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
        <div className="max-w-[540px] mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {tab !== 'home' && (
              <button
                onClick={function () { setTab('home') }}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              >
                ←
              </button>
            )}
            <div>
              <div className="text-base font-bold text-gray-900 leading-tight">
                {tab === 'home' ? 'Inventory Manager' : (visibleFeatures.find(function (f) { return f.tab === tab })?.label || 'Inventory Manager')}
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

        {/* Home — Card Grid */}
        {tab === 'home' && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            {visibleFeatures.map(function (f) {
              return (
                <button
                  key={f.key}
                  onClick={function () { setTab(f.tab) }}
                  className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col items-center gap-2 shadow-sm hover:shadow-md hover:border-gray-300 active:scale-[0.98] transition-all"
                >
                  <div className="relative inline-block">
                <span className="text-2xl">{f.icon}</span>
                {badgeCounts[f.key] > 0 && (
                  <span className="absolute -top-1 -right-2 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {badgeCounts[f.key] > 9 ? '9+' : badgeCounts[f.key]}
                  </span>
                )}
              </div>
                  <span className="text-sm font-semibold text-gray-800">{f.label}</span>
                </button>
              )
            })}
            {visibleFeatures.length === 0 && (
              <div className="col-span-2 text-center py-12 text-gray-400 text-sm">
                No features assigned. Contact admin.
              </div>
            )}
          </div>
        )}

        {tab === 'add' && (
          <InventoryForm
            item={null}
            profile={profile}
            onClose={function () { setTab('home') }}
            onSaved={handleSaved}
          />
        )}
        {tab === 'my' && (
          <Inventory profile={profile} />
        )}
        {tab === 'events' && (
          <Events profile={profile}/>
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
          <Requisitions profile={profile} onBack={function () { setTab('home') }} />
        )}
        {tab === 'expenses' && (
          <Expenses profile={profile} />
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