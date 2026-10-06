import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import StoreRequisitionForm from './StoreRequisitionForm'
import Icon from '../../components/ui/Icon'

// A standalone top-level Procurement tab, a peer of Requisitions/Purchase
// Orders/Vendors — not a tab nested inside Requisitions, since this flow has
// no approval/dispatch lifecycle at all (it deducts stock on submit).
//
// List is intentionally bare (no filters, no detail drill-in) — the real
// list view is a separate pass once submit + stock deduction are confirmed
// working end to end.
function StoreRequisitions({ profile }) {
  var [view, setView] = useState('list')
  var [editId, setEditId] = useState(null)
  var [reqs, setReqs] = useState([])
  var [loading, setLoading] = useState(true)
  var [deletingId, setDeletingId] = useState(null)
  var [confirmDeleteId, setConfirmDeleteId] = useState(null)

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

  async function confirmDelete(id) {
    setDeletingId(id)
    var res = await supabase.rpc('rpc_delete_store_requisition', { p_id: id })
    setDeletingId(null)
    setConfirmDeleteId(null)
    if (res.error) { alert('Delete failed: ' + res.error.message); return }
    load()
  }

  if (view === 'form') {
    return (
      <StoreRequisitionForm
        profile={profile}
        editId={editId}
        onCancel={function () { setView('list'); setEditId(null) }}
        onDone={function () { setView('list'); setEditId(null); load() }}
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
        <button onClick={function () { setEditId(null); setView('form') }}
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
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-indigo-600 whitespace-nowrap">{formatPoints(r.total_paise || 0)}</p>
                    <button onClick={function () { setEditId(r.id); setView('form') }} aria-label="Edit"
                      className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                      <Icon name="edit" size={14} />
                    </button>
                    <button onClick={function () { setConfirmDeleteId(r.id) }} aria-label="Delete"
                      className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-colors">
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>

                {confirmDeleteId === r.id && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between gap-3">
                    <p className="text-xs text-red-700">Delete this requisition? Its stock deduction will be reversed.</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={function () { setConfirmDeleteId(null) }}
                        className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">
                        Cancel
                      </button>
                      <button onClick={function () { confirmDelete(r.id) }} disabled={deletingId === r.id}
                        className="px-2.5 py-1.5 text-xs font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
                        {deletingId === r.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default StoreRequisitions
