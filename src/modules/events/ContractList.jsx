import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge } from '../../components/ui/Badge'
import { formatDate, formatPaise, titleCase } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import EnteredMark from '../../components/ui/EnteredMark'
import Icon from '../../components/ui/Icon'

// The list's columns from sm up: event, contract, date, venue, balance, Tally.
var COLS = 'sm:grid-cols-[minmax(0,2.4fr)_90px_110px_minmax(0,1.5fr)_150px_120px]'
var CTL = 'h-10 rounded-xl border border-slate-200 bg-white text-[13.5px] text-slate-800 focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5'

var DEPT_BADGE = {
  Venue: 'bg-blue-100 text-blue-700',
  Decor: 'bg-purple-100 text-purple-700',
  Catering: 'bg-amber-100 text-amber-700',
  Entertainment: 'bg-pink-100 text-pink-700',
}

var CONTRACT_SELECT = 'id, lms_event_id, contract_no, contract_date, function_date, department, contract_type, ' +
  'venue_name, location, contact_person, contact_number, secondary_contact, event_name, client_name, session, ' +
  'catering, total_plates, complementary_plates, extra_plates_charge, balance_received, balance_bank, ' +
  'balance_amount, status, synced_at, created_user_name, ppt_link, pdf_link, enquiry_mode, priority, address, ' +
  'is_tentative, pax, function_type, merged_into_id, tally_entered_by, tally_entered_at'

// LMS's own indoor/outdoor flag — confirmed directly against the live API:
// every department returns a `lead_type` field, "I" (one of Ambria's own
// venues) or "O" (an external/off-site booking), which sync-events already
// pulls in under `contract_type` (mapRow in supabase/functions/sync-events,
// `e[dep.d + "lead_type"]`). It was never decoded anywhere it's shown — a
// blank event_name fell back to the raw letter as a title. This is the
// authoritative signal; venue_name string-matching was a guess and is gone.
function venueTypeLabel(v) {
  return v === 'I' ? 'Indoor' : v === 'O' ? 'Outdoor' : v
}

