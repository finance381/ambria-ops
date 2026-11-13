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
var PAGE_SIZE = 20

// Same label and grouping StoreRequisitionReport.jsx uses for the merged
// report's department rows — a card's badges are the same groups, just one
// requisition's worth instead of a whole period's.
function deptRowLabel(dr) {
  var dept = (dr.departments && dr.departments.name) || 'Unknown dept'
  var sub = dr.sub_departments && dr.sub_departments.name
  var label = sub ? dept + ' – ' + sub : dept
  if (dr.section) label += ' (' + dr.section + ')'
  return label
}
function deptRowGroupKey(dr) {
  return (dr.department_id || '') + '|' + (dr.sub_department_id || '') + '|' + (dr.section || '')
}

// One page's worth (or, with no range, one chunk of the "fetch everything"
// loop below) — no name/event resolution here, that's done once on the
// combined rows by the wrapper, not per chunk.
async function fetchRequisitionsPage(filters, range) {
  var query = supabase.from('store_requisitions')
    .select('id, date_from, date_to, requisition_no, total_paise, created_at, created_by, event_ids', { count: 'exact' })
    // The date the requisition is FOR, not when it was logged — a slip
    // backdated or entered late otherwise surfaced under today's date
    // rather than its own, and the newest-first order silently became
    // "most recently entered" instead of what it says it shows. id DESC is
    // the final tiebreak, so the sort is fully deterministic and a row can
    // never land on both sides of a page boundary.
    .order('date_from', { ascending: false })
    .order('date_to', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (range) query = query.range(range.from, range.to)
  // Overlap, not containment — a requisition spanning 28 Sep–2 Oct should
  // still show up for a From=1 Oct filter, not just ones starting on/after it.
  if (filters.dateFrom) query = query.gte('date_to', filters.dateFrom)
  if (filters.dateTo) query = query.lte('date_from', filters.dateTo)
  if (filters.searchNo) query = query.ilike('requisition_no', '%' + filters.searchNo + '%')
  // event_ids is bigint[] NOT NULL DEFAULT '{}' — "linked" is a non-empty
  // array, "unlinked" the empty-array literal, matched directly rather than
  // fetched in full and checked client-side.
  if (filters.linkFilter === 'linked') query = query.not('event_ids', 'eq', '{}')
  else if (filters.linkFilter === 'unlinked') query = query.eq('event_ids', '{}')
  return query
}

// Shared by the paginated list and the merged report below — every filter
// (date range, search, linked/unlinked) runs here, server-side, so both
// "page N of M" and the report's totals reflect the whole table rather than
// whatever page happened to already be loaded. `range` is {from, to} for one
// page of the list, or null for the report's "every matching row" fetch.
// `includeDeptBadges` resolves each row's `_deptBadges` (used by the list's
// cards) — skipped for the report's fetch, which already pulls every
// dept row itself for the aggregated table and has no per-card use for this.
async function fetchRequisitions(filters, range, includeDeptBadges) {
  var rows, count

  if (range) {
    var res = await fetchRequisitionsPage(filters, range)
    if (res.error) return { rows: [], count: null, error: res.error }
    rows = res.data || []
    count = res.count || 0
  } else {
    // The report needs every matching row, not one response's worth —
    // PostgREST/Supabase caps a single response (default 1000), which would
    // otherwise silently truncate a report over a long enough date range.
    // Paged through in chunks and concatenated instead of trusting one call
    // to return everything.
    var BATCH = 1000
    var all = []
    var total = null
    var offset = 0
    for (;;) {
      var batchRes = await fetchRequisitionsPage(filters, { from: offset, to: offset + BATCH - 1 })
      if (batchRes.error) return { rows: [], count: null, error: batchRes.error }
      var batchRows = batchRes.data || []
      all = all.concat(batchRows)
      if (total == null) total = batchRes.count || 0
      offset += BATCH
      if (batchRows.length < BATCH || all.length >= total) break
    }
    rows = all
    count = total || 0
  }

  var uids = []
  rows.forEach(function (r) { if (r.created_by && uids.indexOf(r.created_by) === -1) uids.push(r.created_by) })
  if (uids.length > 0) {
    var { data: names } = await supabase.rpc('get_profile_names', { p_ids: uids })
    var map = {}
    ;(names || []).forEach(function (n) { map[n.id] = n.name })
    rows = rows.map(function (r) { return Object.assign({}, r, { _createdByName: map[r.created_by] || null }) })
  }
  // event_ids is the real link to a function — the "LINKED" badge only ever
  // said whether one existed, never which. Collected across every row in
  // one batch rather than one query per row.
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
  if (includeDeptBadges && rows.length > 0) {
    var reqIds = rows.map(function (r) { return r.id })
    var CHUNK = 500
    var deptRowsAll = []
    for (var di = 0; di < reqIds.length; di += CHUNK) {
      var idChunk = reqIds.slice(di, di + CHUNK)
      var { data: chunkRows } = await supabase.from('store_requisition_dept_rows')
        .select('store_requisition_id, department_id, sub_department_id, section, departments(name), sub_departments(name)')
        .in('store_requisition_id', idChunk)
      deptRowsAll = deptRowsAll.concat(chunkRows || [])
    }
    // Two slips for the same department/sub-department/section within one
    // requisition (e.g. two separate Indian Kitchen rows) collapse to one
    // badge — the badge says which departments touched this requisition,
    // not how many rows it took to say so.
    var seenKeysByReq = {}
    var badgesByReq = {}
    deptRowsAll.forEach(function (dr) {
      var reqId = dr.store_requisition_id
      var seen = seenKeysByReq[reqId] || (seenKeysByReq[reqId] = {})
      var key = deptRowGroupKey(dr)
      if (seen[key]) return
      seen[key] = true
      ;(badgesByReq[reqId] || (badgesByReq[reqId] = [])).push(deptRowLabel(dr))
    })
    rows = rows.map(function (r) {
      // Sorted rather than left in whatever order the query happened to
      // return — the dept-rows query has no ORDER BY, so without this the
      // badges could shuffle between an edit and a realtime refresh.
      var badges = (badgesByReq[r.id] || []).slice().sort(function (a, b) { return a.localeCompare(b) })
      return Object.assign({}, r, { _deptBadges: badges })
    })
  }
  return { rows: rows, count: count || 0, error: null }
}

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
  var [totalCount, setTotalCount] = useState(0)
  var [page, setPage] = useState(0)
  var [loading, setLoading] = useState(true)
  var [deletingId, setDeletingId] = useState(null)
  var [confirmDeleteId, setConfirmDeleteId] = useState(null)

  // linkFilter: '' | 'linked' | 'unlinked' — whether a contract (event_ids)
  // is tagged on the requisition. Runs server-side in fetchRequisitions()
  // above, same as the date range and the search box, so paging and the
  // total count both reflect the whole table.
  var [linkFilter, setLinkFilter] = useState('')
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [filtersOpen, setFiltersOpen] = useState(false)
  // requisition_no is free text (often several physical slip numbers
  // comma-separated in one field) — substring match, not an exact lookup.
  var [searchNo, setSearchNo] = useState('')
  var [searchNoDebounced, setSearchNoDebounced] = useState('')
  useEffect(function () {
    var t = setTimeout(function () { setSearchNoDebounced(searchNo.trim()) }, 350)
    return function () { clearTimeout(t) }
  }, [searchNo])

  // A From+To range with a Linked/Unlinked pick (not "All") is specific
  // enough to mean "give me the period, not just a narrower list" — that
  // combination swaps the list for the merged report instead.
  var showReport = !!(dateFrom && dateTo && linkFilter)

  var [loadError, setLoadError] = useState(null)
  // Guards against two overlapping load() calls landing out of order (e.g. a
  // realtime refresh firing while a page change is still in flight) — only
  // the response to the most recently *started* call is ever applied.
  var loadSeq = useRef(0)

  async function load() {
    if (showReport) return  // the report (below) fetches its own data; no need for this page too
    var mySeq = ++loadSeq.current
    setLoading(true)
    var offset = page * PAGE_SIZE
    var res = await fetchRequisitions(
      { dateFrom: dateFrom, dateTo: dateTo, searchNo: searchNoDebounced, linkFilter: linkFilter },
      { from: offset, to: offset + PAGE_SIZE - 1 },
      true
    )
    if (mySeq !== loadSeq.current) return  // a newer load() has since started — drop this response
    if (res.error) {
      // Left stale rather than blanked out — an empty table reading "No
      // store requisitions yet" would be actively misleading on a failed
      // fetch, since nothing has actually changed.
      setLoadError(res.error.message || 'Failed to load')
      setLoading(false)
      return
    }
    setLoadError(null)
    // A row that was the last one on the last page (deleted here, or by
    // someone else via realtime) leaves `page` pointing past the new end —
    // PostgREST answers that with an empty page (or, further past the end,
    // a 416), not a reason to say "No store requisitions yet". Step back to
    // the new last page instead; the effect below re-fetches it.
    if (res.rows.length === 0 && res.count > 0 && page > 0) {
      setPage(Math.max(0, Math.ceil(res.count / PAGE_SIZE) - 1))
      return
    }
    setReqs(res.rows)
    setTotalCount(res.count)
    setLoading(false)
  }

  // load() closes over page/dateFrom/dateTo/linkFilter/searchNoDebounced, so
  // it's re-run whenever any of them change — but useRealtime only ever
  // subscribes once (on mount), and confirmDelete()/the form's onDone can
  // fire after the user has since changed page or a filter, so both would
  // otherwise keep calling that first, now-stale closure forever. Routing
  // every re-load through this ref means they always call whatever load()
  // most recently was, matching the current page/filters rather than
  // whichever were active when the call was made.
  var loadRef = useRef(load)
  loadRef.current = load
  useEffect(function () { loadRef.current() }, [page, dateFrom, dateTo, linkFilter, searchNoDebounced, showReport])
  // Also covers the report (below) — its own effect only depends on the
  // filters, which a realtime change doesn't touch, so without this it
  // would otherwise sit stale until a filter changed.
  useRealtime(['store_requisitions'], function () {
    loadRef.current()
    setReportRefreshKey(function (k) { return k + 1 })
  })
  // A filter/search change can leave `page` pointing past the end of the
  // now-smaller result set, or just stale from browsing a different filter
  // — reset to page one whenever what's being filtered on changes. This can
  // cost one redundant fetch right after a filter change (this effect and
  // the one above both react to it), harmless since loadSeq above always
  // keeps only the latest response.
  useEffect(function () { setPage(0) }, [dateFrom, dateTo, linkFilter, searchNoDebounced])

  var totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  var pageNow = Math.min(page, totalPages - 1)
  var firstShown = totalCount === 0 ? 0 : pageNow * PAGE_SIZE + 1
  var lastShown = Math.min((pageNow + 1) * PAGE_SIZE, totalCount)
  // 1 … 4 5 6 … 12, never a row of a dozen+ buttons.
  var pageButtons = []
  for (var pb = 0; pb < totalPages; pb++) {
    if (pb === 0 || pb === totalPages - 1 || (pb >= pageNow - 1 && pb <= pageNow + 1)) pageButtons.push(pb)
    else if (pageButtons[pageButtons.length - 1] !== '…') pageButtons.push('…')
  }
  function goPage(n) {
    setPage(Math.max(0, Math.min(totalPages - 1, n)))
    window.scrollTo(0, 0)
  }

  // The merged report (below) needs every matching requisition for the
  // period, not just one 20-row page of it — fetched separately, unpaginated,
  // only while that view is actually showing. refreshKey is bumped by a
  // realtime change or a save elsewhere, since this effect's own deps
  // (the filters) otherwise never change from either of those.
  var [reportReqs, setReportReqs] = useState([])
  var [reportLoading, setReportLoading] = useState(false)
  var [reportError, setReportError] = useState(null)
  var [reportRefreshKey, setReportRefreshKey] = useState(0)
  var reportSeq = useRef(0)
  useEffect(function () {
    if (!showReport) { setReportReqs([]); return }
    var mySeq = ++reportSeq.current
    setReportLoading(true)
    fetchRequisitions({ dateFrom: dateFrom, dateTo: dateTo, searchNo: searchNoDebounced, linkFilter: linkFilter }, null)
      .then(function (res) {
        if (mySeq !== reportSeq.current) return
        if (res.error) { setReportError(res.error.message || 'Failed to load'); setReportLoading(false); return }
        setReportError(null)
        setReportReqs(res.rows)
        setReportLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReport, dateFrom, dateTo, linkFilter, searchNoDebounced, reportRefreshKey])

  async function confirmDelete(id) {
    setDeletingId(id)
    var res = await supabase.rpc('rpc_delete_store_requisition', { p_id: id })
    setDeletingId(null)
    setConfirmDeleteId(null)
    if (res.error) { alert('Delete failed: ' + res.error.message); return }
    loadRef.current()
    setReportRefreshKey(function (k) { return k + 1 })
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
        onDone={function () { setView('list'); setEditId(null); loadRef.current(); setReportRefreshKey(function (k) { return k + 1 }) }}
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
      <div className="flex items-center justify-between gap-3 flex-nowrap">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900 truncate">Store Requisition</h2>
          <p className="text-xs text-gray-400">
            {showReport ? reportReqs.length : totalCount} store requisition{(showReport ? reportReqs.length : totalCount) === 1 ? '' : 's'}
          </p>
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
            className="w-full h-10 pl-9 pr-8 border border-slate-300 rounded-lg bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
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
            <button type="button" onClick={function () { setFiltersOpen(!filtersOpen) }} aria-expanded={filtersOpen}
              className={'shrink-0 inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border text-[13px] font-semibold transition-colors ' + (filtersOpen || count > 0 ? 'bg-violet-50 border-violet-300 text-violet-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50')}>
              <Icon name="filter" size={15} />
              Filters
              {count > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-violet-600 text-white text-[10.5px] font-bold tabular-nums">{count}</span>}
              <Icon name="chevronDown" size={14} className={'transition-transform ' + (filtersOpen ? 'rotate-180' : '')} />
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
              <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5">
                {/* One row on a wide screen: contract, from, to, reset */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-end">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[12px] font-medium text-slate-500 mb-1.5">Contract</label>
                    <div className="grid grid-cols-3 sm:inline-grid h-10 p-1 rounded-lg bg-slate-100 border border-slate-200">
                      {['', 'linked', 'unlinked'].map(function (f) {
                        var label = f === '' ? 'All' : f === 'linked' ? 'Linked' : 'Not linked'
                        var on = linkFilter === f
                        return (
                          <button key={f || 'all'} type="button" aria-pressed={on} onClick={function () { setLinkFilter(f === linkFilter ? '' : f) }}
                            className={'px-3.5 rounded-md text-[13px] font-semibold whitespace-nowrap transition-colors ' +
                              (on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <label className="block text-[12px] font-medium text-slate-500 mb-1.5">From</label>
                    <input type="date" value={dateFrom} max={dateTo || undefined}
                      onChange={function (e) { setDateFrom(e.target.value) }}
                      className="w-full h-10 px-3 border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20" style={{ fontSize: '15px' }} />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-[12px] font-medium text-slate-500 mb-1.5">To</label>
                    <input type="date" value={dateTo} min={dateFrom || undefined}
                      onChange={function (e) { setDateTo(e.target.value) }}
                      className="w-full h-10 px-3 border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20" style={{ fontSize: '15px' }} />
                  </div>
                  <button type="button" onClick={resetFilters} disabled={count === 0}
                    className="col-span-2 sm:col-span-1 h-10 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold text-red-600 hover:bg-red-50 disabled:text-slate-400 disabled:hover:bg-transparent disabled:cursor-default transition-colors">
                    <Icon name="refresh" size={14} />Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {showReport ? (
        reportError ? (
          <p className="text-red-600 text-sm text-center py-8">Failed to load: {reportError}</p>
        ) : reportLoading ? (
          <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
        ) : (
          <StoreRequisitionReport reqs={reportReqs} dateFrom={dateFrom} dateTo={dateTo} linkFilter={linkFilter} />
        )
      ) : loadError ? (
        <p className="text-red-600 text-sm text-center py-8">Failed to load: {loadError}</p>
      ) : loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
      ) : reqs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">{totalCount === 0 ? 'No store requisitions yet' : 'No store requisitions match these filters'}</p>
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {reqs.map(function (r) {
            // The day it is for, as a small calendar leaf: the thing people
            // scan this list by. A multi-day entry says where it ends.
            var d0 = new Date((r.date_from || '') + 'T00:00:00')
            var hasDate = !isNaN(d0.getTime())
            var isRange = r.date_to && r.date_to !== r.date_from
            var linked = r._linkedEvents && r._linkedEvents.length > 0
            var linkedText = linked ? r._linkedEvents.map(function (e) {
              return (e.event_name || e.client_name || 'Event #' + e.id) + (e.venue_name ? ' (' + e.venue_name + ')' : '')
            }).join(', ') : ''
            return (
              <div key={r.id} onClick={function () { openDetail(r.id) }}
                className="group bg-white border border-slate-200 rounded-xl px-3.5 py-3 cursor-pointer transition-all duration-200 ease-out hover:border-violet-300 hover:shadow-[0_10px_24px_-12px_rgba(76,29,149,0.35)] motion-safe:hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_180px_210px] items-center gap-x-4 gap-y-1">
                  <div className="shrink-0 w-12 h-12 rounded-xl bg-violet-50 border border-violet-100 flex flex-col items-center justify-center leading-none transition-colors duration-200 group-hover:bg-violet-600 group-hover:border-violet-600" title={formatDate(r.date_from) + (isRange ? ' – ' + formatDate(r.date_to) : '')}>
                    <span className="text-[18px] font-bold text-violet-800 tabular-nums transition-colors duration-200 group-hover:text-white">{hasDate ? d0.getDate() : '—'}</span>
                    <span className="mt-0.5 text-[11px] font-semibold text-violet-600 transition-colors duration-200 group-hover:text-violet-100">{hasDate ? d0.toLocaleString('en-IN', { month: 'short' }) : ''}</span>
                  </div>

                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 min-w-0">
                      {linked
                        ? <Icon name="link" size={13} className="shrink-0 text-emerald-600" />
                        : <Icon name="link" size={13} className="shrink-0 text-slate-300" />}
                      <span className={'truncate text-[13.5px] ' + (linked ? 'font-semibold text-slate-900' : 'font-medium text-slate-500')} title={linkedText}>
                        {linked ? linkedText : 'Not linked to a function'}
                      </span>
                      {r.requisition_no && (
                        <span className="shrink-0 text-[11px] font-semibold text-violet-700 bg-violet-50 rounded-md px-1.5 py-0.5">#{r.requisition_no}</span>
                      )}
                    </p>
                    {r._deptBadges && r._deptBadges.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        {r._deptBadges.map(function (label, bi) {
                          return (
                            <span key={bi} className="text-[11px] font-medium text-slate-600 bg-slate-100 rounded-md px-2 py-0.5">
                              {label}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    {/* phone: who logged it, under the rest (its own column on a wider screen) */}
                    <p className="md:hidden mt-1 text-[11.5px] text-slate-500">
                      {(r._createdByName || '—') + ', logged ' + formatDate(r.created_at)}{isRange ? ' · till ' + formatDate(r.date_to) : ''}
                    </p>
                  </div>

                  <div className="hidden md:block min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{r._createdByName || '—'}</p>
                    <p className="text-[11.5px] text-slate-500">Logged {formatDate(r.created_at)}</p>
                    {isRange && <p className="text-[11.5px] text-slate-500">Till {formatDate(r.date_to)}</p>}
                  </div>

                  <div className="flex flex-col items-end gap-1.5 md:flex-row md:items-center md:justify-end md:gap-3">
                    <p className="text-[15px] font-bold text-slate-900 tabular-nums whitespace-nowrap transition-colors duration-200 group-hover:text-violet-700">{formatPoints(r.total_paise || 0)}</p>
                    <div className="flex items-center gap-1">
                      <button onClick={function (ev) { ev.stopPropagation(); openForm(r.id) }} aria-label="Edit" title="Edit"
                        className="w-8 h-8 rounded-lg text-slate-400 flex items-center justify-center hover:bg-violet-50 hover:text-violet-700 transition-colors">
                        <Icon name="edit" size={15} />
                      </button>
                      <button onClick={function (ev) { ev.stopPropagation(); setConfirmDeleteId(r.id) }} aria-label="Delete" title="Delete"
                        className="w-8 h-8 rounded-lg text-slate-400 flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-colors">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
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

        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2.5">
            <p className="text-[12px] font-semibold text-gray-500" data-notranslate>
              Showing {firstShown}–{lastShown} of {totalCount}
            </p>
            <div className="flex items-center gap-1">
              <button type="button" disabled={pageNow === 0} onClick={function () { goPage(pageNow - 1) }}
                aria-label="Previous page"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors">
                <Icon name="chevronRight" size={14} className="rotate-180" />
              </button>
              {pageButtons.map(function (b, i) {
                if (b === '…') return <span key={'g' + i} className="px-1 text-[12px] font-bold text-gray-300">…</span>
                return (
                  <button key={b} type="button" onClick={function () { goPage(b) }}
                    className={'min-w-8 h-8 px-2 rounded-lg text-[12px] font-bold tabular-nums transition-colors ' +
                      (b === pageNow ? 'bg-indigo-600 text-white' : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-100')}
                    data-notranslate>{b + 1}</button>
                )
              })}
              <button type="button" disabled={pageNow >= totalPages - 1} onClick={function () { goPage(pageNow + 1) }}
                aria-label="Next page"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors">
                <Icon name="chevronRight" size={14} />
              </button>
            </div>
          </div>
        )}
        </>
      )}
    </div>
  )
}

export default StoreRequisitions
