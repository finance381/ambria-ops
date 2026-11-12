import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import StoreRequisitionForm from './StoreRequisitionForm'
import StoreRequisitionDetail from './StoreRequisitionDetail'
import StoreRequisitionReport from './StoreRequisitionReport'
import Icon from '../../components/ui/Icon'

// A standalone top-level Procurement tab, a peer of Requisitions/Purchase
// Orders/Vendors — not a tab nested inside Requisitions, since this flow has
// no approval/dispatch lifecycle at all (it deducts stock on submit).
//
// Clicking a row (not its edit/delete icons) drills into
// StoreRequisitionDetail, a read-only department-by-department breakdown
// with per-plate costing.
var PAGE_SIZE = 50

function StoreRequisitions({ profile }) {
  var [view, setView] = useState('list')
  var [editId, setEditId] = useState(null)
  var [detailId, setDetailId] = useState(null)
  // Opening a row's detail (or its edit form) fully replaces the list's own
  // returned JSX with a separate tree, so the list unmounts rather than just
  // being covered — coming back always landed at the top of the list,
  // regardless of where the person had scrolled to find that row. Captured
  // once on the way out of 'list' below, consumed once on the way back.
  var scrollMemory = useRef(null)
  useEffect(function () {
    if (view === 'list' && scrollMemory.current != null) {
      var y = scrollMemory.current
      scrollMemory.current = null
      requestAnimationFrame(function () { window.scrollTo(0, y) })
    }
  }, [view])
  var [reqs, setReqs] = useState([])
  var [loading, setLoading] = useState(true)
  var [loadingMore, setLoadingMore] = useState(false)
  var [hasMore, setHasMore] = useState(false)
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
  // requisition_no is free text (often several physical slip numbers
  // comma-separated in one field) — substring match, not an exact lookup.
  var [searchNo, setSearchNo] = useState('')

  // Guards against two overlapping load() calls landing out of order (e.g. a
  // realtime reset firing while a Load More fetch is still in flight) — only
  // the response to the most recently *started* call is ever applied.
  var loadSeq = useRef(0)

  async function load(append) {
    var mySeq = ++loadSeq.current
    var offset = append ? reqs.length : 0
    // A reset (non-append) re-fetches however many rows were already
    // showing, not just the first PAGE_SIZE — otherwise a realtime event, or
    // a delete/save elsewhere, silently collapsed someone several Load Mores
    // deep back down to page 1 every time.
    var want = append ? PAGE_SIZE : Math.max(reqs.length, PAGE_SIZE)
    if (!append) setLoading(true)
    else setLoadingMore(true)
    var query = supabase.from('store_requisitions')
      .select('id, date_from, date_to, requisition_no, total_paise, created_at, created_by, event_ids')
      // The date the requisition is FOR, not when it was logged — a slip
      // backdated or entered late otherwise surfaced under today's date
      // rather than its own, and the newest-first order silently became
      // "most recently entered" instead of what it says it shows. id DESC
      // is the final tiebreak, so the sort is fully deterministic and a
      // row can never land on both sides of a page boundary.
      .order('date_from', { ascending: false })
      .order('date_to', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + want)
    // Overlap, not containment — a requisition spanning 28 Sep–2 Oct should
    // still show up for a From=1 Oct filter, not just ones starting on/after it.
    if (dateFrom) query = query.gte('date_to', dateFrom)
    if (dateTo) query = query.lte('date_from', dateTo)
    var { data } = await query
    if (mySeq !== loadSeq.current) return  // a newer load() has since started — drop this response
    var rows = data || []
    var more = rows.length > want
    if (more) rows = rows.slice(0, want)
    var uids = []
    rows.forEach(function (r) { if (r.created_by && uids.indexOf(r.created_by) === -1) uids.push(r.created_by) })
    if (uids.length > 0) {
      var { data: names } = await supabase.rpc('get_profile_names', { p_ids: uids })
      var map = {}
      ;(names || []).forEach(function (n) { map[n.id] = n.name })
      rows = rows.map(function (r) { return Object.assign({}, r, { _createdByName: map[r.created_by] || null }) })
    }
    // event_ids is the real link to a function — the "LINKED" badge only
    // ever said whether one existed, never which. Collected across every
    // row in one batch rather than one query per row.
    var eventIds = []
    rows.forEach(function (r) {
      (r.event_ids || []).forEach(function (id) { if (eventIds.indexOf(id) === -1) eventIds.push(id) })
    })
    if (eventIds.length > 0) {
      var { data: evRows } = await supabase.from('events_safe')
        .select('id, event_name, client_name, venue_name, function_date')
        .in('id', eventIds)
      var evMap = {}
      ;(evRows || []).forEach(function (e) { evMap[e.id] = e })
      rows = rows.map(function (r) {
        var linked = (r.event_ids || []).map(function (id) { return evMap[id] }).filter(Boolean)
        return Object.assign({}, r, { _linkedEvents: linked })
      })
    }
    if (mySeq !== loadSeq.current) return  // superseded during the name/event lookups above
    if (append) {
      // Backstop against the same row appearing twice — a concurrent insert
      // can shift page boundaries by one between the first page and a Load
      // More click (see the comment on loadSeq above for the race this
      // guards against; this covers the rarer case where both requests were
      // legitimately the latest one in turn, just over a moving table).
      setReqs(function (prev) {
        var seen = prev.map(function (p) { return p.id })
        var fresh = rows.filter(function (r) { return seen.indexOf(r.id) === -1 })
        return prev.concat(fresh)
      })
    } else {
      setReqs(rows)
    }
    setHasMore(more)
    setLoading(false)
    setLoadingMore(false)
  }

  // load() closes over dateFrom/dateTo/reqs.length, so it's re-run whenever
  // they change — but useRealtime only ever subscribes once (on mount) and
  // would otherwise keep calling that first, now-stale closure forever.
  // Routing its callback through a ref means it always calls whatever load()
  // most recently was.
  var loadRef = useRef(load)
  loadRef.current = load
  useEffect(function () { load(false) }, [dateFrom, dateTo])
  // A realtime change re-syncs the rows already on screen (load()'s `want`
  // covers however many that is) rather than appending past them — a filter
  // change or a deletion elsewhere can shift which rows belong in that
  // window, and range()-based paging has no way to patch just the delta in.
  useRealtime(['store_requisitions'], function () { loadRef.current(false) })

  var visibleReqs = reqs.filter(function (r) {
    if (searchNo.trim() && (r.requisition_no || '').toLowerCase().indexOf(searchNo.trim().toLowerCase()) === -1) return false
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

  function openForm(id) {
    scrollMemory.current = window.scrollY
    setEditId(id)
    setView('form')
  }
  function openDetail(id) {
    scrollMemory.current = window.scrollY
    setDetailId(id)
    setView('detail')
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

  // A From+To range with a Linked/Unlinked pick (not "All") is specific
  // enough to mean "give me the period, not just a narrower list" — that
  // combination swaps the list for the merged report instead.
  var showReport = !!(dateFrom && dateTo && linkFilter)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-nowrap">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900 truncate">Store Requisition</h2>
          <p className="text-xs text-gray-400">{visibleReqs.length} store requisitions</p>
        </div>
        <button onClick={function () { openForm(null) }}
          className="shrink-0 px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors whitespace-nowrap">
          + New Store Requisition
        </button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" value={searchNo} onChange={function (e) { setSearchNo(e.target.value) }}
            placeholder="Search by requisition / slip number…"
            className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm placeholder:text-gray-400"
            style={{ fontSize: '16px' }} />
          {searchNo && (
            <button onClick={function () { setSearchNo('') }} aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        {(function () {
          var count = (linkFilter ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)
          return (
            <button onClick={function () { setFiltersOpen(!filtersOpen) }}
              className={'shrink-0 px-3.5 py-2 text-xs font-bold rounded-lg border transition-colors flex items-center gap-1.5 ' + (filtersOpen || count > 0 ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
              {filtersOpen ? '▲' : '▼'} Filters
              {count > 0 && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-600 text-white text-[9.5px] font-bold">{count}</span>}
            </button>
          )
        })()}
      </div>

      {(function () {
        var count = (linkFilter ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)
        function resetFilters() { setLinkFilter(''); setDateFrom(''); setDateTo('') }
        return (
          <div className="space-y-2">
            {count > 0 && !filtersOpen && (
              <button onClick={resetFilters} className="text-[11px] font-bold text-red-600 hover:text-red-700">
                Reset filters
              </button>
            )}
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
                {count > 0 && (
                  <button onClick={resetFilters} className="text-[11px] font-bold text-red-600 hover:text-red-700">
                    Reset filters
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {showReport ? (
        <StoreRequisitionReport reqs={visibleReqs} dateFrom={dateFrom} dateTo={dateTo} linkFilter={linkFilter} />
      ) : loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
      ) : visibleReqs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center space-y-3">
          <p className="text-gray-400 text-sm">
            {reqs.length === 0 ? 'No store requisitions yet'
              // searchNo/linkFilter only ever run over the rows already
              // fetched (date range is the one filter the query itself
              // applies) — so a miss here can just mean the match is on an
              // older page, not that nothing matches at all.
              : hasMore ? "No match in what's loaded so far — there are older requisitions to search"
              : 'No store requisitions match these filters'}
          </p>
          {hasMore && (
            <button onClick={function () { load(true) }} disabled={loadingMore}
              className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
              {loadingMore ? 'Loading...' : 'Load More'}
            </button>
          )}
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {visibleReqs.map(function (r) {
            return (
              <div key={r.id} onClick={function () { openDetail(r.id) }}
                className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-indigo-300 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                      {r.date_from === r.date_to ? formatDate(r.date_from) : (formatDate(r.date_from) + ' – ' + formatDate(r.date_to))}
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
                    {r._linkedEvents && r._linkedEvents.length > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {r._linkedEvents.map(function (e) {
                          return (e.event_name || e.client_name || 'Event #' + e.id) +
                            (e.venue_name ? ' (' + e.venue_name + ')' : '')
                        }).join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-indigo-600 whitespace-nowrap">{formatPoints(r.total_paise || 0)}</p>
                    <button onClick={function (ev) { ev.stopPropagation(); openForm(r.id) }} aria-label="Edit"
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
        {/* Loads another 50 past the server-side range() window above —
            visibleReqs can run short of PAGE_SIZE once a search/link filter
            is applied over a page that still has more to give, so this
            checks the fetch's own hasMore rather than the filtered count. */}
        {hasMore && (
          <button onClick={function () { load(true) }} disabled={loadingMore}
            className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
            {loadingMore ? 'Loading...' : 'Load More'}
          </button>
        )}
        </>
      )}
    </div>
  )
}

export default StoreRequisitions
