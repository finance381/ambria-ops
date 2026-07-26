import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'

function currentMonthISO() {
  var d = new Date()
  var y = d.getFullYear()
  var m = String(d.getMonth() + 1).padStart(2, '0')
  return y + '-' + m
}

function monthLabel(iso) {
  if (!iso) return ''
  var d = new Date(iso + '-01')
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function AccrueSalariesModal(props) {
  var onClose = props.onClose
  var onSuccess = props.onSuccess

  var [month, setMonth] = useState(currentMonthISO())
  var [preview, setPreview] = useState(null)  // { eligibleCash, eligibleBank, totalCashPaise, totalBankPaise, alreadyAccrued }
  var [previewLoading, setPreviewLoading] = useState(false)
  var [previewError, setPreviewError] = useState('')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [result, setResult] = useState(null)  // RPC response after commit

  useEffect(function () {
    if (month) loadPreview(month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  async function loadPreview(m) {
    setPreviewLoading(true)
    setPreviewError('')
    setPreview(null)
    setResult(null)

    // 1. Eligible employees + their monthly amounts
    var { data: empData, error: empErr } = await supabase.from('employees')
      .select('id, monthly_cash_paise, monthly_bank_paise, status')
      .in('status', ['active', 'probation', 'on_leave'])
    if (empErr) {
      setPreviewError(empErr.message || 'Failed to load employees')
      setPreviewLoading(false)
      return
    }

    var eligibleCash = 0, eligibleBank = 0, totalCash = 0, totalBank = 0
    ;(empData || []).forEach(function (e) {
      if ((e.monthly_cash_paise || 0) > 0) { eligibleCash++; totalCash += e.monthly_cash_paise }
      if ((e.monthly_bank_paise || 0) > 0) { eligibleBank++; totalBank += e.monthly_bank_paise }
    })

    // 2. Already accrued for this month
    var { data: existing, error: exErr } = await supabase.from('ledger_entries')
      .select('id, metadata')
      .eq('ref_type', 'salary_credit')
      .eq('metadata->>salary_month', m)
      .is('deleted_at', null)
    if (exErr) {
      setPreviewError(exErr.message || 'Failed to check existing accruals')
      setPreviewLoading(false)
      return
    }

    var alreadyCash = 0, alreadyBank = 0
    ;(existing || []).forEach(function (r) {
      var mode = r.metadata && r.metadata.mode
      if (mode === 'cash') alreadyCash++
      else if (mode === 'bank') alreadyBank++
    })

    setPreview({
      eligibleCash: eligibleCash,
      eligibleBank: eligibleBank,
      totalCashPaise: totalCash,
      totalBankPaise: totalBank,
      alreadyCash: alreadyCash,
      alreadyBank: alreadyBank,
      newCash: Math.max(0, eligibleCash - alreadyCash),
      newBank: Math.max(0, eligibleBank - alreadyBank)
    })
    setPreviewLoading(false)
  }

  async function confirmAccrue() {
    if (saving) return
    setSaving(true)
    setError('')

    var { data, error: rpcErr } = await supabase.rpc('accrue_salaries', { p_month: month })
    if (rpcErr) {
      setError(rpcErr.message || 'Accrual failed')
      setSaving(false)
      return
    }

    try { logActivity('SALARY_ACCRUE', month + ' | inserted ' + ((data && data.total_inserted) || 0)) } catch (_) {}
    setResult(data)
    setSaving(false)
    // Refresh preview so counts update immediately
    loadPreview(month)
    // Notify parent to reload list
    if (onSuccess) onSuccess(data)
  }

  var totalNewRows = preview ? (preview.newCash + preview.newBank) : 0
  var canConfirm = !!preview && totalNewRows > 0 && !saving && !previewLoading

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={function () { if (!saving) onClose && onClose() }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto"
        onClick={function (ev) { ev.stopPropagation() }}>

        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">Accrue Salaries</h3>
          <button onClick={function () { if (!saving) onClose && onClose() }}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          Posts monthly salary credits to the ledger. Skips employees already accrued for the selected month.
        </p>

        {error && (
          <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">{error}</div>
        )}
        {previewError && (
          <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">{previewError}</div>
        )}

        {/* Month picker */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Accrual Month *</label>
          <input type="month" value={month}
            onChange={function (ev) { setMonth(ev.target.value) }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
          <p className="text-[11px] text-gray-500 mt-1">{monthLabel(month)}</p>
        </div>

        {/* Preview */}
        {previewLoading ? (
          <p className="text-gray-400 text-sm text-center py-4">Computing preview...</p>
        ) : preview ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Preview</p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white border border-gray-200 rounded p-2">
                <p className="text-[10px] text-gray-500 uppercase">💵 Cash</p>
                <p className="text-sm font-bold text-gray-900">{preview.newCash} new</p>
                <p className="text-[10px] text-gray-500">
                  {preview.eligibleCash} eligible · {preview.alreadyCash} already accrued
                </p>
                {preview.newCash > 0 && (
                  <p className="text-[11px] text-gray-700 mt-1">
                    ≈ {formatPoints(preview.totalCashPaise * preview.newCash / Math.max(preview.eligibleCash, 1))} pts
                  </p>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded p-2">
                <p className="text-[10px] text-gray-500 uppercase">🏦 Bank</p>
                <p className="text-sm font-bold text-gray-900">{preview.newBank} new</p>
                <p className="text-[10px] text-gray-500">
                  {preview.eligibleBank} eligible · {preview.alreadyBank} already accrued
                </p>
                {preview.newBank > 0 && (
                  <p className="text-[11px] text-gray-700 mt-1">
                    ≈ {formatPoints(preview.totalBankPaise * preview.newBank / Math.max(preview.eligibleBank, 1))} pts
                  </p>
                )}
              </div>
            </div>

            {totalNewRows === 0 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                {preview.eligibleCash + preview.eligibleBank === 0
                  ? 'No eligible employees for this month.'
                  : 'All eligible employees already accrued for this month.'}
              </p>
            )}
          </div>
        ) : null}

        {/* Result (after commit) */}
        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800">
            <p className="font-semibold mb-1">✓ Accrual complete for {monthLabel(month)}</p>
            <p>💵 Cash: {result.cash_inserted} inserted, {result.cash_skipped} skipped</p>
            <p>🏦 Bank: {result.bank_inserted} inserted, {result.bank_skipped} skipped</p>
            <p className="mt-1 text-[11px]">Entry date: {result.entry_date}</p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={function () { if (!saving) onClose && onClose() }}
            disabled={saving}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button onClick={confirmAccrue} disabled={!canConfirm}
              className={"flex-1 py-2.5 text-sm font-bold rounded-lg " +
                (canConfirm ? "text-white bg-indigo-600 hover:bg-indigo-700" : "text-gray-400 bg-gray-200 cursor-not-allowed")}>
              {saving ? 'Accruing...' : 'Confirm — Post ' + totalNewRows + ' row' + (totalNewRows !== 1 ? 's' : '')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default AccrueSalariesModal