import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'

var PAGE_SIZE = 20

function AllExpenses({ onBack, onOpenDetail, embedded }) {
  var [allExps, setAllExps] = useState([])
  var [allExpHasMore, setAllExpHasMore] = useState(false)
  var [allExpStatus, setAllExpStatus] = useState('')
  var [allExpFrom, setAllExpFrom] = useState('')
  var [allExpTo, setAllExpTo] = useState('')
  var [allExpSearch, setAllExpSearch] = useState('')
  var [allExpSearchD, setAllExpSearchD] = useState('')
  var [allExpLoading, setAllExpLoading] = useState(false)
  var [allExpLoadingMore, setAllExpLoadingMore] = useState(false)
  var [subDeptMap, setSubDeptMap] = useState({})

  // Filter panel state
  var [filtersOpen, setFiltersOpen] = useState(false)
  var [deptFilter, setDeptFilter] = useState('')
  var [subDeptFilter, setSubDeptFilter] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [userFilter, setUserFilter] = useState('')
  var [amountMin, setAmountMin] = useState('')
  var [amountMax, setAmountMax] = useState('')

  // Filter lookups
  var [deptOptions, setDeptOptions] = useState([])
  var [subDeptOptions, setSubDeptOptions] = useState([])
  var [venueOptions, setVenueOptions] = useState([])
  var [userOptions, setUserOptions] = useState([])

  useEffect(function () {
    var timer = setTimeout(function () { setAllExpSearchD(allExpSearch) }, 400)
    return function () { clearTimeout(timer) }
  }, [allExpSearch])

  useEffect(function () {
    Promise.all([
      supabase.from('sub_departments').select('id, name, department_id').order('name'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('venues').select('id, code, name').eq('active', true).order('name'),
      supabase.from('profiles').select('id, name').order('name'),
    ]).then(function (res) {
      var sds = res[0].data || []
      var map = {}
      sds.forEach(function (sd) { map[sd.id] = sd.name })
      setSubDeptMap(map)
      setSubDeptOptions(sds)
      setDeptOptions(res[1].data || [])
      setVenueOptions(res[2].data || [])
      setUserOptions(res[3].data || [])
    })
  }, [])

  useEffect(function () {
    loadAllExps(false)
  }, [allExpStatus, allExpFrom, allExpTo, allExpSearchD, deptFilter, subDeptFilter, venueFilter, userFilter, amountMin, amountMax])

  async function loadAllExps(append) {
    var offset = append ? allExps.length : 0
    if (append) setAllExpLoadingMore(true)
    else setAllExpLoading(true)

    var hasAllocFilter = !!(deptFilter || subDeptFilter || venueFilter)
    var allocEmbed = hasAllocFilter
      ? 'expense_allocations!inner(department, department_id, sub_department_id, venue_id, amount_paise)'
      : 'expense_allocations(department, department_id, sub_department_id, venue_id, amount_paise)'

    var query = supabase.from('expenses')
      .select('id, user_id, batch_id, expense_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, vendor_name, travel_from, travel_to, travel_mode, metadata, deleted_at, delete_reason, deleted_by, expense_types(name, extra_fields), ' + allocEmbed)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (allExpStatus === 'deleted') {
      query = query.not('deleted_at', 'is', null)
    } else if (allExpStatus) {
      query = query.eq('status', allExpStatus).is('deleted_at', null)
    }
    if (allExpFrom) query = query.gte('expense_date', allExpFrom)
    if (allExpTo) query = query.lte('expense_date', allExpTo)
    if (allExpSearchD) query = query.ilike('description', '%' + allExpSearchD + '%')
    if (userFilter) query = query.eq('user_id', userFilter)
    if (deptFilter) query = query.eq('expense_allocations.department_id', Number(deptFilter))
    if (subDeptFilter) query = query.eq('expense_allocations.sub_department_id', Number(subDeptFilter))
    if (venueFilter) query = query.eq('expense_allocations.venue_id', Number(venueFilter))
    if (amountMin) query = query.gte('amount_paise', Math.round(Number(amountMin) * 100))
    if (amountMax) query = query.lte('amount_paise', Math.round(Number(amountMax) * 100))

    var { data, error } = await query
    if (error) { alert('Failed: ' + error.message); setAllExpLoading(false); setAllExpLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    var aUserIds = []
    rows.forEach(function (r) { if (r.user_id && aUserIds.indexOf(r.user_id) === -1) aUserIds.push(r.user_id) })
    if (aUserIds.length > 0) {
      var { data: aNames } = await supabase.rpc('get_profile_names', { p_ids: aUserIds })
      var aMap = {}
      ;(aNames || []).forEach(function (n) { aMap[n.id] = n.name })
      rows = rows.map(function (r) { return Object.assign({}, r, { profiles: { name: aMap[r.user_id] || null } }) })
    }
    if (append) {
      setAllExps(function (prev) { return prev.concat(rows) })
    } else {
      setAllExps(rows)
    }
    setAllExpHasMore(hasMore)
    setAllExpLoading(false)
    setAllExpLoadingMore(false)
  }

  function exportAllExpCSV() {
    if (!allExps.length) return
    var headers = ['Date', 'User', 'Department', 'Sub-Department', 'Amount (pts)', 'Description', 'Status']
    var rows = allExps.map(function (e) {
      var firstAlloc = (e.expense_allocations && e.expense_allocations[0]) || {}
      var deptName = firstAlloc.department || ''
      var subDeptName = firstAlloc.sub_department_id ? (subDeptMap[firstAlloc.sub_department_id] || '') : ''
      return [
        e.expense_date || '',
        e.profiles?.name || '',
        deptName,
        subDeptName,
        e.amount_paise ? (e.amount_paise / 100) : 0,
        (e.description || '').replace(/,/g, ';'),
        e.status || '',
      ].join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'all_expenses_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }

  var allExpTotal = allExps.reduce(function (s, e) { return s + (e.amount_paise || 0) }, 0)

  return (
    <div className="space-y-4">
      <div>
        {!embedded && (
          <button onClick={onBack}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
        )}
        <div className="flex items-center justify-between">
          <div>
            {!embedded && <h2 className="text-lg font-bold text-gray-900">All Expenses</h2>}
            <p className="text-xs text-gray-400">{allExps.length} shown · {formatPoints(allExpTotal)} total</p>
          </div>
          {allExps.length > 0 && (
            <button onClick={exportAllExpCSV}
              className="px-3 py-1.5 text-xs font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
              📥 CSV
            </button>
          )}
        </div>
      </div>

      <input type="text" value={allExpSearch} onChange={function (e) { setAllExpSearch(e.target.value) }}
        placeholder="Search description..."
        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        style={{ fontSize: '16px' }} />

      {(function () {
        var count = 0
        if (allExpStatus) count++
        if (allExpFrom) count++
        if (allExpTo) count++
        if (userFilter) count++
        if (deptFilter) count++
        if (subDeptFilter) count++
        if (venueFilter) count++
        if (amountMin) count++
        if (amountMax) count++
        function resetFilters() {
          setAllExpStatus(''); setAllExpFrom(''); setAllExpTo('')
          setUserFilter(''); setDeptFilter(''); setSubDeptFilter(''); setVenueFilter('')
          setAmountMin(''); setAmountMax('')
        }
        var subDeptFiltered = deptFilter
          ? subDeptOptions.filter(function (sd) { return String(sd.department_id) === deptFilter })
          : subDeptOptions
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button onClick={function () { setFiltersOpen(!filtersOpen) }}
                className={"flex-1 py-2 text-xs font-bold rounded-lg border transition-colors " + (filtersOpen ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                {filtersOpen ? '▲' : '▼'} Filters{count > 0 ? ' · ' + count : ''}
              </button>
              {count > 0 && (
                <button onClick={resetFilters}
                  className="px-3 py-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                  Reset
                </button>
              )}
            </div>
            {filtersOpen && (
              <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Status</label>
                  <div className="flex gap-2 flex-wrap">
                    {['', 'recorded', 'acknowledged', 'flagged', 'penalized', 'deleted'].map(function (s) {
                      var label = s === 'deleted' ? 'Deleted' : (s ? APPROVAL_STATUS_LABELS[s] : 'All')
                      return (
                        <button key={s} onClick={function () { setAllExpStatus(s === allExpStatus ? '' : s) }}
                          className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                            (allExpStatus === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {userOptions.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">User</label>
                    <select value={userFilter} onChange={function (e) { setUserFilter(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      style={{ fontSize: '16px' }}>
                      <option value="">All users</option>
                      {userOptions.map(function (u) {
                        return <option key={u.id} value={u.id}>{u.name || '—'}</option>
                      })}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Department</label>
                    <select value={deptFilter}
                      onChange={function (e) { setDeptFilter(e.target.value); setSubDeptFilter('') }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      style={{ fontSize: '16px' }}>
                      <option value="">All</option>
                      {deptOptions.map(function (d) {
                        return <option key={d.id} value={d.id}>{d.name}</option>
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Sub-Dept</label>
                    <select value={subDeptFilter}
                      onChange={function (e) { setSubDeptFilter(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      style={{ fontSize: '16px' }}>
                      <option value="">All</option>
                      {subDeptFiltered.map(function (sd) {
                        return <option key={sd.id} value={sd.id}>{sd.name}</option>
                      })}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Venue</label>
                    <select value={venueFilter}
                      onChange={function (e) { setVenueFilter(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      style={{ fontSize: '16px' }}>
                      <option value="">All venues</option>
                      {venueOptions.map(function (v) {
                        return <option key={v.id} value={v.id}>{v.code} — {v.name}</option>
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Min (pts)</label>
                    <input type="number" min="0" step="any" inputMode="decimal" value={amountMin}
                      onChange={function (e) { setAmountMin(e.target.value) }}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Max (pts)</label>
                    <input type="number" min="0" step="any" inputMode="decimal" value={amountMax}
                      onChange={function (e) { setAmountMax(e.target.value) }}
                      placeholder="∞"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
                    <input type="date" value={allExpFrom}
                      onChange={function (e) { setAllExpFrom(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
                    <input type="date" value={allExpTo}
                      onChange={function (e) { setAllExpTo(e.target.value) }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {allExpLoading && <p className="text-gray-400 text-sm text-center py-4">Loading...</p>}

      {!allExpLoading && allExps.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No expenses found</p>
        </div>
      )}

      {!allExpLoading && (
        <div className="space-y-3">
          {allExps.map(function (exp) {
            return (
              <div key={exp.id}
                onClick={function () { onOpenDetail(Object.assign({}, exp, { _fromApprove: true })) }}
                className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md active:bg-gray-50 cursor-pointer transition-all">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{exp.description || 'Expense'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {(exp.profiles?.name || '—') + ' · '}
                      {exp.expense_types?.name ? exp.expense_types.name + ' · ' : ''}
                      {(function () {
                        var a = (exp.expense_allocations && exp.expense_allocations[0]) || null
                        if (!a) return ''
                        var d = a.department || ''
                        var sd = a.sub_department_id ? (subDeptMap[a.sub_department_id] || '') : ''
                        return (d + (sd ? ' › ' + sd : '') + (d || sd ? ' · ' : ''))
                      })()}
                      {formatDate(exp.expense_date)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                    <span className="text-sm font-bold text-gray-800">{formatPoints(exp.amount_paise)}</span>
                    <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (exp.deleted_at ? "bg-gray-200 text-gray-600" : (APPROVAL_STATUS_COLORS[exp.status] || 'bg-gray-100 text-gray-600'))}>
                      {exp.deleted_at ? '🗑 Deleted' : (APPROVAL_STATUS_LABELS[exp.status] || exp.status)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {allExpHasMore && (
        <button onClick={function () { loadAllExps(true) }} disabled={allExpLoadingMore}
          className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          {allExpLoadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  )
}

export default AllExpenses
