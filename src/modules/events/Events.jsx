import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge } from '../../components/ui/Badge'
import { formatDate, formatPaise, titleCase } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import EventLedger from '../expenses/EventLedger'

var lastSyncTime = 0
var SYNC_COOLDOWN = 5 * 60 * 1000
var DAY_GAP = 3

function daysBetween(a, b) {
  var d1 = new Date(a); var d2 = new Date(b)
  return Math.abs(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)))
}

function groupEvents(events) {
  var sorted = events.slice().sort(function (a, b) {
    return new Date(a.function_date || a.contract_date || 0) - new Date(b.function_date || b.contract_date || 0)
  })

  var buckets = {}
  sorted.forEach(function (e) {
    var key = ((e.client_name || '').toLowerCase().trim()) + '||' + ((e.contact_number || '').trim())
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(e)
  })

  var groups = []
  Object.keys(buckets).forEach(function (key) {
    var list = buckets[key]
    var cluster = [list[0]]
    for (var i = 1; i < list.length; i++) {
      var prev = list[i - 1].function_date || list[i - 1].contract_date
      var curr = list[i].function_date || list[i].contract_date
      if (prev && curr && daysBetween(prev, curr) <= DAY_GAP) {
        cluster.push(list[i])
      } else {
        groups.push(cluster)
        cluster = [list[i]]
      }
    }
    groups.push(cluster)
  })

  var todayStart = new Date(); todayStart.setHours(0, 0, 0, 0); var todayMs = todayStart.getTime()
  groups.sort(function (a, b) {
    var aMax = Math.max.apply(null, a.map(function (e) { return new Date(e.function_date || e.contract_date || 0).getTime() }))
    var bMax = Math.max.apply(null, b.map(function (e) { return new Date(e.function_date || e.contract_date || 0).getTime() }))
    var aUp = aMax >= todayMs
    var bUp = bMax >= todayMs
    if (!aUp && bUp) return -1
    if (aUp && !bUp) return 1
    return aMax - bMax
  })

  return groups.map(function (functions) {
    var dates = functions.map(function (f) { return f.function_date || f.contract_date }).filter(Boolean).sort()
    var totalPlates = functions.reduce(function (sum, f) { return sum + (f.total_plates || 0) }, 0)
    return {
      isUpcoming: Math.max.apply(null, functions.map(function (f) { return new Date(f.function_date || f.contract_date || 0).getTime() })) >= todayMs,
      id: functions.map(function (f) { return f.id }).join('-'),
      client_name: functions[0].client_name || '—',
      contact_person: functions[0].contact_person || '',
      contact_number: functions[0].contact_number || '',
      date_start: dates[0] || null,
      date_end: dates[dates.length - 1] || null,
      venues: [...new Set(functions.map(function (f) { return f.venue_name }).filter(Boolean))],
      location: functions[0].location || '',
      function_count: functions.length,
      total_plates: totalPlates,
      functions: functions,
    }
  })
}

