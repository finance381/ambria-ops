import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { StatusBadge } from '../../components/ui/Badge'
import { formatPaise, formatDate } from '../../lib/format'
import Modal from '../../components/ui/Modal'

function Purchase() {
  var [requests, setRequests] = useState([])
  var [loading, setLoading] = useState(true)
  var [statusFilter, setStatusFilter] = useState('')
  var [selected, setSelected] = useState(null)

  useEffect(function () {
    loadRequests()
  }, [])

  async function loadRequests() {
    var { data } = await supabase
      .from('purchase_requests')
      .select('*, categories(name), requester:profiles!purchase_requests_requested_by_fkey(name), reviewer:profiles!purchase_requests_reviewed_by_fkey(name)')
      .order('created_at', { ascending: false })
    setRequests(data || [])
    setLoading(false)
  }

  var filtered = requests.filter(function (r) {
    return !statusFilter || r.status === statusFilter
  })

  var counts = { Pending: 0, Approved: 0, Rejected: 0, Purchased: 0, 'Added to Inventory': 0 }
  requests.forEach(function (r) {
    if (counts[r.status] !== undefined) counts[r.status]++
  })

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading purchase requests...</p>
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
          All ({requests.length})
        </button>
        {['Pending', 'Approved', 'Rejected', 'Purchased', 'Added to Inventory'].map(function (s) {
          if (counts[s] === 0 && s !== 'Pending') return null
          var colors = {
            Pending: 'amber', Approved: 'green', Rejected: 'red',
            Purchased: 'blue', 'Added to Inventory': 'indigo'
          }
          var active = statusFilter === s
          return (
            <button
              key={s}
              onClick={function () { setStatusFilter(s) }}
              className={"px-3 py-1 rounded-full text-sm font-medium transition-colors " +
                (active
                  ? "bg-" + colors[s] + "-100 text-" + colors[s] + "-700"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200")}
            >
              {s} ({counts[s]})
            </button>
          )
        })}
      </div>

      {/* Request cards */}
      {filtered.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-8">No purchase requests found</p>
      )}

      <div className="space-y-3">
        {filtered.map(function (req) {
          return (
            <div
              key={req.id}
              onClick={function () { setSelected(req) }}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md cursor-pointer transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800">{req.item_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {req.requester?.name} • {req.categories?.name || 'Uncategorized'} • Qty: {req.qty}
                  </p>
                </div>
                <div className="text-right ml-3">
                  {req.estimated_cost_paise && (
                    <p className="font-semibold text-gray-800 text-sm">{formatPaise(req.estimated_cost_paise)}</p>
                  )}
                  <StatusBadge status={req.status} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">{formatDate(req.created_at)}</p>
                {req.vendor && <p className="text-xs text-gray-500">🏪 {req.vendor}</p>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Detail Modal */}
      <Modal open={!!selected} onClose={function () { setSelected(null) }} title="Purchase Request">
        {selected && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 text-lg">{selected.item_name}</h3>
              <div className="flex gap-3 mt-2 flex-wrap">
                <StatusBadge status={selected.status} />
                <span className="text-sm text-gray-500">Qty: {selected.qty}</span>
                {selected.categories?.name && (
                  <span className="text-sm text-gray-500">{selected.categories.name}</span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Requested by</span>
                <span className="text-gray-800">{selected.requester?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Date</span>
                <span className="text-gray-800">{formatDate(selected.created_at)}</span>
              </div>
              {selected.estimated_cost_paise && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Estimated Cost</span>
                  <span className="font-medium text-gray-800">{formatPaise(selected.estimated_cost_paise)}</span>
                </div>
              )}
              {selected.vendor && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Preferred Vendor</span>
                  <span className="text-gray-800">{selected.vendor}</span>
                </div>
              )}
              {selected.reviewer?.name && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Reviewed by</span>
                  <span className="text-gray-800">{selected.reviewer.name}</span>
                </div>
              )}
            </div>

            {selected.reason && (
              <div>
                <p className="text-sm text-gray-500 mb-1">Reason</p>
                <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3">{selected.reason}</p>
              </div>
            )}

            {selected.notes && (
              <div>
                <p className="text-sm text-gray-500 mb-1">Notes</p>
                <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-3">{selected.notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default Purchase