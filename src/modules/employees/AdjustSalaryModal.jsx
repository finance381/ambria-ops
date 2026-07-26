import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'

var DEBIT_PRESETS = [
  'LOP (Leave Without Pay)',
  'Advance recovery',
  'Late fine',
  'Damages recovery',
  'Statutory (PF/ESI/PT/TDS)',
  'Other'
]

var CREDIT_PRESETS = [
  'Performance bonus',
  'Festival bonus',
  'Arrears',
  'Reimbursement',
  'Correction',
  'Other'
]

function AdjustSalaryModal(props) {
  var employee = props.employee  // v_employee_ledger row
  var onClose = props.onClose
  var onSuccess = props.onSuccess

  var [sign, setSign] = useState('')  // 'credit' | 'debit'
  var [mode, setMode] = useState('')  // 'cash' | 'bank'
  var [amountRupees, setAmountRupees] = useState('')
  var [reasonPreset, setReasonPreset] = useState('')
  var [reasonOther, setReasonOther] = useState('')
  var [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0])
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  var cashBalPaise = (employee && employee.cash_balance_paise) || 0
  var bankBalPaise = (employee && employee.bank_balance_paise) || 0
  var currentModeBalance = mode === 'cash' ? cashBalPaise : mode === 'bank' ? bankBalPaise : 0

  var amtPaise = Math.round((Number(amountRupees) || 0) * 100)
  var reasonFinal = reasonPreset === 'Other' ? reasonOther.trim() : reasonPreset
  var presets = sign === 'credit' ? CREDIT_PRESETS : DEBIT_PRESETS

  function submit() {
    if (saving) return
    setError('')

    if (!sign) { setError('Select credit or debit'); return }
    if (!mode) { setError('Select cash or bank'); return }
    if (!isFinite(Number(amountRupees)) || Number(amountRupees) <= 0) { setError('Enter a valid amount'); return }
    if (!reasonFinal) { setError('Select or enter a reason'); return }
    if (sign === 'debit' && amtPaise > currentModeBalance) {
      setError('Debit exceeds ' + mode + ' balance owed (' + formatPoints(currentModeBalance) + ' pts)')
      return
    }

    setSaving(true)
    supabase.rpc('adjust_employee_balance', {
      p_employee_id: employee.employee_id,
      p_amount_paise: amtPaise,
      p_sign: sign,
      p_mode: mode,
      p_reason: reasonFinal,
      p_date: entryDate
    }).then(function (res) {
      if (res.error) {
        setError(res.error.message || 'Adjustment failed')
        setSaving(false)
        return
      }
      try {
        logActivity('SALARY_ADJUST',
          employee.employee_name + ' | ' + sign + ' ' + mode + ' | ' +
          (amtPaise / 100) + ' pts | ' + reasonFinal)
      } catch (_) {}
      setSaving(false)
      if (onSuccess) onSuccess(res.data)
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={function () { if (!saving) onClose && onClose() }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto"
        onClick={function (ev) { ev.stopPropagation() }}>

        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">Adjust Salary Balance</h3>
          <button onClick={function () { if (!saving) onClose && onClose() }}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          {employee && employee.employee_name}
          {employee && employee.employee_code ? ' · ' + employee.employee_code : ''}
        </p>

        {error && (
          <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">{error}</div>
        )}

        {/* Sign selector */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Adjustment Type <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            {[
              { v: 'credit', label: '➕ Credit', hint: 'Bonus / Arrears' },
              { v: 'debit', label: '➖ Debit', hint: 'LOP / Advance / Fine' }
            ].map(function (opt) {
              var active = sign === opt.v
              return (
                <button key={opt.v} type="button"
                  onClick={function () { setSign(opt.v); setReasonPreset(''); setReasonOther('') }}
                  className={
                    'flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ' +
                    (active ? (opt.v === 'credit' ? 'bg-green-600 text-white border-green-600' : 'bg-amber-600 text-white border-amber-600')
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                  }>
                  <div>{opt.label}</div>
                  <div className={'text-[10px] font-normal mt-0.5 ' + (active ? 'text-white/80' : 'text-gray-500')}>
                    {opt.hint}
                  </div>
                </button>
              )
            })}
          </div>
          {sign === 'credit' && (
            <p className="text-[11px] text-gray-500 mt-1">Increases balance owed to employee.</p>
          )}
          {sign === 'debit' && (
            <p className="text-[11px] text-gray-500 mt-1">Reduces balance owed. Does not touch wallet.</p>
          )}
        </div>

        {/* Mode selector */}
        {sign && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Apply To <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {[
                { v: 'cash', label: '💵 Cash', bal: cashBalPaise },
                { v: 'bank', label: '🏦 Bank', bal: bankBalPaise }
              ].map(function (opt) {
                var active = mode === opt.v
                return (
                  <button key={opt.v} type="button"
                    onClick={function () { setMode(opt.v) }}
                    className={
                      'flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ' +
                      (active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
                    }>
                    <div>{opt.label}</div>
                    <div className={'text-[10px] font-normal mt-0.5 ' + (active ? 'text-indigo-100' : 'text-gray-500')}>
                      Owed: {(opt.bal / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Amount */}
        {sign && mode && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount (pts) *</label>
              <input type="number" inputMode="decimal" value={amountRupees}
                onChange={function (ev) { setAmountRupees(ev.target.value) }}
                placeholder="0" min="0" step="any"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                style={{ fontSize: '16px' }} />
              {sign === 'debit' && amtPaise > 0 && amtPaise > currentModeBalance && (
                <p className="text-[11px] text-red-600 mt-1">
                  Exceeds {mode} balance ({formatPoints(currentModeBalance)} pts)
                </p>
              )}
            </div>

            {/* Reason */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason *</label>
              <select value={reasonPreset}
                onChange={function (ev) { setReasonPreset(ev.target.value) }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                style={{ fontSize: '16px' }}>
                <option value="">— Select —</option>
                {presets.map(function (r) {
                  return <option key={r} value={r}>{r}</option>
                })}
              </select>
              {reasonPreset === 'Other' && (
                <input type="text" value={reasonOther}
                  onChange={function (ev) { setReasonOther(ev.target.value) }}
                  placeholder="Specify reason..."
                  maxLength="200"
                  className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                  style={{ fontSize: '16px' }} />
              )}
            </div>

            {/* Entry date */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Entry Date</label>
              <input type="date" value={entryDate}
                onChange={function (ev) { setEntryDate(ev.target.value) }}
                max={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                style={{ fontSize: '16px' }} />
            </div>

            {/* Summary */}
            {amtPaise > 0 && reasonFinal && (
              <div className={"border rounded-lg p-2.5 text-xs " +
                (sign === 'credit' ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800")}>
                <div className="flex justify-between">
                  <span>{sign === 'credit' ? 'Adds to' : 'Reduces from'} {mode} balance</span>
                  <span className="font-bold">{sign === 'credit' ? '+' : '−'}{formatPoints(amtPaise)}</span>
                </div>
                <p className="text-[10px] mt-1 opacity-80">{reasonFinal}</p>
              </div>
            )}
          </>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={function () { if (!saving) onClose && onClose() }}
            disabled={saving}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className={"flex-1 py-2.5 text-sm font-bold text-white rounded-lg disabled:opacity-50 " +
              (sign === 'credit' ? "bg-green-600 hover:bg-green-700" : "bg-amber-600 hover:bg-amber-700")}>
            {saving ? 'Saving...' : (sign === 'credit' ? 'Post Credit' : sign === 'debit' ? 'Post Debit' : 'Post')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AdjustSalaryModal