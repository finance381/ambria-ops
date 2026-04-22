import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'

function ActivityLogs({ profile }) {
  var [logs, setLogs] = useState([])
  var [loading, setLoading] = useState(true)
  var [users, setUsers] = useState([])
  var [userMap, setUserMap] = useState({})
  var [userFilter, setUserFilter] = useState('')
  var [search, setSearch] = useState('')
  var [page, setPage] = useState(1)
  var [totalCount, setTotalCount] = useState(0)
  var [searchTimer, setSearchTimer] = useState(null)
  var perPage = 50

  useEffect(function () {
    supabase.from('profiles').select('id, name, email').then(function (res) {
      var uList = res.data || []
      setUsers(uList)
      var map = {}
      uList.forEach(function (u) { map[u.id] = u })
      setUserMap(map)
    })
  }, [])

  useEffect(function () {
    if (Object.keys(userMap).length === 0) return
    loadLogs()
  }, [page, userFilter, userMap])

  // Debounced search — 400ms after typing stops
  useEffect(function () {
    if (searchTimer) clearTimeout(searchTimer)
    var timer = setTimeout(function () {
      setPage(1)
      loadLogs()
    }, 400)
    setSearchTimer(timer)
    return function () { clearTimeout(timer) }
  }, [search])

  async function loadLogs() {
    setLoading(true)
    var from = (page - 1) * perPage
    var to = from + perPage - 1

    // Count query
    var countQuery = supabase.from('activity_logs').select('id', { count: 'exact', head: true })
    if (userFilter) countQuery = countQuery.eq('user_id', userFilter)
    if (search.trim()) countQuery = countQuery.or('details.ilike.%' + search.trim() + '%,action.ilike.%' + search.trim() + '%')

    // Data query
    var dataQuery = supabase.from('activity_logs').select('*')
      .order('created_at', { ascending: false })
      .range(from, to)
    if (userFilter) dataQuery = dataQuery.eq('user_id', userFilter)
    if (search.trim()) dataQuery = dataQuery.or('details.ilike.%' + search.trim() + '%,action.ilike.%' + search.trim() + '%')

    var [countRes, dataRes] = await Promise.all([countQuery, dataQuery])

    setTotalCount(countRes.count || 0)
    var enriched = (dataRes.data || []).map(function (log) {
      return Object.assign({}, log, { profile: userMap[log.user_id] || null })
    })
    setLogs(enriched)
    setLoading(false)
  }

  var totalPages = Math.ceil(totalCount / perPage)
  var paged = logs

  var actionColors = {
    ITEM_CREATE: 'bg-green-100 text-green-700',
    ITEM_UPDATE: 'bg-blue-100 text-blue-700',
    ITEM_MERGE: 'bg-indigo-100 text-indigo-700',
    USER_ADD: 'bg-green-100 text-green-700',
    USER_UPDATE: 'bg-blue-100 text-blue-700',
    USER_DELETE: 'bg-red-100 text-red-700',
    CAT_CREATE: 'bg-green-100 text-green-700',
    CAT_UPDATE: 'bg-blue-100 text-blue-700',
    CAT_DELETE: 'bg-red-100 text-red-700',
    DEPT_CREATE: 'bg-green-100 text-green-700',
    VENUE_CREATE: 'bg-green-100 text-green-700',
    ITEM_SUBMIT: 'bg-emerald-100 text-emerald-700',
    ITEM_EDIT_MERGE: 'bg-purple-100 text-purple-700',
    ITEM_DELETE: 'bg-red-100 text-red-700',
    APPROVE_ITEM: 'bg-green-100 text-green-700',
    DEPT_APPROVE_ITEM: 'bg-amber-100 text-amber-700',
    BLOCK_ITEMS: 'bg-indigo-100 text-indigo-700',
    RELEASE_ITEMS: 'bg-orange-100 text-orange-700',
    BLOCK_STATUS: 'bg-blue-100 text-blue-700',
    REQUISITION_CREATE: 'bg-green-100 text-green-700',
    REQUISITION_APPROVE: 'bg-green-100 text-green-700',
    REQUISITION_REJECT: 'bg-red-100 text-red-700',
    REQUISITION_EDIT: 'bg-blue-100 text-blue-700',
    REQUISITION_DELETE: 'bg-red-100 text-red-700',
    MAINTENANCE_HOLD: 'bg-amber-100 text-amber-700',
    MAINTENANCE_RELEASE: 'bg-orange-100 text-orange-700',
    UPDATE_BUFFER: 'bg-blue-100 text-blue-700',
  }

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading activity logs...</p>
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search action, details, user..."
          className="flex-1 min-w-[200px] px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={userFilter}
          onChange={function (e) { setUserFilter(e.target.value); setPage(1) }}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Users</option>
          {users.map(function (u) {
            return <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
          })}
        </select>
        <div className="text-sm text-gray-400 self-center">
          {totalCount} log{totalCount !== 1 ? 's' : ''}
        </div>

      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Time</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">User</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Action</th>
              <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody>
            {paged.map(function (log) {
              var color = actionColors[log.action] || 'bg-gray-100 text-gray-600'
              var isReject = (log.action || '').includes('REJECT')
              return (
                <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 text-[12px] whitespace-nowrap">{formatDate(log.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 text-[12px]">{log.profile?.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-[12px]">{log.profile?.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " + (isReject ? 'bg-red-100 text-red-700' : color)}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-[12px] max-w-[300px] truncate" title={log.details || ''}>
                    {log.details || '—'}
                  </td>
                </tr>
              )
            })}
            {paged.length === 0 && (
              <tr>
                <td colSpan="5" className="px-4 py-8 text-center text-gray-400">No activity logs found</td>
              </tr>
            )}
          </tbody>
        </table>
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
          <span className="text-xs text-gray-400 ml-2">Page {page} of {totalPages}</span>
        </div>
      )}
    </div>
  )
}

export default ActivityLogs