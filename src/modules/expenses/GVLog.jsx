import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'

function GVLog({ profile }) {
  var perms = (profile && profile.permissions) || []
  var isAdmin = profile?.role === 'admin' || perms.indexOf('feature_admin') !== -1
  var canView = isAdmin || perms.indexOf('finance_gv') !== -1

  var [gvs, setGvs] = useState([])
  var [loading, setLoading] = useState(true)
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [search, setSearch] = useState('')
  var [creatorFilter, setCreatorFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('all') // all | active | reversed | reversal
  var [creators, setCreators] = useState([])
  var [creatorMap, setCreatorMap] = useState({})
  var [expenseMap, setExpenseMap] = useState({})
  var [expandedGvId, setExpandedGvId] = useState('')

  useEffect(function () {
    if (!canView) { setLoading(false); return }
    loadGvs()
  }, [dateFrom, dateTo, creatorFilter, statusFilter])

  async function loadGvs() {
    setLoading(true)
    var query = supabase.from('general_vouchers')
      .select('id, gv_number, expense_id, fiscal_year, created_by, created_at, reason, before_allocations, after_allocations, is_reversal, reverses_gv_id, reversed_by_gv_id')
      .order('created_at', { ascending: false })
      .limit(500)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59')
    if (creatorFilter) query = query.eq('created_by', creatorFilter)
    if (statusFilter === 'reversal') query = query.eq('is_reversal', true)
    else if (statusFilter === 'reversed') query = query.not('reversed_by_gv_id', 'is', null)
    else if (statusFilter === 'active') query = query.eq('is_reversal', false).is('reversed_by_gv_id', null)

    var { data, error } = await query
    if (error) { setLoading(false); return }
    var rows = data || []
    setGvs(rows)

    // Resolve creators + expense summaries
    var creatorIds = []
    var expenseIds = []
    rows.forEach(function (g) {
      if (g.created_by && creatorIds.indexOf(g.created_by) === -1) creatorIds.push(g.created_by)
      if (g.expense_id && expenseIds.indexOf(g.expense_id) === -1) expenseIds.push(g.expense_id)
    })
    if (creatorIds.length > 0) {
      supabase.from('profiles').select('id, name').in('id', creatorIds).then(function (res) {
        var m = {}
        ;(res.data || []).forEach(function (p) { m[p.id] = p.name || '' })
        setCreatorMap(m)
        setCreators(res.data || [])
      })
    } else {
      setCreatorMap({}); setCreators([])
    }
    if (expenseIds.length > 0) {
      supabase.from('expenses').select('id, description, amount_paise, user_id, status').in('id', expenseIds).then(function (res) {
        var m = {}
        ;(res.data || []).forEach(function (e) { m[e.id] = e })
        setExpenseMap(m)
      })
    } else {
      setExpenseMap({})
    }
    setLoading(false)
  }

  var searchLower = search.trim().toLowerCase()
  var filtered = gvs.filter(function (g) {
    if (!searchLower) return true
    if (String(g.gv_number).toLowerCase().indexOf(searchLower) !== -1) return true
    if (String(g.expense_id).indexOf(searchLower) !== -1) return true
    if ((g.reason || '').toLowerCase().indexOf(searchLower) !== -1) return true
    return false
  })

  function exportCSV() {
    if (!filtered.length) return
    var headers = ['JV Number', 'Expense ID', 'Fiscal Year', 'Date', 'Creator', 'Reason', 'Status', 'Amount']
    var rows = filtered.map(function (g) {
      var e = expenseMap[g.expense_id] || {}
      var st = g.is_reversal ? 'Reversal' : (g.reversed_by_gv_id ? 'Reversed' : 'Active')
      return [
        g.gv_number,
        g.expense_id,
        g.fiscal_year,
        g.created_at ? g.created_at.slice(0, 10) : '',
        (creatorMap[g.created_by] || '').replace(/,/g, ';'),
        (g.reason || '').replace(/,/g, ';').replace(/\n/g, ' '),
        st,
        e.amount_paise ? (e.amount_paise / 100) : '',
      ].join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gv_log_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }

  if (!canView) {
    return <p className="text-gray-400 text-sm text-center py-8">Not permitted.</p>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Journal Voucher Log</h2>
          <p className="text-xs text-gray-400">{filtered.length} vouchers</p>
        </div>
        {filtered.length > 0 && (
          <button onClick={exportCSV}
            className="px-3 py-2 text-sm font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
            📥 CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
        <input type="text" value={search} onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search by JV #, expense ID, or reason..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value) }}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" style={{ fontSize: '16px' }} />
          <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value) }}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" style={{ fontSize: '16px' }} />
          <select value={creatorFilter} onChange={function (e) { setCreatorFilter(e.target.value) }}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white" style={{ fontSize: '16px' }}>
            <option value="">All creators</option>
            {creators.map(function (c) { return <option key={c.id} value={c.id}>{c.name || c.id.slice(0, 8)}</option> })}
          </select>
          <select value={statusFilter} onChange={function (e) { setStatusFilter(e.target.value) }}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white" style={{ fontSize: '16px' }}>
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="reversed">Reversed</option>
            <option value="reversal">Reversal JVs</option>
          </select>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-sm font-semibold text-gray-700 mb-1">No vouchers</p>
          <p className="text-xs text-gray-400">Adjust filters or raise a JV from an expense</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
          {filtered.map(function (gv) {
            var e = expenseMap[gv.expense_id] || {}
            var isExpanded = expandedGvId === gv.id
            var creator = creatorMap[gv.created_by] || '—'
            return (
              <div key={gv.id} className="px-4 py-2.5">
                <button onClick={function () { setExpandedGvId(isExpanded ? '' : gv.id) }} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                      <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
                      <span className="text-sm font-bold text-purple-800">{gv.gv_number}</span>
                      <span className="text-xs text-gray-500">·</span>
                      <span className="text-xs font-medium text-gray-700">Expense #{gv.expense_id}</span>
                      {gv.is_reversal && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">Reversal</span>
                      )}
                      {gv.reversed_by_gv_id && !gv.is_reversal && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700">Reversed</span>
                      )}
                    </div>
                    {e.amount_paise != null && (
                      <span className="text-sm font-bold text-gray-800 flex-shrink-0">{formatPoints(e.amount_paise)}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5">{creator} · {formatDate(gv.created_at)}{e.description ? ' · ' + e.description : ''}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5 line-clamp-2">{gv.reason}</p>
                </button>
                {isExpanded && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[{ label: 'Before', arr: gv.before_allocations }, { label: 'After', arr: gv.after_allocations }].map(function (side) {
                      var rows = Array.isArray(side.arr) ? side.arr : []
                      return (
                        <div key={side.label} className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
                          <div className="px-2 py-1 bg-gray-100 border-b border-gray-200">
                            <span className="text-[10px] font-bold text-gray-600 uppercase">{side.label}</span>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {rows.length === 0 && <p className="p-2 text-[11px] text-gray-400 italic">—</p>}
                            {rows.map(function (r, ri) {
                              return (
                                <div key={ri} className="px-2 py-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[12px] font-medium text-gray-800">{r.department || ('Dept #' + (r.department_id || '?'))}</span>
                                    <span className="text-[12px] font-bold text-gray-900">{formatPoints(r.amount_paise || 0)}</span>
                                  </div>
                                  {r.venue_id && (
                                    <p className="text-[10px] text-gray-500">Venue #{r.venue_id}{r.sub_venue_id ? ' › SV#' + r.sub_venue_id : ''}</p>
                                  )}
                                  {r.remarks && <p className="text-[10px] text-gray-500 italic">"{r.remarks}"</p>}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default GVLog