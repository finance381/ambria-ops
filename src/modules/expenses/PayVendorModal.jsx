import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'

var REASON_PRESETS = [
  'Poor quality',
  'Damaged goods',
  'Late delivery',
  'Negotiated discount',
  'Missing items',
  'Other'
]

function PayVendorModal({ vendor, lockedMode, onClose, onSuccess }) {
  var [amount, setAmount] = useState('')
  var [mode, setMode] = useState(lockedMode || '')
  var [date, setDate] = useState(new Date().toISOString().split('T')[0])
  var [description, setDescription] = useState('')
  var [addDeduction, setAddDeduction] = useState(false)
  var [dedAmount, setDedAmount] = useState('')
  var [dedReason, setDedReason] = useState('')
  var [dedReasonOther, setDedReasonOther] = useState('')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  useEffect(function () {
    if (!vendor) return
    setDescription('Payment to ' + (vendor.vendor_name || ''))
    setAmount('')
    setMode(lockedMode || '')
    setDate(new Date().toISOString().split('T')[0])
    setError('')
    setAddDeduction(false)
    setDedAmount('')
    setDedReason('')
    setDedReasonOther('')
  }, [vendor && vendor.vendor_id, lockedMode])

  if (!vendor) return null

  var cashBal = vendor.cash_balance_paise || 0
  var bankBal = vendor.bank_balance_paise || 0
  var modeBal = mode === 'cash' ? cashBal : (mode === 'bank' ? bankBal : 0)

  function selectMode(m) {
    if (lockedMode) return
    setMode(m)
    var bal = m === 'cash' ? cashBal : bankBal
    if (bal > 0 && !amount) setAmount(String(bal / 100))
  }

  async function submit() {
    if (saving) return
    if (!mode) { setError('Select cash or bank'); return }
    var amtR = Number(amount || 0)
    if (!isFinite(amtR) || amtR <= 0) { setError('Enter a valid amount'); return }

    var dedR = 0
    var dedReasonFinal = null
    if (addDeduction) {
      dedR = Number(dedAmount || 0)
      if (!isFinite(dedR) || dedR < 0) { setError('Deduction must be zero or more'); return }
      if (dedR > 0) {
        if (!dedReason) { setError('Select a deduction reason'); return }
        if (dedReason === 'Other') {
          var otherTrim = (dedReasonOther || '').trim()
          if (!otherTrim) { setError('Enter deduction reason'); return }
          dedReasonFinal = otherTrim
        } else {
          dedReasonFinal = dedReason
        }
      }
    }

    var totalPaise = Math.round(amtR * 100) + Math.round(dedR * 100)
    if (totalPaise > modeBal) {
      setError('Payment + deduction (' + (totalPaise / 100) + ') exceeds ' + mode + ' outstanding (' + (modeBal / 100) + ' pts)')
      return
    }

    setSaving(true)
    setError('')
    var { error: rpcErr } = await supabase.rpc('pay_vendor', {
      p_vendor_id: vendor.vendor_id,
      p_amount_paise: Math.round(amtR * 100),
      p_description: (description || '').trim() || null,
      p_entry_date: date,
      p_mode: mode,
      p_deduction_paise: Math.round(dedR * 100),
      p_deduction_reason: dedReasonFinal
    })
    if (rpcErr) {
      setError(rpcErr.message || 'Payment failed')
      setSaving(false)
      return
    }
    try {
      var logMsg = (vendor.vendor_name || '') + ' | ' + amtR + ' pts'
      if (dedR > 0) logMsg += ' | ded ' + dedR + ' pts (' + dedReasonFinal + ')'
      logActivity('VENDOR_PAY', logMsg)
    } catch (_) {}
    setSaving(false)
    if (onSuccess) onSuccess()
  }

  function close() {
    if (saving) return
    if (onClose) onClose()
  }

  var amtN = Number(amount || 0)
  var dedN = addDeduction ? Number(dedAmount || 0) : 0

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={close}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto"
        onClick={function (ev) { ev.stopPropagation() }}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">Pay Vendor</h3>
          <button onClick={close} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-500 -mt-2">{vendor.vendor_name}</p>

        {error && (
          <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">{error}</div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Pay Via <span className="text-red-500">*</span>
            {lockedMode && <span className="text-[10px] text-gray-400 ml-1">(locked)</span>}
          </label>
          <div className="flex gap-2">
            {[{ v: 'cash', label: '💵 Cash', bal: cashBal }, { v: 'bank', label: '🏦 Bank', bal: bankBal }].map(function (opt) {
              var active = mode === opt.v
              var disabled = lockedMode && lockedMode !== opt.v
              return (
                <button key={opt.v} type="button"
                  onClick={function () { selectMode(opt.v) }}
                  disabled={disabled}
                  className={"flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors " +
                    (active ? "bg-indigo-600 text-white border-indigo-600" :
                      (disabled ? "bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed" :
                        "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"))}>
                  <div>{opt.label}</div>
                  <div className={"text-[10px] font-normal mt-0.5 " + (active ? "text-indigo-100" : "text-gray-500")}>
                    Owed: {(opt.bal / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Amount (pts) *</label>
          <input type="number" inputMode="decimal" value={amount}
            onChange={function (ev) { setAmount(ev.target.value) }}
            placeholder="0" min="0" step="any"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
          <input type="date" value={date}
            onChange={function (ev) { setDate(ev.target.value) }}
            max={new Date().toISOString().split('T')[0]}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <input type="text" value={description}
            onChange={function (ev) { setDescription(ev.target.value) }}
            placeholder="Payment to vendor"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
        </div>

        <div className="border-t border-gray-100 pt-3">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
            <input type="checkbox" checked={addDeduction}
              onChange={function (ev) { setAddDeduction(ev.target.checked) }} />
            Deduct from bill (discount / quality issue)
          </label>
        </div>

        {addDeduction && (
          <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Deduction Amount (pts)</label>
              <input type="number" inputMode="decimal" value={dedAmount}
                onChange={function (ev) { setDedAmount(ev.target.value) }}
                placeholder="0" min="0" step="any"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300"
                style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <select value={dedReason}
                onChange={function (ev) { setDedReason(ev.target.value) }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300"
                style={{ fontSize: '16px' }}>
                <option value="">— Select reason —</option>
                {REASON_PRESETS.map(function (r) {
                  return <option key={r} value={r}>{r}</option>
                })}
              </select>
            </div>
            {dedReason === 'Other' && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Specify reason *</label>
                <input type="text" value={dedReasonOther}
                  onChange={function (ev) { setDedReasonOther(ev.target.value) }}
                  placeholder="Describe reason"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-300"
                  style={{ fontSize: '16px' }} />
              </div>
            )}
          </div>
        )}

        {mode && (amtN > 0 || dedN > 0) && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            Pays <span className="font-semibold">{amtN.toLocaleString('en-IN')}</span> ·
            Deducts <span className="font-semibold">{dedN.toLocaleString('en-IN')}</span> ·
            Settles <span className="font-semibold">{(amtN + dedN).toLocaleString('en-IN')}</span> pts
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={close} disabled={saving}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Paying...' : 'Pay Vendor'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PayVendorModal