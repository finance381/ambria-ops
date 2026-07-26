import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useRealtime } from '../../lib/useRealtime'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'
import PaySalaryModal from '../employees/PaySalaryModal'

function SalaryPayouts({ profile }) {
  var perms = (profile && profile.permissions) || []
  var isAdmin = perms.indexOf('feature_admin') !== -1
  var canSeeSalary = perms.indexOf('feature_employees_salary') !== -1
  var canView = isAdmin || (perms.indexOf('feature_salary_pay') !== -1 && canSeeSalary)

  var [employees, setEmployees] = useState([])
  var [credits, setCredits] = useState([])
  var [recentPaid, setRecentPaid] = useState([])
  var [loading, setLoading] = useState(true)

  var [search, setSearch] = useState('')
  var [minStaleDays, setMinStaleDays] = useState('')
  var [onlyStale, setOnlyStale] = useState(false)
  var [expandedKey, setExpandedKey] = useState(null)  // 'cash:<empId>' | 'bank:<empId>'
  var [showRecent, setShowRecent] = useState(false)

  var [payTarget, setPayTarget] = useState(null)  // { employee, lockedMode }

  useEffect(function () {
    if (canView) loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useRealtime(['ledger_entries'], function () { if (canView) loadAll() })

  async function loadAll() {
    setLoading(true)

    var { data: empData } = await supabase.from('v_employee_ledger')
      .select('*')
      .gt('balance_paise', 0)
      .order('balance_paise', { ascending: false })
    var empList = empData || []
    setEmployees(empList)

    if (empList.length === 0) {
      setCredits([])
      setRecentPaid([])
      setLoading(false)
      return
    }

    var empIds = empList.map(function (e) { return e.employee_id })

    // Individual accrual (salary_credit) rows for per-mode + per-row staleness
    var { data: creditData } = await supabase.from('ledger_entries')
      .select('*')
      .eq('ledger_type', 'user_salary')
      .eq('ref_type', 'salary_credit')
      .in('party_uuid', empIds)
      .is('deleted_at', null)
      .limit(2000)
    setCredits(creditData || [])

    // Recently Paid (last 7 days) — payments + adjustments
    var sevenAgo = new Date()
    sevenAgo.setDate(sevenAgo.getDate() - 7)
    var sevenAgoStr = sevenAgo.toISOString().split('T')[0]
    var { data: paidData } = await supabase.from('ledger_entries')
      .select('*')
      .eq('ledger_type', 'user_salary')
      .in('ref_type', ['salary_payment', 'salary_adjustment'])
      .gte('entry_date', sevenAgoStr)
      .is('deleted_at', null)
      .order('id', { ascending: false })
      .limit(200)
    setRecentPaid(paidData || [])

    setLoading(false)
  }

  var empById = useMemo(function () {
    var m = {}
    employees.forEach(function (e) { m[e.employee_id] = e })
    return m
  }, [employees])

  // Group unpaid credits per (employee, mode)
  var cards = useMemo(function () {
    var groups = { cash: {}, bank: {} }
    var today = new Date().toISOString().split('T')[0]
    credits.forEach(function (c) {
      var mode = c.metadata && c.metadata.mode
      if (mode !== 'cash' && mode !== 'bank') return
      var key = c.party_uuid
      if (!groups[mode][key]) {
        groups[mode][key] = { employee_id: key, mode: mode, rows: [], accrual_sum_paise: 0 }
      }
      groups[mode][key].rows.push(c)
      groups[mode][key].accrual_sum_paise += (c.credit_paise || 0)
    })

    function build(modeGroups, mode) {
      return Object.keys(modeGroups).map(function (empId) {
        var g = modeGroups[empId]
        var emp = empById[empId] || {}
        var modeBalance = mode === 'cash' ? (emp.cash_balance_paise || 0) : (emp.bank_balance_paise || 0)
        if (modeBalance <= 0) return null
        // per-mode oldest = smallest entry_date across accrual rows
        var oldest = g.rows.reduce(function (min, r) {
          if (!min) return r.entry_date
          return r.entry_date < min ? r.entry_date : min
        }, null)
        var staleDays = oldest ? Math.floor((new Date(today) - new Date(oldest)) / 86400000) : 0
        return {
          employee_id: empId,
          employee_name: emp.employee_name || '—',
          employee_code: emp.employee_code || '',
          mode: mode,
          balance_paise: modeBalance,
          rows: g.rows.slice().sort(function (a, b) { return (a.entry_date || '').localeCompare(b.entry_date || '') }),
          oldest_accrual: oldest,
          stale_days: staleDays,
          cash_balance_paise: emp.cash_balance_paise || 0,
          bank_balance_paise: emp.bank_balance_paise || 0
        }
      }).filter(Boolean)
    }

    return {
      cash: build(groups.cash, 'cash'),
      bank: build(groups.bank, 'bank')
    }
  }, [credits, empById])

  var filtered = useMemo(function () {
    var qs = search.trim().toLowerCase()
    var minD = Number(minStaleDays) || 0
    function apply(list) {
      return list.filter(function (r) {
          if (qs) {
            var hay = (r.employee_name + ' ' + r.employee_code).toLowerCase()
            if (hay.indexOf(qs) === -1) return false
          }
          if (minD > 0 && r.stale_days < minD) return false
          if (onlyStale && r.stale_days < 30) return false
          return true
        })
        .sort(function (a, b) {
          if (a.stale_days !== b.stale_days) return b.stale_days - a.stale_days
          return b.balance_paise - a.balance_paise
        })
    }
    return { cash: apply(cards.cash), bank: apply(cards.bank) }
  }, [cards, search, minStaleDays, onlyStale])

  var totals = useMemo(function () {
    return {
      cash: filtered.cash.reduce(function (s, r) { return s + r.balance_paise }, 0),
      bank: filtered.bank.reduce(function (s, r) { return s + r.balance_paise }, 0),
      staleCount: filtered.cash.filter(function (r) { return r.stale_days >= 30 }).length
        + filtered.bank.filter(function (r) { return r.stale_days >= 30 }).length
    }
  }, [filtered])

  function staleChip(days) {
    if (days >= 30) return { cls: 'bg-red-50 text-red-700 border-red-200', label: '⏳ ' + days + 'd unpaid' }
    if (days >= 15) return { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: days + 'd unpaid' }
    if (days >= 7) return { cls: 'bg-orange-50 text-orange-700 border-orange-200', label: days + 'd unpaid' }
    return { cls: 'bg-gray-50 text-gray-600 border-gray-200', label: days + 'd' }
  }

  function openPay(row) {
    setPayTarget({
      employee: {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        employee_code: row.employee_code,
        cash_balance_paise: row.cash_balance_paise,
        bank_balance_paise: row.bank_balance_paise
      },
      lockedMode: row.mode
    })
  }

  function onPaySuccess() {
    try { logActivity('SALARY_PAYOUTS_PAY', 'ok') } catch (_) {}
    setPayTarget(null)
    loadAll()
  }

  if (!canView) {
    return <p className="text-gray-400 text-sm text-center py-12">You don't have access to Salary Payouts.</p>
  }

  function renderCard(mode) {
    var list = mode === 'cash' ? filtered.cash : filtered.bank
    var icon = mode === 'cash' ? '💵' : '🏦'
    var label = mode === 'cash' ? 'Cash' : 'Bank'
    var total = mode === 'cash' ? totals.cash : totals.bank
    return (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">{icon} {label} Payouts</p>
            <p className="text-lg font-bold text-gray-900">{formatPoints(total)}</p>
          </div>
          <p className="text-[11px] text-gray-500">{list.length} pending</p>
        </div>
        {list.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No {label.toLowerCase()} payouts pending.</p>
        ) : (
          <div>
            {list.map(function (r) {
              var chip = staleChip(r.stale_days)
              var key = mode + ':' + r.employee_id
              var isExpanded = expandedKey === key
              if (mode === 'bank') {
                // Bank card notes wallet-untouched to reduce paying user's mental load
              }
              return (
                <div key={key} className="border-b border-gray-100 last:border-b-0">
                  <div className="px-3 py-2.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{r.employee_name}</p>
                      <div className="flex gap-1.5 mt-0.5 flex-wrap items-center">
                        <span className={"text-[10px] font-semibold px-1.5 py-0.5 border rounded " + chip.cls}>{chip.label}</span>
                        <span className="text-[10px] text-gray-500">{r.rows.length} accrual{r.rows.length !== 1 ? 's' : ''}</span>
                        {r.employee_code && <span className="text-[10px] text-gray-400">· {r.employee_code}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-amber-800">{formatPoints(r.balance_paise)}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0 print:hidden">
                      <button onClick={function () { openPay(r) }}
                        className="px-2.5 py-1.5 text-[11px] font-bold rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
                        Pay
                      </button>
                      <button onClick={function () { setExpandedKey(isExpanded ? null : key) }}
                        className="px-2 py-1.5 text-[11px] font-semibold rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200">
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-3 bg-gray-50 border-t border-gray-100">
                      {r.rows.map(function (row) {
                        var rowDays = Math.floor((new Date() - new Date(row.entry_date)) / 86400000)
                        var rc = staleChip(rowDays)
                        return (
                          <div key={row.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                            <span className={"px-1.5 py-0.5 border rounded font-semibold " + rc.cls}>{rc.label}</span>
                            <span className="flex-1 truncate text-gray-700">
                              {row.metadata && row.metadata.salary_month ? row.metadata.salary_month : row.entry_date}
                            </span>
                            <span className="font-semibold text-gray-900">{formatPoints(row.credit_paise || 0)}</span>
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Salary Payouts</h2>
          <p className="text-xs text-gray-500">Pending salary settlements — cash & bank</p>
        </div>
        <button onClick={function () { window.print() }}
          className="px-3 py-2 text-xs font-semibold rounded-lg bg-white text-gray-700 border border-gray-200 hover:bg-gray-50">
          🖨 Print
        </button>
      </div>

      {/* Stale banner */}
      {totals.staleCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <span className="text-lg">⚠</span>
          <p className="text-sm text-red-700 font-medium">
            {totals.staleCount} payout{totals.staleCount !== 1 ? 's' : ''} unpaid ≥ 30 days
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 print:hidden">
        <input type="text" value={search} onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search employee..."
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white"
          style={{ fontSize: '16px' }} />
        <input type="number" value={minStaleDays} onChange={function (e) { setMinStaleDays(e.target.value) }}
          placeholder="Min stale days" min="0"
          className="w-full sm:w-40 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white"
          style={{ fontSize: '16px' }} />
        <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer bg-white border border-gray-200 rounded-lg px-3 py-2">
          <input type="checkbox" checked={onlyStale} onChange={function (e) { setOnlyStale(e.target.checked) }} />
          Only ≥30d
        </label>
      </div>

      {/* Two-card grid */}
      {loading ? (
        <p className="text-gray-400 text-sm text-center py-12">Loading payouts...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderCard('cash')}
          {renderCard('bank')}
        </div>
      )}

      {/* Recently paid */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden print:hidden">
        <button onClick={function () { setShowRecent(!showRecent) }}
          className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <span>Recently Paid (last 7 days) — {recentPaid.length} entries</span>
          <span className="text-gray-400">{showRecent ? '▲' : '▼'}</span>
        </button>
        {showRecent && (
          <div className="border-t border-gray-100 max-h-96 overflow-y-auto">
            {recentPaid.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">Nothing in the last 7 days.</p>
            ) : (
              recentPaid.map(function (r) {
                var meta = r.metadata || {}
                var name = meta.employee_name || '—'
                var isAdj = r.ref_type === 'salary_adjustment'
                return (
                  <div key={r.id} className="px-3 py-2 border-b border-gray-100 last:border-b-0 flex items-center gap-2 text-xs">
                    <span className={"px-1.5 py-0.5 rounded font-semibold text-[10px] " +
                      (isAdj ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-green-50 text-green-700 border border-green-200")}>
                      {isAdj ? 'ADJ' : 'PAY'}
                    </span>
                    <span className="flex-1 truncate text-gray-800">{name}</span>
                    <span className="text-gray-500">{meta.mode === 'cash' ? '💵' : meta.mode === 'bank' ? '🏦' : ''}</span>
                    <span className="text-gray-500">{r.entry_date}</span>
                    <span className="font-semibold text-gray-900">{formatPoints(r.debit_paise || r.credit_paise || 0)}</span>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Pay modal — locked to the card's mode */}
      {payTarget && (
        <PaySalaryModal
          employee={payTarget.employee}
          lockedMode={payTarget.lockedMode}
          profile={profile}
          onClose={function () { setPayTarget(null) }}
          onSuccess={onPaySuccess} />
      )}
    </div>
  )
}

export default SalaryPayouts