import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import StoreRequisitionForm from './StoreRequisitionForm'
import StoreRequisitionDetail from './StoreRequisitionDetail'
import Icon from '../../components/ui/Icon'

// A standalone top-level Procurement tab, a peer of Requisitions/Purchase
// Orders/Vendors — not a tab nested inside Requisitions, since this flow has
// no approval/dispatch lifecycle at all (it deducts stock on submit).
//
// List has no filters yet — that's still a separate pass. Clicking a row
// (not its edit/delete icons) drills into StoreRequisitionDetail, a
// read-only department-by-department breakdown with per-plate costing.
function StoreRequisitions({ profile }) {
  var [view, setView] = useState('list')
  var [editId, setEditId] = useState(null)
  var [detailId, setDetailId] = useState(null)
  var [reqs, setReqs] = useState([])
  var [loading, setLoading] = useState(true)
  var [deletingId, setDeletingId] = useState(null)
  var [confirmDeleteId, setConfirmDeleteId] = useState(null)

  // linkFilter: '' | 'linked' | 'unlinked' — whether a contract (event_ids)
  // is tagged on the requisition. Checked client-side after fetch (array
  // length), same as every other filter here; From/To narrow the query
  // itself since those are plain date columns.
  var [linkFilter, setLinkFilter] = useState('')
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [filtersOpen, setFiltersOpen] = useState(false)

  async function load() {
    setLoading(true)
    var query = supabase.from('store_requisitions')
      .select('id, date_from, date_to, requisition_no, total_paise, created_at, created_by, event_ids')
      .order('created_at', { ascending: false })
      .limit(50)
    // Overlap, not containment — a requisition spanning 28 Sep–2 Oct should
    // still show up for a From=1 Oct filter, not just ones starting on/after it.
    if (dateFrom) query = query.gte('date_to', dateFrom)
    if (dateTo) query = query.lte('date_from', dateTo)
    var { data } = await query
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

  // load() closes over dateFrom/dateTo, so it's re-run whenever they change —
  // but useRealtime only ever subscribes once (on mount) and would otherwise
  // keep calling that first, now-stale closure forever. Routing its callback
  // through a ref means it always calls whatever load() most recently was.
  var loadRef = useRef(load)
  loadRef.current = load
  useEffect(function () { load() }, [dateFrom, dateTo])
  useRealtime(['store_requisitions'], function () { loadRef.current() })

  var visibleReqs = reqs.filter(function (r) {
    if (!linkFilter) return true
    var isLinked = !!(r.event_ids && r.event_ids.length > 0)
    return linkFilter === 'linked' ? isLinked : !isLinked
  })

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

  if (view === 'detail') {
    return (
      <StoreRequisitionDetail
        id={detailId}
        onBack={function () { setView('list'); setDetailId(null) }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Store Requisition</h2>
          <p className="text-xs text-gray-400">{visibleReqs.length} store requisitions</p>
        </div>
        <button onClick={function () { setEditId(null); setView('form') }}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
          + New Store Requisition
        </button>
      </div>

      {(function () {
        var count = (linkFilter ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)
        function resetFilters() { setLinkFilter(''); setDateFrom(''); setDateTo('') }
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button onClick={function () { setFiltersOpen(!filtersOpen) }}
                className={'flex-1 py-2 text-xs font-bold rounded-lg border transition-colors ' + (filtersOpen ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
                {filtersOpen ? '▲' : '▼'} Filters{count > 0 ? ' · ' + count : ''}
              </button>
              {count > 0 && (
                <button onClick={resetFilters}
                  className="px-3 py-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                  Reset
                </button>
              )}
            </div>
            {filtersOpen && (
              <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Contract</label>
                  <div className="flex gap-2 flex-wrap">
                    {['', 'linked', 'unlinked'].map(function (f) {
                      var label = f === '' ? 'All' : f === 'linked' ? 'Linked' : 'Unlinked'
                      return (
                        <button key={f} onClick={function () { setLinkFilter(f === linkFilter ? '' : f) }}
                          className={'px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors ' +
                            (linkFilter === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
                    <input type="date" value={dateFrom}
                      onChange={function (e) { setDateFrom(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
                    <input type="date" value={dateTo}
                      onChange={function (e) { setDateTo(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
      ) : visibleReqs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">{reqs.length === 0 ? 'No store requisitions yet' : 'No store requisitions match these filters'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleReqs.map(function (r) {
            return (
              <div key={r.id} onClick={function () { setDetailId(r.id); setView('detail') }}
                className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-indigo-300 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                      {formatDate(r.date_from)} – {formatDate(r.date_to)}
                      {r.requisition_no && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
                          #{r.requisition_no}
                        </span>
                      )}
                      {r.event_ids && r.event_ids.length > 0 ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                          Linked
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
                          Unlinked
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{r._createdByName || '—'} · {formatDate(r.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-indigo-600 whitespace-nowrap">{formatPoints(r.total_paise || 0)}</p>
                    <button onClick={function (ev) { ev.stopPropagation(); setEditId(r.id); setView('form') }} aria-label="Edit"
                      className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                      <Icon name="edit" size={14} />
                    </button>
                    <button onClick={function (ev) { ev.stopPropagation(); setConfirmDeleteId(r.id) }} aria-label="Delete"
                      className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-colors">
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>

                {confirmDeleteId === r.id && (
                  <div onClick={function (ev) { ev.stopPropagation() }}
                    className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between gap-3">
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
