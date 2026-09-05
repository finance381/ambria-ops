import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints } from '../../lib/format'
import { useReferenceData } from '../../lib/referenceData.jsx'

function ExpenseReport({ onBack }) {
  var [reportData, setReportData] = useState(null)
  var [reportFrom, setReportFrom] = useState(new Date().toISOString().slice(0, 7) + '-01')
  var [reportTo, setReportTo] = useState(new Date().toISOString().split('T')[0])
  var [reportLoading, setReportLoading] = useState(false)
  var refData = useReferenceData()

  useEffect(function () { loadReport() }, [])

  async function loadReport() {
    setReportLoading(true)
    // Master maps (small tables, IDs → names)
    var mapRes = await Promise.all([
      supabase.from('departments').select('id, name'),
      supabase.from('profiles').select('id, name'),
    ])
    var deptMap = {}; (mapRes[0].data || []).forEach(function (d) { deptMap[d.id] = d.name })
    var typeMap = {}; refData.expenseTypes.forEach(function (t) { typeMap[t.id] = t.name })
    var subTypeMap = {}; refData.expenseSubTypes.forEach(function (s) { subTypeMap[s.id] = s.name })
    var userMap = {}; (mapRes[1].data || []).forEach(function (u) { userMap[u.id] = u.name })

    // Paginated v_ledger pull (server caps ~1000/request). View already filters deleted_at.
    var rows = []; var from = 0; var pageSize = 1000
    while (true) {
      var page = await supabase.from('v_ledger')
        .select('allocation_id, expense_id, user_id, department_id, expense_type_id, expense_sub_type_id, amount_paise, pending_paise, committed_paise, expense_date, status')
        .in('status', ['recorded', 'flagged', 'acknowledged', 'deducted'])
        .gte('expense_date', reportFrom)
        .lte('expense_date', reportTo)
        .order('expense_date', { ascending: false })
        .range(from, from + pageSize - 1)
      if (page.error) { alert('Report failed: ' + page.error.message); setReportLoading(false); return }
      var chunk = page.data || []
      rows = rows.concat(chunk)
      if (chunk.length < pageSize) break
      from += pageSize
      if (from > 50000) break // safety cap
    }

    var totalPaise = 0, pendingPaise = 0, committedPaise = 0
    var expenseIds = {}
    var byUser = {}, byType = {}, bySubType = {}, byDept = {}, byMonth = {}
    var matrix = {} // { dept: { type: { total, pending, committed } } }

    rows.forEach(function (r) {
      var amt = r.amount_paise || 0
      var p = r.pending_paise || 0
      var c = r.committed_paise || 0
      totalPaise += amt; pendingPaise += p; committedPaise += c
      if (r.expense_id != null) expenseIds[r.expense_id] = true

      var uName = userMap[r.user_id] || '—'
      var tName = r.expense_type_id ? (typeMap[r.expense_type_id] || 'Untyped') : 'Untyped'
      var stName = r.expense_sub_type_id ? (subTypeMap[r.expense_sub_type_id] || '—') : '—'
      var dName = r.department_id ? (deptMap[r.department_id] || 'Unassigned') : 'Unallocated'

      byUser[uName] = (byUser[uName] || 0) + amt
      byType[tName] = (byType[tName] || 0) + amt
      bySubType[stName] = (bySubType[stName] || 0) + amt
      byDept[dName] = (byDept[dName] || 0) + amt

      var month = (r.expense_date || '').slice(0, 7)
      if (month) byMonth[month] = (byMonth[month] || 0) + amt

      if (!matrix[dName]) matrix[dName] = {}
      if (!matrix[dName][tName]) matrix[dName][tName] = { total: 0, pending: 0, committed: 0 }
      matrix[dName][tName].total += amt
      matrix[dName][tName].pending += p
      matrix[dName][tName].committed += c
    })

    var sortObj = function (obj) {
      return Object.entries(obj).sort(function (a, b) { return b[1] - a[1] })
    }
    var matrixRows = []
    Object.keys(matrix).forEach(function (d) {
      Object.keys(matrix[d]).forEach(function (t) {
        matrixRows.push({ dept: d, type: t, total: matrix[d][t].total, pending: matrix[d][t].pending, committed: matrix[d][t].committed })
      })
    })
    matrixRows.sort(function (a, b) { return b.total - a.total })

    setReportData({
      count: Object.keys(expenseIds).length,
      allocCount: rows.length,
      totalPaise: totalPaise,
      pendingPaise: pendingPaise,
      committedPaise: committedPaise,
      byUser: sortObj(byUser),
      byType: sortObj(byType),
      bySubType: sortObj(bySubType),
      byDept: sortObj(byDept),
      byMonth: Object.entries(byMonth).sort(function (a, b) { return a[0].localeCompare(b[0]) }),
      matrixRows: matrixRows,
    })
    setReportLoading(false)
  }

  function exportReportCSV() {
    if (!reportData) return
    function esc(v) {
      var s = String(v == null ? '' : v)
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    var sections = []
    sections.push('Summary')
    sections.push('Total,' + (reportData.totalPaise / 100))
    sections.push('Committed,' + (reportData.committedPaise / 100))
    sections.push('Pending,' + (reportData.pendingPaise / 100))
    sections.push('Expenses,' + reportData.count)
    sections.push('Allocations,' + reportData.allocCount)
    sections.push('')
    sections.push('By User')
    sections.push('User,Amount (pts)')
    reportData.byUser.forEach(function (r) { sections.push(esc(r[0]) + ',' + (r[1] / 100)) })
    sections.push('')
    sections.push('By Type')
    sections.push('Type,Amount (pts)')
    reportData.byType.forEach(function (r) { sections.push(esc(r[0]) + ',' + (r[1] / 100)) })
    sections.push('')
    sections.push('By Sub-Type')
    sections.push('Sub-Type,Amount (pts)')
    reportData.bySubType.forEach(function (r) { sections.push(esc(r[0]) + ',' + (r[1] / 100)) })
    sections.push('')
    sections.push('By Department')
    sections.push('Department,Amount (pts)')
    reportData.byDept.forEach(function (r) { sections.push(esc(r[0]) + ',' + (r[1] / 100)) })
    sections.push('')
    sections.push('Dept x Type')
    sections.push('Department,Type,Total (pts),Committed (pts),Pending (pts)')
    reportData.matrixRows.forEach(function (r) {
      sections.push(esc(r.dept) + ',' + esc(r.type) + ',' + (r.total / 100) + ',' + (r.committed / 100) + ',' + (r.pending / 100))
    })
    sections.push('')
    sections.push('By Month')
    sections.push('Month,Amount (pts)')
    reportData.byMonth.forEach(function (r) { sections.push(esc(r[0]) + ',' + (r[1] / 100)) })
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
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-center">
              <p className="text-[10px] font-bold text-indigo-400 uppercase">Total</p>
              <p className="text-xl font-bold text-indigo-700">{formatPoints(reportData.totalPaise)}</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-[10px] font-bold text-green-500 uppercase">Committed</p>
              <p className="text-xl font-bold text-green-700">{formatPoints(reportData.committedPaise)}</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-[10px] font-bold text-amber-500 uppercase">Pending</p>
              <p className="text-xl font-bold text-amber-700">{formatPoints(reportData.pendingPaise)}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-[10px] font-bold text-gray-400 uppercase">Expenses</p>
              <p className="text-xl font-bold text-gray-700">{reportData.count}</p>
              <p className="text-[9px] text-gray-400 mt-0.5">{reportData.allocCount} allocs</p>
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
            <h3 className="text-sm font-bold text-gray-900 mb-3">By Sub-Type</h3>
            <div className="space-y-2">
              {reportData.bySubType.slice(0, 15).map(function (r) {
                var pct = reportData.totalPaise > 0 ? Math.round(r[1] / reportData.totalPaise * 100) : 0
                return (
                  <div key={r[0]} className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{r[0]}</p>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                        <div className="bg-teal-500 h-1.5 rounded-full" style={{ width: pct + '%' }}></div>
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
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900">Dept × Type</h3>
              <span className="text-[10px] text-gray-400">{reportData.matrixRows.length} cells</span>
            </div>
            {reportData.matrixRows.length === 0 ? (
              <p className="text-xs text-gray-400">No data</p>
            ) : (
              <div className="overflow-x-auto -mx-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] font-bold text-gray-400 uppercase border-b border-gray-100">
                      <th className="text-left px-4 py-2">Dept</th>
                      <th className="text-left px-2 py-2">Type</th>
                      <th className="text-right px-2 py-2">Total</th>
                      <th className="text-right px-2 py-2 text-green-500">Cmt</th>
                      <th className="text-right px-4 py-2 text-amber-500">Pnd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.matrixRows.slice(0, 30).map(function (r, i) {
                      return (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="px-4 py-1.5 text-gray-800 truncate max-w-[100px]">{r.dept}</td>
                          <td className="px-2 py-1.5 text-gray-600 truncate max-w-[100px]">{r.type}</td>
                          <td className="px-2 py-1.5 text-right font-bold text-gray-800">{formatPoints(r.total)}</td>
                          <td className="px-2 py-1.5 text-right text-green-700">{formatPoints(r.committed)}</td>
                          <td className="px-4 py-1.5 text-right text-amber-700">{formatPoints(r.pending)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
