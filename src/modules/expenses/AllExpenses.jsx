import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'

var PAGE_SIZE = 20

function AllExpenses({ subCatMap, onBack, onOpenDetail }) {
  var [allExps, setAllExps] = useState([])
  var [allExpHasMore, setAllExpHasMore] = useState(false)
  var [allExpStatus, setAllExpStatus] = useState('')
  var [allExpFrom, setAllExpFrom] = useState('')
  var [allExpTo, setAllExpTo] = useState('')
  var [allExpSearch, setAllExpSearch] = useState('')
  var [allExpSearchD, setAllExpSearchD] = useState('')
  var [allExpLoading, setAllExpLoading] = useState(false)
  var [allExpLoadingMore, setAllExpLoadingMore] = useState(false)

  useEffect(function () {
    var timer = setTimeout(function () { setAllExpSearchD(allExpSearch) }, 400)
    return function () { clearTimeout(timer) }
  }, [allExpSearch])

  useEffect(function () {
    loadAllExps(false)
  }, [allExpStatus, allExpFrom, allExpTo, allExpSearchD])

  async function loadAllExps(append) {
    var offset = append ? allExps.length : 0
    if (append) setAllExpLoadingMore(true)
    else setAllExpLoading(true)

    var query = supabase.from('expenses')
      .select('id, user_id, category_id, sub_category_id, expense_type_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, vendor_name, travel_from, travel_to, travel_mode, metadata, categories(name), expense_types(name, extra_fields)')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (allExpStatus) query = query.eq('status', allExpStatus)
    if (allExpFrom) query = query.gte('expense_date', allExpFrom)
    if (allExpTo) query = query.lte('expense_date', allExpTo)
    if (allExpSearchD) query = query.ilike('description', '%' + allExpSearchD + '%')

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
    var headers = ['Date', 'User', 'Category', 'Sub-Category', 'Amount (pts)', 'Description', 'Status']
    var rows = allExps.map(function (e) {
      return [
        e.expense_date || '',
        e.profiles?.name || '',
        e.categories?.name || '',
        subCatMap[e.sub_category_id] || '',
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
        <button onClick={onBack}
          className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">All Expenses</h2>
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

      <div className="flex gap-2 flex-wrap">
        {['', 'recorded', 'acknowledged', 'flagged', 'penalized'].map(function (s) {
          var label = s ? APPROVAL_STATUS_LABELS[s] : 'All'
          return (
            <button key={s} onClick={function () { setAllExpStatus(s === allExpStatus ? '' : s) }}
              className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                (allExpStatus === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
              {label}
            </button>
          )
        })}
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
          <input type="date" value={allExpFrom} onChange={function (e) { setAllExpFrom(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ fontSize: '16px' }} />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
          <input type="date" value={allExpTo} onChange={function (e) { setAllExpTo(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ fontSize: '16px' }} />
        </div>
        {(allExpFrom || allExpTo) && (
          <button onClick={function () { setAllExpFrom(''); setAllExpTo('') }}
            className="self-end px-3 py-2 text-xs font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors mb-px">
            Clear
          </button>
        )}
      </div>

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
                      {exp.profiles?.name || '—'} · {exp.expense_types?.name ? exp.expense_types.name + ' · ' : ''}{exp.categories?.name || '—'}
                      {exp.sub_category_id && subCatMap[exp.sub_category_id] ? ' > ' + subCatMap[exp.sub_category_id] : ''}
                      {' · ' + formatDate(exp.expense_date)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                    <span className="text-sm font-bold text-gray-800">{formatPoints(exp.amount_paise)}</span>
                    <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (APPROVAL_STATUS_COLORS[exp.status] || 'bg-gray-100 text-gray-600')}>
                      {APPROVAL_STATUS_LABELS[exp.status] || exp.status}
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
