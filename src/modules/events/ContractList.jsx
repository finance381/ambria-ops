import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge } from '../../components/ui/Badge'
import { formatDate, formatPaise, titleCase } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import EnteredMark from '../../components/ui/EnteredMark'

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
    return matchSearch && matchVenue && matchDept && matchEntered
  })

  var totalPages = Math.ceil(filtered.length / perPage)
  var paged = filtered.slice((page - 1) * perPage, page * perPage)
  var rowsToShow = filterId ? (pinnedContract ? [pinnedContract] : []) : paged

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading contracts...</p>
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

      {/* Toolbar */}
      {!filterId && (
      <div className="space-y-2">
        <input type="text" value={search}
          onChange={function (e) { setSearch(e.target.value); setPage(1) }}
          placeholder="Search client, event, contract, venue..."
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
        <div className="flex gap-2 flex-wrap items-center">
          <select value={venueFilter}
            onChange={function (e) { setVenueFilter(e.target.value); setPage(1) }}
            className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Venues</option>
            {venueNames.map(function (v) { return <option key={v} value={v}>{venueMap[v] ? (venueMap[v] + ' — ' + v) : v}</option> })}
          </select>
          <select value={deptFilter}
            onChange={function (e) { setDeptFilter(e.target.value); setPage(1) }}
            className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Depts</option>
            {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
          </select>
          <select value={enteredFilter}
            onChange={function (e) { setEnteredFilter(e.target.value); setPage(1) }}
            className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">Entered: All</option>
            <option value="yes">Entered: Yes</option>
            <option value="no">Entered: No</option>
          </select>
          <select value={perPage}
            onChange={function (e) { setPerPage(Number(e.target.value)); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <p className="text-xs text-gray-400">{filtered.length} contract{filtered.length === 1 ? '' : 's'}</p>
      </div>
      )}

      {filterId && pinnedLoading && (
        <p className="text-gray-400 text-sm text-center py-8">Loading contract...</p>
      )}
      {filterId && !pinnedLoading && !pinnedContract && (
        <p className="text-gray-400 text-sm text-center py-8">That contract couldn't be found — it may have been merged or removed.</p>
      )}
      {!filterId && filtered.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-8">No contracts found</p>
      )}

      <div className="space-y-2">
        {rowsToShow.map(function (c) {
          return (
            <button key={c.id} type="button" onClick={function () { setSelected(c) }}
              className="w-full text-left bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md hover:border-gray-300 transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-800 text-sm truncate">{c.event_name || c.contract_type || '—'}</h3>
                    {c.is_tentative && <Badge color="amber">Tentative</Badge>}
                    {c.department && <span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0 " + (DEPT_BADGE[c.department] || "bg-gray-100 text-gray-600")}>{c.department}</span>}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{titleCase(c.client_name || '—')}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400 mt-1">
                    {c.contract_no && <span>#{c.contract_no}</span>}
                    <span>{formatDate(c.function_date || c.contract_date)}</span>
                    {c.venue_name && <span>{c.venue_name}</span>}
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {isAdmin && c.balance_amount ? (
                    <span className={"text-xs font-semibold " + (c.balance_amount < 0 ? "text-red-600" : "text-green-600")}>
                      {formatPaise(Math.abs(c.balance_amount))} {c.balance_amount < 0 ? 'due' : 'adv'}
                    </span>
                  ) : null}
                  {(c.tally_entered_by || canMarkEntered) && (
                    <span onClick={function (ev) { ev.stopPropagation() }}>
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
            </button>
          )
        })}
      </div>

      {/* Pagination */}
      {!filterId && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button onClick={function () { setPage(1) }} disabled={page === 1}
            className="px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">«</button>
          <button onClick={function () { setPage(page - 1) }} disabled={page === 1}
            className="px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">‹</button>
          {Array.from({ length: totalPages }, function (_, i) { return i + 1 }).filter(function (p) {
            return p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)
          }).map(function (p, i, arr) {
            var showGap = i > 0 && p - arr[i - 1] > 1
            return (
              <span key={p}>
                {showGap && <span className="px-1 text-gray-300">…</span>}
                <button onClick={function () { setPage(p) }}
                  className={"px-3 py-1.5 text-xs rounded font-medium transition-colors " +
                    (p === page ? "bg-indigo-600 text-white" : "border border-gray-300 hover:bg-gray-50")}>{p}</button>
              </span>
            )
          })}
          <button onClick={function () { setPage(page + 1) }} disabled={page === totalPages}
            className="px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">›</button>
          <button onClick={function () { setPage(totalPages) }} disabled={page === totalPages}
            className="px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">»</button>
          <span className="text-xs text-gray-400 ml-2">Page {page} / {totalPages}</span>
        </div>
      )}

      {/* ═══ CONTRACT DETAIL MODAL — every events_safe field ═══ */}
      <Modal open={!!selected} onClose={function () { setSelected(null) }}
        title={selected ? (selected.event_name || selected.contract_type || '—') : ''} wide>
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
                ['Contract type', selected.contract_type],
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
                {selected.pdf_link && <a href={selected.pdf_link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">View contract PDF ↗</a>}
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
