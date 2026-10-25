import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge } from '../../components/ui/Badge'
import { formatDate, formatPaise, titleCase } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import EnteredMark from '../../components/ui/EnteredMark'
import Icon from '../../components/ui/Icon'
import EventLedger from '../expenses/EventLedger'
import EventDatePicker from '../../components/ui/EventDatePicker'

// The list's columns from sm up: event, contract, date, venue, balance, Tally.
var COLS = 'sm:grid-cols-[minmax(0,2.2fr)_140px_110px_minmax(0,1.5fr)_150px_120px]'
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
  'is_tentative, pax, function_type, merged_into_id, tally_entered_by, tally_entered_at, ' +
  'menu_rate_paise, venue_rental_paise, decor_amount_paise, entertainment_amount_paise'

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
  var [salesFilter, setSalesFilter] = useState('')
  var [sessionFilter, setSessionFilter] = useState('')
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [filtersOpen, setFiltersOpen] = useState(false)
  var [page, setPage] = useState(1)
  var [perPage, setPerPage] = useState(25)
  var [selected, setSelected] = useState(null)
  var [showFinancials, setShowFinancials] = useState(false)

  // Reset the financials disclosure whenever a different contract is opened,
  // so it doesn't stay expanded (showing the previous contract's figures for
  // a flash) across a selection change.
  useEffect(function () {
    setShowFinancials(false)
  }, [selected && selected.id])

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
  var salesNames = [...new Set(contracts.map(function (c) { return c.created_user_name }).filter(Boolean))].sort()
  var sessionNames = [...new Set(contracts.map(function (c) { return c.session }).filter(Boolean))].sort()

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
    var matchSales = !salesFilter || c.created_user_name === salesFilter
    var matchSession = !sessionFilter || c.session === sessionFilter
    var cDate = (c.function_date || c.contract_date || '').slice(0, 10)
    var matchDate = (!dateFrom || !cDate || cDate >= dateFrom) && (!dateTo || !cDate || cDate <= dateTo)
    return matchSearch && matchVenue && matchDept && matchEntered && matchVenueType && matchSales && matchSession && matchDate
  })

  // One group per contract (contract_no + department) rather than one row
  // per function — a multi-function contract (Lunch, Dinner, Sagan, all
  // under the same contract_no) used to show as N separate full-width
  // cards. A row with no contract_no yet (tentative, no LMS contract) is
  // its own singleton group, keyed by id so it never merges with anything.
  function groupKeyOf(c) { return c.contract_no ? ((c.department || '') + '|' + c.contract_no) : ('single-' + c.id) }
  var groupsMap = {}
  var groupOrder = []
  filtered.forEach(function (c) {
    var k = groupKeyOf(c)
    if (!groupsMap[k]) { groupsMap[k] = []; groupOrder.push(k) }
    groupsMap[k].push(c)
  })
  var groups = groupOrder.map(function (k) { return { key: k, rows: groupsMap[k] } })

  var totalPages = Math.ceil(groups.length / perPage)
  var pagedGroups = groups.slice((page - 1) * perPage, page * perPage)
  var groupsToShow = filterId ? (pinnedContract ? [{ key: 'pinned', rows: [pinnedContract] }] : []) : pagedGroups

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

      {/* Toolbar: search, a single Filters button holding every dropdown
          plus the date range, page size at its end, the count under it. Six
          "All ..." selects spread across the row said nothing useful most of
          the time — the button now says how many are actually narrowed. */}
      {!filterId && (function () {
        var FILTER_DROPDOWNS = [
          [venueFilter, setVenueFilter, 'mapPin', 'Venue', [['', 'All venues']].concat(venueNames.map(function (v) { return [v, venueMap[v] ? (venueMap[v] + ' — ' + v) : v] }))],
          [deptFilter, setDeptFilter, 'tag', 'Department', [['', 'All depts']].concat(departments.map(function (d) {
            // The "Department" master record (id 23) covers several sub-departments
            // (Allied, Entertainment, Tech, Tender, ...) — renaming it to
            // "Entertainment" in the masters screen would be wrong, since it isn't
            // exclusively that. But every Entertainment-department contract is
            // stamped with the literal string "Entertainment" on events.department
            // by sync-events, with no master record of its own to filter by — so
            // this one option is relabelled (and its filter value swapped to
            // match) here only, scoped to this dropdown, leaving the master as is.
            var label = d.name === 'Department' ? 'Entertainment' : d.name
            return [label, label]
          }))],
          [enteredFilter, setEnteredFilter, 'checkCircle', 'Entered in Tally', [['', 'Entered: all'], ['yes', 'Entered'], ['no', 'Not entered']]],
          [venueTypeFilter, setVenueTypeFilter, 'building', 'Indoor or outdoor', [['', 'Indoor & outdoor'], ['indoor', 'Indoor'], ['outdoor', 'Outdoor']]],
          [salesFilter, setSalesFilter, 'user', 'Sales person', [['', 'All sales']].concat(salesNames.map(function (s) { return [s, s] }))],
          [sessionFilter, setSessionFilter, 'clock', 'Session', [['', 'All sessions']].concat(sessionNames.map(function (s) { return [s, s] }))],
        ]
        var filterCount = [venueFilter, deptFilter, enteredFilter, venueTypeFilter, salesFilter, sessionFilter, dateFrom, dateTo].filter(Boolean).length
        function clearAll() {
          setSearch(''); setVenueFilter(''); setDeptFilter(''); setEnteredFilter(''); setVenueTypeFilter('')
          setSalesFilter(''); setSessionFilter(''); setDateFrom(''); setDateTo(''); setPage(1)
        }
        return (
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
          <button type="button" onClick={function () { setFiltersOpen(!filtersOpen) }} aria-expanded={filtersOpen}
            className={'relative h-10 px-3.5 rounded-xl border text-[13px] font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ' +
              (filtersOpen || filterCount > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
            <Icon name="filter" size={14} />Filters
            {filterCount > 0 && (
              <span data-notranslate className="px-1.5 rounded-md bg-indigo-600 text-white text-[11px] tabular-nums">{filterCount}</span>
            )}
          </button>
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

        {filtersOpen && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-2.5 sm:grid-cols-3">
            {FILTER_DROPDOWNS.map(function (f) {
              return (
                <div key={f[3]} className="relative">
                  <Icon name={f[2]} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select value={f[0]} onChange={function (e) { f[1](e.target.value); setPage(1) }} aria-label={f[3]}
                    className={CTL + ' w-full pl-8 pr-8 appearance-none bg-white ' + (f[0] ? '' : 'text-slate-500')}>
                    {f[4].map(function (o) { return <option key={o[0]} value={o[0]}>{o[1]}</option> })}
                  </select>
                  <Icon name="chevronDown" size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              )
            })}
            <div className="flex items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex-1 min-w-0">
                <EventDatePicker value={dateFrom} placeholder="From" collapsible includePast plain
                  onChange={function (v) { setDateFrom(v); setPage(1) }} />
              </div>
              <span aria-hidden="true" className="shrink-0 self-stretch my-2 w-px bg-slate-200" />
              <div className="flex-1 min-w-0">
                <EventDatePicker value={dateTo} placeholder="To" collapsible includePast plain
                  onChange={function (v) { setDateTo(v); setPage(1) }} />
              </div>
              {(dateFrom || dateTo) && (
                <button type="button" onClick={function () { setDateFrom(''); setDateTo(''); setPage(1) }}
                  aria-label="Clear dates"
                  className="shrink-0 px-2 text-slate-400 hover:text-slate-600">
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
            {filterCount > 0 && (
              <button type="button" onClick={clearAll}
                className="sm:col-span-3 justify-self-start inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] font-semibold text-slate-600 hover:bg-white hover:text-red-600 transition-colors">
                <Icon name="refresh" size={13} />Clear filters
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 px-0.5 text-[12.5px] text-slate-500">
          <span className="h-6 px-2 rounded-md bg-slate-100 inline-flex items-center"><b className="text-slate-800 tabular-nums">{groups.length}</b>&nbsp;contract{groups.length === 1 ? '' : 's'}</span>
          {(filterCount > 0 || search) && (
            <button type="button" onClick={clearAll}
              className="h-6 px-2 rounded-md font-bold text-indigo-600 hover:bg-indigo-50">Reset</button>
          )}
        </div>
      </div>
        )
      })()}

      {filterId && pinnedLoading && (
        <p className="text-slate-500 text-[13px] text-center py-8">Loading contract…</p>
      )}
      {filterId && !pinnedLoading && !pinnedContract && (
        <p className="text-slate-500 text-[13px] text-center py-8">That contract couldn't be found — it may have been merged or removed.</p>
      )}
      {!filterId && groups.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl px-6 py-14 text-center">
          <span className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 inline-flex items-center justify-center mb-3"><Icon name="fileText" size={22} /></span>
          <p className="font-display text-[15px] font-bold text-slate-800">No contracts found</p>
          <p className="mt-1 text-[13px] text-slate-500">Try a different search or loosen a filter.</p>
        </div>
      )}

      {/* The contracts: one bordered card per contract, with a gap between
          them — a shared divider between a card's own header row and its
          Pax/rate detail strip read the same as the gap between two
          different contracts, so the list kept reading as one long run
          with no clear edges. A gap and a border per card is unambiguous
          regardless of how heavy the internal divider is. */}
      {groupsToShow.length > 0 && (
        <div className="space-y-2.5">
          <div className={'hidden sm:grid ' + COLS + ' gap-3 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11.5px] font-bold uppercase tracking-[0.07em] text-slate-500'}>
            <span>Event</span><span>Contract</span><span>Date</span><span>Venue</span><span className="text-right">Balance</span><span className="text-right">Tally</span>
          </div>
          {groupsToShow.map(function (g) {
            var rows = g.rows
            var c = rows[0]
            var multi = rows.length > 1
            var dates = rows.map(function (r) { return r.function_date || r.contract_date }).filter(Boolean).sort()
            var dateStart = dates[0], dateEnd = dates[dates.length - 1]
            var isTentative = rows.some(function (r) { return r.is_tentative })
            var uniqueLocations = [...new Set(rows.map(function (r) { return r.location }).filter(Boolean))]
            var enteredCount = rows.filter(function (r) { return r.tally_entered_by }).length
            return (
              <div key={g.key}
                {...(!multi ? {
                  role: 'button', tabIndex: 0,
                  onClick: function () { setSelected(c) },
                  onKeyDown: function (e) { if (e.key === 'Enter') setSelected(c) },
                } : {})}
                className={'group bg-white border border-slate-200 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.05)] px-4 py-3.5 transition-colors sm:grid ' + COLS + ' sm:gap-3 sm:items-center ' +
                  (multi ? '' : 'cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40')}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className={'font-display text-[14px] font-bold tracking-[-0.01em] text-slate-900 truncate ' + (multi ? '' : 'group-hover:text-indigo-700')}>
                      {multi ? titleCase(c.client_name || '—') : (c.event_name || '—')}
                    </h3>
                    {isTentative && <span className="shrink-0 text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Tentative</span>}
                    {c.department && <span className={'shrink-0 text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded ' + (DEPT_BADGE[c.department] || 'bg-slate-100 text-slate-600')}>{c.department}</span>}
                  </div>
                  {multi ? (
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {rows.map(function (r) {
                        return (
                          <span key={r.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600">
                            {r.event_name || '—'}{r.session ? ' · ' + r.session : ''}
                          </span>
                        )
                      })}
                    </p>
                  ) : (
                    <p className="text-[12.5px] text-slate-600 truncate mt-0.5">{titleCase(c.client_name || '—')}</p>
                  )}
                  {/* phone: the columns as one meta line */}
                  <p className="sm:hidden mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-slate-500">
                    {c.contract_no && <span className="font-mono">#{c.contract_no}</span>}
                    <span className="inline-flex items-center gap-1"><Icon name="calendar" size={12} className="text-slate-400" />
                      {multi && dateStart !== dateEnd ? formatDate(dateStart) + ' – ' + formatDate(dateEnd) : formatDate(dateStart || c.contract_date)}
                    </span>
                    {c.contract_date && dateStart && (
                      <span className="text-slate-400">Contracted {formatDate(c.contract_date)}</span>
                    )}
                    {(c.venue_name || uniqueLocations.length > 0) && (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="mapPin" size={12} className="text-slate-400" />
                        {[c.venue_name, uniqueLocations.length === 1 ? uniqueLocations[0] : (uniqueLocations.length > 1 ? uniqueLocations.length + ' sub-venues' : null)].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {!multi && c.session && <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} className="text-slate-400" />{c.session}</span>}
                    {multi && <span className="font-semibold text-slate-600">{rows.length} functions</span>}
                    {c.created_user_name && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-100 font-bold text-indigo-700">
                        <Icon name="user" size={11} />{c.created_user_name}
                      </span>
                    )}
                  </p>
                </div>
                <div className="hidden sm:block min-w-0">
                  <span className="block font-mono text-[12.5px] text-slate-600">{c.contract_no ? '#' + c.contract_no : '—'}</span>
                  {c.created_user_name && (
                    <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-100 text-[10.5px] font-bold text-indigo-700 max-w-full truncate">
                      <Icon name="user" size={10} className="shrink-0" /><span className="truncate">{c.created_user_name}</span>
                    </span>
                  )}
                </div>
                <div className="hidden sm:block">
                  <span className="block text-[13px] text-slate-700 tabular-nums">
                    {multi && dateStart !== dateEnd ? formatDate(dateStart) + ' – ' + formatDate(dateEnd) : formatDate(dateStart || c.contract_date)}
                  </span>
                  {c.contract_date && dateStart && (
                    <span className="block text-[10.5px] text-slate-400 tabular-nums">Contracted {formatDate(c.contract_date)}</span>
                  )}
                </div>
                <div className="hidden sm:block min-w-0">
                  <span className="block text-[13px] text-slate-600 truncate">{c.venue_name || '—'}</span>
                  {uniqueLocations.length === 1 && <span className="block text-[11px] text-slate-400 truncate">{uniqueLocations[0]}</span>}
                  {uniqueLocations.length > 1 && <span className="block text-[11px] text-slate-400 truncate">{uniqueLocations.length} sub-venues</span>}
                  {!multi && c.session && (
                    <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] text-slate-400">
                      <Icon name="clock" size={10} className="text-slate-400" />{c.session}
                    </span>
                  )}
                </div>
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
                    {multi ? (
                      <span className="ml-auto sm:ml-0 text-[11px] font-bold text-slate-500 tabular-nums">{enteredCount}/{rows.length} entered</span>
                    ) : (c.tally_entered_by || canMarkEntered) && (
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

                  {/* Multi-function contract: each function gets its own line —
                      own date/session/venue, own Venue-dept Pax/rate chips, and
                      critically its own EnteredMark, since "entered in Tally" is
                      tracked per function, not per contract (see fix() notes on
                      sync-events' composite dedup key — collapsing this back to
                      one shared mark would silently hide a not-yet-entered
                      sibling function). Clicking a line opens that one function's
                      full detail; the card itself is no longer one click target. */}
                  {multi ? (
                    <div className="sm:col-span-full mt-2 pt-2 border-t border-slate-100 space-y-1">
                      {rows.map(function (r) {
                        var rVenueLine = (r.venue_name !== c.venue_name || r.location) ? [r.venue_name, r.location].filter(Boolean).join(' · ') : null
                        return (
                          <div key={r.id} role="button" tabIndex={0}
                            onClick={function (ev) { ev.stopPropagation(); setSelected(r) }}
                            onKeyDown={function (ev) { if (ev.key === 'Enter') setSelected(r) }}
                            className="flex items-start justify-between gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                                <span className="font-bold text-slate-800">{r.event_name || '—'}</span>
                                <span className="text-slate-400 tabular-nums">{formatDate(r.function_date)}{r.session ? ' · ' + r.session : ''}</span>
                              </div>
                              {rVenueLine && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{rVenueLine}</p>}
                              {r.department === 'Venue' && (r.total_plates || r.menu_rate_paise != null || r.venue_rental_paise != null || r.decor_amount_paise != null || r.entertainment_amount_paise != null) && (
                                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                                  {!!r.total_plates && <span className="text-slate-500">Pax <b className="text-slate-800 tabular-nums">{r.total_plates}</b></span>}
                                  {r.menu_rate_paise != null && r.menu_rate_paise > 0 && <span className="text-slate-500">Menu <b className="text-slate-800 tabular-nums">{formatPaise(r.menu_rate_paise)}</b></span>}
                                  {r.venue_rental_paise != null && <span className="text-slate-500">Rental <b className="text-slate-800 tabular-nums">{formatPaise(r.venue_rental_paise)}</b></span>}
                                  {r.decor_amount_paise != null && r.decor_amount_paise > 0 && <span className="text-slate-500">Decor <b className="text-slate-800 tabular-nums">{formatPaise(r.decor_amount_paise)}</b></span>}
                                  {r.entertainment_amount_paise != null && r.entertainment_amount_paise > 0 && <span className="text-slate-500">Entertainment <b className="text-slate-800 tabular-nums">{formatPaise(r.entertainment_amount_paise)}</b></span>}
                                </div>
                              )}
                            </div>
                            {(r.tally_entered_by || canMarkEntered) && (
                              <span onClick={function (ev) { ev.stopPropagation() }} className="shrink-0">
                                <EnteredMark
                                  entered={!!r.tally_entered_by}
                                  enteredByName={enteredNames[r.tally_entered_by]}
                                  enteredAt={r.tally_entered_at}
                                  canToggle={canMarkEntered}
                                  canUnenter={r.tally_entered_by === profile.id || isSysAdmin}
                                  busy={enteringId === r.id}
                                  onToggle={function () { toggleContractEntered(r.id) }}
                                />
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    /* LMS already computes these per Venue contract (see migration
                       00094's note) — pax was already synced as total_plates, just
                       never shown as a column; menu rate/venue rental/decor/
                       entertainment are new. Scoped to Venue rows only — the other
                       three departments are their own standalone contracts with
                       nothing to decompose. A full-width strip under the row
                       rather than more grid columns, since it's blank dead space
                       for 3 of every 4 rows otherwise. */
                    c.department === 'Venue' && (c.total_plates || c.menu_rate_paise != null || c.venue_rental_paise != null || c.decor_amount_paise != null || c.entertainment_amount_paise != null) && (
                    <div className="sm:col-span-full mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px]">
                      {!!c.total_plates && (
                        <span className="text-slate-500">Pax <b className="text-slate-800 tabular-nums">{c.total_plates}</b></span>
                      )}
                      {c.menu_rate_paise != null && c.menu_rate_paise > 0 && (
                        <span className="text-slate-500">Menu rate <b className="text-slate-800 tabular-nums">{formatPaise(c.menu_rate_paise)}</b></span>
                      )}
                      {c.venue_rental_paise != null && (
                        <span className="text-slate-500">Venue rental <b className="text-slate-800 tabular-nums">{formatPaise(c.venue_rental_paise)}</b></span>
                      )}
                      {c.decor_amount_paise != null && c.decor_amount_paise > 0 && (
                        <span className="text-slate-500">Decor <b className="text-slate-800 tabular-nums">{formatPaise(c.decor_amount_paise)}</b></span>
                      )}
                      {c.entertainment_amount_paise != null && c.entertainment_amount_paise > 0 && (
                        <span className="text-slate-500">Entertainment <b className="text-slate-800 tabular-nums">{formatPaise(c.entertainment_amount_paise)}</b></span>
                      )}
                    </div>
                    )
                  )}
                </div>
              )
            })}
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
                ['Menu rate', selected.menu_rate_paise > 0 ? formatPaise(selected.menu_rate_paise) : null],
                ['Venue rental', selected.venue_rental_paise != null ? formatPaise(selected.venue_rental_paise) : null],
                ['Decor amount', selected.decor_amount_paise > 0 ? formatPaise(selected.decor_amount_paise) : null],
                ['Entertainment amount', selected.entertainment_amount_paise > 0 ? formatPaise(selected.entertainment_amount_paise) : null],
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
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Balance (per LMS sync)</p>
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

            {/* One disclosure, one list: past collections (whatever LMS has
                on record, collected outside Ambria Ops entirely) sit right
                above the new ones (collected through this app's own wallet,
                deduped across any LMS resync duplicates — see
                EventLedger._buildContractGroup) instead of behind two
                separate toggles a reader had to find and open one at a time. */}
            {isAdmin && (
              <div>
                <button type="button"
                  onClick={function () { setShowFinancials(!showFinancials) }}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  {showFinancials ? '− Hide financials' : '+ Show financials'}
                </button>
                {showFinancials && (
                  <div className="mt-3">
                    {/* EventLedger's own Transactions tab now folds in LMS's
                        payment history alongside Ambria Ops' own wallet
                        collections — one list, one place, markable the same
                        way — so there's nothing left to render here. */}
                    <EventLedger profile={profile} eventId={selected.id} />
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