function Events({ profile }) {
  var [events, setEvents] = useState([])
  var [loading, setLoading] = useState(true)
  var [syncing, setSyncing] = useState(false)
  var [syncMsg, setSyncMsg] = useState('')
  var [selectedGroup, setSelectedGroup] = useState(null)
  var [selectedFunction, setSelectedFunction] = useState(null)
  var [search, setSearch] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [deptFilter, setDeptFilter] = useState('')
  var [departments, setDepartments] = useState([])
  var [page, setPage] = useState(1)
  var [perPage, setPerPage] = useState(24)
  var [showLedger, setShowLedger] = useState(false)
  var [extraPlateSummary, setExtraPlateSummary] = useState(null)
  var [venueMap, setVenueMap] = useState({})

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var perms = profile?.permissions || []

  useEffect(function () {
    if (!selectedFunction) { setExtraPlateSummary(null); return }
    var fid = selectedFunction.id
    Promise.all([
      supabase.from('extra_plate_issues').select('plates_count, status').eq('event_id', fid),
      supabase.from('extra_plate_collections').select('extras_charged, plates_returned, total_paise, discount_paise, status').eq('event_id', fid),
    ]).then(function (res) {
      var epIssues = res[0].data || []
      var epColls = res[1].data || []
      var eps = {
        issued_active: 0, issued_cancelled: 0,
        charged_active: 0, returned_active: 0, waste_active: 0,
        net_paise: 0, discount_paise: 0,
        collections_active: 0, collections_cancelled: 0
      }
      epIssues.forEach(function (r) {
        if (r.status === 'active') { eps.issued_active += Number(r.plates_count || 0) }
        else if (r.status === 'cancelled') { eps.issued_cancelled += 1 }
      })
      epColls.forEach(function (r) {
        if (r.status !== 'active' && r.status !== null && r.status !== undefined && r.status !== '') {
          eps.collections_cancelled += 1
          return
        }
        // Only 'active' (or default) rows count toward totals
        var charged = Number(r.extras_charged || 0)
        var returned = Number(r.plates_returned || 0)
        eps.charged_active += charged
        eps.net_paise += Number(r.total_paise || 0) - Number(r.discount_paise || 0)
        eps.discount_paise += Number(r.discount_paise || 0)
        eps.collections_active += 1
        if (charged === 0) { eps.waste_active += returned }      // waste-only entry
        else { eps.returned_active += returned }                  // returns reconciled against a charge
      })
      setExtraPlateSummary(eps)
    })
  }, [selectedFunction])
  var userEventDeptNames = (profile?.event_dept_ids || []).map(function (id) {
    var dept = departments.find(function (d) { return d.id === id })
    return dept ? dept.name : null
  }).filter(Boolean)
  var hasEventDeptFilter = !isAdmin && userEventDeptNames.length > 0

  useEffect(function () {
    loadEvents().then(function () {
      if (Date.now() - lastSyncTime > SYNC_COOLDOWN) {
        syncFromLMS(true)
      }
    })
  }, [])

  async function loadEvents() {
    var dateFloor = new Date()
    dateFloor.setDate(dateFloor.getDate() - 5)
    var dateFloorStr = dateFloor.toISOString().split('T')[0]
    var [eventsRes, deptRes, venueRes] = await Promise.all([
      supabase
        .from('events_safe')
        .select('id, lms_event_id, contract_no, contract_date, function_date, department, contract_type, venue_name, location, contact_person, contact_number, event_name, client_name, session, catering, total_plates, complementary_plates, extra_plates_charge, balance_received, balance_bank, balance_amount, status, synced_at, created_user_name')
        .gte('function_date', dateFloorStr)
        .order('function_date', { ascending: false })
        .limit(2000),
      supabase.from('departments').select('id, name').eq('active', true).eq('hide_from_lists', false),
      supabase.from('venues').select('code, name').eq('active', true),
    ])
    setDepartments(deptRes.data || [])
    setEvents(eventsRes.data || [])
    var vMap = {}
    ;(venueRes.data || []).forEach(function (v) { if (v.name) vMap[v.name] = v.code })
    setVenueMap(vMap)
    setLoading(false)
  }

  async function syncFromLMS(silent) {
    if (syncing) return
    if (!silent) setSyncing(true)
    setSyncMsg('')
    try {
      var { data: sessionData } = await supabase.auth.getSession()
      var token = sessionData?.session?.access_token
      if (!token) { setSyncMsg('Not authenticated'); setSyncing(false); return }
      var anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      var res = await fetch(
        'https://ptksdithbytzrznplfiq.supabase.co/functions/v1/sync-events',
        { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'apikey': anonKey, 'Content-Type': 'application/json' } }
      )
      var body = await res.json().catch(function () { return {} })
      if (!res.ok) {
        if (!silent) setSyncMsg('Sync failed: ' + (body.error || res.status))
      } else {
        lastSyncTime = Date.now()
        if (!silent) setSyncMsg('Synced ' + (body.synced || 0) + '/' + (body.total || 0) + ' events' + (body.errors ? ' (' + body.errors.length + ' dept errors)' : ''))
        loadEvents()
      }
    } catch (err) {
      if (!silent) setSyncMsg('Sync error: ' + err.message)
    }
    setSyncing(false)
  }

  var visibleEvents = hasEventDeptFilter
    ? events.filter(function (e) { return userEventDeptNames.includes(e.department) })
    : events
  var allGroups = useMemo(function () { return groupEvents(visibleEvents) }, [visibleEvents])

  var venueNames = [...new Set(events.map(function (e) { return e.venue_name }).filter(Boolean))]

  var searchLower = search.toLowerCase()
  var filtered = allGroups.filter(function (g) {
    var matchSearch = !search ||
      g.client_name.toLowerCase().includes(searchLower) ||
      g.contact_person.toLowerCase().includes(searchLower) ||
      (g.contact_number || '').includes(search) ||
      g.location.toLowerCase().includes(searchLower) ||
      g.venues.some(function (v) { return v.toLowerCase().includes(searchLower) }) ||
      g.functions.some(function (f) {
        return (f.event_name || '').toLowerCase().includes(searchLower) ||
          (f.contract_no || '').includes(search)
      })
    var matchVenue = !venueFilter || g.venues.includes(venueFilter) ||
      g.functions.some(function (f) { return f.venue_name === venueFilter })
    var matchDept = !deptFilter || g.functions.some(function (f) { return f.department === deptFilter })
    return matchSearch && matchVenue && matchDept
  })

  var totalPages = Math.ceil(filtered.length / perPage)
  var paged = filtered.slice((page - 1) * perPage, page * perPage)

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading events...</p>
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
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
          <button onClick={function () { syncFromLMS(false) }} disabled={syncing}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium disabled:opacity-50 whitespace-nowrap">
            {syncing ? '🔄 Syncing...' : '🔄 Sync LMS'}
          </button>
          <select value={perPage}
            onChange={function (e) { setPerPage(Number(e.target.value)); setPage(1) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value={12}>12</option>
            <option value={24}>24</option>
            <option value={48}>48</option>
          </select>
        </div>
        <select value={deptFilter}
          onChange={function (e) { setDeptFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Depts</option>
          {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
        </select>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {filtered.length} guests · {visibleEvents.length} functions
          </span>
          {syncMsg && (
            <span className={"text-xs px-2 py-1 rounded " + (syncMsg.includes('failed') || syncMsg.includes('error') ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600")}>
              {syncMsg}
            </span>
          )}
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-8">No events found</p>
      )}

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {paged.flatMap(function (group, idx) {
          var elements = []
          if (!group.isUpcoming && idx === 0) {
            elements.push(<div key="past-hdr" className="col-span-1 md:col-span-2 lg:col-span-3 flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider font-semibold py-1"><span>Past Events</span><span className="flex-1 border-t border-gray-300"></span></div>)
          }
          if (group.isUpcoming && (idx === 0 || !paged[idx - 1].isUpcoming)) {
            elements.push(<div key="upcoming-hdr" className="col-span-1 md:col-span-2 lg:col-span-3 flex items-center gap-2 text-xs text-indigo-500 uppercase tracking-wider font-semibold py-1"><span>Upcoming</span><span className="flex-1 border-t border-indigo-300"></span></div>)
          }
          var dateRange = group.date_start === group.date_end
            ? formatDate(group.date_start)
            : formatDate(group.date_start) + ' – ' + formatDate(group.date_end)
          elements.push(
            <div key={group.id}
              onClick={function () { setSelectedGroup(group) }}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md cursor-pointer transition-shadow">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-800 truncate">{titleCase(group.client_name)}</h3>
                  {group.contact_person && <p className="text-xs text-gray-500 truncate">{group.contact_person}</p>}
                </div>
                <span className="text-[11px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full ml-2 flex-shrink-0">
                  {group.function_count} fn{group.function_count !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mb-3">
                <span>📅 {dateRange}</span>
                {group.venues.map(function (v) { return <span key={v}>🏛️ {v}</span> })}
                {group.location && !group.venues.some(function (v) { return v.toLowerCase().indexOf(group.location.toLowerCase()) !== -1 || group.location.toLowerCase().indexOf(v.toLowerCase()) !== -1 }) && <span>📍 {group.location}</span>}
              </div>

              <div className="space-y-1 mb-3">
                {group.functions.map(function (f) {
                  return (
                    <div key={f.id} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5">
                      <span className="font-medium text-gray-800 truncate flex-1">{f.event_name || f.contract_type || '—'}</span>
                      {f.department && <span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0 " +
                        (f.department === 'Venue' ? "bg-blue-100 text-blue-700" :
                         f.department === 'Decor' ? "bg-purple-100 text-purple-700" :
                         f.department === 'Catering' ? "bg-amber-100 text-amber-700" :
                         f.department === 'Entertainment' ? "bg-pink-100 text-pink-700" :
                         "bg-gray-100 text-gray-600")}>{f.department}</span>}
                      <span className="text-gray-400">{formatDate(f.function_date || f.contract_date)}</span>
                    </div>
                  )
                })}
              </div>

              {isAdmin && (function () {
                var totalBalance = group.functions.reduce(function (s, f) { return s + (f.balance_amount || 0) }, 0)
                if (!totalBalance) return null
                return (
                  <div className="pt-2 border-t border-gray-100">
                    <span className={"text-xs font-medium " + (totalBalance < 0 ? "text-red-600" : "text-green-600")}>
                      Balance: {formatPaise(Math.abs(totalBalance))} {totalBalance < 0 ? 'due' : 'advance'}
                    </span>
                  </div>
                )
              })()}
            </div>
          )
          return elements
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
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

      {/* ═══ GROUP DETAIL MODAL ═══ */}
      <Modal open={!!selectedGroup && !selectedFunction} onClose={function () { setSelectedGroup(null) }}
        title={selectedGroup ? titleCase(selectedGroup.client_name) : ''} wide>
        {selectedGroup && (
          <div className="space-y-5">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                {selectedGroup.contact_person && <span><strong>Contact:</strong> {selectedGroup.contact_person}</span>}
                {selectedGroup.contact_number && <span><strong>Phone:</strong> {selectedGroup.contact_number}</span>}
                {selectedGroup.location && <span><strong>Location:</strong> {selectedGroup.location}</span>}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                Functions ({selectedGroup.function_count})
              </h4>
              <div className="space-y-2">
                {selectedGroup.functions.map(function (f) {
                  return (
                    <div key={f.id} onClick={function () { setSelectedFunction(f); setShowLedger(false) }}
                      className="bg-white border border-gray-200 rounded-lg p-3 hover:bg-indigo-50 cursor-pointer transition-colors active:bg-indigo-100">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h5 className="font-semibold text-gray-800 text-sm truncate">{f.event_name || f.contract_type || '—'}</h5>
                            {f.department && <Badge color="indigo">{f.department}</Badge>}
                          </div>
                          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-gray-500 mt-1">
                            <span>{formatDate(f.function_date || f.contract_date)}</span>
                            {f.venue_name && <span>· {f.venue_name}</span>}
                            {f.session && <span>· {f.session}</span>}
                          </div>
                        </div>
                        <span className="text-gray-300 ml-2 flex-shrink-0">›</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ═══ FUNCTION DETAIL MODAL ═══ */}
      <Modal open={!!selectedFunction} onClose={function () { setSelectedFunction(null); setShowLedger(false) }}
        title={selectedFunction?.event_name || selectedFunction?.contract_type || ''} wide>
        {selectedFunction && (
          <div className="space-y-5">
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                {selectedFunction.contract_no && <span><strong>Contract:</strong> #{selectedFunction.contract_no}</span>}
                {(selectedFunction.function_date || selectedFunction.contract_date) && <span><strong>Event Date:</strong> {formatDate(selectedFunction.function_date || selectedFunction.contract_date)}</span>}
                {selectedFunction.contract_type && <span><strong>Type:</strong> {selectedFunction.contract_type}</span>}
                {selectedFunction.department && <span><strong>Dept:</strong> {selectedFunction.department}</span>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                {selectedFunction.venue_name && <span><strong>Venue:</strong> {selectedFunction.venue_name}</span>}
                {selectedFunction.location && <span><strong>Location:</strong> {selectedFunction.location}</span>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                {selectedFunction.total_plates > 0 && <span><strong>Plates:</strong> {selectedFunction.total_plates}</span>}
                {selectedFunction.complementary_plates > 0 && <span><strong>Complimentary:</strong> {selectedFunction.complementary_plates}</span>}
                {selectedFunction.session && <span><strong>Session:</strong> {selectedFunction.session}</span>}
                {selectedFunction.catering && <span><strong>Catering:</strong> {selectedFunction.catering}</span>}
              </div>
              {selectedFunction.created_user_name && (
                <p className="text-xs text-gray-400">Created by: {selectedFunction.created_user_name}</p>
              )}
            </div>

            {/* Extra Plate summary — visible when activity exists */}
            {extraPlateSummary && (extraPlateSummary.issued_active !== 0 || extraPlateSummary.collections_active > 0 || extraPlateSummary.issued_cancelled > 0 || extraPlateSummary.collections_cancelled > 0) && (function () {
              var hasMoneyPerm = isAdmin || perms.indexOf('feature_extra_plate_collect') >= 0
              var totalReturned = extraPlateSummary.returned_active + extraPlateSummary.waste_active
              var netConsumed = extraPlateSummary.issued_active - totalReturned
              // uncollected: extras eaten that haven't been charged yet
              var quota = selectedFunction?.total_plates || 0
              var chargeableExtras = Math.max(0, netConsumed - quota)
              var uncollected = chargeableExtras - extraPlateSummary.charged_active
              return (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-orange-700 uppercase tracking-wider">🍽 Extra Plates</h4>
                    {uncollected > 0
                      ? <span className="text-[10px] font-bold text-red-600">{uncollected} uncollected</span>
                      : uncollected < 0
                        ? <span className="text-[10px] font-bold text-amber-600">{Math.abs(uncollected)} over-collected</span>
                        : (extraPlateSummary.issued_active > 0 ? <span className="text-[10px] font-bold text-green-600">✓ settled</span> : null)}
                  </div>
                  <div className={"grid gap-2 text-sm " + (hasMoneyPerm ? "grid-cols-4" : "grid-cols-3")}>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase">Issued</p>
                      <p className="font-medium text-gray-800">{extraPlateSummary.issued_active}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase">Returned</p>
                      <p className="font-medium text-gray-800">{extraPlateSummary.returned_active || 0}</p>
                      {extraPlateSummary.waste_active > 0 && (
                        <p className="text-[9px] text-amber-700">+{extraPlateSummary.waste_active} waste</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase">Charged</p>
                      <p className="font-medium text-gray-800">{extraPlateSummary.charged_active}</p>
                    </div>
                    {hasMoneyPerm && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase">Collected</p>
                        <p className="font-medium text-green-700">{formatPaise(extraPlateSummary.net_paise)}</p>
                      </div>
                    )}
                  </div>
                  {hasMoneyPerm && extraPlateSummary.discount_paise > 0 && (
                    <p className="text-[10px] text-gray-500 mt-2">Discount given: {formatPaise(extraPlateSummary.discount_paise)}</p>
                  )}
                  {(extraPlateSummary.issued_cancelled > 0 || extraPlateSummary.collections_cancelled > 0) && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      Cancelled: {extraPlateSummary.issued_cancelled} issue{extraPlateSummary.issued_cancelled !== 1 ? 's' : ''} · {extraPlateSummary.collections_cancelled} collection{extraPlateSummary.collections_cancelled !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              )
            })()}

            {/* Financial details — hidden by default */}
            <div>
              <button type="button"
                onClick={function () { setShowLedger(!showLedger) }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                {showLedger ? '− Hide financials' : '+ Show financials'}
              </button>
              {showLedger && (
                <div className="mt-3">
                  <EventLedger eventId={selectedFunction.id} />
                </div>
              )}
            </div>

            {selectedFunction.synced_at && (
              <p className="text-xs text-gray-400 text-right">Last synced: {formatDate(selectedFunction.synced_at)}</p>
            )}

            <button onClick={function () { setSelectedFunction(null) }}
              className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors">
              ← Back to functions
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default Events