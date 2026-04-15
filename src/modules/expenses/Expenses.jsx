import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { StatusBadge } from '../../components/ui/Badge'
import { formatPaise, formatDate } from '../../lib/format'
import Modal from '../../components/ui/Modal'

function Expenses({ profile }) {
  var [expenses, setExpenses] = useState([])
  var [loading, setLoading] = useState(true)
  var [statusFilter, setStatusFilter] = useState('')
  var [selected, setSelected] = useState(null)

  useEffect(function () {
    loadExpenses()
  }, [])

  async function loadExpenses() {
    var { data } = await supabase
      .from('expenses')
      .select('*, expense_categories(name), profiles!expenses_user_id_fkey(name), reviewer:profiles!expenses_reviewed_by_fkey(name)')
      .order('created_at', { ascending: false })
    setExpenses(data || [])
    setLoading(false)
  }

  var filtered = expenses.filter(function (exp) {
    return !statusFilter || exp.status === statusFilter
  })

  var pendingCount = expenses.filter(function (e) { return e.status === 'pending' }).length
  var approvedCount = expenses.filter(function (e) { return e.status === 'approved' }).length
  var rejectedCount = expenses.filter(function (e) { return e.status === 'rejected' }).length

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading expenses...</p>
  }

  return (
    <div className="space-y-4">
      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={function () { setStatusFilter('') }}
          className={"px-3 py-1 rounded-full text-sm font-medium transition-colors " +
            (!statusFilter ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
        >
          All ({expenses.length})
        </button>
        <button
          onClick={function () { setStatusFilter('pending') }}
          className={"px-3 py-1 rounded-full text-sm font-medium transition-colors " +
            (statusFilter === 'pending' ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
        >
          Pending ({pendingCount})
        </button>
        <button
          onClick={function () { setStatusFilter('approved') }}
          className={"px-3 py-1 rounded-full text-sm font-medium transition-colors " +
            (statusFilter === 'approved' ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
        >
          Approved ({approvedCount})
        </button>
        <button
          onClick={function () { setStatusFilter('rejected') }}
          className={"px-3 py-1 rounded-full text-sm font-medium transition-colors " +
            (statusFilter === 'rejected' ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
        >
          Rejected ({rejectedCount})
        </button>
      </div>

      {/* Expense cards */}
      {filtered.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-8">No expenses found</p>
      )}

      <div className="space-y-3">
        {filtered.map(function (exp) {
          return (
            <div
              key={exp.id}
              onClick={function () { setSelected(exp) }}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md cursor-pointer transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800 truncate">{exp.description}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {exp.profiles?.name} • {exp.expense_categories?.name}
                  </p>
                </div>
                <div className="text-right ml-3">
                  <p className="font-semibold text-gray-800">{formatPaise(exp.amount_paise)}</p>
                  <StatusBadge status={exp.status} />
                </div>
              </div>
              <p className="text-xs text-gray-400">{formatDate(exp.created_at)}</p>
            </div>
          )
        })}
      </div>

      {/* Detail Modal */}
      <Modal open={!!selected} onClose={function () { setSelected(null) }} title="Expense Detail">
        {selected && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-500">Amount</p>
              <p className="text-3xl font-bold text-gray-800">{formatPaise(selected.amount_paise)}</p>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Status</span>
                <StatusBadge status={selected.status} />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Submitted by</span>
                <span className="text-gray-800">{selected.profiles?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Category</span>
                <span className="text-gray-800">{selected.expense_categories?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Date</span>
                <span className="text-gray-800">{formatDate(selected.created_at)}</span>
              </div>
              {selected.reviewer?.name && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Reviewed by</span>
                  <span className="text-gray-800">{selected.reviewer.name}</span>
                </div>
              )}
              {selected.reviewed_at && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Reviewed on</span>
                  <span className="text-gray-800">{formatDate(selected.reviewed_at)}</span>
                </div>
              )}
            </div>

            <div>
              <p className="text-sm text-gray-500 mb-1">Description</p>
              <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3">{selected.description}</p>
            </div>

            {selected.rejection_reason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm font-medium text-red-700">Rejection Reason</p>
                <p className="text-sm text-red-600 mt-1">{selected.rejection_reason}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default Expenses