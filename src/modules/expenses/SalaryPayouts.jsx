import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useRealtime } from '../../lib/useRealtime'
import { logActivity } from '../../lib/logger'
import { formatPoints, formatDate } from '../../lib/format'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import SearchDropdown from '../../components/ui/SearchDropdown'
import Icon from '../../components/ui/Icon'

var ACTIVE_STATUSES = ['active', 'probation', 'on_leave']

function emptyRow(id) {
  return { id: id, employeeId: '', cash: '', bank: '' }
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function SalaryPayouts(props) {
  var profile = props.profile
  var permsNew = (profile && profile.permsNew) || []
  var isAdmin = hasPerm(permsNew, 'admin.dashboard')
  var canView = isAdmin || (hasPerm(permsNew, 'finance.salary_payouts') && hasPerm(permsNew, 'hr.employees.salary_view'))

  var refData = useReferenceData()

  var [date, setDate] = useState(todayStr)
  var [rows, setRows] = useState(function () { return [emptyRow(1)] })
  var [extraEmployees, setExtraEmployees] = useState([])  // optimistic quick-added employees, before refData catches up
  var [walletBalance, setWalletBalance] = useState(null)
  var [recent, setRecent] = useState([])
  var [showRecent, setShowRecent] = useState(false)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [saved, setSaved] = useState(null)

  useEffect(function () {
    if (!canView) return
    loadWallet()
    loadRecent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useRealtime(['salary_payout_entries'], function () { if (canView) loadRecent() })

  async function loadWallet() {
    if (!profile || !profile.id) return
    var res = await supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
    setWalletBalance(res.data && typeof res.data.balance_paise === 'number' ? res.data.balance_paise : 0)
  }

  async function loadRecent() {
    var res = await supabase.from('salary_payout_entries')
      .select('id, payout_date, cash_paise, bank_paise, created_at, employees(full_name, employee_code)')
      .order('created_at', { ascending: false })
      .limit(100)
    setRecent(res.data || [])
  }

  var employeeItems = useMemo(function () {
    var byId = {}
    ;(refData.employees || []).forEach(function (e) {
      if (ACTIVE_STATUSES.indexOf(e.status) !== -1) byId[e.id] = e
    })
    extraEmployees.forEach(function (e) { byId[e.id] = e })  // quick-added ones win if refData hasn't caught up yet
    return Object.keys(byId).map(function (id) {
      var e = byId[id]
      return { value: String(e.id), label: e.full_name + (e.designation ? ' — ' + e.designation : '') }
    }).sort(function (a, b) { return a.label.localeCompare(b.label) })
  }, [refData.employees, extraEmployees])

  function addRow() {
    setRows(function (prev) { return prev.concat([emptyRow(Date.now() + Math.random())]) })
  }
  function removeRow(id) {
    setRows(function (prev) { return prev.length > 1 ? prev.filter(function (r) { return r.id !== id }) : prev })
  }
  function updateRow(id, patch) {
    setRows(function (prev) { return prev.map(function (r) { return r.id === id ? Object.assign({}, r, patch) : r }) })
  }

  async function quickAddEmployee(typed) {
    var name = (typed || '').trim()
    if (!name) return null
    var res = await supabase.rpc('fn_quick_add_employee', { p_full_name: name })
    if (res.error || !res.data) {
      alert('Could not add employee: ' + (res.error && res.error.message || 'unknown error'))
      return null
    }
    setExtraEmployees(function (prev) { return prev.concat([res.data]) })
    try { refData.refreshRefData && refData.refreshRefData() } catch (_) {}
    try { logActivity('EMPLOYEE_QUICK_ADD', name + ' (id ' + res.data.id + ')') } catch (_) {}
    return res.data
  }

  var totals = useMemo(function () {
    var cash = 0, bank = 0
    rows.forEach(function (r) {
      cash += Math.round((Number(r.cash) || 0) * 100)
      bank += Math.round((Number(r.bank) || 0) * 100)
    })
    return { cashPaise: cash, bankPaise: bank }
  }, [rows])

  var walletAfterPaise = walletBalance == null ? null : walletBalance - totals.cashPaise

  async function handleSave() {
    setError('')
    var validRows = rows.filter(function (r) {
      return r.employeeId && (Math.round((Number(r.cash) || 0) * 100) > 0 || Math.round((Number(r.bank) || 0) * 100) > 0)
    })
    if (validRows.length === 0) {
      setError('Add at least one employee with a cash or bank amount')
      return
    }

    setSaving(true)
    var payload = validRows.map(function (r) {
      return {
        employee_id: r.employeeId,
        cash_paise: Math.round((Number(r.cash) || 0) * 100),
        bank_paise: Math.round((Number(r.bank) || 0) * 100)
      }
    })
    var res = await supabase.rpc('fn_record_salary_payout', { p_date: date, p_entries: payload })
    if (res.error) {
      setError(res.error.message || 'Could not save payout')
      setSaving(false)
      return
    }

    var batchId = res.data
    var totalCashPaise = payload.reduce(function (s, p) { return s + p.cash_paise }, 0)
    var totalBankPaise = payload.reduce(function (s, p) { return s + p.bank_paise }, 0)

    if (totalCashPaise > 0) {
      var wRes = await supabase.rpc('wallet_self_debit', {
        p_amount_paise: totalCashPaise,
        p_description: 'Salary payout — ' + validRows.length + ' employee(s)',
        p_ref_type: 'salary_payout',
        p_ref_id: String(batchId)
      })
      if (wRes.error) {
        setError('Payout was recorded, but your wallet debit failed: ' + wRes.error.message + '. Let an admin know.')
        setSaving(false)
        loadRecent()
        return
      }
    }

    try {
      logActivity('SALARY_PAYOUT_RECORD',
        validRows.length + ' employee(s) | cash ' + (totalCashPaise / 100) + ' | bank ' + (totalBankPaise / 100))
    } catch (_) {}

    setSaving(false)
    setSaved({ count: validRows.length })
    setRows([emptyRow(Date.now())])
    setExtraEmployees([])
    loadWallet()
    loadRecent()
    setTimeout(function () { setSaved(null) }, 3000)
  }

  if (!canView) {
    return <p className="text-gray-400 text-sm text-center py-12">You don't have access to Salary Payouts.</p>
  }

  function renderDropdownCell(row) {
    return (
      <SearchDropdown
        items={employeeItems}
        value={row.employeeId}
        onChange={function (val) { updateRow(row.id, { employeeId: val }) }}
        allowAdd
        onAdd={async function (typed) {
          var emp = await quickAddEmployee(typed)
          if (emp) updateRow(row.id, { employeeId: String(emp.id) })
        }}
        placeholder="Search or add employee..." />
    )
  }

  function renderCashInput(row, cls) {
    return (
      <input type="number" min="0" step="any" value={row.cash}
        onChange={function (e) { updateRow(row.id, { cash: e.target.value }) }}
        placeholder="0"
        className={cls}
        style={{ fontSize: '16px' }} />
    )
  }

  function renderBankInput(row, cls) {
    return (
      <input type="number" min="0" step="any" value={row.bank}
        onChange={function (e) { updateRow(row.id, { bank: e.target.value }) }}
        placeholder="0"
        className={cls}
        style={{ fontSize: '16px' }} />
    )
  }

  function rowNote(row) {
    var cash = Math.round((Number(row.cash) || 0) * 100)
    var bank = Math.round((Number(row.bank) || 0) * 100)
    if (cash > 0 && bank > 0) return { text: 'Cash deducts wallet · bank record-only', cls: 'text-gray-500' }
    if (cash > 0) return { text: 'Deducts from your wallet', cls: 'text-amber-700' }
    if (bank > 0) return { text: 'Record-only — no wallet change', cls: 'text-blue-700' }
    return { text: '', cls: 'text-gray-300' }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
            <Icon name="bank" size={18} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Salary Payouts</h2>
            <p className="text-xs text-gray-500">Cash deducts from your PC wallet — bank is record-only.</p>
          </div>
        </div>
      </div>

      {/* Date + wallet */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-2.5">
          <label htmlFor="salpay-date" className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">
            Payment date <span className="font-normal normal-case text-gray-400">· backdating allowed</span>
          </label>
          <input id="salpay-date" type="date" value={date} max={todayStr()}
            onChange={function (e) { setDate(e.target.value) }}
            className="w-full border-none p-0 text-sm font-bold text-gray-900 bg-transparent focus:ring-0"
            style={{ fontSize: '16px' }} />
        </div>
        <div className="flex-1 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800 mb-0.5">Your PC wallet</div>
          <div className="text-sm font-extrabold text-amber-800 tabular-nums">
            {walletBalance == null ? 'Loading…' : formatPoints(walletBalance)}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {/* Entry table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* Desktop table */}
        <div className="hidden sm:block">
          <div className="grid border-b border-gray-200 bg-gray-50"
            style={{ gridTemplateColumns: 'minmax(220px,2fr) 140px 140px minmax(160px,1fr) 36px' }}>
            <div className="px-4 py-2 text-[10.5px] font-bold uppercase tracking-wider text-gray-500">Employee</div>
            <div className="px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-gray-500 text-right">Cash (pts)</div>
            <div className="px-3 py-2 text-[10.5px] font-bold uppercase tracking-wider text-gray-500 text-right">Bank (pts)</div>
            <div className="px-4 py-2 text-[10.5px] font-bold uppercase tracking-wider text-gray-500">Note</div>
            <div />
          </div>
          {rows.map(function (row) {
            var note = rowNote(row)
            return (
              <div key={row.id} className="grid items-center border-b border-gray-100 last:border-b-0"
                style={{ gridTemplateColumns: 'minmax(220px,2fr) 140px 140px minmax(160px,1fr) 36px' }}>
                <div className="px-4 py-2.5">{renderDropdownCell(row)}</div>
                <div className="px-3 py-2.5">
                  {renderCashInput(row, 'w-full px-2.5 py-2 border border-amber-200 bg-amber-50 rounded-lg text-sm text-right tabular-nums focus:ring-2 focus:ring-indigo-300')}
                </div>
                <div className="px-3 py-2.5">
                  {renderBankInput(row, 'w-full px-2.5 py-2 border border-blue-200 bg-blue-50 rounded-lg text-sm text-right tabular-nums focus:ring-2 focus:ring-indigo-300')}
                </div>
                <div className={'px-4 py-2.5 text-xs ' + note.cls}>{note.text}</div>
                <div className="flex items-center justify-center">
                  <button onClick={function () { removeRow(row.id) }} aria-label="Remove this row"
                    className="w-6 h-6 rounded-full border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-red-500 flex items-center justify-center">
                    <Icon name="close" size={12} />
                  </button>
                </div>
              </div>
            )
          })}
          <button onClick={addRow} className="w-full border-t border-dashed border-gray-200 py-3 text-indigo-600 font-semibold text-sm hover:bg-indigo-50 flex items-center justify-center gap-1.5">
            <Icon name="plus" size={14} /> Add employee
          </button>
          <div className="grid border-t-2 border-gray-200 bg-gray-50"
            style={{ gridTemplateColumns: 'minmax(220px,2fr) 140px 140px minmax(160px,1fr) 36px' }}>
            <div className="px-4 py-2.5 text-xs font-extrabold text-gray-900">TOTAL</div>
            <div className="px-3 py-2.5 text-sm font-extrabold text-amber-800 text-right tabular-nums">{formatPoints(totals.cashPaise)}</div>
            <div className="px-3 py-2.5 text-sm font-extrabold text-blue-800 text-right tabular-nums">{formatPoints(totals.bankPaise)}</div>
            <div className="px-4 py-2.5 text-xs text-gray-500">Grand total {formatPoints(totals.cashPaise + totals.bankPaise)}</div>
            <div />
          </div>
        </div>

        {/* Mobile stacked */}
        <div className="sm:hidden divide-y divide-gray-100">
          {rows.map(function (row) {
            var note = rowNote(row)
            return (
              <div key={row.id} className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">{renderDropdownCell(row)}</div>
                  <button onClick={function () { removeRow(row.id) }} aria-label="Remove this row"
                    className="w-7 h-7 flex-shrink-0 rounded-full border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-red-500 flex items-center justify-center">
                    <Icon name="close" size={13} />
                  </button>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">Cash (pts)</label>
                    {renderCashInput(row, 'w-full px-2.5 py-2 border border-amber-200 bg-amber-50 rounded-lg text-sm tabular-nums')}
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-700 mb-1">Bank (pts)</label>
                    {renderBankInput(row, 'w-full px-2.5 py-2 border border-blue-200 bg-blue-50 rounded-lg text-sm tabular-nums')}
                  </div>
                </div>
                {note.text && <p className={'text-[11px] ' + note.cls}>{note.text}</p>}
              </div>
            )
          })}
          <button onClick={addRow} className="w-full py-3 text-indigo-600 font-semibold text-sm hover:bg-indigo-50 flex items-center justify-center gap-1.5">
            <Icon name="plus" size={14} /> Add employee
          </button>
          <div className="p-3 bg-gray-50 space-y-1">
            <div className="flex justify-between text-xs text-gray-600"><span>Total cash</span><span className="font-bold text-amber-800 tabular-nums">{formatPoints(totals.cashPaise)}</span></div>
            <div className="flex justify-between text-xs text-gray-600"><span>Total bank</span><span className="font-bold text-blue-800 tabular-nums">{formatPoints(totals.bankPaise)}</span></div>
          </div>
        </div>
      </div>

      {/* Wallet-after + Save */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          Wallet after this payout:{' '}
          <span className={'font-extrabold tabular-nums ' + (walletAfterPaise != null && walletAfterPaise < 0 ? 'text-red-600' : 'text-emerald-700')}>
            {walletAfterPaise == null ? '—' : formatPoints(walletAfterPaise)}
          </span>
        </p>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-xs font-bold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
              ✓ Recorded for {saved.count} employee(s)
            </span>
          )}
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Payout'}
          </button>
        </div>
      </div>

      {/* Recent payouts */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <button onClick={function () { setShowRecent(!showRecent) }}
          className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <span>Recent Payouts — {recent.length} entries</span>
          <Icon name={showRecent ? 'chevronUp' : 'chevronDown'} size={14} className="text-gray-400" />
        </button>
        {showRecent && (
          <div className="border-t border-gray-100 max-h-96 overflow-y-auto">
            {recent.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">No payouts recorded yet.</p>
            ) : (
              recent.map(function (r) {
                var emp = r.employees || {}
                return (
                  <div key={r.id} className="px-3 py-2 border-b border-gray-100 last:border-b-0 flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate text-gray-800 font-medium">{emp.full_name || '—'}</span>
                    <span className="text-gray-500">{formatDate(r.payout_date)}</span>
                    {r.cash_paise > 0 && <span className="font-semibold text-amber-800 tabular-nums">💵 {formatPoints(r.cash_paise)}</span>}
                    {r.bank_paise > 0 && <span className="font-semibold text-blue-800 tabular-nums">🏦 {formatPoints(r.bank_paise)}</span>}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default SalaryPayouts
