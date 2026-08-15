import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints } from '../../lib/format'
import { pushBack } from '../../lib/backNav'

var STATUS_LABELS = { recorded: 'Recorded', flagged: 'Flagged', acknowledged: 'Acknowledged', deducted: 'Deducted' }
var STATUS_COLORS = {
  recorded: 'bg-amber-100 text-amber-700',
  flagged: 'bg-orange-100 text-orange-700',
  acknowledged: 'bg-green-100 text-green-700',
  deducted: 'bg-indigo-100 text-indigo-700',
}
var PAGE_SIZE = 50

function fmtISO(d) { return d.toISOString().split('T')[0] }

function getPresetRange(preset) {
  var d = new Date()
  if (preset === 'month') return { from: fmtISO(new Date(d.getFullYear(), d.getMonth(), 1)), to: fmtISO(d) }
  if (preset === 'lastMonth') return { from: fmtISO(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: fmtISO(new Date(d.getFullYear(), d.getMonth(), 0)) }
  if (preset === 'ytd') return { from: fmtISO(new Date(d.getFullYear(), 0, 1)), to: fmtISO(d) }
  return null
}

function Ledgers({ profile }) {
  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var scopeDeptIds = isAdmin ? null : (profile?.event_dept_ids || [])
  var hasScope = !isAdmin && scopeDeptIds && scopeDeptIds.length > 0

  // Date state
  var [datePreset, setDatePreset] = useState('month')
  var [dateFrom, setDateFrom] = useState(function () { return getPresetRange('month').from })
  var [dateTo, setDateTo] = useState(function () { return getPresetRange('month').to })

  // Filters
  var [search, setSearch] = useState('')
  var [searchDeb, setSearchDeb] = useState('')
  var [userFilter, setUserFilter] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('')
  var [pendingOnly, setPendingOnly] = useState(false)

  // Master maps
  var [deptMap, setDeptMap] = useState({})
  var [typeMap, setTypeMap] = useState({})
  var [subTypeMap, setSubTypeMap] = useState({})
  var [userMap, setUserMap] = useState({})
  var [venueMap, setVenueMap] = useState({})
  var [users, setUsers] = useState([])
  var [venues, setVenues] = useState([])

  // List state
  var [deptGroups, setDeptGroups] = useState([])
  var [totals, setTotals] = useState({ total: 0, pending: 0, committed: 0, allocs: 0 })
  var [loading, setLoading] = useState(false)
  var [collapsedDepts, setCollapsedDepts] = useState({})
  var [deptDelta, setDeptDelta] = useState({})
  var allocSnapshot = useRef({})
  var isFirstLoad = useRef(true)

  // Drill state
  var [drillGroup, setDrillGroup] = useState(null)
  var [drillRows, setDrillRows] = useState([])
  var [drillOffset, setDrillOffset] = useState(0)
  var [drillHasMore, setDrillHasMore] = useState(false)
  var [drillLoading, setDrillLoading] = useState(false)
  var [drillUserFilter, setDrillUserFilter] = useState('')
  var [drillStatusFilter, setDrillStatusFilter] = useState('')
  var [drillVenueFilter, setDrillVenueFilter] = useState('')

  var reloadTimer = useRef(null)

  useEffect(function () { loadMaps() }, [])

  useEffect(function () {
    var t = setTimeout(function () { setSearchDeb(search) }, 300)
    return function () { clearTimeout(t) }
  }, [search])

  useEffect(function () {
    isFirstLoad.current = true
    loadLedger()
  }, [dateFrom, dateTo, userFilter, venueFilter, statusFilter, (scopeDeptIds || []).join(',')])

  useEffect(function () {
    if (drillGroup) { setDrillOffset(0); loadDrill(false) }
  }, [drillGroup, drillUserFilter, drillStatusFilter, drillVenueFilter, dateFrom, dateTo])

  useEffect(function () {
    function schedule() {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(function () {
        loadLedger()
        if (drillGroup) { setDrillOffset(0); loadDrill(false) }
      }, 800)
    }
    var channel = supabase.channel('ledgers-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_allocations' }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'expenses' }, schedule)
      .subscribe()
    return function () {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      supabase.removeChannel(channel)
    }
  }, [dateFrom, dateTo, userFilter, venueFilter, statusFilter, drillGroup])

  async function loadMaps() {
    var res = await Promise.all([
      supabase.from('departments').select('id, name'),
      supabase.from('expense_types').select('id, name'),
      supabase.from('expense_sub_types').select('id, name'),
      supabase.from('profiles').select('id, name'),
      supabase.from('venues').select('id, name, code'),
    ])
    var dm = {}; (res[0].data || []).forEach(function (d) { dm[d.id] = d.name })
    var tm = {}; (res[1].data || []).forEach(function (t) { tm[t.id] = t.name })
    var stm = {}; (res[2].data || []).forEach(function (s) { stm[s.id] = s.name })
    var um = {}; (res[3].data || []).forEach(function (u) { um[u.id] = u.name })
    var vm = {}; (res[4].data || []).forEach(function (v) { vm[v.id] = v.name || v.code })
    setDeptMap(dm); setTypeMap(tm); setSubTypeMap(stm); setUserMap(um); setVenueMap(vm)
    setUsers((res[3].data || []).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') }))
    setVenues((res[4].data || []).slice().sort(function (a, b) { return (a.name || a.code || '').localeCompare(b.name || b.code || '') }))
  }

  async function loadLedger() {
    setLoading(true)
    var statusIn = statusFilter ? [statusFilter] : ['recorded', 'flagged', 'acknowledged', 'deducted']
    var rows = []; var from = 0; var pageSize = 1000
    while (true) {
      var q = supabase.from('v_ledger')
        .select('department_id, expense_type_id, expense_sub_type_id, amount_paise, pending_paise, committed_paise')
        .in('status', statusIn)
        .gte('expense_date', dateFrom)
        .lte('expense_date', dateTo)
        .range(from, from + pageSize - 1)
      if (hasScope) q = q.in('department_id', scopeDeptIds)
      if (userFilter) q = q.eq('user_id', userFilter)
      if (venueFilter) q = q.eq('venue_id', Number(venueFilter))
      var page = await q
      if (page.error) { alert('Load failed: ' + page.error.message); setLoading(false); return }
      var chunk = page.data || []
      rows = rows.concat(chunk)
      if (chunk.length < pageSize) break
      from += pageSize
      if (from > 50000) break
    }

    var byDept = {}
    var total = 0, pending = 0, committed = 0
    rows.forEach(function (r) {
      var deptKey = r.department_id != null ? String(r.department_id) : '__unassigned__'
      var rowKey = (r.expense_type_id || 0) + '|' + (r.expense_sub_type_id || 0)
      if (!byDept[deptKey]) {
        byDept[deptKey] = { key: deptKey, deptId: r.department_id, total: 0, pending: 0, committed: 0, allocs: 0, rowMap: {} }
      }
      var g = byDept[deptKey]
      g.total += r.amount_paise || 0
      g.pending += r.pending_paise || 0
      g.committed += r.committed_paise || 0
      g.allocs += 1
      if (!g.rowMap[rowKey]) {
        g.rowMap[rowKey] = { typeId: r.expense_type_id, subTypeId: r.expense_sub_type_id, total: 0, pending: 0, committed: 0, allocs: 0 }
      }
      var rr = g.rowMap[rowKey]
      rr.total += r.amount_paise || 0
      rr.pending += r.pending_paise || 0
      rr.committed += r.committed_paise || 0
      rr.allocs += 1
      total += r.amount_paise || 0
      pending += r.pending_paise || 0
      committed += r.committed_paise || 0
    })
    var groups = Object.values(byDept).map(function (g) {
      var rowsArr = Object.values(g.rowMap).sort(function (a, b) { return b.total - a.total })
      return { key: g.key, deptId: g.deptId, total: g.total, pending: g.pending, committed: g.committed, allocs: g.allocs, rows: rowsArr }
    })
    groups.sort(function (a, b) { return b.total - a.total })

    // Delta tracking
    var newDeltas = {}
    if (isFirstLoad.current) {
      var snap = {}
      groups.forEach(function (g) { snap[g.key] = g.allocs })
      allocSnapshot.current = snap
      isFirstLoad.current = false
    } else {
      groups.forEach(function (g) {
        var prev = allocSnapshot.current[g.key] || 0
        if (g.allocs > prev) newDeltas[g.key] = g.allocs - prev
      })
    }
    setDeptDelta(newDeltas)
    setDeptGroups(groups)
    setTotals({ total: total, pending: pending, committed: committed, allocs: rows.length })
    setLoading(false)
  }

  async function loadDrill(append) {
    if (!drillGroup) return
    setDrillLoading(true)
    var offset = append ? drillOffset : 0
    var q = supabase.from('v_ledger')
      .select('allocation_id, expense_id, user_id, venue_id, amount_paise, remarks, expense_date, description, status, created_at')
      .in('status', ['recorded', 'flagged', 'acknowledged', 'deducted'])
      .gte('expense_date', dateFrom)
      .lte('expense_date', dateTo)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)
    if (drillGroup.deptId) q = q.eq('department_id', drillGroup.deptId)
    else q = q.is('department_id', null)
    if (drillGroup.typeId) q = q.eq('expense_type_id', drillGroup.typeId)
    else q = q.is('expense_type_id', null)
    if (drillGroup.subTypeId) q = q.eq('expense_sub_type_id', drillGroup.subTypeId)
    else q = q.is('expense_sub_type_id', null)
    if (drillUserFilter) q = q.eq('user_id', drillUserFilter)
    if (drillStatusFilter) q = q.eq('status', drillStatusFilter)
    if (drillVenueFilter) q = q.eq('venue_id', Number(drillVenueFilter))

    var { data, error } = await q
    if (error) { alert('Drill load failed: ' + error.message); setDrillLoading(false); return }
    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)
    if (append) setDrillRows(function (prev) { return prev.concat(rows) })
    else setDrillRows(rows)
    setDrillHasMore(hasMore)
    setDrillOffset(offset + rows.length)
    setDrillLoading(false)
  }

  function openRow(g, r) {
    var deptName = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
    var typeName = r.typeId ? (typeMap[r.typeId] || 'Untyped') : 'Untyped'
    var subTypeName = r.subTypeId ? (subTypeMap[r.subTypeId] || '—') : '—'
    pushBack(function () { setDrillGroup(null); setDrillRows([]); setDrillOffset(0); setDrillUserFilter(''); setDrillStatusFilter(''); setDrillVenueFilter('') })
    setDrillGroup({
      deptId: g.deptId, typeId: r.typeId, subTypeId: r.subTypeId,
      deptName: deptName, typeName: typeName, subTypeName: subTypeName,
      total: r.total, pending: r.pending, committed: r.committed
    })
  }

  function closeDrill() {
    setDrillGroup(null); setDrillRows([]); setDrillOffset(0)
    setDrillUserFilter(''); setDrillStatusFilter(''); setDrillVenueFilter('')
  }

  function toggleDept(deptKey, currentAllocs) {
    setCollapsedDepts(function (prev) {
      var next = Object.assign({}, prev)
      next[deptKey] = !prev[deptKey]
      return next
    })
    allocSnapshot.current[deptKey] = currentAllocs
    setDeptDelta(function (prev) {
      var next = Object.assign({}, prev)
      delete next[deptKey]
      return next
    })
  }

  function applyPreset(preset) {
    setDatePreset(preset)
    if (preset === 'custom') return
    var r = getPresetRange(preset)
    if (r) { setDateFrom(r.from); setDateTo(r.to) }
  }

  function exportListCSV() {
    if (!deptGroups.length) return
    function esc(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    var lines = ['Department,Type,Sub-Type,Total (pts),Committed (pts),Pending (pts),Allocations']
    deptGroups.forEach(function (g) {
      var d = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
      lines.push(esc(d) + ' (subtotal),,,' + (g.total / 100) + ',' + (g.committed / 100) + ',' + (g.pending / 100) + ',' + g.allocs)
      g.rows.forEach(function (r) {
        var t = r.typeId ? (typeMap[r.typeId] || 'Untyped') : 'Untyped'
        var s = r.subTypeId ? (subTypeMap[r.subTypeId] || '—') : '—'
        lines.push(esc(d) + ',' + esc(t) + ',' + esc(s) + ',' + (r.total / 100) + ',' + (r.committed / 100) + ',' + (r.pending / 100) + ',' + r.allocs)
      })
    })
    var csv = '\uFEFF' + lines.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ledgers_' + dateFrom + '_' + dateTo + '.csv'; a.click()
  }

  // Client-side filter: search + pendingOnly
  var visibleGroups = deptGroups.map(function (g) {
    var deptName = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
    var q = searchDeb.toLowerCase()
    var deptMatch = !q || deptName.toLowerCase().indexOf(q) !== -1
    var filteredRows = g.rows.filter(function (r) {
      if (pendingOnly && r.pending === 0) return false
      if (!q) return true
      if (deptMatch) return true
      var tn = r.typeId ? (typeMap[r.typeId] || '') : ''
      var sn = r.subTypeId ? (subTypeMap[r.subTypeId] || '') : ''
      return tn.toLowerCase().indexOf(q) !== -1 || sn.toLowerCase().indexOf(q) !== -1
    })
    if (pendingOnly && g.pending === 0) return null
    if (q && !deptMatch && filteredRows.length === 0) return null
    return Object.assign({}, g, { rows: filteredRows, deptName: deptName })
  }).filter(Boolean)

  // ─── DRILL VIEW ───
  if (drillGroup) {
    return (
      <div className="space-y-4">
        <div>
          <button onClick={closeDrill}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Ledgers</button>
          <h2 className="text-lg font-bold text-gray-900">{drillGroup.deptName}</h2>
          <p className="text-xs text-gray-500">{drillGroup.typeName} › {drillGroup.subTypeName}</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2 text-center">
            <p className="text-[9px] font-bold text-indigo-400 uppercase">Total</p>
            <p className="text-sm font-bold text-indigo-700">{formatPoints(drillGroup.total)}</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
            <p className="text-[9px] font-bold text-green-500 uppercase">Committed</p>
            <p className="text-sm font-bold text-green-700">{formatPoints(drillGroup.committed)}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
            <p className="text-[9px] font-bold text-amber-500 uppercase">Pending</p>
            <p className="text-sm font-bold text-amber-700">{formatPoints(drillGroup.pending)}</p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="grid grid-cols-3 gap-2">
            <select value={drillUserFilter} onChange={function (e) { setDrillUserFilter(e.target.value) }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-md" style={{ fontSize: '16px' }}>
              <option value="">All Users</option>
              {users.map(function (u) { return <option key={u.id} value={u.id}>{u.name}</option> })}
            </select>
            <select value={drillStatusFilter} onChange={function (e) { setDrillStatusFilter(e.target.value) }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-md" style={{ fontSize: '16px' }}>
              <option value="">All Status</option>
              <option value="recorded">Recorded</option>
              <option value="flagged">Flagged</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="deducted">Deducted</option>
            </select>
            <select value={drillVenueFilter} onChange={function (e) { setDrillVenueFilter(e.target.value) }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-md" style={{ fontSize: '16px' }}>
              <option value="">All Venues</option>
              {venues.map(function (v) { return <option key={v.id} value={v.id}>{v.code ? (v.code + ' — ' + v.name) : v.name}</option> })}
            </select>
          </div>
        </div>

        {drillLoading && drillRows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">Loading...</p>
        ) : drillRows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">No allocations in range</p>
        ) : (
          <div className="space-y-2">
            {drillRows.map(function (r) {
              return (
                <div key={r.allocation_id} className="bg-white border border-gray-200 rounded-xl p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500">{r.expense_date}</span>
                        <span className="text-xs font-semibold text-gray-700">{userMap[r.user_id] || '—'}</span>
                        <span className={"text-[10px] px-1.5 py-0.5 rounded font-semibold " + (STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600')}>
                          {STATUS_LABELS[r.status] || r.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 truncate mt-1">{r.description || '—'}</p>
                      {r.remarks && <p className="text-xs italic text-gray-500 mt-0.5">"{r.remarks}"</p>}
                      {r.venue_id && <p className="text-[10px] text-gray-400 mt-0.5">Venue: {venueMap[r.venue_id] || '—'}</p>}
                    </div>
                    <span className="text-sm font-bold text-gray-800 ml-3 flex-shrink-0">{formatPoints(r.amount_paise)}</span>
                  </div>
                </div>
              )
            })}
            {drillHasMore && (
              <button onClick={function () { loadDrill(true) }} disabled={drillLoading}
                className="w-full py-2 text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                {drillLoading ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  function PresetChip(props) {
    var active = datePreset === props.k
    return (
      <button onClick={function () { applyPreset(props.k) }}
        className={"px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors " + (active ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500 hover:text-gray-800")}>
        {props.label}
      </button>
    )
  }

  // ─── LIST VIEW ───
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Ledgers</h2>
        <p className="text-xs text-gray-400">Live financial tracker · {totals.allocs} allocation{totals.allocs !== 1 ? 's' : ''}</p>
      </div>

      <div className="sticky top-0 z-10 bg-gray-50 pt-1 pb-3 border-b border-gray-200 space-y-2">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 text-center">
            <p className="text-[9px] font-bold text-indigo-400 uppercase">Total</p>
            <p className="text-base font-bold text-indigo-700">{formatPoints(totals.total)}</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-center">
            <p className="text-[9px] font-bold text-green-500 uppercase">Committed</p>
            <p className="text-base font-bold text-green-700">{formatPoints(totals.committed)}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
            <p className="text-[9px] font-bold text-amber-500 uppercase">Pending</p>
            <p className="text-base font-bold text-amber-700">{formatPoints(totals.pending)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <PresetChip k="month" label="This month" />
          <PresetChip k="lastMonth" label="Last month" />
          <PresetChip k="ytd" label="YTD" />
          <PresetChip k="custom" label="Custom" />
          {datePreset === 'custom' && (
            <>
              <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value) }}
                className="px-2 py-1 border border-gray-200 rounded-md text-[11px]" style={{ fontSize: '16px' }} />
              <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value) }}
                className="px-2 py-1 border border-gray-200 rounded-md text-[11px]" style={{ fontSize: '16px' }} />
            </>
          )}
        </div>

        <input type="text" value={search} onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search dept / type / sub-type..."
          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs" style={{ fontSize: '16px' }} />

        <div className="flex flex-wrap gap-1.5 items-center">
          <select value={userFilter} onChange={function (e) { setUserFilter(e.target.value) }}
            className="px-2 py-1 text-[11px] border border-gray-200 rounded-md flex-1 min-w-[100px]" style={{ fontSize: '16px' }}>
            <option value="">All users</option>
            {users.map(function (u) { return <option key={u.id} value={u.id}>{u.name}</option> })}
          </select>
          <select value={venueFilter} onChange={function (e) { setVenueFilter(e.target.value) }}
            className="px-2 py-1 text-[11px] border border-gray-200 rounded-md flex-1 min-w-[100px]" style={{ fontSize: '16px' }}>
            <option value="">All venues</option>
            {venues.map(function (v) { return <option key={v.id} value={v.id}>{v.code ? (v.code + ' — ' + v.name) : v.name}</option> })}
          </select>
          <select value={statusFilter} onChange={function (e) { setStatusFilter(e.target.value) }}
            className="px-2 py-1 text-[11px] border border-gray-200 rounded-md flex-1 min-w-[100px]" style={{ fontSize: '16px' }}>
            <option value="">All status</option>
            <option value="recorded">Recorded</option>
            <option value="flagged">Flagged</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="deducted">Deducted</option>
          </select>
          <button onClick={function () { setPendingOnly(!pendingOnly) }}
            className={"px-2 py-1 text-[11px] font-semibold rounded-md transition-colors " + (pendingOnly ? "bg-amber-100 border border-amber-300 text-amber-700" : "bg-white border border-gray-200 text-gray-500")}>
            Pending only
          </button>
          <button onClick={exportListCSV} disabled={!deptGroups.length}
            className="px-2 py-1 text-[11px] font-semibold text-green-600 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 disabled:opacity-40">
            ↓ CSV
          </button>
        </div>
      </div>

      {loading && deptGroups.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">Loading ledger...</p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">No matches in this range</p>
      ) : (
        <div className="space-y-1.5">
          {visibleGroups.map(function (g) {
            var collapsed = collapsedDepts[g.key]
            var delta = deptDelta[g.key] || 0
            return (
              <div key={g.key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={function () { toggleDept(g.key, g.allocs) }}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors text-left">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs text-gray-400 flex-shrink-0">{collapsed ? '▸' : '▾'}</span>
                    <span className="text-sm font-bold text-gray-900 truncate">{g.deptName}</span>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{g.rows.length} · {g.allocs}</span>
                    {delta > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex-shrink-0 animate-pulse">
                        +{delta}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 items-center flex-shrink-0 text-xs tabular-nums">
                    <span className="text-green-700">{formatPoints(g.committed)}</span>
                    <span className="text-amber-700">{formatPoints(g.pending)}</span>
                    <span className="font-bold text-gray-900 min-w-[60px] text-right">{formatPoints(g.total)}</span>
                  </div>
                </button>
                {!collapsed && g.rows.map(function (r, i) {
                  var typeName = r.typeId ? (typeMap[r.typeId] || 'Untyped') : 'Untyped'
                  var subTypeName = r.subTypeId ? (subTypeMap[r.subTypeId] || '—') : '—'
                  return (
                    <button key={i} onClick={function () { openRow(g, r) }}
                      className="w-full grid grid-cols-[1fr_70px_70px_80px_36px] items-center px-3 py-2 pl-9 border-t border-gray-100 hover:bg-indigo-50 transition-colors text-left">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-800 truncate">{subTypeName}</p>
                        <p className="text-[10px] text-gray-500 truncate">{typeName}</p>
                      </div>
                      <span className="text-xs text-right text-green-700 tabular-nums">{formatPoints(r.committed)}</span>
                      <span className="text-xs text-right text-amber-700 tabular-nums">{formatPoints(r.pending)}</span>
                      <span className="text-xs text-right font-bold text-gray-800 tabular-nums">{formatPoints(r.total)}</span>
                      <span className="text-[10px] text-right text-gray-400">{r.allocs}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Ledgers