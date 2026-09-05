import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'
import PaySalaryModal from './PaySalaryModal'
import AccrueSalariesModal from './AccrueSalariesModal'
import AdjustSalaryModal from './AdjustSalaryModal'
import PaymentProofThumbs from '../../components/ledger/PaymentProofThumbs'
import LedgerSourceMedia from '../../components/ledger/LedgerSourceMedia'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'

function SalaryLedger({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var isAdmin = hasPerm(permsNew, 'admin.dashboard')
  var canSeeSalary = hasPerm(permsNew, 'hr.employees.salary_view')
  var canView = isAdmin || (hasPerm(permsNew, 'finance.ledgers.salary') && canSeeSalary)

  var [view, setView] = useState('list')  // 'list' | 'detail'
  var [employees, setEmployees] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [statusFilter, setStatusFilter] = useState('all')  // 'all' | 'with_balance' | 'stale'
  var [deptFilter, setDeptFilter] = useState('')  // job_department id or ''
  var [jdMap, setJdMap] = useState({})
  var [jdOptions, setJdOptions] = useState([])

  var [selectedEmp, setSelectedEmp] = useState(null)
  var [entries, setEntries] = useState([])
  var [entriesLoading, setEntriesLoading] = useState(false)
  var [showDeleted, setShowDeleted] = useState(false)

  var [showPayModal, setShowPayModal] = useState(false)
  var [showAccrueModal, setShowAccrueModal] = useState(false)  // SL-C4
  var [showAdjustModal, setShowAdjustModal] = useState(false)  // SL-C5
  var refData = useReferenceData()

  useEffect(function () {
    if (canView) loadEmployees()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadEmployees() {
    setLoading(true)
    var res = await Promise.all([
      supabase.from('v_employee_ledger').select('*').order('balance_paise', { ascending: false }),
      supabase.from('job_departments').select('id, name').order('sort_order').order('name')
    ])
    var ledger = (res[0].data) || []
    var emps = refData.employees
    var jds = (res[1].data) || []
    var empMap = {}
    emps.forEach(function (e) { empMap[e.id] = e })
    var jdM = {}
    jds.forEach(function (j) { jdM[j.id] = j.name })
    setJdMap(jdM)
    setJdOptions(jds)
    var merged = ledger.map(function (r) {
      var e = empMap[r.employee_id]
      return Object.assign({}, r, {
        designation: e ? (e.designation || '') : '',
        job_department_ids: e ? (e.job_department_ids || []) : []
      })
    })
    setEmployees(merged)
    setLoading(false)
  }

  async function loadEntries(emp, withDeleted) {
    setEntriesLoading(true)
    setEntries([])
    var q = supabase.from('ledger_entries')
      .select('*')
      .eq('ledger_type', 'user_salary')
      .eq('party_uuid', emp.employee_id)
      .order('entry_date', { ascending: true })
      .order('id', { ascending: true })
      .limit(1000)
    if (!withDeleted) q = q.is('deleted_at', null)
    var { data, error } = await q
    if (error) { setEntries([]); setEntriesLoading(false); return }

    var rows = data || []

    // Batch-fetch source expense receipts for expense-type rows (bill/voice note on source expense)
    var expIds = []
    rows.forEach(function (r) {
      if (r.ref_type === 'expense' && r.ref_id && /^[0-9]+$/.test(String(r.ref_id))) {
        var id = Number(r.ref_id)
        if (expIds.indexOf(id) === -1) expIds.push(id)
      }
    })

    var receiptsByExpId = {}
    if (expIds.length > 0) {
      var { data: exps } = await supabase.from('expenses')
        .select('id, receipt_paths, receipt_path')
        .in('id', expIds)
      ;(exps || []).forEach(function (ex) {
        var paths = Array.isArray(ex.receipt_paths) && ex.receipt_paths.length > 0
          ? ex.receipt_paths
          : (ex.receipt_path ? [ex.receipt_path] : [])
        if (paths.length > 0) receiptsByExpId[ex.id] = paths
      })
    }

    var merged = rows.map(function (r) {
      if (r.ref_type === 'expense' && r.ref_id) {
        var id = Number(r.ref_id)
        if (receiptsByExpId[id]) return Object.assign({}, r, { _sourceReceipts: receiptsByExpId[id] })
      }
      return r
    })

    setEntries(merged)
    setEntriesLoading(false)
  }

  async function openEmployee(emp) {
    setSelectedEmp(emp)
    setView('detail')
    setShowDeleted(false)
    await loadEntries(emp, false)
    try { logActivity('SALARY_LEDGER_VIEW', emp.employee_name + ' (' + emp.employee_code + ')') } catch (_) {}
  }

  function toggleShowDeleted(next) {
    setShowDeleted(next)
    if (selectedEmp) loadEntries(selectedEmp, next)
  }

  function backToList() {
    setView('list')
    setSelectedEmp(null)
    setEntries([])
    loadEmployees()
  }

  function openPay() {
    if (!selectedEmp) return
    setShowPayModal(true)
  }

  function onPaymentSuccess() {
    setShowPayModal(false)
    if (selectedEmp) loadEntries(selectedEmp, showDeleted)
    loadEmployees()
  }

  function onAccrueSuccess() {
    setShowAccrueModal(false)
    loadEmployees()
  }

  function onAdjustSuccess() {
    setShowAdjustModal(false)
    if (selectedEmp) loadEntries(selectedEmp, showDeleted)
    loadEmployees()
  }

  async function reverseEntry(entryId) {
    var reason = prompt('Reason for reversal (optional)?')
    if (reason === null) return
    var { error } = await supabase.rpc('reverse_ledger_entry', {
      p_entry_id: entryId,
      p_reason: (reason || '').trim() || null
    })
    if (error) { alert('Reversal failed: ' + error.message); return }
    try { logActivity('LEDGER_REVERSE', 'salary entry #' + entryId) } catch (_) {}
    if (selectedEmp) await loadEntries(selectedEmp, showDeleted)
  }

  if (!canView) {
    return <p className="text-gray-400 text-sm text-center py-12">You don't have access to Salary Ledger.</p>
  }

  // ── LIST VIEW ──
  if (view === 'list') {
    var q = search.trim().toLowerCase()
    var filtered = employees.filter(function (e) {
      if (q) {
        var hay = ((e.employee_name || '') + ' ' + (e.employee_code || '') + ' ' + (e.designation || '')).toLowerCase()
        if (hay.indexOf(q) === -1) return false
      }
      if (statusFilter === 'with_balance' && (e.balance_paise || 0) === 0) return false
      if (statusFilter === 'stale' && ((e.unpaid_since_days || 0) < 30)) return false
      if (deptFilter) {
        var ids = e.job_department_ids || []
        if (ids.indexOf(Number(deptFilter)) === -1) return false
      }
      return true
    })

    var totalOutstanding = employees.reduce(function (s, e) { return s + (e.balance_paise || 0) }, 0)
    var totalCash = employees.reduce(function (s, e) { return s + (e.cash_balance_paise || 0) }, 0)
    var totalBank = employees.reduce(function (s, e) { return s + (e.bank_balance_paise || 0) }, 0)
    var empsWithBalance = employees.filter(function (e) { return (e.balance_paise || 0) !== 0 }).length
    var staleEmps = employees.filter(function (e) { return (e.unpaid_since_days || 0) >= 30 })

    return (
      <div className="space-y-4">
        {/* Stale warning banner */}
        {staleEmps.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-lg">⏳</span>
            <p className="text-sm text-amber-800 font-medium">
              {staleEmps.length} employee{staleEmps.length !== 1 ? 's' : ''} with salary unpaid ≥ 30 days
            </p>
          </div>
        )}

        {/* Summary + Accrue button */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Total Owed to Employees</p>
              <p className="text-2xl font-bold text-amber-800">{formatPoints(totalOutstanding)}</p>
              <div className="flex gap-3 mt-1.5 text-[11px] flex-wrap">
                <span className="text-gray-600">💵 Cash: <span className="font-semibold text-gray-900">{formatPoints(totalCash)}</span></span>
                <span className="text-gray-600">🏦 Bank: <span className="font-semibold text-gray-900">{formatPoints(totalBank)}</span></span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[11px] text-gray-500">With balance</p>
              <p className="text-lg font-bold text-gray-800">{empsWithBalance}</p>
            </div>
          </div>
          <div className="border-t border-gray-100 mt-3 pt-3 flex flex-wrap gap-2">
            <button onClick={function () { setShowAccrueModal(true) }}
              className="px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              📅 Accrue Salaries
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="text" value={search} onChange={function (e) { setSearch(e.target.value) }}
            placeholder="Search name / code / designation..."
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white"
            style={{ fontSize: '16px' }} />
          <select value={deptFilter} onChange={function (e) { setDeptFilter(e.target.value) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }}>
            <option value="">All Departments</option>
            {jdOptions.map(function (j) {
              return <option key={j.id} value={j.id}>{j.name}</option>
            })}
          </select>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 self-start">
            {[
              { key: 'all', label: 'All' },
              { key: 'with_balance', label: 'With Balance' },
              { key: 'stale', label: 'Stale ≥30d' }
            ].map(function (s) {
              return (
                <button key={s.key} onClick={function () { setStatusFilter(s.key) }}
                  className={"px-3 py-1.5 text-xs font-semibold rounded-md transition-colors " +
                    (statusFilter === s.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-gray-400 text-sm text-center py-12">Loading employees...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">
            {employees.length === 0 ? 'No employees found' : 'No employees match your filter'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(function (e) {
              var bal = e.balance_paise || 0
              var balColor = bal > 0 ? 'text-amber-800' : bal < 0 ? 'text-red-700' : 'text-gray-500'
              var balBg = bal > 0 ? 'bg-amber-50 border-amber-200' : bal < 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
              var cashBal = e.cash_balance_paise || 0
              var bankBal = e.bank_balance_paise || 0
              var days = e.unpaid_since_days || 0
              var isStale = days >= 30
              var isTerminated = e.employee_status === 'terminated' || e.employee_status === 'resigned'
              return (
                <button key={e.employee_id} onClick={function () { openEmployee(e) }}
                  className={"text-left border rounded-xl p-3 hover:shadow-sm active:scale-[0.99] transition-all " + balBg + (isStale ? " ring-2 ring-amber-300" : "")}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900 truncate">{e.employee_name || '—'}</p>
                      <p className="text-[10px] text-gray-500 truncate">{e.employee_code || '—'}{e.designation ? ' · ' + e.designation : ''}</p>
                      {(e.job_department_ids || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(e.job_department_ids || []).map(function (id) {
                            var name = jdMap[id]
                            if (!name) return null
                            return (
                              <span key={id} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-white/70 text-gray-700 border border-gray-200">
                                {name}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {isStale && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">{days}d</span>
                      )}
                      {isTerminated && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">{e.employee_status}</span>
                      )}
                    </div>
                  </div>
                  <p className={"text-lg font-bold " + balColor}>{formatPoints(bal)}</p>
                  {(cashBal !== 0 || bankBal !== 0) && (
                    <div className="flex gap-2 mt-1 text-[10px] text-gray-600">
                      {cashBal !== 0 && <span>💵 {formatPoints(cashBal)}</span>}
                      {bankBal !== 0 && <span>🏦 {formatPoints(bankBal)}</span>}
                    </div>
                  )}
                  <p className="text-[11px] text-gray-500 mt-1">
                    {(e.entry_count || 0) > 0
                      ? (e.entry_count + ' entries · last ' + (e.last_entry_date || '—'))
                      : 'No activity'}
                  </p>
                </button>
              )
            })}
          </div>
        )}

        {/* Accrue Salaries modal */}
        {showAccrueModal && (
          <AccrueSalariesModal
            onClose={function () { setShowAccrueModal(false) }}
            onSuccess={onAccrueSuccess} />
        )}
      </div>
    )
  }

  // ── DETAIL VIEW ──
  var emp = selectedEmp
  if (!emp) return null

  var running = 0
  var withRunning = entries.map(function (e) {
    if (!e.deleted_at) running += (e.credit_paise || 0) - (e.debit_paise || 0)
    return Object.assign({}, e, { runningBalance: e.deleted_at ? null : running })
  })
  var displayEntries = withRunning.slice().reverse()

  var currentBalance = running
  var balColor = currentBalance > 0 ? 'text-amber-800' : currentBalance < 0 ? 'text-red-700' : 'text-gray-500'

  return (
    <div className="space-y-4">
      <button onClick={backToList} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors">
        ← Back to employees
      </button>

      {/* Employee header card */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-gray-900 truncate">{emp.employee_name || '—'}</h3>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-gray-100 text-gray-600 rounded">{emp.employee_status}</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">{emp.employee_code} · #{emp.employee_id.slice(0, 8)}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Monthly: 💵 {formatPoints(emp.monthly_cash_paise || 0)} · 🏦 {formatPoints(emp.monthly_bank_paise || 0)}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button onClick={openPay} disabled={currentBalance <= 0}
              className={"px-3 py-2 text-xs font-bold rounded-lg transition-colors " +
                (currentBalance > 0 ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}>
              💸 Pay Salary
            </button>
            <button onClick={function () { setShowAdjustModal(true) }}
              className="px-3 py-2 text-xs font-bold rounded-lg bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50">
              ± Adjust
            </button>
          </div>
        </div>
        <div className="border-t border-gray-100 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Outstanding Balance</p>
          <p className={"text-3xl font-bold " + balColor}>{formatPoints(currentBalance)}</p>
          {((emp.cash_balance_paise || 0) !== 0 || (emp.bank_balance_paise || 0) !== 0) && (
            <div className="flex gap-3 mt-2 text-xs">
              <span className="text-gray-600">💵 Cash: <span className="font-semibold text-gray-900">{formatPoints(emp.cash_balance_paise || 0)}</span></span>
              <span className="text-gray-600">🏦 Bank: <span className="font-semibold text-gray-900">{formatPoints(emp.bank_balance_paise || 0)}</span></span>
            </div>
          )}
          {(emp.unpaid_since_days || 0) >= 30 && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-700 font-medium">
              ⏳ Unpaid for {emp.unpaid_since_days} days
            </div>
          )}
        </div>
      </div>

      {/* Admin toggle: show deleted */}
      {isAdmin && (
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showDeleted}
            onChange={function (e) { toggleShowDeleted(e.target.checked) }} />
          Show deleted entries (audit)
        </label>
      )}

      {/* Pay Salary modal (shared component) */}
      {showPayModal && emp && (
        <PaySalaryModal
          employee={emp}
          profile={profile}
          onClose={function () { setShowPayModal(false) }}
          onSuccess={onPaymentSuccess} />
      )}

      {/* Adjust Salary modal */}
      {showAdjustModal && emp && (
        <AdjustSalaryModal
          employee={emp}
          onClose={function () { setShowAdjustModal(false) }}
          onSuccess={onAdjustSuccess} />
      )}

      {/* Entries list */}
      {entriesLoading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading entries...</p>
      ) : displayEntries.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">No salary entries yet.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {displayEntries.map(function (e, idx) {
            var isCredit = (e.credit_paise || 0) > 0
            var isDeleted = !!e.deleted_at
            var amt = isCredit ? (e.credit_paise || 0) : (e.debit_paise || 0)
            var kind = e.metadata && e.metadata.kind ? e.metadata.kind : e.ref_type
            var dotColor = isDeleted ? 'bg-gray-300' : isCredit ? 'bg-amber-500' : 'bg-green-500'
            var meta = e.metadata || {}
            return (
              <div key={e.id}
                className={"flex items-start gap-3 px-3 py-3 " +
                  (idx < displayEntries.length - 1 ? "border-b border-gray-100 " : "") +
                  (isDeleted ? "opacity-50" : "")}>
                <div className={"w-2 h-2 rounded-full mt-1.5 flex-shrink-0 " + dotColor}></div>
                <div className="flex-1 min-w-0">
                  <p className={"text-sm font-medium text-gray-900 " + (isDeleted ? "line-through" : "")}>
                    {e.description || (isCredit ? 'Credit' : 'Debit')}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {e.entry_date} · {kind}
                    {meta.salary_month ? ' · ' + meta.salary_month : ''}
                    {isDeleted && ' · deleted'}
                  </p>
                  {(meta.mode || meta.reason) && (
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      {meta.mode && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                          {meta.mode === 'cash' ? '💵 Cash' : '🏦 Bank'}
                        </span>
                      )}
                      {meta.reason && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-gray-50 text-gray-700 border border-gray-200 rounded">
                          {meta.reason}
                        </span>
                      )}
                    </div>
                  )}
                  <PaymentProofThumbs meta={meta} />
                  {e._sourceReceipts && e._sourceReceipts.length > 0 && (
                    <LedgerSourceMedia paths={e._sourceReceipts} />
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={"text-sm font-bold " + (isCredit ? "text-amber-800" : "text-green-700")}>
                    {isCredit ? '+' : '−'}{formatPoints(amt)}
                  </p>
                  {!isDeleted && (
                    <p className="text-[10px] text-gray-400">Bal: {formatPoints(e.runningBalance)}</p>
                  )}
                  {isAdmin && !isDeleted && (
                    <button onClick={function () { reverseEntry(e.id) }}
                      className="text-[10px] text-red-500 hover:text-red-700 mt-1 font-medium">
                      ↩ Reverse
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default SalaryLedger