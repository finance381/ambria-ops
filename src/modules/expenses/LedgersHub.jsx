import { useState, useEffect, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'

var Ledgers = lazy(function () { return import('./Ledgers') })
var EventLedger = lazy(function () { return import('./EventLedger') })
var VendorLedger = lazy(function () { return import('./VendorLedger') })
var InventoryLedger = lazy(function () { return import('./InventoryLedger') })
var SalaryLedger = lazy(function () { return import('../employees/SalaryLedger') })
var GVLog = lazy(function () { return import('./GVLog') })
var CostTransfers = lazy(function () { return import('./CostTransfers') })

// perm keys map 1:1 to PERM_GROUPS finance.ledgers children (permissions.js).
var LEDGERS = [
  { key: 'expense',       label: 'Expense',        icon: 'ti-receipt',           component: Ledgers,         countTable: 'expenses',          countFilter: function (q) { return q.is('deleted_at', null) },                                                     perm: 'finance.ledgers.expense' },
  { key: 'event',         label: 'Event',          icon: 'ti-calendar-event',    component: EventLedger,     countTable: 'event_ledger',                                                                                                                        perm: 'finance.ledgers.event' },
  { key: 'vendor',        label: 'Vendor',         icon: 'ti-building-store',    component: VendorLedger,    countTable: 'ledger_entries',    countFilter: function (q) { return q.eq('ledger_type', 'vendor').is('deleted_at', null) },                        perm: 'finance.ledgers.vendor' },
  { key: 'inventory',     label: 'Inventory',      icon: 'ti-package',           component: InventoryLedger, countTable: null,                                                                                                                                  perm: 'finance.ledgers.inventory' },
  { key: 'salary',        label: 'Salary',         icon: 'ti-cash',              component: SalaryLedger,    countTable: 'ledger_entries',    countFilter: function (q) { return q.eq('ledger_type', 'user_salary').is('deleted_at', null) },                   perm: 'finance.ledgers.salary' },
  { key: 'cost_transfer', label: 'Cost Transfers', icon: 'ti-arrows-right-left', component: CostTransfers,   countTable: 'cost_transfers',    countFilter: function (q) { return q.is('reversal_of', null).is('reversed_by_id', null) },                        perm: 'finance.ledgers.cost_transfer' },
  { key: 'gv',            label: 'JV Log',         icon: 'ti-history',           component: GVLog,           countTable: 'general_vouchers',  countFilter: function (q) { return q.eq('is_reversal', false).is('reversed_by_gv_id', null) },                     perm: 'finance.ledgers.gv' },
]

function LedgersHub(props) {
  var permsNew = (props.profile && props.profile.permsNew) || []
  var visible = LEDGERS.filter(function (l) {
    if (!l.perm) return true
    return hasPerm(permsNew, l.perm)
  })
  var defaultKey = visible.length > 0 ? visible[0].key : 'expense'
  var [active, setActive] = useState(props.activeSubTab && visible.some(function (l) { return l.key === props.activeSubTab }) ? props.activeSubTab : defaultKey)
  var [counts, setCounts] = useState({})

  useEffect(function () {
    var alive = true
    async function loadCounts() {
      var results = await Promise.all(visible.map(async function (l) {
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

  var activeLedger = visible.find(function (l) { return l.key === active }) || visible[0] || LEDGERS[0]
  var Cmp = activeLedger.component

  return (
    <div>
      <div className="flex overflow-x-auto mb-5 bg-gray-100 rounded-lg p-1 gap-0.5 no-scrollbar">
        {visible.map(function (l) {
          var isActive = l.key === active
          var c = counts[l.key]
          return (
            <button key={l.key} onClick={function () { setActive(l.key) }}
              className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all flex-1 justify-center " +
                (isActive ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900")}>
              <i className={"ti " + l.icon} style={{ fontSize: '14px' }} aria-hidden="true"></i>
              <span>{l.label}</span>
              {c != null && c > 0 && (
                <span className={"px-1.5 py-0.5 rounded-full text-[10px] leading-none " +
                  (isActive ? "bg-indigo-100 text-indigo-700" : "bg-gray-200 text-gray-600")}>
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