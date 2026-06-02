import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'

var PAGE_SIZE = 25

function ReviewHistory({ profile, onBack, onOpenDetail }) {
  var [expenses, setExpenses] = useState([])
  var [loading, setLoading] = useState(true)
  var [filter, setFilter] = useState('')
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [search, setSearch] = useState('')
  var [searchDebounced, setSearchDebounced] = useState('')
  var [hasMore, setHasMore] = useState(false)
  var [loadingMore, setLoadingMore] = useState(false)
  var [stats, setStats] = useState({ acknowledged: 0, flagged: 0, penalized: 0, totalPenalty: 0 })

  useEffect(function () {
    var t = setTimeout(function () { setSearchDebounced(search) }, 400)
    return function () { clearTimeout(t) }
  }, [search])

  useEffect(function () {
    loadExpenses(false)
  }, [filter, dateFrom, dateTo, searchDebounced])

  useEffect(function () {
    loadStats()
  }, [])

  async function loadStats() {
    var results = await Promise.all([
      supabase.from('expenses').select('id', { count: 'exact', head: true })
        .eq('acknowledged_by', profile.id).eq('status', 'acknowledged'),
      supabase.from('expenses').select('id', { count: 'exact', head: true })
        .eq('reviewed_by', profile.id).eq('status', 'flagged'),
      supabase.from('expenses').select('id, penalty_paise')
        .eq('penalized_by', profile.id).eq('status', 'penalized'),
    ])
    var penalizedRows = results[2].data || []
    var totalPenalty = penalizedRows.reduce(function (s, r) { return s + (r.penalty_paise || 0) }, 0)
    setStats({
      acknowledged: results[0].count || 0,
      flagged: results[1].count || 0,
      penalized: penalizedRows.length,
      totalPenalty: totalPenalty,
    })
  }

  async function loadExpenses(append) {
    var offset = append ? expenses.length : 0
    if (!append) setLoading(true)
    else setLoadingMore(true)

    var query = supabase.from('expenses')
      .select('id, user_id, category_id, expense_type_id, expense_sub_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, flag_reason, penalty_paise, acknowledged_by, acknowledged_at, reviewed_by, reviewed_at, penalized_by, penalized_at, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, categories(name), expense_types(name), expense_sub_types(name, extra_fields), events(event_name)')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (filter === 'acknowledged') {
      query = query.eq('acknowledged_by', profile.id).eq('status', 'acknowledged')
    } else if (filter === 'flagged') {
      query = query.eq('reviewed_by', profile.id).eq('status', 'flagged')
    } else if (filter === 'penalized') {
      query = query.eq('penalized_by', profile.id).eq('status', 'penalized')
    } else {
      query = query.or(
        'acknowledged_by.eq.' + profile.id + ',reviewed_by.eq.' + profile.id + ',penalized_by.eq.' + profile.id
      )
      query = query.in('status', ['acknowledged', 'flagged', 'penalized'])
    }

    if (dateFrom) query = query.gte('expense_date', dateFrom)
    if (dateTo) query = query.lte('expense_date', dateTo)
    if (searchDebounced) query = query.ilike('description', '%' + searchDebounced + '%')

    var { data, error } = await query
    if (error) { alert('Load failed: ' + error.message); setLoading(false); setLoadingMore(false); return }

    var rows = data || []
    var more = rows.length > PAGE_SIZE
    if (more) rows = rows.slice(0, PAGE_SIZE)

    var userIds = []
    rows.forEach(function (r) { if (r.user_id && userIds.indexOf(r.user_id) === -1) userIds.push(r.user_id) })
    if (userIds.length > 0) {
      var { data: names } = await supabase.rpc('get_profile_names', { p_ids: userIds })
      var nameMap = {}
      ;(names || []).forEach(function (n) { nameMap[n.id] = n.name })
      rows = rows.map(function (r) { return Object.assign({}, r, { profiles: { name: nameMap[r.user_id] || '—' } }) })
    }

    if (append) {
      setExpenses(function (prev) { return prev.concat(rows) })
    } else {
      setExpenses(rows)
    }
    setHasMore(more)
    setLoading(false)
    setLoadingMore(false)
  }

  function actionDate(exp) {
    if (exp.status === 'penalized') return exp.penalized_at
    if (exp.status === 'flagged') return exp.reviewed_at
    if (exp.status === 'acknowledged') return exp.acknowledged_at
    return exp.created_at
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 mb-1">← Back</button>
          <h2 className="text-lg font-bold text-gray-900">My Review History</h2>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-green-700">{stats.acknowledged}</p>
          <p className="text-[10px] font-bold text-green-600 uppercase">Acknowledged</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-amber-700">{stats.flagged}</p>
          <p className="text-[10px] font-bold text-amber-600 uppercase">Flagged</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-red-700">{stats.penalized}</p>
          <p className="text-[10px] font-bold text-red-600 uppercase">Penalized</p>
          {stats.totalPenalty > 0 && (
            <p className="text-[10px] text-red-500 mt-0.5">{formatPoints(stats.totalPenalty)} total</p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'acknowledged', 'flagged', 'penalized'].map(function (s) {
          var label = s ? (APPROVAL_STATUS_LABELS[s] || s) : 'All'
          return (
            <button key={s} onClick={function () { setFilter(s === filter ? '' : s) }}
              className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                (filter === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
              {label}
            </button>
          )
        })}
      </div>

      <input type="text" value={search} onChange={function (e) { setSearch(e.target.value) }}
        placeholder="Search by description..."
        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        style={{ fontSize: '16px' }} />

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
          <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            style={{ fontSize: '16px' }} />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
          <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            style={{ fontSize: '16px' }} />
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={function () { setDateFrom(''); setDateTo('') }}
            className="self-end px-3 py-2 text-xs font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 mb-px">
            Clear
          </button>
        )}
      </div>

      {/* List */}
      {loading && <p className="text-center py-8 text-gray-400 text-sm">Loading...</p>}

      {!loading && expenses.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No reviewed expenses found</p>
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {expenses.map(function (exp) {
            var isVoice = /\.(webm|ogg|mp3|wav)$/i.test(exp.receipt_path || '')
            var hasReceipt = !!exp.receipt_path
            return (
              <div key={exp.id}
                onClick={function () { if (onOpenDetail) onOpenDetail(exp) }}
                className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md active:bg-gray-50 cursor-pointer transition-all">

                {/* Header row */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{exp.description || 'Expense'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {exp.profiles?.name || '—'} · {exp.categories?.name || '—'} · {formatDate(exp.expense_date)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                    <span className="text-sm font-bold text-gray-800">{formatPoints(exp.amount_paise)}</span>
                    <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (APPROVAL_STATUS_COLORS[exp.status] || 'bg-gray-100 text-gray-600')}>
                      {APPROVAL_STATUS_LABELS[exp.status] || exp.status}
                    </span>
                  </div>
                </div>

                {/* Detail row */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                  {exp.expense_types?.name && <span>Type: {exp.expense_types.name}{exp.expense_sub_types?.name ? ' > ' + exp.expense_sub_types.name : ''}</span>}
                  {exp.vendor_name && <span>Vendor: {exp.vendor_name}</span>}
                  {exp.events?.event_name && <span>Event: {exp.events.event_name}</span>}
                  {exp.travel_from && <span>{exp.travel_from}{exp.travel_to ? ' → ' + exp.travel_to : ''}</span>}
                  <span>Reviewed: {formatDate(actionDate(exp))}</span>
                </div>

                {/* Penalty / Flag info */}
                {exp.status === 'penalized' && (
                  <div className="mt-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-red-600 font-medium">Penalty</span>
                      <span className="text-sm font-bold text-red-700">{formatPoints(exp.penalty_paise || 0)}</span>
                    </div>
                    {exp.flag_reason && <p className="text-[11px] text-red-500 mt-1">{exp.flag_reason}</p>}
                  </div>
                )}

                {exp.status === 'flagged' && exp.flag_reason && (
                  <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <p className="text-[11px] text-amber-600">{exp.flag_reason}</p>
                  </div>
                )}

                {/* Receipt indicator */}
                <div className="mt-2 flex gap-2">
                  {hasReceipt ? (
                    <span className={"text-[10px] font-medium px-2 py-0.5 rounded-full " + (isVoice ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600")}>
                      {isVoice ? '🎙 Voice receipt' : '📎 Receipt attached'}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">⚠ No receipt</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {hasMore && (
        <button onClick={function () { loadExpenses(true) }} disabled={loadingMore}
          className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          {loadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  )
}

export default ReviewHistory
