import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints } from '../../lib/format'

function ExpenseReport({ onBack }) {
  var [reportData, setReportData] = useState(null)
  var [reportFrom, setReportFrom] = useState(new Date().toISOString().slice(0, 7) + '-01')
  var [reportTo, setReportTo] = useState(new Date().toISOString().split('T')[0])
  var [reportLoading, setReportLoading] = useState(false)

  useEffect(function () { loadReport() }, [])

  async function loadReport() {
    setReportLoading(true)
    var { data, error } = await supabase.from('expenses')
      .select('id, user_id, expense_type_id, amount_paise, status, expense_date, expense_types(name), profiles:user_id(name), expense_allocations(department, amount_paise)')
      .in('status', ['recorded', 'acknowledged', 'approved'])
      .gte('expense_date', reportFrom)
      .lte('expense_date', reportTo)
      .order('expense_date', { ascending: false })
      .limit(5000)
    if (error) { alert('Report failed: ' + error.message); setReportLoading(false); return }
    var rows = data || []
    var totalPaise = 0
    var byUser = {}
    var byType = {}
    var byDept = {}
    var byMonth = {}
    rows.forEach(function (r) {
      var amt = r.amount_paise || 0
      totalPaise += amt
      var uName = r.profiles?.name || '—'
      byUser[uName] = (byUser[uName] || 0) + amt
      var tName = r.expense_types?.name || 'Untyped'
      byType[tName] = (byType[tName] || 0) + amt
      var allocs = r.expense_allocations || []
      if (allocs.length === 0) {
        byDept['Unallocated'] = (byDept['Unallocated'] || 0) + amt
      } else {
        allocs.forEach(function (a) {
          var d = a.department || 'Unassigned'
          byDept[d] = (byDept[d] || 0) + (a.amount_paise || 0)
        })
      }
      var month = (r.expense_date || '').slice(0, 7)
      if (month) byMonth[month] = (byMonth[month] || 0) + amt
    })
    var sortObj = function (obj) {
      return Object.entries(obj).sort(function (a, b) { return b[1] - a[1] })
    }
    setReportData({
      count: rows.length,
      totalPaise: totalPaise,
      byUser: sortObj(byUser),
      byType: sortObj(byType),
      byDept: sortObj(byDept),
      byMonth: Object.entries(byMonth).sort(function (a, b) { return a[0].localeCompare(b[0]) }),
    })
    setReportLoading(false)
  }

  function exportReportCSV() {
    if (!reportData) return
    var sections = []
    sections.push('Summary')
    sections.push('Total Recorded,' + (reportData.totalPaise / 100))
    sections.push('Count,' + reportData.count)
    sections.push('')
    sections.push('By User')
    sections.push('User,Amount (pts)')
    reportData.byUser.forEach(function (r) { sections.push(r[0] + ',' + (r[1] / 100)) })
    sections.push('')
    sections.push('By Type')
    sections.push('Type,Amount (pts)')
    reportData.byType.forEach(function (r) { sections.push(r[0] + ',' + (r[1] / 100)) })
    sections.push('')
    sections.push('By Department')
    sections.push('Department,Amount (pts)')
    reportData.byDept.forEach(function (r) { sections.push(r[0] + ',' + (r[1] / 100)) })
    sections.push('')
    sections.push('By Month')
    sections.push('Month,Amount (pts)')
    reportData.byMonth.forEach(function (r) { sections.push(r[0] + ',' + (r[1] / 100)) })
    var csv = '\uFEFF' + sections.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'expense_report_' + reportFrom + '_' + reportTo + '.csv'; a.click()
  }

  return (
    <div className="space-y-4">
      <div>
        <button onClick={onBack}
          className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back to Expenses</button>
        <h2 className="text-lg font-bold text-gray-900">Expense Report</h2>
        <p className="text-xs text-gray-400">Recorded expenses summary</p>
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">From</label>
          <input type="date" value={reportFrom} onChange={function (e) { setReportFrom(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ fontSize: '16px' }} />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">To</label>
          <input type="date" value={reportTo} onChange={function (e) { setReportTo(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ fontSize: '16px' }} />
        </div>
        <button onClick={loadReport} disabled={reportLoading}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {reportLoading ? 'Loading...' : 'Generate'}
        </button>
      </div>
      {reportData && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
              <p className="text-[10px] font-bold text-indigo-400 uppercase">Total Recorded</p>
              <p className="text-xl font-bold text-indigo-700">{formatPoints(reportData.totalPaise)}</p>
            </div>
            <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-[10px] font-bold text-gray-400 uppercase">Expenses</p>
              <p className="text-xl font-bold text-gray-700">{reportData.count}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900">By User</h3>
            </div>
            <div className="space-y-2">
              {reportData.byUser.slice(0, 15).map(function (r) {
                var pct = reportData.totalPaise > 0 ? Math.round(r[1] / reportData.totalPaise * 100) : 0
                return (
                  <div key={r[0]} className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{r[0]}</p>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                        <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: pct + '%' }}></div>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-gray-700 ml-3 flex-shrink-0">{formatPoints(r[1])}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-3">By Type</h3>
            <div className="space-y-2">
              {reportData.byType.slice(0, 15).map(function (r) {
                var pct = reportData.totalPaise > 0 ? Math.round(r[1] / reportData.totalPaise * 100) : 0
                return (
                  <div key={r[0]} className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{r[0]}</p>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                        <div className="bg-green-500 h-1.5 rounded-full" style={{ width: pct + '%' }}></div>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-gray-700 ml-3 flex-shrink-0">{formatPoints(r[1])}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-3">By Department</h3>
            <div className="space-y-2">
              {reportData.byDept.slice(0, 15).map(function (r) {
                var pct = reportData.totalPaise > 0 ? Math.round(r[1] / reportData.totalPaise * 100) : 0
                return (
                  <div key={r[0]} className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{r[0]}</p>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                        <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: pct + '%' }}></div>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-gray-700 ml-3 flex-shrink-0">{formatPoints(r[1])}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-3">By Month</h3>
            <div className="space-y-2">
              {reportData.byMonth.map(function (r) {
                return (
                  <div key={r[0]} className="flex items-center justify-between">
                    <span className="text-sm text-gray-800">{r[0]}</span>
                    <span className="text-sm font-bold text-gray-700">{formatPoints(r[1])}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <button onClick={exportReportCSV}
            className="w-full py-3 text-sm font-bold text-green-600 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
            📥 Export Report CSV
          </button>
        </div>
      )}
    </div>
  )
}

export default ExpenseReport
