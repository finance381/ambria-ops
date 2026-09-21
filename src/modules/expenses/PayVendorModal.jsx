import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { compressImage } from '../../lib/imageCompress'
import { formatDate, formatPoints } from '../../lib/format'
import VoiceInput from '../../components/ui/VoiceInput'
import Icon from '../../components/ui/Icon'
import EventDatePicker from '../../components/ui/EventDatePicker'

// One label and one field for the whole form, so a row cannot drift out of
// line with the row above it — every field was writing its own px-3 py-2 and
// its own focus ring, and the deduction block a second set in amber.
var LABEL = 'block text-[12px] font-semibold text-slate-600 mb-1.5'
var FIELD = 'w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow'
// The two file buttons, and the pair inside the deduction block.
var PICK = 'h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-dashed text-[12.5px] font-bold cursor-pointer transition-colors'

function PayVendorModal({ vendor, profile, onClose, onSuccess }) {
  var [payMode, setPayMode] = useState('')
  var [payType, setPayType] = useState('')
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

  // Bills this vendor has been billed against — so a deduction/discount can be
  // credited back to whichever expense-type/department it actually belongs to,
  // split by that bill's own allocation ratio, instead of just vanishing from
  // what's owed to the vendor.
  var [sourceBills, setSourceBills] = useState([])
  var [sourceBillsLoading, setSourceBillsLoading] = useState(true)
  var [sourceExpenseId, setSourceExpenseId] = useState('')

  useEffect(function () {
    var cancelled = false
    setSourceBillsLoading(true)
    // Expenses don't carry a vendor_id column — the vendor↔expense link lives on
    // the ledger_entries row posted when the bill was recorded against the vendor
    // (ledger_type='vendor', ref_type='expense', ref_id=expense.id), same as VendorLedger.jsx.
    supabase.from('ledger_entries')
      .select('ref_id')
      .eq('ledger_type', 'vendor')
      .eq('party_id', vendor.vendor_id)
      .eq('ref_type', 'expense')
      .is('deleted_at', null)
      .limit(200)
      .then(async function (res) {
        if (cancelled) return
        var expIds = (res.data || [])
          .map(function (r) { return r.ref_id })
          .filter(function (id) { return /^[0-9]+$/.test(String(id)) })
          .map(Number)
        if (expIds.length === 0) { setSourceBills([]); setSourceBillsLoading(false); return }
        var { data: exps } = await supabase.from('expenses')
          .select('id, description, amount_paise, expense_date')
          .in('id', expIds)
          .is('deleted_at', null)
        if (cancelled) return
        var rows = (exps || []).slice().sort(function (a, b) { return (b.expense_date || '').localeCompare(a.expense_date || '') })
        setSourceBills(rows)
        setSourceBillsLoading(false)
      })
    return function () { cancelled = true }
  }, [vendor.vendor_id])

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
    if (!payType) { setPayError('Select payment type'); return }
    var amtR = Number(payAmount || 0)
    if (!isFinite(amtR) || amtR <= 0) { setPayError('Enter a valid amount'); return }
    var dedR = 0
    var dedReason = ''
    if (useDeduction) {
      dedR = Number(deductionAmount || 0)
      if (!isFinite(dedR) || dedR < 0) { setPayError('Enter a valid deduction amount'); return }
      dedReason = (deductionReason || '').trim()
      if (dedR > 0 && !dedReason) { setPayError('Deduction reason required'); return }
      if (dedR > 0 && sourceBills.length > 0 && !sourceExpenseId) { setPayError('Select which bill this deduction is against'); return }
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
      var fIsPdf = f.type === 'application/pdf'
      var path = profile.id + '/paypf_' + clientUuid + '_' + i + (fIsPdf ? '.pdf' : '.jpg')
      var up = await supabase.storage.from('receipts').upload(path, f, { upsert: true, contentType: fIsPdf ? 'application/pdf' : 'image/jpeg' })
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
      var dedIsPdf = dedImage.type === 'application/pdf'
      var dedPath = profile.id + '/paydeduct_' + clientUuid + (dedIsPdf ? '.pdf' : '.jpg')
      var dedUp = await supabase.storage.from('receipts').upload(dedPath, dedImage, { upsert: true, contentType: dedIsPdf ? 'application/pdf' : 'image/jpeg' })
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
      p_image_paths: uploadedPaths.filter(function (p) { return p !== dedUploadedPath }),
      p_payment_type: payType
    }
    if (useDeduction && dedR > 0) {
      rpcArgs.p_deduction_paise = Math.round(dedR * 100)
      rpcArgs.p_deduction_reason = dedReason
      if (dedUploadedPath) rpcArgs.p_deduction_image_path = dedUploadedPath
      if (sourceExpenseId) rpcArgs.p_source_expense_id = Number(sourceExpenseId)
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

  return createPortal((
    <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={function () { if (!paySaving) onClose() }}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto ambria-thin-scroll"
        onClick={function (ev) { ev.stopPropagation() }}>
        {/* Title and who it is about in one block, so the vendor's name is
            under the heading rather than pulled back up into it with -mt-2. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-[17px] font-bold text-slate-900">Pay Vendor</h3>
            <p className="mt-0.5 text-[12.5px] text-slate-500 truncate">{vendor.vendor_name}</p>
          </div>
          <button onClick={function () { if (!paySaving) onClose() }} aria-label="Close"
            className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <Icon name="close" size={16} />
          </button>
        </div>

        {payError && (
          <p className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[12.5px] font-semibold text-rose-700">
            <span className="shrink-0 mt-px"><Icon name="alert" size={14} /></span>
            {payError}
          </p>
        )}

        <div>
          <label className={LABEL}>Pay via <span className="text-rose-500">*</span></label>
          <div className="grid grid-cols-2 gap-2">
            {[{ v: 'cash', label: 'Cash', icon: 'banknote', bal: vendor.cash_balance_paise || 0 },
              { v: 'bank', label: 'Bank', icon: 'bank', bal: vendor.bank_balance_paise || 0 }].map(function (opt) {
              var active = payMode === opt.v
              return (
                <button key={opt.v} type="button" aria-pressed={active}
                  onClick={function () { chooseMode(opt.v, opt.bal) }}
                  className={"px-3 py-2.5 rounded-xl border text-left transition-colors " +
                    (active ? "bg-indigo-50 border-indigo-300" : "bg-white border-slate-300 hover:bg-slate-50")}>
                  <span className={"flex items-center gap-2 text-[13.5px] font-bold " + (active ? "text-indigo-700" : "text-slate-800")}>
                    <Icon name={opt.icon} size={15} className={active ? "text-indigo-500" : "text-slate-400"} />
                    {opt.label}
                  </span>
                  <span className={"block mt-0.5 text-[11.5px] tabular-nums " + (active ? "text-indigo-600" : "text-slate-500")} data-notranslate>
                    Owed: {(opt.bal / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} pts
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className={LABEL}>Payment type <span className="text-rose-500">*</span></label>
          <div className="relative">
            <select value={payType} onChange={function (ev) { setPayType(ev.target.value) }}
              className={FIELD + ' appearance-none pr-10'}
              style={{ fontSize: '16px' }}>
              <option value="">Select…</option>
              <option value="fnf">FNF (Full &amp; Final)</option>
              <option value="advance">Advance</option>
            </select>
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <Icon name="chevronDown" size={15} />
            </span>
          </div>
        </div>

        <div>
          <label className={LABEL}>Amount (pts) <span className="text-rose-500">*</span></label>
          <input type="number" inputMode="decimal" value={payAmount}
            onChange={function (ev) { setPayAmount(ev.target.value) }}
            placeholder="0" min="0" step="any"
            className={FIELD + ' tabular-nums'}
            style={{ fontSize: '16px' }} />
        </div>

        <div>
          <label className={LABEL}>Payment date</label>
          {/* The app's own picker. <input type="date"> renders mm/dd/yyyy in US
              order whatever the locale, which on a form where every other date
              on the screen reads "19 Sept 2026" is the one that looks wrong. */}
          <EventDatePicker value={payDate} placeholder="Payment date" collapsible includePast plain neutral
            onChange={function (v) { setPayDate(v) }} />
        </div>

        <div>
          <label className={LABEL}>Description</label>
          <VoiceInput type="text" value={payDescription}
            onChange={function (ev) { setPayDescription(ev.target.value) }}
            placeholder="Payment to vendor"
            className={FIELD} />
        </div>

        <div>
          <label className="flex items-center gap-2.5 text-[12.5px] font-medium text-slate-700 cursor-pointer">
            <input type="checkbox" checked={useDeduction}
              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
              onChange={function (ev) { setUseDeduction(ev.target.checked); if (!ev.target.checked) { setDeductionAmount(''); setDeductionReason(''); setDedImage(null) } }} />
            Deduct from bill (discount / quality issue)
          </label>
          {/* A card of its own rather than fields hanging off a rule. It is a
              form inside a form — four of its own questions — and on a tint it
              is clear where it starts and stops without an amber edge shouting
              about it. Its fields get real labels too: a placeholder is gone
              the moment you type into it, which is exactly when you want to
              check what you are filling in. */}
          {useDeduction && (
            <div className="mt-3 p-3.5 space-y-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div>
                <label className={LABEL}>Deduction amount (pts) <span className="text-rose-500">*</span></label>
                <input type="number" inputMode="decimal" value={deductionAmount}
                  onChange={function (ev) { setDeductionAmount(ev.target.value) }}
                  placeholder="0" min="0" step="any"
                  className={FIELD + ' tabular-nums'}
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
                <label className={LABEL}>Reason <span className="text-rose-500">*</span></label>
                <VoiceInput type="text" value={deductionReason}
                  onChange={function (ev) { setDeductionReason(ev.target.value) }}
                  placeholder="Why is this being deducted?"
                  className={FIELD} />
              </div>
              <div>
                <label className={LABEL}>
                  Which bill is this discount against?
                  {sourceBills.length === 0 && !sourceBillsLoading && <span className="ml-1 font-normal text-slate-400">(no bills found — the deduction will not be credited to an expense type)</span>}
                </label>
                {sourceBillsLoading ? (
                  <p className="text-[12.5px] text-slate-500">Loading bills…</p>
                ) : sourceBills.length > 0 ? (
                  <div className="relative">
                    <select value={sourceExpenseId} onChange={function (ev) { setSourceExpenseId(ev.target.value) }}
                      className={FIELD + ' appearance-none pr-10'}
                      style={{ fontSize: '16px' }}>
                      <option value="">Select bill…</option>
                      {sourceBills.map(function (b) {
                        return <option key={b.id} value={b.id}>{formatDate(b.expense_date)} — {b.description || 'Expense #' + b.id} ({formatPoints(b.amount_paise)})</option>
                      })}
                    </select>
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <Icon name="chevronDown" size={15} />
                    </span>
                  </div>
                ) : null}
              </div>
              <div>
                <label className={LABEL}>
                  Updated bill / deduction proof
                  <span className="ml-1 font-normal text-slate-400">(optional)</span>
                </label>
                {dedImage ? (
                  <div className="relative inline-block">
                    {dedImage.type === 'application/pdf' ? (
                      <a href={URL.createObjectURL(dedImage)} target="_blank" rel="noopener noreferrer"
                        className="w-24 h-24 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 px-1 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                        title="PDF — tap to view">
                        <Icon name="fileText" size={20} />
                        <span className="mt-1 text-[10px] truncate max-w-full">{dedImage.name}</span>
                      </a>
                    ) : (
                      <img src={URL.createObjectURL(dedImage)} alt="deduction proof" className="w-24 h-24 object-cover rounded-xl border border-slate-200" />
                    )}
                    <button type="button" onClick={removeDedImg} disabled={paySaving}
                      aria-label="Remove"
                      className="absolute -top-2 -right-2 w-6 h-6 bg-rose-600 text-white rounded-full inline-flex items-center justify-center shadow-sm hover:bg-rose-700 disabled:opacity-50 transition-colors">
                      <Icon name="close" size={12} strokeWidth={3} />
                    </button>
                    <div className="mt-1 text-[10px] text-slate-500 text-center tabular-nums">{Math.round(dedImage.size / 1024)}KB</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <label className={PICK + ' ' + (paySaving || dedImgBusy ? "border-slate-200 text-slate-400 cursor-not-allowed" : "border-slate-300 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50")}>
                      <input type="file" accept="image/*" capture="environment"
                        disabled={paySaving || dedImgBusy}
                        onChange={handleDedImgAdd}
                        className="hidden" />
                      <Icon name={dedImgBusy ? 'refresh' : 'camera'} size={15} />
                      {dedImgBusy ? 'Compressing…' : 'Take photo'}
                    </label>
                    <label className={PICK + ' ' + (paySaving || dedImgBusy ? "border-slate-200 text-slate-400 cursor-not-allowed" : "border-slate-300 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50")}>
                      <input type="file" accept="image/*,.pdf"
                        disabled={paySaving || dedImgBusy}
                        onChange={handleDedImgAdd}
                        className="hidden" />
                      <Icon name={dedImgBusy ? 'refresh' : 'paperclip'} size={15} />
                      {dedImgBusy ? 'Compressing…' : 'Upload file'}
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <label className={LABEL}>
            Payment proof <span className="text-rose-500">*</span>
            <span className="ml-1 font-normal text-slate-400">(auto-compressed to &lt;100KB)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={PICK + ' ' + (paySaving || payImgBusy ? "border-slate-200 text-slate-400 cursor-not-allowed" : "border-slate-300 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50")}>
              <input type="file" accept="image/*" capture="environment" multiple
                disabled={paySaving || payImgBusy}
                onChange={handlePayImgAdd}
                className="hidden" />
              <Icon name={payImgBusy ? 'refresh' : 'camera'} size={15} />
              {payImgBusy ? 'Compressing…' : 'Take photo'}
            </label>
            <label className={PICK + ' ' + (paySaving || payImgBusy ? "border-slate-200 text-slate-400 cursor-not-allowed" : "border-slate-300 text-slate-700 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50")}>
              <input type="file" accept="image/*,.pdf" multiple
                disabled={paySaving || payImgBusy}
                onChange={handlePayImgAdd}
                className="hidden" />
              <Icon name={payImgBusy ? 'refresh' : 'paperclip'} size={15} />
              {payImgBusy ? 'Compressing…' : 'Upload file'}
            </label>
          </div>
          {payImages.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-2">
              {payImages.map(function (f, i) {
                var url = URL.createObjectURL(f)
                var isPdf = f.type === 'application/pdf'
                return (
                  <div key={i} className="relative">
                    {isPdf ? (
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="h-20 w-full rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-500 px-1 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                        title="PDF — tap to view">
                        <Icon name="fileText" size={20} />
                        <span className="mt-1 text-[10px] truncate max-w-full">{f.name}</span>
                      </a>
                    ) : (
                      <img src={url} alt={'proof ' + (i + 1)} className="w-full h-20 object-cover rounded-xl border border-slate-200" />
                    )}
                    <button type="button" onClick={function () { removePayImg(i) }} disabled={paySaving}
                      aria-label="Remove"
                      className="absolute -top-2 -right-2 w-6 h-6 bg-rose-600 text-white rounded-full inline-flex items-center justify-center shadow-sm hover:bg-rose-700 disabled:opacity-50 transition-colors">
                      <Icon name="close" size={12} strokeWidth={3} />
                    </button>
                    <div className="mt-1 text-[10px] text-slate-500 text-center tabular-nums">{Math.round(f.size / 1024)}KB</div>
                  </div>
                )
              })}
            </div>
          )}
          {payImages.length === 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700">
              <Icon name="alert" size={13} className="shrink-0" />
              At least one proof (image or PDF) is required to pay.
            </p>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={function () { if (!paySaving) onClose() }}
            disabled={paySaving}
            className="flex-1 h-11 text-[13px] font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-40 transition-colors">
            Cancel
          </button>
          <button onClick={submitPayment} disabled={paySaving}
            className="flex-1 h-11 inline-flex items-center justify-center gap-2 text-[13px] font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-40 transition-all">
            <Icon name={paySaving ? 'refresh' : 'banknote'} size={15} />
            {paySaving ? 'Paying…' : 'Pay Vendor'}
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}

export default PayVendorModal