// A flat, un-grouped list of every synced LMS contract — Events.jsx clusters
// same-guest functions into one card and hides most contract fields behind
// two levels of drill-down (group → function). This is the other view: one
// row per contract, click through to see every field events_safe carries,
// for whoever needs the raw contract detail rather than the day-of grouping.
function ContractList({ profile, deepLinkContractId }) {
  var [contracts, setContracts] = useState([])
  var [loading, setLoading] = useState(true)
  var [departments, setDepartments] = useState([])
  var [search, setSearch] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [deptFilter, setDeptFilter] = useState('')
  var [venueTypeFilter, setVenueTypeFilter] = useState('')
  var [page, setPage] = useState(1)
  var [perPage, setPerPage] = useState(25)
  var [selected, setSelected] = useState(null)

  // Deep-link from a "new contract synced" notification — pins the view to
  // just that one contract regardless of the normal date-floor/search/filter
  // state, fetched directly by id so it resolves even if the contract falls
  // outside the default list window. Local state (not read straight off the
  // prop) so "Clear" can drop it without needing the parent to forget it too.
  var [filterId, setFilterId] = useState(deepLinkContractId || null)
  var [pinnedContract, setPinnedContract] = useState(null)
  var [pinnedLoading, setPinnedLoading] = useState(false)

  useEffect(function () {
    if (deepLinkContractId) setFilterId(deepLinkContractId)
  }, [deepLinkContractId])

  useEffect(function () {
    if (!filterId) { setPinnedContract(null); return }
    setPinnedLoading(true)
    supabase.from('events_safe').select(CONTRACT_SELECT).eq('id', filterId).maybeSingle()
      .then(function (res) {
        setPinnedContract(res.data || null)
        setSelected(res.data || null)
        if (res.data) loadEnteredNames([res.data])
        setPinnedLoading(false)
      })
  }, [filterId])
  var refData = useReferenceData()
  var venueMap = useMemo(function () {
    var m = {}
    refData.venues.filter(function (v) { return v.active }).forEach(function (v) { if (v.name) m[v.name] = v.code })
    return m
  }, [refData.venues])

  var isAdmin = hasPerm(profile?.permsNew, 'events.list')
  var isSysAdmin = hasPerm(profile?.permsNew, 'admin.dashboard')
  var canMarkEntered = hasPerm(profile?.permsNew, 'finance.wallet.mark_entered')
  var userEventDeptNames = (profile?.event_dept_ids || []).map(function (id) {
    var dept = departments.find(function (d) { return d.id === id })
    return dept ? dept.name : null
  }).filter(Boolean)
  var hasEventDeptFilter = !isAdmin && userEventDeptNames.length > 0

  var [enteredNames, setEnteredNames] = useState({})
  var [enteringId, setEnteringId] = useState(null)
  var [enteredFilter, setEnteredFilter] = useState('')

  useEffect(function () { load() }, [])

  async function load() {
    setLoading(true)
    var dateFloor = new Date()
    dateFloor.setDate(dateFloor.getDate() - 5)
    var dateFloorStr = dateFloor.toISOString().split('T')[0]
    var [res, deptRes] = await Promise.all([
      supabase.from('events_safe')
        .select(CONTRACT_SELECT)
        .gte('function_date', dateFloorStr)
        .is('merged_into_id', null)
        .order('function_date', { ascending: false })
        .limit(2000),
      supabase.from('departments').select('id, name').eq('active', true).eq('hide_from_lists', false),
    ])
    setDepartments(deptRes.data || [])
    var rows = res.data || []
    setContracts(rows)
    loadEnteredNames(rows)
    setLoading(false)
  }

  function loadEnteredNames(rows) {
    var ids = []
    rows.forEach(function (c) { if (c.tally_entered_by && ids.indexOf(c.tally_entered_by) === -1) ids.push(c.tally_entered_by) })
    if (ids.length === 0) return
    supabase.from('profiles').select('id, name').in('id', ids).then(function (res) {
      var next = {}
      ;(res.data || []).forEach(function (p) { next[p.id] = p.name })
      setEnteredNames(function (prev) { return Object.assign({}, prev, next) })
    })
  }

  async function toggleContractEntered(id) {
    if (enteringId) return
    setEnteringId(id)
    var res = await supabase.rpc('fn_toggle_event_tally_entered', { p_event_id: id })
    setEnteringId(null)
    if (res.error) { alert('Failed: ' + res.error.message); return }
    var patch = res.data
      ? { tally_entered_by: profile.id, tally_entered_at: new Date().toISOString() }
      : { tally_entered_by: null, tally_entered_at: null }
    setContracts(function (prev) { return prev.map(function (c) { return c.id === id ? Object.assign({}, c, patch) : c }) })
    setPinnedContract(function (prev) { return prev && prev.id === id ? Object.assign({}, prev, patch) : prev })
    setSelected(function (prev) { return prev && prev.id === id ? Object.assign({}, prev, patch) : prev })
    if (res.data && profile.name) setEnteredNames(function (prev) { return Object.assign({}, prev, { [profile.id]: profile.name }) })
  }

  var visible = hasEventDeptFilter
    ? contracts.filter(function (c) { return userEventDeptNames.includes(c.department) })
    : contracts

  var venueNames = [...new Set(contracts.map(function (c) { return c.venue_name }).filter(Boolean))]

  var searchLower = search.toLowerCase()
  var filtered = visible.filter(function (c) {
    var matchSearch = !search ||
      (c.client_name || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (c.event_name || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (c.contact_person || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (c.contact_number || '').indexOf(search) !== -1 ||
      (c.contract_no || '').indexOf(search) !== -1 ||
      (c.venue_name || '').toLowerCase().indexOf(searchLower) !== -1
    var matchVenue = !venueFilter || c.venue_name === venueFilter
    var matchDept = !deptFilter || c.department === deptFilter
    var matchEntered = !enteredFilter || (enteredFilter === 'yes' ? !!c.tally_entered_by : !c.tally_entered_by)
    var matchVenueType = !venueTypeFilter || c.contract_type === (venueTypeFilter === 'outdoor' ? 'O' : 'I')
    return matchSearch && matchVenue && matchDept && matchEntered && matchVenueType
  })

  var totalPages = Math.ceil(filtered.length / perPage)
  var paged = filtered.slice((page - 1) * perPage, page * perPage)
  var rowsToShow = filterId ? (pinnedContract ? [pinnedContract] : []) : paged

  if (loading) {
    return <p className="text-slate-500 text-[13px] text-center py-10">Loading contracts…</p>
  }

  return (
    <div className="space-y-4">
      {filterId && (
        <div className="flex items-center justify-between gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
          <p className="text-sm font-semibold text-indigo-900">Showing 1 contract from your notification</p>
          <button type="button" onClick={function () { setFilterId(null) }}
            className="shrink-0 text-xs font-bold text-indigo-600 hover:text-indigo-800">
            Clear — view all
          </button>
        </div>
      )}

      {/* Toolbar: search and the four filters on one line, page size at
          its end, the count under it. */}
      {!filterId && (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)] p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input type="text" value={search}
              onChange={function (e) { setSearch(e.target.value); setPage(1) }}
              placeholder="Search client, event, contract, venue…"
              className={CTL + ' w-full pl-9 pr-3 placeholder:text-slate-400'}
              style={{ fontSize: '16px' }} />
          </div>
          {[
            [venueFilter, setVenueFilter, 'mapPin', 'Venue', [['', 'All venues']].concat(venueNames.map(function (v) { return [v, venueMap[v] ? (venueMap[v] + ' — ' + v) : v] })), 'sm:w-52'],
            [deptFilter, setDeptFilter, 'tag', 'Department', [['', 'All depts']].concat(departments.map(function (d) { return [d.name, d.name] })), 'sm:w-40'],
            [enteredFilter, setEnteredFilter, 'checkCircle', 'Entered in Tally', [['', 'Entered: all'], ['yes', 'Entered'], ['no', 'Not entered']], 'sm:w-40'],
            [venueTypeFilter, setVenueTypeFilter, 'building', 'Indoor or outdoor', [['', 'Indoor & outdoor'], ['indoor', 'Indoor'], ['outdoor', 'Outdoor']], 'sm:w-44'],
          ].map(function (f) {
            return (
              <div key={f[3]} className={'relative w-[calc(50%-4px)] ' + f[5]}>
                <Icon name={f[2]} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select value={f[0]} onChange={function (e) { f[1](e.target.value); setPage(1) }} aria-label={f[3]}
                  className={CTL + ' w-full pl-8 pr-8 appearance-none ' + (f[0] ? '' : 'text-slate-500')}>
                  {f[4].map(function (o) { return <option key={o[0]} value={o[0]}>{o[1]}</option> })}
                </select>
                <Icon name="chevronDown" size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            )
          })}
          <span className="relative ml-auto">
            <select value={perPage}
              onChange={function (e) { setPerPage(Number(e.target.value)); setPage(1) }}
              aria-label="Per page"
              className={CTL + ' pl-3 pr-8 appearance-none font-semibold'}>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
            <Icon name="chevronDown" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-0.5 text-[12.5px] text-slate-500">
          <span className="h-6 px-2 rounded-md bg-slate-100 inline-flex items-center"><b className="text-slate-800 tabular-nums">{filtered.length}</b>&nbsp;contract{filtered.length === 1 ? '' : 's'}</span>
          {(venueFilter || deptFilter || enteredFilter || venueTypeFilter || search) && (
            <button type="button" onClick={function () { setSearch(''); setVenueFilter(''); setDeptFilter(''); setEnteredFilter(''); setVenueTypeFilter(''); setPage(1) }}
              className="h-6 px-2 rounded-md font-bold text-indigo-600 hover:bg-indigo-50">Reset</button>
          )}
        </div>
      </div>
      )}

      {filterId && pinnedLoading && (
        <p className="text-slate-500 text-[13px] text-center py-8">Loading contract…</p>
      )}
      {filterId && !pinnedLoading && !pinnedContract && (
        <p className="text-slate-500 text-[13px] text-center py-8">That contract couldn't be found — it may have been merged or removed.</p>
      )}
      {!filterId && filtered.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl px-6 py-14 text-center">
          <span className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 inline-flex items-center justify-center mb-3"><Icon name="fileText" size={22} /></span>
          <p className="font-display text-[15px] font-bold text-slate-800">No contracts found</p>
          <p className="mt-1 text-[13px] text-slate-500">Try a different search or loosen a filter.</p>
        </div>
      )}

      {/* The contracts: one card of rows. From sm up the rows line up in
          columns under a header; on a phone each row stacks. */}
      {rowsToShow.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)] overflow-hidden">
          <div className={'hidden sm:grid ' + COLS + ' gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[11.5px] font-bold uppercase tracking-[0.07em] text-slate-500'}>
            <span>Event</span><span>Contract</span><span>Date</span><span>Venue</span><span className="text-right">Balance</span><span className="text-right">Tally</span>
          </div>
          <div className="divide-y divide-slate-100">
            {rowsToShow.map(function (c) {
              return (
                <div key={c.id} role="button" tabIndex={0}
                  onClick={function () { setSelected(c) }}
                  onKeyDown={function (e) { if (e.key === 'Enter') setSelected(c) }}
                  className={'group cursor-pointer px-4 py-3 hover:bg-indigo-50/40 transition-colors sm:grid ' + COLS + ' sm:gap-3 sm:items-center'}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display text-[14px] font-bold tracking-[-0.01em] text-slate-900 truncate group-hover:text-indigo-700">{c.event_name || '—'}</h3>
                      {c.is_tentative && <span className="shrink-0 text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Tentative</span>}
                      {c.department && <span className={'shrink-0 text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded ' + (DEPT_BADGE[c.department] || 'bg-slate-100 text-slate-600')}>{c.department}</span>}
                    </div>
                    <p className="text-[12.5px] text-slate-600 truncate mt-0.5">{titleCase(c.client_name || '—')}</p>
                    {/* phone: the columns as one meta line */}
                    <p className="sm:hidden mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-slate-500">
                      {c.contract_no && <span className="font-mono">#{c.contract_no}</span>}
                      <span className="inline-flex items-center gap-1"><Icon name="calendar" size={12} className="text-slate-400" />{formatDate(c.function_date || c.contract_date)}</span>
                      {c.venue_name && <span className="inline-flex items-center gap-1"><Icon name="mapPin" size={12} className="text-slate-400" />{c.venue_name}</span>}
                    </p>
                  </div>
                  <span className="hidden sm:block font-mono text-[12.5px] text-slate-600">{c.contract_no ? '#' + c.contract_no : '—'}</span>
                  <span className="hidden sm:block text-[13px] text-slate-700 tabular-nums">{formatDate(c.function_date || c.contract_date)}</span>
                  <span className="hidden sm:block text-[13px] text-slate-600 truncate">{c.venue_name || '—'}</span>
                  <span className="hidden sm:block text-right">
                    {isAdmin && c.balance_amount ? (
                      <span className={'text-[13px] font-bold tabular-nums ' + (c.balance_amount < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {formatPaise(Math.abs(c.balance_amount))}
                        <span className="ml-1 text-[11px] font-semibold opacity-80">{c.balance_amount < 0 ? 'due' : 'adv'}</span>
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </span>
                  <div className="mt-2 sm:mt-0 flex sm:justify-end items-center gap-3">
                    {isAdmin && c.balance_amount ? (
                      <span className={'sm:hidden text-[12.5px] font-bold tabular-nums ' + (c.balance_amount < 0 ? 'text-red-600' : 'text-emerald-600')}>
                        {formatPaise(Math.abs(c.balance_amount))} {c.balance_amount < 0 ? 'due' : 'adv'}
                      </span>
                    ) : null}
                    {(c.tally_entered_by || canMarkEntered) && (
                      <span onClick={function (ev) { ev.stopPropagation() }} className="ml-auto sm:ml-0">
                        <EnteredMark
                          entered={!!c.tally_entered_by}
                          enteredByName={enteredNames[c.tally_entered_by]}
                          enteredAt={c.tally_entered_at}
                          canToggle={canMarkEntered}
                          canUnenter={c.tally_entered_by === profile.id || isSysAdmin}
                          busy={enteringId === c.id}
                          onToggle={function () { toggleContractEntered(c.id) }}
                        />
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {!filterId && totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
          {[['«', 1, page === 1, 'First page'], ['‹', page - 1, page === 1, 'Previous page']].map(function (b) {
            return <button key={b[3]} onClick={function () { setPage(b[1]) }} disabled={b[2]} aria-label={b[3]}
              className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-[13px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">{b[0]}</button>
          })}
          {Array.from({ length: totalPages }, function (_, i) { return i + 1 }).filter(function (p) {
            return p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)
          }).map(function (p, i, arr) {
            var showGap = i > 0 && p - arr[i - 1] > 1
            return (
              <span key={p} className="inline-flex items-center gap-1.5">
                {showGap && <span className="px-0.5 text-slate-300">…</span>}
                <button onClick={function () { setPage(p) }} aria-current={p === page ? 'page' : undefined}
                  className={'h-9 min-w-[36px] px-2.5 rounded-lg text-[13px] font-bold tabular-nums transition-colors ' +
                    (p === page ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>{p}</button>
              </span>
            )
          })}
          {[['›', page + 1, page === totalPages, 'Next page'], ['»', totalPages, page === totalPages, 'Last page']].map(function (b) {
            return <button key={b[3]} onClick={function () { setPage(b[1]) }} disabled={b[2]} aria-label={b[3]}
              className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-[13px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">{b[0]}</button>
          })}
          <span className="text-[12px] text-slate-500 ml-2">Page {page} of {totalPages}</span>
        </div>
      )}

      {/* ═══ CONTRACT DETAIL MODAL — every events_safe field ═══ */}
      <Modal open={!!selected} onClose={function () { setSelected(null) }}
        title={selected ? (selected.event_name || '—') : ''} wide>
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              {selected.is_tentative && <Badge color="amber">Tentative — no LMS contract yet</Badge>}
              {selected.department && <Badge color="indigo">{selected.department}</Badge>}
              {selected.status && <Badge color="gray">{selected.status}</Badge>}
            </div>

            <div className="space-y-1.5">
              {[
                ['Contract #', selected.contract_no],
                ['LMS Event ID', selected.lms_event_id],
                ['Client', selected.client_name ? titleCase(selected.client_name) : null],
                ['Contact person', selected.contact_person],
                ['Contact number', selected.contact_number],
                ['Secondary contact', selected.secondary_contact],
                ['Contract date', selected.contract_date ? formatDate(selected.contract_date) : null],
                ['Function date', selected.function_date ? formatDate(selected.function_date) : null],
                ['Venue type', venueTypeLabel(selected.contract_type)],
                ['Function type', selected.function_type],
                ['Venue', selected.venue_name],
                ['Location', selected.location],
                ['Address', selected.address],
                ['Session', selected.session],
                ['Catering', selected.catering],
                ['Total plates', selected.total_plates],
                ['Pax', selected.pax],
                ['Complimentary plates', selected.complementary_plates],
                ['Extra plates charge', selected.extra_plates_charge],
                ['Enquiry mode', selected.enquiry_mode],
                ['Priority', selected.priority],
                ['Created by (LMS)', selected.created_user_name],
                ['Last synced', selected.synced_at ? formatDate(selected.synced_at) : null],
              ].filter(function (row) { return row[1] != null && row[1] !== '' }).map(function (row) {
                return (
                  <div key={row[0]} className="flex justify-between gap-3">
                    <span className="text-gray-500 flex-shrink-0">{row[0]}</span>
                    <span className="font-medium text-gray-800 text-right">{row[1]}</span>
                  </div>
                )
              })}
            </div>

            {isAdmin && (selected.balance_received != null || selected.balance_bank != null || selected.balance_amount != null) && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Balance</p>
                {selected.balance_received != null && (
                  <div className="flex justify-between"><span className="text-gray-500">Cash received</span><span className="font-medium text-gray-800">{formatPaise(selected.balance_received)}</span></div>
                )}
                {selected.balance_bank != null && (
                  <div className="flex justify-between"><span className="text-gray-500">Bank received</span><span className="font-medium text-gray-800">{formatPaise(selected.balance_bank)}</span></div>
                )}
                {selected.balance_amount != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">{selected.balance_amount < 0 ? 'Due' : 'Advance'}</span>
                    <span className={"font-bold " + (selected.balance_amount < 0 ? "text-red-600" : "text-green-600")}>{formatPaise(Math.abs(selected.balance_amount))}</span>
                  </div>
                )}
              </div>
            )}

            {(selected.tally_entered_by || canMarkEntered) && (
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-xs font-semibold text-gray-500">Entered in Tally</span>
                <EnteredMark
                  entered={!!selected.tally_entered_by}
                  enteredByName={enteredNames[selected.tally_entered_by]}
                  enteredAt={selected.tally_entered_at}
                  canToggle={canMarkEntered}
                  canUnenter={selected.tally_entered_by === profile.id || isSysAdmin}
                  busy={enteringId === selected.id}
                  onToggle={function () { toggleContractEntered(selected.id) }}
                />
              </div>
            )}

            {(selected.pdf_link || selected.ppt_link) && (
              <div className="flex gap-3">
                {selected.pdf_link && (
                  <a href={selected.pdf_link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                    {selected.department === 'Catering' ? 'View menu PDF' : 'View contract PDF'} ↗
                  </a>
                )}
                {selected.ppt_link && <a href={selected.ppt_link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">View PPT ↗</a>}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default ContractList
