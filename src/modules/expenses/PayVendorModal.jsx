import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { compressImage } from '../../lib/imageCompress'
import VoiceInput from '../../components/ui/VoiceInput'

function PayVendorModal({ vendor, profile, onClose, onSuccess }) {
  var [payMode, setPayMode] = useState('')
  var [payAmount, setPayAmount] = useState('')
  var [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])
  var [payDescription, setPayDescription] = useState('Payment to ' + (vendor.vendor_name || ''))
  var [useDeduction, setUseDeduction] = useState(false)
  var [deductionAmount, setDeductionAmount] = useState('')
  var [deductionReason, setDeductionReason] = useState('')
  var [payImages, setPayImages] = useState([])
  var [payImgBusy, setPayImgBusy] = useState(false)
  var [dedImage, setDedImage] = useState(null)
  var [dedImgBusy, setDedImgBusy] = useState(false)
  var [paySaving, setPaySaving] = useState(false)
  var [payError, setPayError] = useState('')

  function chooseMode(mode, bal) {
    setPayMode(mode)
    if (bal > 0) setPayAmount(String(bal / 100))
  }

  async function handlePayImgAdd(ev) {
    if (paySaving) return
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

  function removePayImg(idx) {
    if (paySaving) return
    setPayImages(function (prev) { return prev.filter(function (_, i) { return i !== idx }) })
  }

  async function handleDedImgAdd(ev) {
    if (paySaving) return
    var raw = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!raw) return
    setDedImgBusy(true)
    try {
      var f = await compressImage(raw, 100)
      setDedImage(f)
    } catch (_) { /* skip corrupted */ }
    setDedImgBusy(false)
  }

  function removeDedImg() {
    if (paySaving) return
    setDedImage(null)
  }

  async function submitPayment() {
    if (paySaving) return
    if (!payMode) { setPayError('Select cash or bank'); return }
    var amtR = Number(payAmount || 0)
    if (!isFinite(amtR) || amtR <= 0) { setPayError('Enter a valid amount'); return }
    var dedR = 0
    var dedReason = ''
    if (useDeduction) {
      dedR = Number(deductionAmount || 0)
      if (!isFinite(dedR) || dedR < 0) { setPayError('Enter a valid deduction amount'); return }
      dedReason = (deductionReason || '').trim()
      if (dedR > 0 && !dedReason) { setPayError('Deduction reason required'); return }
    }
    if (!payImages || payImages.length === 0) { setPayError('At least one payment proof image is required'); return }
    if (!profile || !profile.id) { setPayError('Session error — please refresh'); return }

    setPaySaving(true)
    setPayError('')

    // Upload proofs → collect paths. First segment must be profile.id for storage RLS.
    var clientUuid = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(36).slice(2, 10))
    var uploadedPaths = []
    for (var i = 0; i < payImages.length; i++) {
      var f = payImages[i]
      var path = profile.id + '/paypf_' + clientUuid + '_' + i + '.jpg'
      var up = await supabase.storage.from('receipts').upload(path, f, { upsert: true, contentType: 'image/jpeg' })
      if (up.error) {
        setPayError('Image ' + (i + 1) + ' upload failed: ' + (up.error.message || 'unknown'))
        setPaySaving(false)
        // Cleanup successful uploads so far
        if (uploadedPaths.length > 0) {
          try { await supabase.storage.from('receipts').remove(uploadedPaths) } catch (_) {}
        }
        return
      }
      uploadedPaths.push(path)
    }

    // Optional deduction image — upload after payment proofs so it can piggyback the cleanup list
    var dedUploadedPath = null
    if (useDeduction && dedR > 0 && dedImage) {
      var dedPath = profile.id + '/paydeduct_' + clientUuid + '.jpg'
      var dedUp = await supabase.storage.from('receipts').upload(dedPath, dedImage, { upsert: true, contentType: 'image/jpeg' })
      if (dedUp.error) {
        setPayError('Deduction image upload failed: ' + (dedUp.error.message || 'unknown'))
        setPaySaving(false)
        try { await supabase.storage.from('receipts').remove(uploadedPaths) } catch (_) {}
        return
      }
      dedUploadedPath = dedPath
      uploadedPaths.push(dedPath)
    }

    var rpcArgs = {
      p_vendor_id: vendor.vendor_id,
      p_amount_paise: Math.round(amtR * 100),
      p_description: (payDescription || '').trim() || null,
      p_entry_date: payDate,
      p_mode: payMode,
      p_image_paths: uploadedPaths.filter(function (p) { return p !== dedUploadedPath })
    }
    if (useDeduction && dedR > 0) {
      rpcArgs.p_deduction_paise = Math.round(dedR * 100)
      rpcArgs.p_deduction_reason = dedReason
      if (dedUploadedPath) rpcArgs.p_deduction_image_path = dedUploadedPath
    }

    var { error } = await supabase.rpc('pay_vendor', rpcArgs)
    if (error) {
      setPayError(error.message || 'Payment failed')
      setPaySaving(false)
      try { await supabase.storage.from('receipts').remove(uploadedPaths) } catch (_) {}
      return
    }

    try { logActivity('VENDOR_PAY', (vendor.vendor_name || '') + ' | ' + amtR + ' pts | ' + uploadedPaths.length + ' img' + (dedUploadedPath ? ' (incl. dedn)' : '')) } catch (_) {}
    setPaySaving(false)
    if (onSuccess) onSuccess()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={function () { if (!paySaving) onClose() }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={function (ev) { ev.stopPropagation() }}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">Pay Vendor</h3>
          <button onClick={function () { if (!paySaving) onClose() }}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-500 -mt-2">{vendor.vendor_name}</p>

        {payError && (
          <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">{payError}</div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Pay Via <span className="text-red-500">*</span></label>
          <div className="flex gap-2">
            {[{ v: 'cash', label: '💵 Cash', bal: vendor.cash_balance_paise || 0 },
              { v: 'bank', label: '🏦 Bank', bal: vendor.bank_balance_paise || 0 }].map(function (opt) {
              var active = payMode === opt.v
              return (
                <button key={opt.v} type="button"
                  onClick={function () { chooseMode(opt.v, opt.bal) }}
                  className={"flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors " + (active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50")}>
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Amount (pts) <span className="text-red-500">*</span></label>
          <input type="number" inputMode="decimal" value={payAmount}
            onChange={function (ev) { setPayAmount(ev.target.value) }}
            placeholder="0" min="0" step="any"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
          <input type="date" value={payDate}
            onChange={function (ev) { setPayDate(ev.target.value) }}
            max={new Date().toISOString().split('T')[0]}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <VoiceInput type="text" value={payDescription}
            onChange={function (ev) { setPayDescription(ev.target.value) }}
            placeholder="Payment to vendor"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300" />
        </div>

        <div>
          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" checked={useDeduction}
              onChange={function (ev) { setUseDeduction(ev.target.checked); if (!ev.target.checked) { setDeductionAmount(''); setDeductionReason(''); setDedImage(null) } }} />
            Deduct from bill (discount / quality issue)
          </label>
          {useDeduction && (
            <div className="mt-2 space-y-2 pl-5 border-l-2 border-amber-200">
              <input type="number" inputMode="decimal" value={deductionAmount}
                onChange={function (ev) { setDeductionAmount(ev.target.value) }}
                placeholder="Deduction amount (pts)" min="0" step="any"
                className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-amber-50 focus:ring-2 focus:ring-amber-300"
                style={{ fontSize: '16px' }} />
              <VoiceInput type="text" value={deductionReason}
                onChange={function (ev) { setDeductionReason(ev.target.value) }}
                placeholder="Reason (required)"
                className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-amber-50 focus:ring-2 focus:ring-amber-300" />
              <div>
                <label className="block text-[11px] font-medium text-amber-800 mb-1">
                  Updated Bill / Deduction Proof
                  <span className="text-[10px] font-normal text-amber-600 ml-1">(optional)</span>
                </label>
                {dedImage ? (
                  <div className="relative inline-block">
                    <img src={URL.createObjectURL(dedImage)} alt="deduction proof" className="w-24 h-24 object-cover rounded border border-amber-300" />
                    <button type="button" onClick={removeDedImg} disabled={paySaving}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs font-bold flex items-center justify-center disabled:opacity-50">×</button>
                    <div className="text-[10px] text-amber-700 text-center mt-0.5">{Math.round(dedImage.size / 1024)}KB</div>
                  </div>
                ) : (
                  <label className={"flex items-center justify-center gap-2 py-2 px-3 border-2 border-dashed rounded-lg text-xs font-medium cursor-pointer transition-colors " + (paySaving || dedImgBusy ? "border-gray-200 text-gray-400 cursor-not-allowed" : "border-amber-300 text-amber-700 hover:bg-amber-100")}>
                    <input type="file" accept="image/*" capture="environment"
                      disabled={paySaving || dedImgBusy}
                      onChange={handleDedImgAdd}
                      className="hidden" />
                    {dedImgBusy ? 'Compressing...' : '📷 Attach updated bill'}
                  </label>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Payment Proof <span className="text-red-500">*</span>
            <span className="text-[10px] font-normal text-gray-400 ml-1">(auto-compressed to &lt;100KB)</span>
          </label>
          <label className={"flex items-center justify-center gap-2 py-2.5 px-3 border-2 border-dashed rounded-lg text-sm font-medium cursor-pointer transition-colors " + (paySaving || payImgBusy ? "border-gray-200 text-gray-400 cursor-not-allowed" : "border-indigo-300 text-indigo-700 hover:bg-indigo-50")}>
            <input type="file" accept="image/*" capture="environment" multiple
              disabled={paySaving || payImgBusy}
              onChange={handlePayImgAdd}
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
                    <button type="button" onClick={function () { removePayImg(i) }} disabled={paySaving}
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

        <div className="flex gap-2 pt-2">
          <button onClick={function () { if (!paySaving) onClose() }}
            disabled={paySaving}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submitPayment} disabled={paySaving}
            className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {paySaving ? 'Paying...' : 'Pay Vendor'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PayVendorModal