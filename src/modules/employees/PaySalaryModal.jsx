import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'
import { compressImage } from '../../lib/imageCompress'

var REASON_PRESETS = [
  'LOP (Leave Without Pay)',
  'Advance recovery',
  'Late fine',
  'Damages recovery',
  'Statutory (PF/ESI/PT/TDS)',
  'Other'
]

function PaySalaryModal(props) {
  var employee = props.employee
  var lockedMode = props.lockedMode || ''
  var onClose = props.onClose
  var onSuccess = props.onSuccess
  var profile = props.profile

  var [mode, setMode] = useState(lockedMode || '')
  var [amountRupees, setAmountRupees] = useState('')
  var [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  // Adjustment (deduct-from-owed) toggle
  var [showAdj, setShowAdj] = useState(false)
  var [adjRupees, setAdjRupees] = useState('')
  var [adjReasonPreset, setAdjReasonPreset] = useState('')
  var [adjReasonOther, setAdjReasonOther] = useState('')

  // Wallet balance for cash-mode UX (does not affect server-side guard)
  var [walletBalancePaise, setWalletBalancePaise] = useState(null)

  // Payment proof images
  var [payImages, setPayImages] = useState([])
  var [payImgBusy, setPayImgBusy] = useState(false)

  useEffect(function () {
    if (!profile || !profile.id) return
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) {
        setWalletBalancePaise(res.data && typeof res.data.balance_paise === 'number' ? res.data.balance_paise : 0)
      })
  }, [profile && profile.id])

  async function handleImgAdd(ev) {
    if (saving) return
    var raw = Array.from(ev.target.files || [])
    ev.target.value = ''
    if (raw.length === 0) return
    setPayImgBusy(true)
    var out = []
    for (var i = 0; i < raw.length; i++) {
      try {
        var f = await compressImage(raw[i], 100)
        out.push(f)
      } catch (_) { /* skip corrupted */ }
    }
    setPayImages(function (prev) { return prev.concat(out) })
    setPayImgBusy(false)
  }

  function removeImg(idx) {
    if (saving) return
    setPayImages(function (prev) { return prev.filter(function (_, i) { return i !== idx }) })
  }

  var cashBalPaise = (employee && employee.cash_balance_paise) || 0
  var bankBalPaise = (employee && employee.bank_balance_paise) || 0
  var currentModeBalance = mode === 'cash' ? cashBalPaise : mode === 'bank' ? bankBalPaise : 0

  var amtPaise = Math.round((Number(amountRupees) || 0) * 100)
  var adjPaise = showAdj ? Math.round((Number(adjRupees) || 0) * 100) : 0
  var totalSettlePaise = amtPaise + adjPaise
  var adjReasonFinal = adjReasonPreset === 'Other' ? adjReasonOther.trim() : adjReasonPreset

  async function submit() {
    if (saving) return
    setError('')

    if (!mode) { setError('Select cash or bank'); return }
    if (!isFinite(Number(amountRupees)) || Number(amountRupees) <= 0) { setError('Enter a valid amount'); return }
    if (showAdj) {
      if (Number(adjRupees) < 0) { setError('Adjustment must be >= 0'); return }
      if (adjPaise > 0 && !adjReasonFinal) { setError('Select or enter an adjustment reason'); return }
    }
    if (totalSettlePaise > currentModeBalance) {
      setError('Total (payment + adjustment) exceeds ' + mode + ' balance owed')
      return
    }
    if (mode === 'cash' && walletBalancePaise !== null && amtPaise > walletBalancePaise) {
      setError('Your wallet cash is insufficient — you have ' + formatPoints(walletBalancePaise) + ' pts')
      return
    }
    if (!payImages || payImages.length === 0) {
      setError('At least one payment proof image is required')
      return
    }
    if (!profile || !profile.id) {
      setError('Session error — please refresh')
      return
    }

    setSaving(true)

    // Upload proofs → collect paths. First segment must be profile.id for storage RLS.
    var clientUuid = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(36).slice(2, 10))
    var uploadedPaths = []
    for (var i = 0; i < payImages.length; i++) {
      var f = payImages[i]
      var path = profile.id + '/paypf_' + clientUuid + '_' + i + '.jpg'
      var up = await supabase.storage.from('receipts').upload(path, f, { upsert: true, contentType: 'image/jpeg' })
      if (up.error) {
        setError('Image ' + (i + 1) + ' upload failed: ' + (up.error.message || 'unknown'))
        setSaving(false)
        if (uploadedPaths.length > 0) {
          try { await supabase.storage.from('receipts').remove(uploadedPaths) } catch (_) {}
        }
        return
      }
      uploadedPaths.push(path)
    }

    var res = await supabase.rpc('pay_employee', {
      p_employee_id: employee.employee_id,
      p_amount_paise: amtPaise,
      p_mode: mode,
      p_date: payDate,
      p_adjustment_paise: adjPaise,
      p_adjustment_reason: adjPaise > 0 ? adjReasonFinal : null,
      p_image_paths: uploadedPaths
    })
    if (res.error) {
      setError(res.error.message || 'Payment failed')
      setSaving(false)
      try { await supabase.storage.from('receipts').remove(uploadedPaths) } catch (_) {}
      return
    }
    try {
      logActivity('SALARY_PAY',
        employee.employee_name + ' | ' + mode + ' | pay ' +
        (amtPaise / 100) + ' pts' +
        (adjPaise > 0 ? ' + adj ' + (adjPaise / 100) + ' (' + adjReasonFinal + ')' : '') +
        ' | ' + uploadedPaths.length + ' img')
    } catch (_) {}
    setSaving(false)
    onSuccess && onSuccess(res.data)
  }

  var modeOptions = [
    { v: 'cash', label: '💵 Cash', bal: cashBalPaise },
    { v: 'bank', label: '🏦 Bank', bal: bankBalPaise }
  ]

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={function () { if (!saving) onClose && onClose() }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto"
        onClick={function (ev) { ev.stopPropagation() }}>

        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">Pay Salary</h3>
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

        {/* Mode selector */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Pay Via <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            {modeOptions.map(function (opt) {
              var active = mode === opt.v
              var disabled = !!lockedMode && lockedMode !== opt.v
              return (
                <button key={opt.v} type="button"
                  disabled={disabled}
                  onClick={function () {
                    if (disabled) return
                    setMode(opt.v)
                    if (opt.bal > 0) setAmountRupees(String(opt.bal / 100))
                  }}
                  className={
                    'flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ' +
                    (active ? 'bg-indigo-600 text-white border-indigo-600'
                      : disabled ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
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

        {/* Bank-mode notice — no wallet debit */}
        {mode === 'bank' && (
          <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px]">
            ℹ️ Bank payout is a record-only entry. Your wallet will NOT be debited — the actual transfer is expected via the company bank account.
          </div>
        )}

        {/* Cash-mode wallet hint */}
        {mode === 'cash' && walletBalancePaise !== null && (
          <div className="text-[11px] text-gray-500">
            Your wallet cash: <span className="font-semibold text-gray-800">{formatPoints(walletBalancePaise)} pts</span>
          </div>
        )}

        {/* Amount */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Amount (pts) *</label>
          <input type="number" inputMode="decimal" value={amountRupees}
            onChange={function (ev) { setAmountRupees(ev.target.value) }}
            placeholder="0" min="0" step="any"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
        </div>

        {/* Payment date */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
          <input type="date" value={payDate}
            onChange={function (ev) { setPayDate(ev.target.value) }}
            max={new Date().toISOString().split('T')[0]}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
        </div>

        {/* Adjustment section (collapsed by default) */}
        <div className="border-t border-gray-100 pt-3">
          <button type="button"
            onClick={function () { setShowAdj(!showAdj); if (showAdj) { setAdjRupees(''); setAdjReasonPreset(''); setAdjReasonOther('') } }}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            {showAdj ? '− Hide adjustment' : '+ Add adjustment (LOP / advance / fine)'}
          </button>

          {showAdj && (
            <div className="mt-2 space-y-2 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Adjustment (pts)</label>
                <input type="number" inputMode="decimal" value={adjRupees}
                  onChange={function (ev) { setAdjRupees(ev.target.value) }}
                  placeholder="0" min="0" step="any"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reason *</label>
                <select value={adjReasonPreset}
                  onChange={function (ev) { setAdjReasonPreset(ev.target.value) }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                  style={{ fontSize: '16px' }}>
                  <option value="">— Select —</option>
                  {REASON_PRESETS.map(function (r) {
                    return <option key={r} value={r}>{r}</option>
                  })}
                </select>
              </div>
              {adjReasonPreset === 'Other' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Specify</label>
                  <input type="text" value={adjReasonOther}
                    onChange={function (ev) { setAdjReasonOther(ev.target.value) }}
                    placeholder="Adjustment reason..."
                    maxLength="200"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                    style={{ fontSize: '16px' }} />
                </div>
              )}
              <p className="text-[10px] text-gray-500">
                Adjustment reduces the balance owed. Does NOT touch wallet.
              </p>
            </div>
          )}
        </div>

        {/* Payment proof images */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Payment Proof <span className="text-red-500">*</span>
            <span className="text-[10px] font-normal text-gray-400 ml-1">(auto-compressed to &lt;100KB)</span>
          </label>
          <label className={"flex items-center justify-center gap-2 py-2.5 px-3 border-2 border-dashed rounded-lg text-sm font-medium cursor-pointer transition-colors " + (saving || payImgBusy ? "border-gray-200 text-gray-400 cursor-not-allowed" : "border-indigo-300 text-indigo-700 hover:bg-indigo-50")}>
            <input type="file" accept="image/*" capture="environment" multiple
              disabled={saving || payImgBusy}
              onChange={handleImgAdd}
              className="hidden" />
            {payImgBusy ? 'Compressing...' : ('📷 ' + (payImages.length === 0 ? 'Capture / choose images' : 'Add more'))}
          </label>
          {payImages.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-2">
              {payImages.map(function (f, i) {
                var url = URL.createObjectURL(f)
                return (
                  <div key={i} className="relative">
                    <img src={url} alt={'proof ' + (i + 1)} className="w-full h-20 object-cover rounded border border-gray-200" />
                    <button type="button" onClick={function () { removeImg(i) }} disabled={saving}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs font-bold flex items-center justify-center disabled:opacity-50">×</button>
                    <div className="text-[10px] text-gray-500 text-center mt-0.5">{Math.round(f.size / 1024)}KB</div>
                  </div>
                )
              })}
            </div>
          )}
          {payImages.length === 0 && (
            <p className="text-[11px] text-amber-700 mt-1">At least one image required to pay.</p>
          )}
        </div>

        {/* Summary */}
        {mode && (amtPaise > 0 || adjPaise > 0) && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 text-xs text-indigo-800">
            <div className="flex justify-between">
              <span>Pays</span>
              <span className="font-semibold">{formatPoints(amtPaise)} pts</span>
            </div>
            {adjPaise > 0 && (
              <div className="flex justify-between mt-0.5">
                <span>Adjusts</span>
                <span className="font-semibold">{formatPoints(adjPaise)} pts</span>
              </div>
            )}
            <div className="flex justify-between mt-1 pt-1 border-t border-indigo-200">
              <span className="font-semibold">Settles</span>
              <span className="font-bold">{formatPoints(totalSettlePaise)} pts</span>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={function () { if (!saving) onClose && onClose() }}
            disabled={saving}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Paying...' : 'Pay Salary'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PaySalaryModal