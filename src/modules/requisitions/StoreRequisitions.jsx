import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import StoreRequisitionForm from './StoreRequisitionForm'

// A standalone top-level Procurement tab, a peer of Requisitions/Purchase
// Orders/Vendors — not a tab nested inside Requisitions, since this flow has
// no approval/dispatch lifecycle at all (it deducts stock on submit).
//
// List is intentionally bare (no filters, no detail drill-in) — the real
// list view is a separate pass once submit + stock deduction are confirmed
// working end to end.
function StoreRequisitions({ profile }) {
  var [view, setView] = useState('list')
  var [reqs, setReqs] = useState([])
  var [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    var { data } = await supabase.from('store_requisitions')
      .select('id, date_from, date_to, total_paise, created_at, created_by')
      .order('created_at', { ascending: false })
      .limit(50)
    var rows = data || []
    var uids = []
    rows.forEach(function (r) { if (r.created_by && uids.indexOf(r.created_by) === -1) uids.push(r.created_by) })
    if (uids.length > 0) {
      var { data: names } = await supabase.rpc('get_profile_names', { p_ids: uids })
      var map = {}
      ;(names || []).forEach(function (n) { map[n.id] = n.name })
      rows = rows.map(function (r) { return Object.assign({}, r, { _createdByName: map[r.created_by] || null }) })
    }
    setReqs(rows)
    setLoading(false)
  }

  useEffect(function () { load() }, [])
  useRealtime(['store_requisitions'], load)

  if (view === 'form') {
    return (
      <StoreRequisitionForm
        profile={profile}
        onCancel={function () { setView('list') }}
        onDone={function () { setView('list'); load() }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Store Requisition</h2>
          <p className="text-xs text-gray-400">{reqs.length} store requisitions</p>
        </div>
        <button onClick={function () { setView('form') }}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
          + New Store Requisition
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
      ) : reqs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No store requisitions yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reqs.map(function (r) {
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{formatDate(r.date_from)} – {formatDate(r.date_to)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{r._createdByName || '—'} · {formatDate(r.created_at)}</p>
                  </div>
                  <p className="text-sm font-bold text-indigo-600 whitespace-nowrap">{formatPoints(r.total_paise || 0)}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default StoreRequisitions
