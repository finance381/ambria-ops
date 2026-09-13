import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import ExpenseDetail from '../modules/expenses/ExpenseDetail'

var EXPENSE_DETAIL_SELECT = 'id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name), expense_allocations(department, department_id, venue_id, amount_paise)'

// Shared "click an expense-linked ledger row → open the ExpenseDetail overlay"
// behavior, used by every ledger tab except Cost Transfers (which has no
// single underlying expense to open).
export function useExpenseDetailModal(profile, isAdmin, onRefresh, onNavigateToExpenses) {
  var [target, setTarget] = useState(null)
  var [loading, setLoading] = useState(false)

  async function openExpenseDetail(expenseId) {
    if (!expenseId) return
    setLoading(true)
    setTarget({ _placeholder: true, id: expenseId })
    var { data: row, error } = await supabase.from('expenses')
      .select(EXPENSE_DETAIL_SELECT)
      .eq('id', Number(expenseId)).maybeSingle()
    setLoading(false)
    if (error || !row) { alert('Expense not found: ' + (error?.message || 'missing')); setTarget(null); return }
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
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl p-4 sm:p-5 min-h-screen sm:min-h-0 sm:max-h-[92vh] overflow-y-auto"
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
