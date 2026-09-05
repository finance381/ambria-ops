import { useState } from 'react'
import { supabase } from '../lib/supabase'
import ExpenseDetail from '../modules/expenses/ExpenseDetail'

var EXPENSE_DETAIL_SELECT = 'id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name), expense_allocations(department, department_id, venue_id, amount_paise)'

// Shared "click an expense-linked ledger row → open the ExpenseDetail overlay"
// behavior, used by every ledger tab except Cost Transfers (which has no
// single underlying expense to open).
export function useExpenseDetailModal(profile, isAdmin, onRefresh) {
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

  var expenseDetailModal = !target ? null : (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={function () { closeExpenseDetail(false) }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl p-4 sm:p-5 min-h-screen sm:min-h-0 sm:max-h-[92vh] overflow-y-auto"
        onClick={function (ev) { ev.stopPropagation() }}>
        {loading || target._placeholder ? (
          <div className="py-16 text-center text-sm text-gray-500">Loading expense…</div>
        ) : (
          <ExpenseDetail
            key={target.id}
            exp={target}
            profile={profile}
            isAdmin={isAdmin}
            isDeptApprover={false}
            onBack={function () { closeExpenseDetail(false) }}
            onUpdated={function () { closeExpenseDetail(true) }}
            onEdit={function () { alert('To edit this expense, please open the Expenses tab.'); closeExpenseDetail(false) }}
            onRaiseGV={function () { alert('To raise a Journal Voucher, please open the Expenses tab.'); closeExpenseDetail(false) }}
          />
        )}
      </div>
    </div>
  )

  return { openExpenseDetail: openExpenseDetail, expenseDetailModal: expenseDetailModal }
}
