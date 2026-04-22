import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge } from '../../components/ui/Badge'
import { formatDate, formatPaise, titleCase } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import BlockInventory from './BlockInventory'
import BriefUpload from './BriefUpload'
import { logActivity } from '../../lib/logger'

var lastSyncTime = 0
var SYNC_COOLDOWN = 5 * 60 * 1000
var DAY_GAP = 3

function daysBetween(a, b) {
  var d1 = new Date(a); var d2 = new Date(b)
  return Math.abs(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)))
}

function groupEvents(events) {
  // Sort by date ascending for grouping
  var sorted = events.slice().sort(function (a, b) {
    return new Date(a.contract_date || 0) - new Date(b.contract_date || 0)
  })

  // Bucket by client key (client_name + contact_number)
  var buckets = {}
  sorted.forEach(function (e) {
    var key = ((e.client_name || '').toLowerCase().trim()) + '||' + ((e.contact_number || '').trim())
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(e)
  })

  // Within each bucket, cluster by date proximity (3 day gap)
  var groups = []
  Object.keys(buckets).forEach(function (key) {
    var list = buckets[key]
    var cluster = [list[0]]
    for (var i = 1; i < list.length; i++) {
      var prev = list[i - 1].contract_date
      var curr = list[i].contract_date
      if (prev && curr && daysBetween(prev, curr) <= DAY_GAP) {
        cluster.push(list[i])
      } else {
        groups.push(cluster)
        cluster = [list[i]]
      }
    }
    groups.push(cluster)
  })

  // Sort groups by latest date descending
  groups.sort(function (a, b) {
    var aMax = Math.max.apply(null, a.map(function (e) { return new Date(e.contract_date || 0).getTime() }))
    var bMax = Math.max.apply(null, b.map(function (e) { return new Date(e.contract_date || 0).getTime() }))
    return bMax - aMax
  })

  return groups.map(function (functions) {
    var dates = functions.map(function (f) { return f.contract_date }).filter(Boolean).sort()
    var totalItems = functions.reduce(function (sum, f) { return sum + (f.item_count || 0) }, 0)
    var totalPlates = functions.reduce(function (sum, f) { return sum + (f.total_plates || 0) }, 0)
    return {
      id: functions.map(function (f) { return f.id }).join('-'),
      client_name: functions[0].client_name || '—',
      contact_person: functions[0].contact_person || '',
      contact_number: functions[0].contact_number || '',
      date_start: dates[0] || null,
      date_end: dates[dates.length - 1] || null,
      venues: [...new Set(functions.map(function (f) { return f.venue_name }).filter(Boolean))],
      location: functions[0].location || '',
      function_count: functions.length,
      total_items: totalItems,
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
  var [eventItems, setEventItems] = useState([])
  var [blockingFunc, setBlockingFunc] = useState(null)
  var [briefFunc, setBriefFunc] = useState(null)
  var [editingBuffer, setEditingBuffer] = useState(null) // { id, setup_days, teardown_days }
  var [savingBuffer, setSavingBuffer] = useState(false)
  var [search, setSearch] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [deptFilter, setDeptFilter] = useState('')
  var [departments, setDepartments] = useState([])
  var [page, setPage] = useState(1)
  var [perPage, setPerPage] = useState(24)
  var [releasing, setReleasing] = useState({}) // { eventItemId: true } while releasing
  var [togglingStatus, setTogglingStatus] = useState({}) // { eventItemId: true }
  var [freedAlert, setFreedAlert] = useState(null)
  

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var userEventDeptNames = (profile?.event_dept_ids || []).map(function (id) {
    var dept = departments.find(function (d) { return d.id === id })
    return dept ? dept.name : null
  }).filter(Boolean)
  var hasEventDeptFilter = !isAdmin && userEventDeptNames.length > 0
  var perms = profile?.permissions || []
  var canEditBuffer = isAdmin || perms.includes('event_buffer')

  useEffect(function () {
    supabase.rpc('cleanup_expired_tentative').then(function () {})
    loadEvents().then(function () {
      if (Date.now() - lastSyncTime > SYNC_COOLDOWN) {
        syncFromLMS(true)
      }
    })
  }, [])

  async function loadEvents() {
    var dateFloor = new Date()
    dateFloor.setMonth(dateFloor.getMonth() - 6)
    var dateFloorStr = dateFloor.toISOString().split('T')[0]
    var [eventsRes, deptRes] = await Promise.all([
      supabase
      .from('events_safe')
      .select('id, lms_event_id, contract_no, contract_date, department, contract_type, venue_name, location, contact_person, contact_number, event_name, client_name, session, catering, total_plates, complementary_plates, extra_plates_charge, balance_received, balance_bank, balance_amount, status, setup_days, teardown_days, blocked_count, synced_at, created_user_name')
      .gte('contract_date', dateFloorStr)
      .order('contract_date', { ascending: false })
      .limit(2000),
      supabase.from('departments').select('id, name').eq('active', true),
    ])
    var data = eventsRes.data || []
    setDepartments(deptRes.data || [])
    // Use blocked_count from events_safe view instead of pulling all event_items
    var enriched = data.map(function (e) {
      return Object.assign({}, e, { item_count: e.blocked_count || 0, event_items: [] })
    })
    setEvents(enriched)
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

  async function openFunctionDetail(func) {
    setSelectedFunction(func)
    var { data } = await supabase
      .from('event_items')
      .select('*')
      .eq('event_id', func.id)
    var rows = data || []
    var itemIds = [...new Set(rows.map(function (r) { return r.item_id }).filter(Boolean))]
    if (itemIds.length > 0) {
      var [invRes, csRes] = await Promise.all([
        supabase.from('inventory_items').select('id, name, type, unit, blocked').in('id', itemIds),
        supabase.from('catering_store_items').select('id, name, type, unit').in('id', itemIds),
      ])
      var itemMap = {}
      ;(invRes.data || []).forEach(function (i) { itemMap[i.id] = i })
      ;(csRes.data || []).forEach(function (i) { if (!itemMap[i.id]) itemMap[i.id] = Object.assign({}, i, { blocked: 0 }) })
      rows = rows.map(function (ei) {
        return Object.assign({}, ei, { inventory_items: itemMap[ei.item_id] || null })
      })
    }
    setEventItems(rows)
  }

  async function saveBuffer() {
    if (!editingBuffer) return
    setSavingBuffer(true)
    // Capture old values for rollback
    var oldSetup = selectedFunction?.setup_days ?? 1
    var oldTeardown = selectedFunction?.teardown_days ?? 1
    try {
      // Update event
      var { error: bufErr } = await supabase.from('events').update({
        setup_days: editingBuffer.setup_days,
        teardown_days: editingBuffer.teardown_days,
      }).eq('id', editingBuffer.id)
      if (bufErr) throw bufErr

      // Recalculate block_from/block_to for all event_items of this event
      var { data: evt } = await supabase.from('events').select('contract_date').eq('id', editingBuffer.id).maybeSingle()
      if (evt?.contract_date) {
        var d = new Date(evt.contract_date)
        var from = new Date(d); from.setDate(from.getDate() - editingBuffer.setup_days)
        var to = new Date(d); to.setDate(to.getDate() + editingBuffer.teardown_days)
        var fromStr = from.toISOString().split('T')[0]
        var toStr = to.toISOString().split('T')[0]
        var { error: itemErr } = await supabase.from('event_items').update({ block_from: fromStr, block_to: toStr }).eq('event_id', editingBuffer.id)
        if (itemErr) {
          // Rollback event buffer days
          await supabase.from('events').update({ setup_days: oldSetup, teardown_days: oldTeardown }).eq('id', editingBuffer.id)
          throw new Error('Block dates update failed, buffer reverted: ' + itemErr.message)
        }
      }

      try { await logActivity('UPDATE_BUFFER', (selectedFunction?.event_name || '') + ' | setup=' + editingBuffer.setup_days + ' teardown=' + editingBuffer.teardown_days) } catch (_) {}
      setEditingBuffer(null)
      if (selectedFunction) openFunctionDetail(selectedFunction)
      loadEvents()
    } catch (err) {
      alert('Save failed: ' + (err.message || 'Unknown error'))
    }
    setSavingBuffer(false)
  }

  function canRelease(ei) {
    return isAdmin || ei.blocked_by === profile?.id
  }

 async function releaseItem(ei) {
    if (releasing[ei.id]) return
    if (!confirm('Release ' + ei.qty + ' × ' + titleCase(ei.inventory_items?.name) + '?')) return
    setReleasing(function (p) { return Object.assign({}, p, { [ei.id]: true }) })
    try {
      var itemId = ei.item_id
      var { error: relErr } = await supabase.from('event_items').delete().eq('id', ei.id)
      if (relErr) throw new Error('Release failed: ' + relErr.message)
      try { await logActivity('RELEASE_ITEMS', (selectedFunction?.event_name || '') + ' | ' + titleCase(ei.inventory_items?.name) + ' × ' + ei.qty) } catch (_) {}
      setEventItems(function (prev) { return prev.filter(function (x) { return x.id !== ei.id }) })
      // Check cascade
      var { data } = await supabase.rpc('check_freed_inventory', { p_item_ids: [itemId] })
      var affected = (data || []).filter(function (e) { return e.event_id !== selectedFunction?.id })
      if (affected.length > 0) setFreedAlert(affected)
    } catch (err) {
      alert('Release failed: ' + err.message)
    }
    setReleasing(function (p) { var c = Object.assign({}, p); delete c[ei.id]; return c })
  }

  async function releaseAll() {
    var releasable = eventItems.filter(canRelease)
    if (releasable.length === 0) return
    if (!confirm('Release all ' + releasable.length + ' items from this function?')) return
    setReleasing(function () {
      var r = {}; releasable.forEach(function (ei) { r[ei.id] = true }); return r
    })
    try {
      var ids = releasable.map(function (ei) { return ei.id })
      var itemIds = [...new Set(releasable.map(function (ei) { return ei.item_id }))]
      var { error: relErr } = await supabase.from('event_items').delete().in('id', ids)
      if (relErr) throw new Error('Release failed: ' + relErr.message)
      try { await logActivity('RELEASE_ITEMS', (selectedFunction?.event_name || '') + ' | ALL ' + releasable.length + ' items') } catch (_) {}
      setEventItems(function (prev) { return prev.filter(function (x) { return !ids.includes(x.id) }) })
      // Check cascade
      var { data } = await supabase.rpc('check_freed_inventory', { p_item_ids: itemIds })
      var affected = (data || []).filter(function (e) { return e.event_id !== selectedFunction?.id })
      if (affected.length > 0) setFreedAlert(affected)
    } catch (err) {
      alert('Release failed: ' + err.message)
    }
    setReleasing({})
  }

  async function toggleBlockStatus(ei) {
    if (togglingStatus[ei.id]) return
    var newStatus = ei.block_status === 'confirmed' ? 'tentative' : 'confirmed'
    setTogglingStatus(function (p) { return Object.assign({}, p, { [ei.id]: true }) })
    try {
      var { error: togErr } = await supabase.from('event_items').update({ block_status: newStatus }).eq('id', ei.id)
      if (togErr) throw new Error(togErr.message)
      try { await logActivity('BLOCK_STATUS', titleCase(ei.inventory_items?.name) + ' → ' + newStatus) } catch (_) {}
      setEventItems(function (prev) {
        return prev.map(function (x) { return x.id === ei.id ? Object.assign({}, x, { block_status: newStatus }) : x })
      })
    } catch (err) {
      alert('Failed: ' + err.message)
    }
    setTogglingStatus(function (p) { var c = Object.assign({}, p); delete c[ei.id]; return c })
  }

  async function confirmAllTentative() {
    var tentatives = eventItems.filter(function (ei) { return ei.block_status === 'tentative' })
    if (tentatives.length === 0) return
    if (!confirm('Confirm all ' + tentatives.length + ' tentative blocks?')) return
    var ids = tentatives.map(function (ei) { return ei.id })
    var { error: confErr } = await supabase.from('event_items').update({ block_status: 'confirmed' }).in('id', ids)
    if (confErr) { alert('Confirm failed: ' + confErr.message); return }
    try { await logActivity('BLOCK_STATUS', (selectedFunction?.event_name || '') + ' | Confirmed ALL ' + tentatives.length + ' tentative') } catch (_) {}
    setEventItems(function (prev) {
      return prev.map(function (x) { return x.block_status === 'tentative' ? Object.assign({}, x, { block_status: 'confirmed' }) : x })
    })
  }

  

  function groupByDept(items) {
    var groups = {}
    items.forEach(function (ei) {
      var dept = ei.department || 'Other'
      if (!groups[dept]) groups[dept] = []
      groups[dept].push(ei)
    })
    return groups
  }

  // Grouping
  var visibleEvents = hasEventDeptFilter
    ? events.filter(function (e) { return userEventDeptNames.includes(e.department) })
    : events
  var allGroups = groupEvents(visibleEvents)

  // Unique venues across all events
  var venueNames = [...new Set(events.map(function (e) { return e.venue_name }).filter(Boolean))]

  // Filter groups
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
            {venueNames.map(function (v) { return <option key={v} value={v}>{v}</option> })}
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

      {/* Guest Cards */}
      {filtered.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-8">No events found</p>
      )}

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {paged.map(function (group) {
          var dateRange = group.date_start === group.date_end
            ? formatDate(group.date_start)
            : formatDate(group.date_start) + ' – ' + formatDate(group.date_end)
          return (
            <div key={group.id}
              onClick={function () { setSelectedGroup(group) }}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md cursor-pointer transition-shadow">
              {/* Client header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-800 truncate">{titleCase(group.client_name)}</h3>
                  {group.contact_person && <p className="text-xs text-gray-500 truncate">{group.contact_person}</p>}
                </div>
                <span className="text-[11px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full ml-2 flex-shrink-0">
                  {group.function_count} fn{group.function_count !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Date + meta */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mb-3">
                <span>📅 {dateRange}</span>
                {group.venues.map(function (v) { return <span key={v}>🏛️ {v}</span> })}
                {group.location && <span>📍 {group.location}</span>}
              </div>

              {/* Functions list */}
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
                      <span className="text-gray-400">{formatDate(f.contract_date)}</span>
                      {f.contract_no && <span className="font-mono text-gray-400">#{f.contract_no}</span>}
                    </div>
                  )
                })}
              </div>

              {/* Stats */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                {group.total_plates > 0 && <span>🍽️ {group.total_plates} plates</span>}
                {group.total_items > 0 && <span>📦 {group.total_items} blocked</span>}
                {group.contact_number && <span>📞 {group.contact_number}</span>}
              </div>

              {/* Financial — admin only */}
              {isAdmin && (function () {
                var totalBalance = group.functions.reduce(function (sum, f) { return sum + (f.balance_amount || 0) }, 0)
                if (!totalBalance) return null
                return (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <span className={"text-xs font-medium " + (totalBalance < 0 ? "text-red-600" : "text-green-600")}>
                      Balance: {formatPaise(Math.abs(totalBalance))} {totalBalance < 0 ? 'due' : 'advance'}
                    </span>
                  </div>
                )
              })()}
            </div>
          )
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
            {/* Client info */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                {selectedGroup.contact_person && <span><strong>Contact:</strong> {selectedGroup.contact_person}</span>}
                {selectedGroup.contact_number && <span><strong>Phone:</strong> {selectedGroup.contact_number}</span>}
                {selectedGroup.location && <span><strong>Location:</strong> {selectedGroup.location}</span>}
              </div>
            </div>

            {/* Financial summary — admin only */}
            {isAdmin && (function () {
              var totalReceived = selectedGroup.functions.reduce(function (s, f) { return s + (f.balance_received || 0) }, 0)
              var totalBank = selectedGroup.functions.reduce(function (s, f) { return s + (f.balance_bank || 0) }, 0)
              var totalBalance = selectedGroup.functions.reduce(function (s, f) { return s + (f.balance_amount || 0) }, 0)
              if (!totalReceived && !totalBank && !totalBalance) return null
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">Financial Summary (All Functions)</h4>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Received</p>
                      <p className="font-medium text-gray-800">{formatPaise(Math.abs(totalReceived))}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Bank</p>
                      <p className="font-medium text-gray-800">{formatPaise(totalBank)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Balance</p>
                      <p className={"font-medium " + (totalBalance < 0 ? "text-red-600" : "text-green-600")}>
                        {formatPaise(Math.abs(totalBalance))} {totalBalance < 0 ? 'due' : 'advance'}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Functions list */}
            <div>
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                Functions ({selectedGroup.function_count})
              </h4>
              <div className="space-y-2">
                {selectedGroup.functions.map(function (f) {
                  var itemCount = (f.event_items || []).length
                  return (
                    <div key={f.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <div onClick={function () { openFunctionDetail(f) }}
                        className="p-4 hover:bg-gray-50 cursor-pointer transition-colors">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h5 className="font-semibold text-gray-800">{f.event_name || f.contract_type || '—'}</h5>
                            {f.contract_no && <span className="text-[11px] font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">#{f.contract_no}</span>}
                          </div>
                          {f.department && <Badge color="indigo">{f.department}</Badge>}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                          <span>📅 {formatDate(f.contract_date)}</span>
                          {f.venue_name && <span>🏛️ {f.venue_name}</span>}
                          {f.session && <span>🕐 {f.session}</span>}
                          {f.total_plates > 0 && <span>🍽️ {f.total_plates} plates</span>}
                          {f.catering && <span>🍴 {f.catering}</span>}
                          {(f.event_items || []).length > 0 && <span>📦 {(f.event_items || []).length} blocked</span>}
                        </div>
                        {isAdmin && f.balance_amount !== null && f.balance_amount !== 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-100">
                            <span className={"text-xs font-medium " + (f.balance_amount < 0 ? "text-red-600" : "text-green-600")}>
                              Balance: {formatPaise(Math.abs(f.balance_amount))} {f.balance_amount < 0 ? 'due' : 'advance'}
                            </span>
                          </div>
                        )}
                      </div>
                      {/* Action buttons */}
                      <div className="flex border-t border-gray-100">
                        <button onClick={function (e) { e.stopPropagation(); setBlockingFunc(f); setSelectedGroup(null) }}
                          className="flex-1 py-3 text-sm font-bold text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 transition-colors">
                          🔒 Block
                        </button>
                        <div className="w-px bg-gray-100" />
                        <button onClick={function (e) { e.stopPropagation(); setBriefFunc(f); setSelectedGroup(null) }}
                          className="flex-1 py-3 text-sm font-bold text-amber-600 hover:bg-amber-50 active:bg-amber-100 transition-colors">
                          📎 Brief
                        </button>
                        <div className="w-px bg-gray-100" />
                        <button onClick={function (e) { e.stopPropagation(); openFunctionDetail(f) }}
                          className="flex-1 py-3 text-sm font-bold text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors">
                          📋 Details
                        </button>
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
      <Modal open={!!selectedFunction} onClose={function () { setSelectedFunction(null); setEventItems([]) }}
        title={selectedFunction?.event_name || selectedFunction?.contract_type || ''} wide>
        {selectedFunction && (
          <div className="space-y-6">
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                {selectedFunction.contract_no && <span><strong>Contract:</strong> #{selectedFunction.contract_no}</span>}
                {selectedFunction.contract_date && <span><strong>Date:</strong> {formatDate(selectedFunction.contract_date)}</span>}
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
              {/* Buffer days */}
              <div className="flex items-center gap-3 pt-2 border-t border-gray-200 mt-2">
                <span className="text-xs text-gray-500">🔒 Block range:</span>
                {selectedFunction.contract_date && (
                  <span className="text-xs font-medium text-indigo-600">
                    {new Date(new Date(selectedFunction.contract_date).getTime() - (selectedFunction.setup_days || 1) * 86400000).toLocaleDateString('en-IN', {day:'numeric',month:'short'})}
                    {' → '}
                    {new Date(new Date(selectedFunction.contract_date).getTime() + (selectedFunction.teardown_days || 1) * 86400000).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})}
                  </span>
                )}
                <span className="text-[11px] text-gray-400">({selectedFunction.setup_days ?? 1}d setup + {selectedFunction.teardown_days ?? 1}d teardown)</span>
                {canEditBuffer && !editingBuffer && (
                  <button onClick={function () { setEditingBuffer({ id: selectedFunction.id, setup_days: selectedFunction.setup_days ?? 1, teardown_days: selectedFunction.teardown_days ?? 1 }) }}
                    className="text-[11px] text-indigo-600 font-medium hover:text-indigo-800 ml-auto">✎ Edit</button>
                )}
              </div>

              {/* Buffer edit inline */}
              {editingBuffer && editingBuffer.id === selectedFunction.id && (
                <div className="flex items-center gap-2 pt-2">
                  <label className="text-xs text-gray-500">Setup:</label>
                  <input type="number" min="0" max="7"
                    value={editingBuffer.setup_days}
                    onChange={function (e) { setEditingBuffer(Object.assign({}, editingBuffer, { setup_days: Math.max(0, Number(e.target.value) || 0) })) }}
                    className="w-14 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    style={{ fontSize: '16px' }} />
                  <label className="text-xs text-gray-500">Teardown:</label>
                  <input type="number" min="0" max="7"
                    value={editingBuffer.teardown_days}
                    onChange={function (e) { setEditingBuffer(Object.assign({}, editingBuffer, { teardown_days: Math.max(0, Number(e.target.value) || 0) })) }}
                    className="w-14 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    style={{ fontSize: '16px' }} />
                  <button onClick={saveBuffer} disabled={savingBuffer}
                    className="px-3 py-1 text-xs font-bold text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                    {savingBuffer ? '...' : 'Save'}</button>
                  <button onClick={function () { setEditingBuffer(null) }}
                    className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              )}
            </div>

            {/* Financial — admin only */}
            {isAdmin && (selectedFunction.balance_received != null || selectedFunction.balance_bank != null || selectedFunction.balance_amount != null) && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">Financial Summary</h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Received</p>
                    <p className="font-medium text-gray-800">{formatPaise(Math.abs(selectedFunction.balance_received || 0))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Bank</p>
                    <p className="font-medium text-gray-800">{formatPaise(selectedFunction.balance_bank || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Balance</p>
                    <p className={"font-medium " + ((selectedFunction.balance_amount || 0) < 0 ? "text-red-600" : "text-green-600")}>
                      {formatPaise(Math.abs(selectedFunction.balance_amount || 0))} {(selectedFunction.balance_amount || 0) < 0 ? 'due' : 'advance'}
                    </p>
                  </div>
                </div>
              </div>
            )}
              {freedAlert && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-blue-700 uppercase tracking-wider">📢 Freed Inventory — {freedAlert.length} future event{freedAlert.length !== 1 ? 's' : ''} use these items</h4>
                  <button onClick={function () { setFreedAlert(null) }}
                    className="text-xs text-blue-400 hover:text-blue-600 font-semibold">Dismiss</button>
                </div>
                <div className="space-y-1.5">
                  {freedAlert.map(function (evt) {
                    return (
                      <div key={evt.event_id} className="flex items-center justify-between bg-white rounded px-2.5 py-1.5 border border-blue-100">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{evt.event_name || '—'}</p>
                          <p className="text-[11px] text-gray-400">{evt.venue_name} · {evt.contract_date} · {evt.department}</p>
                        </div>
                        <div className="text-right">
                          {(evt.items || []).map(function (it, ii) {
                            return <p key={ii} className="text-[11px] text-blue-600 font-medium">{it.item_name}: {it.blocked_qty}</p>
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Blocked items */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h4 className="text-sm font-semibold text-gray-700">Blocked Items ({eventItems.length})</h4>
                  {(function () {
                    var confirmed = eventItems.filter(function (ei) { return ei.block_status === 'confirmed' }).length
                    var tentative = eventItems.filter(function (ei) { return ei.block_status === 'tentative' }).length
                    if (tentative === 0) return null
                    return (
                      <span className="text-[11px] text-gray-400">
                        <span className="text-green-600 font-medium">{confirmed} confirmed</span>
                        <span className="mx-1">·</span>
                        <span className="text-amber-600 font-medium">{tentative} tentative</span>
                      </span>
                    )
                  })()}
                </div>
                <div className="flex gap-2">
                  {isAdmin && eventItems.some(function (ei) { return ei.block_status === 'tentative' }) && (
                    <button onClick={confirmAllTentative}
                      className="px-3 py-1.5 text-xs font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 active:bg-green-200 transition-colors">
                      ✓ Confirm All
                    </button>
                  )}
                {eventItems.some(canRelease) && (
                  <button onClick={releaseAll}
                    className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 active:bg-red-200 transition-colors">
                    Release All ({eventItems.filter(canRelease).length})
                  </button>
                )}
                </div>
              </div>
              {Object.entries(groupByDept(eventItems)).map(function (entry) {
                var dept = entry[0]; var items = entry[1]
                return (
                  <div key={dept} className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge color="indigo">{dept}</Badge>
                      <span className="text-xs text-gray-400">{items.length} items</span>
                    </div>
                    <div className="bg-gray-50 rounded-lg overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left px-3 py-2 font-medium text-gray-600">Item</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600">Type</th>
                            <th className="text-right px-3 py-2 font-medium text-gray-600">Qty</th>
                            <th className="text-left px-3 py-2 font-medium text-gray-600">Remark</th>
                            <th className="text-center px-3 py-2 font-medium text-gray-600">Status</th>
                            <th className="text-center px-3 py-2 font-medium text-gray-600 w-20"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(function (ei) {
                            return (
                              <tr key={ei.id} className="border-b border-gray-100">
                                <td className="px-3 py-2 text-gray-800">{titleCase(ei.inventory_items?.name)}</td>
                                <td className="px-3 py-2">
                                  <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                                    (ei.inventory_items?.type === 'Premium' ? "bg-purple-100 text-purple-700" :
                                     ei.inventory_items?.type === 'Outdoor' ? "bg-green-100 text-green-700" :
                                     "bg-blue-100 text-blue-700")}>
                                    {ei.inventory_items?.type || '—'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">{ei.qty} {ei.inventory_items?.unit}</td>
                                <td className="px-3 py-2 text-gray-500 text-xs">{ei.remark || '—'}</td>
                                <td className="px-3 py-2 text-center">
                                  {isAdmin ? (
                                    <button onClick={function () { toggleBlockStatus(ei) }}
                                      disabled={togglingStatus[ei.id]}
                                      className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full cursor-pointer transition-colors " +
                                        (ei.block_status === 'confirmed'
                                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                                          : "bg-amber-100 text-amber-700 hover:bg-amber-200")}>
                                      {togglingStatus[ei.id] ? '...' : ei.block_status === 'confirmed' ? 'Confirmed' : 'Tentative'}
                                    </button>
                                  ) : (
                                    <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                                      (ei.block_status === 'confirmed' ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                                      {ei.block_status === 'confirmed' ? 'Confirmed' : 'Tentative'}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {canRelease(ei) && (
                                    <button onClick={function () { releaseItem(ei) }}
                                      disabled={releasing[ei.id]}
                                      className="px-2 py-1 text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 transition-colors">
                                      {releasing[ei.id] ? '...' : '✕ Release'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
              {eventItems.length === 0 && (
                <p className="text-sm text-gray-400">No items blocked yet</p>
              )}
            </div>

            {selectedFunction.synced_at && (
              <p className="text-xs text-gray-400 text-right">Last synced: {formatDate(selectedFunction.synced_at)}</p>
            )}

            {/* Back to group */}
            <button onClick={function () { setSelectedFunction(null); setEventItems([]); setFreedAlert(null) }} 
              className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors">
              ← Back to functions
            </button>
          </div>
        )}
      </Modal>
      {/* ═══ BLOCKING VIEW ═══ */}
      <Modal open={!!blockingFunc} onClose={function () { setBlockingFunc(null) }} title="Block Inventory" wide>
        {blockingFunc && (
          <BlockInventory
            func={blockingFunc}
            profile={profile}
            onDone={function () { setBlockingFunc(null); loadEvents() }}
          />
        )}
      </Modal>

      {/* ═══ BRIEF UPLOAD VIEW ═══ */}
      <Modal open={!!briefFunc} onClose={function () { setBriefFunc(null) }} title="Decor Briefs" wide>
        {briefFunc && (
          <BriefUpload
            func={briefFunc}
            profile={profile}
            onDone={function () { setBriefFunc(null) }}
          />
        )}
      </Modal>
      
    </div>
  )
}

export default Events