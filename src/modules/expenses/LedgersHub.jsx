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
var PaymentsLedger = lazy(function () { return import('./PaymentsLedger') })

// perm keys map 1:1 to PERM_GROUPS finance.ledgers children (permissions.js).
var LEDGERS = [
  { key: 'expense',       label: 'Expense',        icon: 'receipt',           component: Ledgers,         countTable: 'expenses',          countFilter: function (q) { return q.is('deleted_at', null) },                                                     perm: 'finance.ledgers.expense' },
  { key: 'event',         label: 'Event',          icon: 'calendar',    component: EventLedger,     countTable: 'event_ledger',                                                                                                                        perm: 'finance.ledgers.event' },
  { key: 'vendor',        label: 'Vendor',         icon: 'building',    component: VendorLedger,    countTable: 'ledger_entries',    countFilter: function (q) { return q.eq('ledger_type', 'vendor').is('deleted_at', null) },                        perm: 'finance.ledgers.vendor' },
  { key: 'payments',      label: 'Cash & Bank',    icon: 'banknote',     component: PaymentsLedger, countTable: null,                                                                                                                                  perm: 'finance.payments' },
  { key: 'inventory',     label: 'Inventory',      icon: 'box',           component: InventoryLedger, countTable: null,                                                                                                                                  perm: 'finance.ledgers.inventory' },
  { key: 'salary',        label: 'Salary',         icon: 'rupee',              component: SalaryLedger,    countTable: 'ledger_entries',    countFilter: function (q) { return q.eq('ledger_type', 'user_salary').is('deleted_at', null) },                   perm: 'finance.ledgers.salary' },
  { key: 'cost_transfer', label: 'Cost Transfers', icon: 'transfer', component: CostTransfers,   countTable: 'cost_transfers',    countFilter: function (q) { return q.is('reversal_of', null).is('reversed_by_id', null) },                        perm: 'finance.ledgers.cost_transfer' },
  { key: 'gv',            label: 'JV Log',         icon: 'clock',           component: GVLog,           countTable: 'general_vouchers',  countFilter: function (q) { return q.eq('is_reversal', false).is('reversed_by_gv_id', null) },                     perm: 'finance.ledgers.gv' },
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
      {/* A white bar with hairlines between the tabs, and the picked one on a
          soft indigo pill.

          No glyphs. They were Tabler icon-font classes — "ti ti-receipt" and
          the rest — and nothing in this app loads that font, so all eight have
          been drawing nothing this whole time. Eight words read better than
          eight words with eight blanks in front of them.

          The divider is drawn by the tab that follows it, and skipped on the
          first — a rule before every tab but one, rather than a separate
          element between each pair. */}
      <div className="flex overflow-x-auto mb-5 bg-white border border-slate-200 rounded-2xl p-1.5 no-scrollbar">
        {visible.map(function (l, li) {
          var isActive = l.key === active
          var c = counts[l.key]
          return (
            <div key={l.key} className="flex flex-1 items-center min-w-0">
              {li > 0 && <span aria-hidden="true" className="shrink-0 w-px h-5 bg-slate-200" />}
              <button type="button" onClick={function () { setActive(l.key) }} aria-pressed={isActive}
                className={"inline-flex items-center gap-2 h-9 px-3.5 mx-0.5 rounded-xl text-[13px] font-bold whitespace-nowrap transition-all duration-150 flex-1 justify-center " +
                  (isActive
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50")}>
                <span>{l.label}</span>
                {c != null && c > 0 && (
                  <span data-notranslate
                    className={"min-w-[22px] px-1.5 py-1 rounded-lg text-[11px] font-bold tabular-nums text-center leading-none transition-colors " +
                      (isActive ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500")}>
                    {c > 999 ? Math.floor(c / 1000) + 'k' : c}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>
      <Suspense fallback={<p className="text-gray-400 text-sm py-8 text-center">Loading...</p>}>
        <Cmp profile={props.profile} onNavigate={props.onNavigate} onNavigateToExpenses={props.onNavigateToExpenses} />
      </Suspense>
    </div>
  )
}

export default LedgersHub