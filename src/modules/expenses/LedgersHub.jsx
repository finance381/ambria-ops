import { useState, useEffect, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabase'

var Ledgers = lazy(function () { return import('./Ledgers') })
var EventLedger = lazy(function () { return import('./EventLedger') })
var VendorLedger = lazy(function () { return import('./VendorLedger') })
var SalaryLedger = lazy(function () { return import('../employees/SalaryLedger') })
var GVLog = lazy(function () { return import('./GVLog') })

var LEDGERS = [
  { key: 'expense', label: 'Expense', icon: 'ti-receipt', component: Ledgers, countTable: 'expenses', countFilter: function (q) { return q.is('deleted_at', null) } },
  { key: 'event', label: 'Event', icon: 'ti-calendar-event', component: EventLedger, countTable: 'event_ledger' },
  { key: 'vendor', label: 'Vendor', icon: 'ti-building-store', component: VendorLedger, countTable: 'ledger_entries' },
  { key: 'salary', label: 'Salary', icon: 'ti-cash', component: SalaryLedger, countTable: null },
  { key: 'gv', label: 'GV Log', icon: 'ti-history', component: GVLog, countTable: null },
]

function LedgersHub(props) {
  var [active, setActive] = useState(props.activeSubTab && LEDGERS.some(function (l) { return l.key === props.activeSubTab }) ? props.activeSubTab : 'expense')
  var [counts, setCounts] = useState({})

  useEffect(function () {
    var alive = true
    async function loadCounts() {
      var results = await Promise.all(LEDGERS.map(async function (l) {
        if (!l.countTable) return { key: l.key, count: null }
        try {
          var q = supabase.from(l.countTable).select('*', { count: 'exact', head: true })
          if (l.countFilter) q = l.countFilter(q)
          var { count } = await q
          return { key: l.key, count: count || 0 }
        } catch (_) { return { key: l.key, count: null } }
      }))
      if (!alive) return
      var next = {}
      results.forEach(function (r) { next[r.key] = r.count })
      setCounts(next)
    }
    loadCounts()
    return function () { alive = false }
  }, [])

  var activeLedger = LEDGERS.find(function (l) { return l.key === active }) || LEDGERS[0]
  var Cmp = activeLedger.component

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-5">
        {LEDGERS.map(function (l) {
          var isActive = l.key === active
          var c = counts[l.key]
          return (
            <button key={l.key} onClick={function () { setActive(l.key) }}
              className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors " +
                (isActive ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300")}>
              <i className={"ti " + l.icon} style={{ fontSize: '14px' }} aria-hidden="true"></i>
              <span>{l.label}</span>
              {c != null && c > 0 && (
                <span className={"px-1.5 py-0.5 rounded-full text-[10px] leading-none " +
                  (isActive ? "bg-white/25 text-white" : "bg-gray-100 text-gray-600")}>
                  {c > 999 ? Math.floor(c / 1000) + 'k' : c}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <Suspense fallback={<p className="text-gray-400 text-sm py-8 text-center">Loading...</p>}>
        <Cmp profile={props.profile} onNavigate={props.onNavigate} />
      </Suspense>
    </div>
  )
}

export default LedgersHub