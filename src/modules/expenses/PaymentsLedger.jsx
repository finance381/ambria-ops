import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import { hasPerm } from '../../lib/permissions'

// Full history of money actually paid out to vendors (payments + deductions),
// filterable by mode and date range — complements the per-vendor Vendor Ledger tab.
function PaymentsLedger({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canView = hasPerm(permsNew, 'finance.payments')

  var [rows, setRows] = useState([])
  var [loading, setLoading] = useState(true)
  var [dateFrom, setDateFrom] = useState(function () { return new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] })
  var [dateTo, setDateTo] = useState(function () { return new Date().toISOString().split('T')[0] })
  var [modeFilter, setModeFilter] = useState('all') // 'all' | 'cash' | 'bank'
  var [search, setSearch] = useState('')

  async function load() {
    if (!canView) { setLoading(false); return }
    setLoading(true)
    var { data: rec } = await supabase
      .from('ledger_entries')
      .select('id, party_id, entry_date, description, debit_paise, ref_id, ref_type, metadata')
      .eq('ledger_type', 'vendor')
      .in('ref_type', ['vendor_payment', 'vendor_deduction'])
      .is('deleted_at', null)
      .gte('entry_date', dateFrom)
      .lte('entry_date', dateTo)
      .order('entry_date', { ascending: false })
      .limit(1000)
    var recRows = rec || []
    var vendorIds = []
    recRows.forEach(function (r) { if (vendorIds.indexOf(r.party_id) === -1) vendorIds.push(r.party_id) })
    var nameMap = {}
    if (vendorIds.length > 0) {
      var { data: vRows } = await supabase.from('vendors').select('id, name').in('id', vendorIds)
      ;(vRows || []).forEach(function (v) { nameMap[v.id] = v.name })
    }
    recRows.forEach(function (r) { r._vendor_name = nameMap[r.party_id] || '—' })
    setRows(recRows)
    setLoading(false)
  }

  useEffect(function () { load() }, [canView, dateFrom, dateTo])
  useRealtime(['ledger_entries'], function () { load() })

  var visible = useMemo(function () {
    var searchLower = search.trim().toLowerCase()
    return rows.filter(function (r) {
      if (modeFilter !== 'all' && !(r.metadata && r.metadata.mode === modeFilter)) return false
      if (searchLower && (r._vendor_name || '').toLowerCase().indexOf(searchLower) === -1) return false
      return true
    })
  }, [rows, modeFilter, search])

  var total = useMemo(function () {
    return visible.reduce(function (s, r) { return s + (r.debit_paise || 0) }, 0)
  }, [visible])

  if (!canView) {
    return <p className="text-gray-400 text-sm text-center py-8">No access</p>
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Payments Ledger</h2>
        <p className="text-xs text-gray-400">{visible.length} payment{visible.length !== 1 ? 's' : ''} · {formatPoints(total)}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
        <input type="text" value={search} onChange={function (ev) { setSearch(ev.target.value) }}
          placeholder="Search vendor name..."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
          style={{ fontSize: '16px' }} />
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={dateFrom} onChange={function (ev) { setDateFrom(ev.target.value) }}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }} />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={dateTo} onChange={function (ev) { setDateTo(ev.target.value) }}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }} />
          <div className="inline-flex bg-gray-100 rounded-lg p-0.5 ml-auto">
            {[['all', 'All'], ['cash', '💵 Cash'], ['bank', '🏦 Bank']].map(function (opt) {
              var active = modeFilter === opt[0]
              return (
                <button key={opt[0]} type="button" onClick={function () { setModeFilter(opt[0]) }}
                  className={"px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors " + (active ? "bg-white shadow-sm text-gray-900" : "text-gray-500")}>
                  {opt[1]}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
        ) : visible.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No payments in this range.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {visible.map(function (r) {
              var isDed = r.ref_type === 'vendor_deduction'
              var mode = r.metadata && r.metadata.mode
              return (
                <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{r._vendor_name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-gray-500">{formatDate(r.entry_date)}</span>
                      {mode && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 border rounded bg-gray-50 text-gray-700 border-gray-200">
                          {mode === 'cash' ? '💵 Cash' : '🏦 Bank'}
                        </span>
                      )}
                      {isDed && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 border rounded bg-amber-50 text-amber-700 border-amber-200">
                          Deduction
                        </span>
                      )}
                      {r.description && <span className="text-[10px] text-gray-400 truncate">{r.description}</span>}
                    </div>
                  </div>
                  <p className={"text-sm font-bold flex-shrink-0 " + (isDed ? "text-amber-700" : "text-green-700")}>
                    {formatPoints(r.debit_paise || 0)}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default PaymentsLedger
