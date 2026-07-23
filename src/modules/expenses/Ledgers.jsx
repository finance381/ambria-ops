import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints } from '../../lib/format'
import { pushBack } from '../../lib/backNav'

var STATUS_LABELS = {
  recorded: 'Recorded',
  flagged: 'Flagged',
  acknowledged: 'Acknowledged',
  deducted: 'Deducted',
}

var STATUS_COLORS = {
  recorded: 'bg-amber-100 text-amber-700',
  flagged: 'bg-orange-100 text-orange-700',
  acknowledged: 'bg-green-100 text-green-700',
  deducted: 'bg-indigo-100 text-indigo-700',
}

var PAGE_SIZE = 50

function Ledgers({ profile }) {
  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var scopeDeptIds = isAdmin ? null : (profile?.event_dept_ids || [])
  var hasScope = !isAdmin && scopeDeptIds && scopeDeptIds.length > 0

  var today = new Date().toISOString().split('T')[0]
  var monthStart = new Date().toISOString().slice(0, 7) + '-01'

  var [dateFrom, setDateFrom] = useState(monthStart)
  var [dateTo, setDateTo] = useState(today)

  // Master maps
  var [deptMap, setDeptMap] = useState({})
  var [typeMap, setTypeMap] = useState({})
  var [subTypeMap, setSubTypeMap] = useState({})
  var [userMap, setUserMap] = useState({})
  var [venueMap, setVenueMap] = useState({})
  var [users, setUsers] = useState([])
  var [venues, setVenues] = useState([])

  // List view
  var [groups, setGroups] = useState([])
  var [totals, setTotals] = useState({ total: 0, pending: 0, committed: 0, allocs: 0 })
  var [loading, setLoading] = useState(false)
  var [sortBy, setSortBy] = useState('total') // total | committed | pending | allocs

  // Drill view
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

  useEffect(function () { loadLedger() }, [dateFrom, dateTo, (scopeDeptIds || []).join(',')])

  useEffect(function () {
    if (drillGroup) { setDrillOffset(0); loadDrill(false) }
  }, [drillGroup, drillUserFilter, drillStatusFilter, drillVenueFilter, dateFrom, dateTo])

  // Real-time subscription (debounced 800ms)
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
  }, [dateFrom, dateTo, drillGroup])

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
    var rows = []; var from = 0; var pageSize = 1000
    while (true) {
      var q = supabase.from('v_ledger')
        .select('department_id, expense_type_id, expense_sub_type_id, amount_paise, pending_paise, committed_paise')
        .in('status', ['recorded', 'flagged', 'acknowledged', 'deducted'])
        .gte('expense_date', dateFrom)
        .lte('expense_date', dateTo)
        .range(from, from + pageSize - 1)
      if (hasScope) q = q.in('department_id', scopeDeptIds)
      var page = await q
      if (page.error) { alert('Load failed: ' + page.error.message); setLoading(false); return }
      var chunk = page.data || []
      rows = rows.concat(chunk)
      if (chunk.length < pageSize) break
      from += pageSize
      if (from > 50000) break
    }
    var groupMap = {}
    var total = 0, pending = 0, committed = 0
    rows.forEach(function (r) {
      var k = (r.department_id || 0) + '|' + (r.expense_type_id || 0) + '|' + (r.expense_sub_type_id || 0)
      if (!groupMap[k]) {
        groupMap[k] = { deptId: r.department_id, typeId: r.expense_type_id, subTypeId: r.expense_sub_type_id, total: 0, pending: 0, committed: 0, allocs: 0 }
      }
      var g = groupMap[k]
      g.total += r.amount_paise || 0
      g.pending += r.pending_paise || 0
      g.committed += r.committed_paise || 0
      g.allocs += 1
      total += r.amount_paise || 0
      pending += r.pending_paise || 0
      committed += r.committed_paise || 0
    })
    setGroups(Object.values(groupMap))
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

  function openGroup(g) {
    pushBack(function () { setDrillGroup(null); setDrillRows([]); setDrillOffset(0); setDrillUserFilter(''); setDrillStatusFilter(''); setDrillVenueFilter('') })
    setDrillGroup(Object.assign({}, g, {
      deptName: g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated',
      typeName: g.typeId ? (typeMap[g.typeId] || 'Untyped') : 'Untyped',
      subTypeName: g.subTypeId ? (subTypeMap[g.subTypeId] || '—') : '—',
    }))
  }

  function closeDrill() {
    setDrillGroup(null); setDrillRows([]); setDrillOffset(0)
    setDrillUserFilter(''); setDrillStatusFilter(''); setDrillVenueFilter('')
  }

  function exportListCSV() {
    if (!groups.length) return
    function esc(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    var lines = ['Department,Type,Sub-Type,Total (pts),Committed (pts),Pending (pts),Allocations']
    var sorted = groups.slice().sort(function (a, b) { return b[sortBy] - a[sortBy] })
    sorted.forEach(function (g) {
      var d = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
      var t = g.typeId ? (typeMap[g.typeId] || 'Untyped') : 'Untyped'
      var s = g.subTypeId ? (subTypeMap[g.subTypeId] || '—') : '—'
      lines.push(esc(d) + ',' + esc(t) + ',' + esc(s) + ',' + (g.total / 100) + ',' + (g.committed / 100) + ',' + (g.pending / 100) + ',' + g.allocs)
    })
    var csv = '\uFEFF' + lines.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ledgers_' + dateFrom + '_' + dateTo + '.csv'; a.click()
  }

  var sortedGroups = groups.slice().sort(function (a, b) { return b[sortBy] - a[sortBy] })

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
              {venues.map(function (v) { return <option key={v.id} value={v.id}>{v.name || v.code}</option> })}
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

  // ─── LIST VIEW ───
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Ledgers</h2>
        <p className="text-xs text-gray-400">Live financial tracker · {totals.allocs} allocation{totals.allocs !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
          <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" style={{ fontSize: '16px' }} />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
          <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" style={{ fontSize: '16px' }} />
        </div>
        <button onClick={loadLedger} disabled={loading}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {loading ? '...' : '↻'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
          <p className="text-[10px] font-bold text-indigo-400 uppercase">Total</p>
          <p className="text-lg font-bold text-indigo-700">{formatPoints(totals.total)}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <p className="text-[10px] font-bold text-green-500 uppercase">Committed</p>
          <p className="text-lg font-bold text-green-700">{formatPoints(totals.committed)}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
          <p className="text-[10px] font-bold text-amber-500 uppercase">Pending</p>
          <p className="text-lg font-bold text-amber-700">{formatPoints(totals.pending)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {[['total', 'Total'], ['committed', 'Cmt'], ['pending', 'Pnd'], ['allocs', 'Allocs']].map(function (opt) {
            var on = sortBy === opt[0]
            return (
              <button key={opt[0]} onClick={function () { setSortBy(opt[0]) }}
                className={"px-2 py-1 text-[11px] font-semibold rounded-md transition-colors " + (on ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500 hover:text-gray-800")}>
                {opt[1]}
              </button>
            )
          })}
        </div>
        <button onClick={exportListCSV} disabled={!groups.length}
          className="px-3 py-1 text-[11px] font-semibold text-green-600 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 disabled:opacity-40 transition-colors">
          ↓ CSV
        </button>
      </div>

      {loading && groups.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">Loading ledger...</p>
      ) : sortedGroups.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">No expenses in this range</p>
      ) : (
        <div className="space-y-2">
          {sortedGroups.map(function (g, i) {
            var d = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
            var t = g.typeId ? (typeMap[g.typeId] || 'Untyped') : 'Untyped'
            var s = g.subTypeId ? (subTypeMap[g.subTypeId] || '—') : '—'
            return (
              <button key={i} onClick={function () { openGroup(g) }}
                className="w-full text-left bg-white border border-gray-200 rounded-xl p-3 hover:border-indigo-300 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{d}</p>
                    <p className="text-xs text-gray-500 truncate">{t} › {s}</p>
                  </div>
                  <div className="text-right ml-3 flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">{formatPoints(g.total)}</p>
                    <p className="text-[10px] text-gray-400">{g.allocs} alloc{g.allocs !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-semibold">Cmt {formatPoints(g.committed)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">Pnd {formatPoints(g.pending)}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Ledgers