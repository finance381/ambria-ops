import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import ExpenseDetail from '../modules/expenses/ExpenseDetail'

var EXPENSE_DETAIL_SELECT = 'id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, checked_by, checked_at, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name, venue_name, function_date, pax), expense_allocations(department, department_id, venue_id, amount_paise)'

// Shared "click an expense-linked ledger row → open the ExpenseDetail overlay"
// behavior, used by every ledger tab except Cost Transfers (which has no
// single underlying expense to open).
export function useExpenseDetailModal(profile, isAdmin, onRefresh, onNavigateToExpenses) {
  var [target, setTarget] = useState(null)
  var [loading, setLoading] = useState(false)

  // `seed` is whatever the caller already has on screen.
  //
  // Every one of these overlays is opened from a row that was drawn from a
  // query — the description, the amount, the date and the status are on the
  // screen at the moment of the click. Waiting on a round trip before showing
  // any of it meant a second of "Loading expense…" for facts you had just
  // pressed.
  //
  // The fetch still runs, for the things a ledger row has no reason to carry:
  // the receipts, the tax split, the allocations, who reviewed it and when. It
  // replaces the seed when it lands. The id does not change, so ExpenseDetail
  // is not remounted and nothing already drawn flickers.
  //
  // Callers with nothing to hand over simply pass nothing, and get the spinner
  // they had before.
  async function openExpenseDetail(expenseId, seed) {
    if (!expenseId) return
    setLoading(!seed)
    setTarget(seed ? Object.assign({}, seed, { id: expenseId }) : { _placeholder: true, id: expenseId })
    var { data: row, error } = await supabase.from('expenses')
      .select(EXPENSE_DETAIL_SELECT)
      .eq('id', Number(expenseId)).maybeSingle()
    setLoading(false)
    if (error || !row) {
      // With a seed on screen there is something to read and something to
      // close; taking it away to announce a failed refresh is worse than the
      // failure.
      if (!seed) { alert('Expense not found: ' + (error?.message || 'missing')); setTarget(null) }
      return
    }
    setTarget(row)
  }

  function closeExpenseDetail(refresh) {
    setTarget(null)
    if (refresh && onRefresh) onRefresh()
  }

  // Portalled to <body> — the admin shell wraps each page in `relative isolate`,
  // which traps any z-index inside it, so an in-place fixed overlay here would
  // have the sidebar showing through its left ~250px. Matches Modal.jsx's fix.
  var expenseDetailModal = !target ? null : createPortal((
    <div className="fixed inset-0 z-[9998] bg-black/70 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={function () { closeExpenseDetail(false) }}>
      {/* Wide enough for the detail to use its own two-column layout.

          ExpenseDetail is a @container and splits into two columns at 48rem. At
          max-w-2xl the container was about 630px once padding was off, so it
          never did — every panel stacked, the panel ran twice the height it
          needed, and a modal that fits on a screen had a scrollbar down the
          side of it.

          The height cap stays as a floor rather than as the plan: an expense
          with a dozen allocations can outgrow any screen. */}
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-5xl p-4 sm:p-5 min-h-screen sm:min-h-0 sm:max-h-[92vh] overflow-y-auto"
        onClick={function (ev) { ev.stopPropagation() }}>
        {/* The overlay owns its close control. It used to lean on the Back link
            inside ExpenseDetail, which left no way out on a phone, where the
            sheet is full-bleed and there is no backdrop left to tap. */}
        <div className="flex justify-end mb-1">
          <button
            onClick={function () { closeExpenseDetail(false) }}
            aria-label="Close"
            className="-mr-1 -mt-1 w-9 h-9 flex items-center justify-center rounded-xl text-[17px] leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 active:scale-95 transition-all"
          >
            ✕
          </button>
        </div>
        {loading || target._placeholder ? (
          <div className="py-16 text-center text-[13px] font-medium text-slate-500">Loading expense…</div>
        ) : (
          <ExpenseDetail
            key={target.id}
            exp={target}
            profile={profile}
            isAdmin={isAdmin}
            isDeptApprover={false}
            onUpdated={function () { closeExpenseDetail(true) }}
            onEdit={function () { var id = target.id; closeExpenseDetail(false); onNavigateToExpenses && onNavigateToExpenses(id, 'edit') }}
            onRaiseGV={function () { var id = target.id; closeExpenseDetail(false); onNavigateToExpenses && onNavigateToExpenses(id, 'gv') }}
          />
        )}
      </div>
    </div>
  ), document.body)

  return { openExpenseDetail: openExpenseDetail, expenseDetailModal: expenseDetailModal }
}
