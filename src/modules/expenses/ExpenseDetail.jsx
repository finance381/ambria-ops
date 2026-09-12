import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import VoiceInput from '../../components/ui/VoiceInput'
import Icon from '../../components/ui/Icon'

// Label left, value right, hairline between. A py-2 row plus a divider costs
// ~34px where the old space-y-3 pair cost ~44px, and the rule makes a long
// stack of facts scannable instead of soupy.
function Row({ label, value, money }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="shrink-0 text-[11.5px] font-medium text-slate-500">{label}</span>
      <span className={"min-w-0 text-right text-[13px] text-slate-900" + (money ? " font-semibold tabular-nums" : "")}>{value}</span>
    </div>
  )
}

function ExpenseDetail({ exp, profile, isAdmin, isDeptApprover, inAdmin, onBack, onUpdated, onEdit, onRaiseGV }) {
  var [saving, setSaving] = useState(false)
  var [rejectMode, setRejectMode] = useState(false)
  var [rejectReason, setRejectReason] = useState('')
  var [deductionAmount, setDeductionAmount] = useState('')
  var [deductionType, setDeductionType] = useState('')
  var [deductionTypes, setDeductionTypes] = useState([])
  var [showTypeSuggestions, setShowTypeSuggestions] = useState(false)
  var [deleteMode, setDeleteMode] = useState(false)
  var [deleteReason, setDeleteReason] = useState('')
  var [allocations, setAllocations] = useState([])
  var [allocVenues, setAllocVenues] = useState({})
  var [imgFullscreen, setImgFullscreen] = useState('')
  var [fullscreenIdx, setFullscreenIdx] = useState(-1)
  var [imgRotations, setImgRotations] = useState({})
  var [lookupLabels, setLookupLabels] = useState({})
  var [reviewerName, setReviewerName] = useState('')
  var [penalizerName, setPenalizerName] = useState('')
  var [acknowledgerName, setAcknowledgerName] = useState('')
  var [gvs, setGvs] = useState([])
  var [expandedGvId, setExpandedGvId] = useState('')
  var [reversing, setReversing] = useState(false)
  var [gvCreators, setGvCreators] = useState({})
  var refData = useReferenceData()

  useEffect(function () {
    supabase.from('expenses').select('deduction_type').not('deduction_type', 'is', null).neq('deduction_type', '')
      .then(function (res) {
        var unique = []
        var seen = {}
        ;(res.data || []).forEach(function (r) {
          var v = r.deduction_type
          if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = true; unique.push(v) }
        })
        unique.sort()
        setDeductionTypes(unique)
      })
  }, [])

  useEffect(function () {
    var ids = []
    if (exp.reviewed_by) ids.push(exp.reviewed_by)
    if (exp.penalized_by && ids.indexOf(exp.penalized_by) === -1) ids.push(exp.penalized_by)
    if (exp.acknowledged_by && ids.indexOf(exp.acknowledged_by) === -1) ids.push(exp.acknowledged_by)
    if (ids.length === 0) { setReviewerName(''); setPenalizerName(''); setAcknowledgerName(''); return }
    supabase.from('profiles').select('id, name').in('id', ids).then(function (res) {
      var map = {}
      ;(res.data || []).forEach(function (p) { map[p.id] = p.name || '' })
      setReviewerName(exp.reviewed_by ? (map[exp.reviewed_by] || '—') : '')
      setPenalizerName(exp.penalized_by ? (map[exp.penalized_by] || '—') : '')
      setAcknowledgerName(exp.acknowledged_by ? (map[exp.acknowledged_by] || '—') : '')
    })
  }, [exp.id, exp.reviewed_by, exp.penalized_by, exp.acknowledged_by])

  useEffect(function () {
    supabase.from('general_vouchers')
      .select('id, gv_number, expense_id, created_by, created_at, reason, before_allocations, after_allocations, before_fields, after_fields, is_reversal, reverses_gv_id, reversed_by_gv_id')
      .eq('expense_id', exp.id)
      .order('created_at', { ascending: false })
      .then(function (res) {
        var rows = res.data || []
        setGvs(rows)
        var creatorIds = []
        rows.forEach(function (g) { if (g.created_by && creatorIds.indexOf(g.created_by) === -1) creatorIds.push(g.created_by) })
        if (creatorIds.length > 0) {
          supabase.from('profiles').select('id, name').in('id', creatorIds).then(function (r2) {
            var map = {}
            ;(r2.data || []).forEach(function (p) { map[p.id] = p.name || '' })
            setGvCreators(map)
          })
        } else {
          setGvCreators({})
        }
      })
  }, [exp.id])

  useEffect(function () {
    var fields = (exp.expense_sub_types && exp.expense_sub_types.extra_fields) || []
    var meta = exp.metadata || {}
    var bySource = {}
    fields.forEach(function (f) {
      if (f.type !== 'lookup' || !f.source) return
      var v = meta[f.key]
      if (!v) return
      if (!bySource[f.source]) bySource[f.source] = []
      if (bySource[f.source].indexOf(v) === -1) bySource[f.source].push(v)
    })
    var sources = Object.keys(bySource)
    if (sources.length === 0) return
    Promise.all(sources.map(function (src) {
      var ids = bySource[src]
      if (src === 'job_departments') {
        var empIds = ids.map(String)
        var empRows = refData.employees.filter(function (e) { return empIds.indexOf(String(e.id)) !== -1 })
          .map(function (e) { return { id: String(e.id), label: e.full_name + ' (' + e.employee_code + ')' } })
        return Promise.resolve({ src: src, rows: empRows })
      }
      if (src === 'vendors') {
        return supabase.from('vendors').select('id, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (v) { return { id: String(v.id), label: v.name } }) } })
      }
      if (src === 'staff') {
        return supabase.from('profiles').select('id, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (p) { return { id: String(p.id), label: p.name || '—' } }) } })
      }
      if (src === 'categories') {
        return supabase.from('categories').select('id, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (c) { return { id: String(c.id), label: c.name } }) } })
      }
      if (src === 'venues') {
        var venueIds = ids.map(String)
        var venueRows = refData.venues.filter(function (v) { return venueIds.indexOf(String(v.id)) !== -1 })
          .map(function (v) { return { id: String(v.id), label: v.code + ' — ' + v.name } })
        return Promise.resolve({ src: src, rows: venueRows })
      }
      return Promise.resolve({ src: src, rows: [] })
    })).then(function (results) {
      var next = {}
      results.forEach(function (res) {
        res.rows.forEach(function (row) { next[res.src + ':' + row.id] = row.label })
      })
      setLookupLabels(next)
    }).catch(function () {})
  }, [exp.id])

  useEffect(function () {
    supabase.from('expense_allocations')
      .select('id, department, venue_id, sub_venue_id, amount_paise, department_id, expense_type_id, expense_sub_type_id, remarks, source')
      .eq('expense_id', exp.id)
      .then(function (res) {
        var rows = res.data || []
        setAllocations(rows)
        if (rows.length > 0) {
          var svIds = rows.map(function (r) { return r.sub_venue_id }).filter(Boolean)
          var dIds = rows.map(function (r) { return r.department_id }).filter(Boolean)
          Promise.all([
            svIds.length > 0 ? supabase.from('sub_venues').select('id, name').in('id', svIds) : { data: [] },
            dIds.length > 0 ? supabase.from('departments').select('id, name').in('id', dIds) : { data: [] },
          ]).then(function (results) {
            var map = {}
            refData.venues.forEach(function (v) { map['v_' + v.id] = v.code + ' — ' + v.name })
            refData.expenseTypes.forEach(function (et) { map['et_' + et.id] = et.name })
            refData.expenseSubTypes.forEach(function (est) { map['est_' + est.id] = est.name })
            ;(results[0].data || []).forEach(function (sv) { map['sv_' + sv.id] = sv.name })
            ;(results[1].data || []).forEach(function (d) { map['d_' + d.id] = d.name })
            setAllocVenues(map)
          })
        }
      })
  }, [exp.id])

  var isDeleted = !!exp.deleted_at
  var isAuditor = profile?.role === 'auditor'
  var canReview = !isDeleted && (isAdmin || isDeptApprover) && (exp.status === 'recorded' || exp.status === 'flagged') && exp.user_id !== profile?.id
  var canDelete = !isDeleted && ((exp.user_id === profile?.id && (exp.status === 'recorded' || exp.status === 'flagged')) || isAdmin)
  var canEdit = !isDeleted && exp.user_id === profile?.id && (exp.status === 'recorded' || exp.status === 'flagged')
  var canResubmit = !isDeleted && exp.user_id === profile?.id && exp.status === 'flagged'
  // GV rules:
  //  • recorded / flagged / deducted → admin OR anyone with finance_gv permission
  //  • acknowledged → admin OR auditor only (finance_gv perm not enough — locks stricter after ack)
  var canRaiseGV = !isDeleted && (
    (exp.status === 'acknowledged' && (isAdmin || isAuditor)) ||
    ((exp.status === 'recorded' || exp.status === 'flagged' || exp.status === 'deducted') && (isAdmin || hasPerm(profile?.permsNew, 'finance.gv')))
  )

  var receiptPaths = (exp.receipt_paths && exp.receipt_paths.length > 0)
    ? exp.receipt_paths
    : (exp.receipt_path ? [exp.receipt_path] : [])
  var [signedReceiptUrls, setSignedReceiptUrls] = useState({})
  var pathsKey = receiptPaths.join('|')
  useEffect(function () {
    if (receiptPaths.length === 0) return
    var cancelled = false
    Promise.all(receiptPaths.map(function (p) {
      return supabase.storage.from('receipts').createSignedUrl(p, 3600)
        .then(function (res) { return { path: p, url: res.data?.signedUrl || null } })
        .catch(function () { return { path: p, url: null } })
    })).then(function (results) {
      if (cancelled) return
      var m = {}
      results.forEach(function (r) { if (r.url) m[r.path] = r.url })
      setSignedReceiptUrls(m)
    })
    return function () { cancelled = true }
  }, [pathsKey])
  var receipts = receiptPaths.map(function (path) {
    return {
      path: path,
      url: signedReceiptUrls[path] || supabase.storage.from('receipts').getPublicUrl(path).data?.publicUrl,
      isVoice: /\.(webm|ogg|mp3|wav)$/i.test(path),
      isImage: /\.(jpg|jpeg|png|gif|webp)$/i.test(path)
    }
  })

  // Rotation is view-only (not persisted) — just for checking a wrong-orientation upload.
  function rotateImg(key, e) {
    if (e) e.stopPropagation()
    setImgRotations(function (prev) {
      var next = Object.assign({}, prev)
      next[key] = ((prev[key] || 0) + 90) % 360
      return next
    })
  }

  async function reverseGv(gv) {
    if (reversing) return
    var reason = window.prompt('Reason for reversing ' + gv.gv_number + '?')
    if (!reason || reason.trim().length < 3) return
    setReversing(true)
    var { data, error } = await supabase.rpc('fn_reverse_gv', { p_gv_id: gv.id, p_reason: reason.trim() })
    setReversing(false)
    if (error) { alert('Failed: ' + error.message); return }
    try { await logActivity({ action: 'gv_reverse', entity: 'expense', entity_id: exp.id, meta: { gv_number: data?.gv_number, reverses: gv.gv_number } }) } catch (e) {}
    if (onUpdated) onUpdated()
  }

  async function acknowledge() {
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'acknowledged',
      acknowledged_by: profile.id,
      acknowledged_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Acknowledge failed: ' + error.message); setSaving(false); return }
    // If acknowledging a flagged expense, re-debit wallet (was refunded on flag)
    if (exp.status === 'flagged') {
      try {
        await supabase.rpc('wallet_admin_debit', {
          p_user_id: exp.user_id,
          p_amount_paise: exp.amount_paise,
          p_description: 'Accepted: expense #' + exp.id + ' after flag',
          p_ref_type: 'expense',
          p_ref_id: String(exp.id),
        })
      } catch (_) {}
    }
    try { await logActivity('EXPENSE_ACKNOWLEDGE', (exp.description || 'Expense') + ' | ' + formatPoints(exp.amount_paise)) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function flag() {
    if (!rejectReason.trim()) return
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'flagged',
      flag_reason: rejectReason.trim(),
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Resubmit failed: ' + error.message); setSaving(false); return }
    if (exp.status === 'recorded') {
      try {
        await supabase.rpc('wallet_admin_credit', {
          p_user_id: exp.user_id,
          p_amount_paise: exp.amount_paise,
          p_description: 'Refund: flagged expense #' + exp.id,
          p_ref_type: 'expense_refund',
          p_ref_id: String(exp.id),
        })
      } catch (_) {}
    }
    try { await logActivity('EXPENSE_FLAG', (exp.description || 'Expense') + ' | Refund ' + formatPoints(exp.amount_paise) + ' | ' + rejectReason.trim()) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function deduct() {
    if (!rejectReason.trim() || !deductionAmount || Number(deductionAmount) <= 0) return
    if (saving) return
    setSaving(true)
    var deductionPaise = Math.round(Number(deductionAmount) * 100)
    var { error } = await supabase.from('expenses').update({
      status: 'deducted',
      flag_reason: rejectReason.trim(),
      deduction_type: deductionType.trim() || null,
      penalty_paise: deductionPaise,
      penalized_by: profile.id,
      penalized_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Deduction failed: ' + error.message); setSaving(false); return }
    // Salary ledger debit is written automatically by trg_expense_deduction_to_salary_ledger
    try { await logActivity('EXPENSE_DEDUCT', (exp.description || 'Expense') + ' | Deduction ' + formatPoints(deductionPaise) + ' | ' + rejectReason.trim()) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function resubmit() {
    if (saving) return
    if (!confirm('Resubmit this expense for review? ' + formatPoints(exp.amount_paise) + ' will be deducted from your wallet again.')) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'recorded',
      flag_reason: null,
      reviewed_by: null,
      reviewed_at: null,
    }).eq('id', exp.id)
    if (error) { alert('Resubmit failed: ' + error.message); setSaving(false); return }
    try {
      await supabase.rpc('wallet_self_debit', {
        p_amount_paise: exp.amount_paise,
        p_description: 'Resubmit: expense #' + exp.id,
        p_ref_type: 'expense',
        p_ref_id: String(exp.id),
      })
    } catch (_) {}
    try { await logActivity('EXPENSE_RESUBMIT', (exp.description || 'Expense') + ' | ' + formatPoints(exp.amount_paise)) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function deleteExp() {
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      deleted_at: new Date().toISOString(),
      deleted_by: profile.id,
      delete_reason: deleteReason.trim() || null,
    }).eq('id', exp.id)
    if (error) { alert('Delete failed: ' + error.message); setSaving(false); return }
    if (exp.status === 'recorded') {
      try {
        if (exp.user_id === profile?.id) {
          await supabase.rpc('wallet_self_credit', {
            p_amount_paise: exp.amount_paise,
            p_description: 'Refund: deleted expense',
            p_ref_type: 'expense_refund',
            p_ref_id: String(exp.id),
          })
        } else {
          await supabase.rpc('wallet_admin_credit', {
            p_user_id: exp.user_id,
            p_amount_paise: exp.amount_paise,
            p_description: 'Refund: deleted expense',
            p_ref_type: 'expense_refund',
            p_ref_id: String(exp.id),
          })
        }
      } catch (_) {}
    }
    try { await logActivity('EXPENSE_DELETE', (exp.description || 'Expense') + (deleteReason.trim() ? ' | ' + deleteReason.trim() : '')) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  return (
    <div className="@container space-y-3 pb-4">
      {/* The phone shell's header carries a back arrow, so this screen adds
          none there — the duplicate cost a whole row above the fold, and the
          amount should lead: it is the one fact you open this screen to
          check.

          The admin shell has no back arrow, only a breadcrumb, so there it
          has to provide its own or the screen is a dead end. */}
      {inAdmin && onBack && (
        <button type="button" onClick={onBack}
          className="inline-flex items-center gap-1.5 h-8 px-2 -ml-1 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-white hover:text-slate-900 transition-colors">
          <Icon name="arrowLeft" size={15} />
          Back to expenses
        </button>
      )}
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Total</p>
            <p className="mt-1 text-[26px] font-bold text-slate-900 tabular-nums leading-none tracking-[-0.02em]">
              {formatPoints(exp.amount_paise)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <span className={"text-[9.5px] font-bold uppercase tracking-[0.08em] px-2 py-1 rounded-full " + (APPROVAL_STATUS_COLORS[exp.status] || 'bg-slate-100 text-slate-600')}>
              {APPROVAL_STATUS_LABELS[exp.status] || exp.status}
            </span>
            {exp.status === 'acknowledged' && acknowledgerName && (
              <p className="text-[10px] text-slate-400 mt-1">
                By <span className="font-semibold text-slate-600">{acknowledgerName}</span>{exp.acknowledged_at ? ' · ' + formatDate(exp.acknowledged_at) : ''}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 text-[14px] font-semibold text-slate-900 leading-snug">{exp.description || 'Expense'}</p>
        <p className="mt-0.5 text-[11.5px] font-medium text-slate-500">
          {exp.profiles?.name || '—'} · {formatDate(exp.expense_date)}
        </p>
      </div>

      {exp.status === 'rejected' && exp.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs font-bold text-red-700 mb-0.5">Rejection Reason</p>
          <p className="text-sm text-red-600">{exp.rejection_reason}</p>
        </div>
      )}

      {isDeleted && (
        <div className="bg-slate-100 border border-slate-300 rounded-lg p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mb-0.5">
            <Icon name="trash" size={13} />
            Deleted by user
          </p>
          {exp.delete_reason && <p className="text-sm text-slate-600">{exp.delete_reason}</p>}
          <p className="text-[11px] text-slate-500 mt-1">
            {exp.deleted_at ? new Date(exp.deleted_at).toLocaleString() : ''}
          </p>
        </div>
      )}

      {(exp.status === 'flagged' || exp.status === 'deducted') && exp.flag_reason && (
        <div className={"border rounded-lg p-3 " + (exp.status === 'deducted' ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200")}>
          <p className={"flex items-center gap-1.5 text-xs font-bold mb-0.5 " + (exp.status === 'deducted' ? "text-red-700" : "text-amber-700")}>
            <Icon name={exp.status === 'deducted' ? 'banknote' : 'alert'} size={13} />
            {exp.status === 'deducted' ? 'Deducted' : 'Resubmit — Fix & Resend'}
          </p>
          <p className={"text-sm " + (exp.status === 'deducted' ? "text-red-600" : "text-amber-600")}>{exp.flag_reason}</p>
          {exp.deduction_type && (
            <p className="text-xs text-red-500 mt-1">Type: {exp.deduction_type}</p>
          )}
          {exp.penalty_paise > 0 && (
            <p className="text-sm font-bold text-red-700 mt-1">Deduction: {formatPoints(exp.penalty_paise)}</p>
          )}
          {exp.status === 'deducted' && penalizerName && (
            <p className="text-[11px] text-red-500 mt-1">
              By <span className="font-semibold">{penalizerName}</span>{exp.penalized_at ? ' · ' + formatDate(exp.penalized_at) : ''}
            </p>
          )}
          {exp.status === 'flagged' && reviewerName && (
            <p className="text-[11px] text-amber-600 mt-1">
              By <span className="font-semibold">{reviewerName}</span>{exp.reviewed_at ? ' · ' + formatDate(exp.reviewed_at) : ''}
            </p>
          )}
          {exp.status === 'flagged' && (
            <p className="text-[11px] text-amber-500 mt-1">Wallet refunded. Edit and resubmit, or delete this expense.</p>
          )}
        </div>
      )}

      <div className="space-y-4 @3xl:grid @3xl:grid-cols-12 @3xl:gap-5 @3xl:space-y-0 @3xl:items-start">
        <div className="@3xl:col-span-6">

      {receipts.length > 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">
              {receipts.length === 1 && receipts[0].isVoice ? '🎙 Voice Receipt' : (receipts.length > 1 ? '📎 Receipts (' + receipts.length + ')' : '📎 Receipt')}
            </p>
          </div>
          <div className="p-3 space-y-2">
            {receipts.map(function (r, rIdx) {
              if (r.isVoice) {
                return (
                  <div key={rIdx} className="space-y-1">
                    <audio controls preload="auto" className="w-full"
                      onLoadedMetadata={function (ev) {
                        // MediaRecorder WebM lacks proper cues → playback stops after first cluster (~3s).
                        // Force browser to scan the whole file to build a runtime seek index.
                        var a = ev.target
                        var fixed = false
                        function reset() {
                          if (fixed) return
                          fixed = true
                          try { a.currentTime = 0 } catch (_) {}
                          a.removeEventListener('timeupdate', reset)
                          a.removeEventListener('durationchange', reset)
                        }
                        try {
                          a.currentTime = 1e101
                          a.addEventListener('timeupdate', reset)
                          a.addEventListener('durationchange', reset)
                        } catch (_) {}
                      }}>
                      <source src={r.url} type="audio/webm" />
                      <source src={r.url} />
                      Your browser cannot play this audio.
                    </audio>
                    <a href={r.url} download target="_blank" rel="noopener noreferrer"
                      className="text-[10px] text-slate-500 hover:text-indigo-600 underline">
                      ⬇ Download if playback fails
                    </a>
                  </div>
                )
              }
              if (r.isImage) {
                return (
                  <div key={rIdx} className="relative">
                    <img
                      src={r.url} alt={"Receipt " + (rIdx + 1)}
                      onClick={function () { setImgFullscreen(r.url); setFullscreenIdx(rIdx) }}
                      style={{ transform: 'rotate(' + (imgRotations[r.path] || 0) + 'deg)', transition: 'transform 0.2s' }}
                      className="w-full max-h-64 @3xl:max-h-[520px] object-contain rounded-lg border border-slate-100 bg-slate-50 cursor-pointer active:opacity-80"
                    />
                    <button type="button" onClick={function (e) { rotateImg(r.path, e) }} title="Rotate" aria-label="Rotate receipt"
                      className="absolute top-2 right-2 w-8 h-8 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center">
                      <Icon name="refresh" size={15} />
                    </button>
                    {receipts.length === 1 && <p className="text-[10px] text-slate-500 text-center mt-1">Tap to enlarge</p>}
                  </div>
                )
              }
              return (
                <a key={rIdx} href={r.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
                  📎 View Attachment {receipts.length > 1 ? '#' + (rIdx + 1) : ''}
                </a>
              )
            })}
            {receipts.length > 1 && receipts.some(function (r) { return r.isImage }) && (
              <p className="text-[10px] text-slate-500 text-center pt-1">Tap any image to enlarge</p>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
          <span className="shrink-0 text-amber-600"><Icon name="alert" size={16} /></span>
          <p className="text-[13px] font-semibold text-amber-800">No receipt attached</p>
        </div>
      )}

      {imgFullscreen && createPortal((
        <div
          onClick={function () { setImgFullscreen(''); setFullscreenIdx(-1) }}
          className="fixed inset-0 z-[9998] bg-black/90 flex items-center justify-center p-4"
          style={{ margin: 0 }}
        >
          <button
            onClick={function () { setImgFullscreen(''); setFullscreenIdx(-1) }}
            aria-label="Close"
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/30"
          ><Icon name="close" size={20} /></button>
          <button
            onClick={function (e) { rotateImg(receipts[fullscreenIdx] ? receipts[fullscreenIdx].path : fullscreenIdx, e) }}
            title="Rotate" aria-label="Rotate receipt"
            className="absolute top-4 right-16 w-10 h-10 bg-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/30"
          ><Icon name="refresh" size={18} /></button>
          {(function () {
            var rotKey = receipts[fullscreenIdx] ? receipts[fullscreenIdx].path : fullscreenIdx
            var rot = imgRotations[rotKey] || 0
            var rotated90 = rot === 90 || rot === 270
            return (
              <img src={imgFullscreen} alt="Receipt"
                onClick={function (e) { e.stopPropagation() }}
                style={{
                  transform: 'rotate(' + rot + 'deg)',
                  transition: 'transform 0.2s',
                  maxWidth: rotated90 ? '85vh' : '100%',
                  maxHeight: rotated90 ? '85vw' : '100%',
                }}
                className="object-contain rounded-lg" />
            )
          })()}
        </div>
      ), document.body)}

        </div>
        <div className="@3xl:col-span-6 space-y-4">

      <div className="bg-white border border-slate-200 rounded-2xl px-4 divide-y divide-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        {/* Base and GST only earn their rows when there is actually tax to
            split out; the total already leads the screen. */}
        {(exp.tax_paise || 0) > 0 && (
          <Row label="Base" money value={formatPoints((exp.amount_paise || 0) - (exp.tax_paise || 0))} />
        )}
        {(exp.tax_paise || 0) > 0 && <Row label="GST" money value={formatPoints(exp.tax_paise)} />}
        <Row label="Date" value={formatDate(exp.expense_date)} />
        {exp.expense_types?.name && (
          <Row label="Type" value={exp.expense_types.name + (exp.expense_sub_types?.name ? ' › ' + exp.expense_sub_types.name : '')} />
        )}
        {exp.vendor_name && <Row label="Vendor" value={exp.vendor_name} />}
        {exp.travel_from && (
          <Row label="Travel" value={exp.travel_from + (exp.travel_to ? ' → ' + exp.travel_to : '') + (exp.travel_mode ? ' (' + exp.travel_mode + ')' : '')} />
        )}
        {exp.events?.event_name && <Row label="Event" value={exp.events.event_name} />}
        {exp.expense_sub_types?.extra_fields && exp.expense_sub_types.extra_fields.map(function (field) {
          var val = (exp.metadata && exp.metadata[field.key]) || exp[field.key] || null
          if (!val) return null
          var display = val
          if (field.type === 'lookup' && field.source) {
            display = lookupLabels[field.source + ':' + String(val)] || val
          }
          return <Row key={field.key} label={field.label} value={display} />
        })}
        <Row label="Submitted" value={exp.created_at ? formatDate(exp.created_at) : '—'} />
      </div>

      {(function () {
        var items = (exp.metadata && Array.isArray(exp.metadata.item_receipts)) ? exp.metadata.item_receipts : []
        if (items.length === 0) return null
        var itemsTotal = items.reduce(function (s, it) { return s + ((Number(it.qty) || 0) * (Number(it.rate_paise) || 0)) }, 0)
        return (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
            <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Items ({items.length})</p>
                {exp.item_receipt_status && (
                  <span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded " + (exp.item_receipt_status === 'received' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
                    {exp.item_receipt_status}
                  </span>
                )}
              </div>
              {itemsTotal > 0 && <p className="text-xs font-bold text-slate-700">{formatPoints(itemsTotal)}</p>}
            </div>
            <div className="divide-y divide-slate-100">
              {items.map(function (it, i) {
                var qty = Number(it.qty) || 0
                var rate = Number(it.rate_paise) || 0
                var subtotal = qty * rate
                return (
                  <div key={i} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{it.query || '—'}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-slate-500">{qty} {it.unit || ''}</span>
                          {rate > 0 && <span className="text-[11px] text-slate-500">× {formatPoints(rate)}</span>}
                          {it.matched_item_id && it.matched_source && (
                            <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                              {it.matched_source === 'catering_store' ? 'Catering match' : 'Inventory match'}
                            </span>
                          )}
                          {!it.matched_item_id && (
                            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">New item</span>
                          )}
                        </div>
                        {it.notes && (
                          <p className="text-[11px] text-slate-500 italic mt-0.5 truncate">"{it.notes}"</p>
                        )}
                      </div>
                      {subtotal > 0 && <span className="text-sm font-bold text-slate-900 shrink-0">{formatPoints(subtotal)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {(function () {
        var shownAllocations = allocations.filter(function (a) { return a.source !== 'auto_default' })
        if (shownAllocations.length === 0) return null
        return (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">Allocations</p>
            <p className="text-xs font-bold text-slate-700">{formatPoints(shownAllocations.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0))}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {shownAllocations.map(function (a) {
              var deptLabel = a.department_id && allocVenues['d_' + a.department_id] ? allocVenues['d_' + a.department_id] : a.department || '—'
              var typeLabel = a.expense_type_id && allocVenues['et_' + a.expense_type_id] ? allocVenues['et_' + a.expense_type_id] : null
              var subTypeLabel = a.expense_sub_type_id && allocVenues['est_' + a.expense_sub_type_id] ? allocVenues['est_' + a.expense_sub_type_id] : null
              var venueLabel = a.venue_id && allocVenues['v_' + a.venue_id] ? allocVenues['v_' + a.venue_id] : null
              var subVenueLabel = a.sub_venue_id && allocVenues['sv_' + a.sub_venue_id] ? allocVenues['sv_' + a.sub_venue_id] : null
              return (
                <div key={a.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">{deptLabel}</span>
                    {a.amount_paise > 0 && <span className="text-sm font-bold text-slate-900">{formatPoints(a.amount_paise)}</span>}
                  </div>
                  {(typeLabel || subTypeLabel) && (
                    <p className="text-[11px] text-indigo-600 font-medium mt-0.5">{typeLabel || '—'}{subTypeLabel ? ' › ' + subTypeLabel : ''}</p>
                  )}
                  {venueLabel && (
                    <p className="text-[11px] text-slate-500 mt-0.5">{venueLabel}{subVenueLabel ? ' › ' + subVenueLabel : ''}</p>
                  )}
                  {a.remarks && (
                    <p className="text-[11px] text-slate-500 italic mt-0.5">"{a.remarks}"</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        )
      })()}

      {gvs.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
          <div className="px-4 py-2 bg-purple-50 border-b border-purple-100">
            <p className="text-xs font-bold text-purple-700 uppercase tracking-wider">Journal Vouchers ({gvs.length})</p>
          </div>
          <div className="divide-y divide-slate-100">
            {gvs.map(function (gv, gvIdx) {
              var isNewest = gvIdx === 0
              var canReverse = canRaiseGV && isNewest && !gv.is_reversal && !gv.reversed_by_gv_id
              var creator = gvCreators[gv.created_by] || '—'
              var isExpanded = expandedGvId === gv.id
              return (
                <div key={gv.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={function () { setExpandedGvId(isExpanded ? '' : gv.id) }} className="flex-1 text-left">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
                        <span className="text-sm font-bold text-purple-800">{gv.gv_number}</span>
                        {gv.is_reversal && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">Reversal</span>
                        )}
                        {gv.reversed_by_gv_id && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700">Reversed</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{creator} · {formatDate(gv.created_at)}</p>
                      <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{gv.reason}</p>
                    </button>
                    {canReverse && (
                      <button onClick={function () { reverseGv(gv) }} disabled={reversing}
                        className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 hover:bg-red-100 disabled:opacity-50 flex-shrink-0">
                        ↺ Reverse
                      </button>
                    )}
                  </div>
                  {isExpanded && gv.before_fields && gv.after_fields && (
                    <div className="mt-3 bg-purple-50 border border-purple-200 rounded-lg overflow-hidden">
                      <div className="px-3 py-1.5 bg-purple-100 border-b border-purple-200">
                        <span className="text-[10px] font-bold text-purple-800 uppercase tracking-wider">📝 Parent expense field changes</span>
                      </div>
                      <div className="p-3 space-y-1.5">
                        {(function () {
                          var bf = gv.before_fields || {}
                          var af = gv.after_fields || {}
                          var rows = []
                          if (bf.expense_type_id !== af.expense_type_id) {
                            rows.push({ label: 'Expense Type', before: bf.expense_type_name || '—', after: af.expense_type_name || '—' })
                          }
                          if (bf.expense_sub_type_id !== af.expense_sub_type_id) {
                            rows.push({ label: 'Sub-Type', before: bf.expense_sub_type_name || '—', after: af.expense_sub_type_name || '—' })
                          }
                          if (rows.length === 0) return <p className="text-[11px] text-slate-500 italic">No visible field changes.</p>
                          return rows.map(function (r, ri) {
                            return (
                              <div key={ri} className="grid grid-cols-[70px_1fr_16px_1fr] gap-2 items-center text-[11px]">
                                <span className="font-bold text-slate-600 uppercase text-[10px]">{r.label}</span>
                                <span className="line-through text-slate-500 truncate">{r.before}</span>
                                <span className="text-purple-600 font-bold text-center">→</span>
                                <span className="font-semibold text-purple-800 truncate">{r.after}</span>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>
                  )}
                  {isExpanded && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[{ label: 'Before', arr: gv.before_allocations }, { label: 'After', arr: gv.after_allocations }].map(function (side) {
                        var rows = Array.isArray(side.arr) ? side.arr : []
                        return (
                          <div key={side.label} className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                            <div className="px-2 py-1 bg-slate-100 border-b border-slate-200">
                              <span className="text-[10px] font-bold text-slate-600 uppercase">{side.label}</span>
                            </div>
                            <div className="divide-y divide-slate-100">
                              {rows.length === 0 && <p className="p-2 text-[11px] text-slate-500 italic">—</p>}
                              {rows.map(function (r, ri) {
                                return (
                                  <div key={ri} className="px-2 py-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[12px] font-medium text-slate-800">{r.department || ('Dept #' + (r.department_id || '?'))}</span>
                                      <span className="text-[12px] font-bold text-slate-900">{formatPoints(r.amount_paise || 0)}</span>
                                    </div>
                                    {r.venue_id && (
                                      <p className="text-[10px] text-slate-500">Venue #{r.venue_id}{r.sub_venue_id ? ' › SV#' + r.sub_venue_id : ''}</p>
                                    )}
                                    {r.remarks && <p className="text-[10px] text-slate-500 italic">"{r.remarks}"</p>}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Decide */}
      {canReview && !rejectMode && (
        <div className="space-y-2">
          {exp.status === 'recorded' && (
            <button onClick={acknowledge} disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 transition-all">
              <Icon name="checkCircle" size={16} />
              {saving ? 'Saving...' : 'Acknowledge'}
            </button>
          )}
          <div className="flex gap-2">
            {exp.status === 'flagged' && (
              <button onClick={acknowledge} disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 transition-all">
                <Icon name="checkCircle" size={16} />
                {saving ? '...' : 'Accept'}
              </button>
            )}
            {exp.status !== 'flagged' && (
              <button onClick={function () { setRejectMode('flag') }} disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.99] disabled:opacity-50 transition-all">
                <Icon name="undo" size={15} />
                Send back
              </button>
            )}
            <button onClick={function () { setRejectMode('deduct') }} disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-[13px] font-semibold text-red-700 bg-white border border-red-200 rounded-xl hover:bg-red-50 active:scale-[0.99] disabled:opacity-50 transition-all">
              <Icon name="banknote" size={15} />
              Deduct
            </button>
          </div>
        </div>
      )}

      {/* Own it */}
      {canEdit && (
        <div className="flex gap-2">
          <button onClick={onEdit} disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.99] disabled:opacity-50 transition-all">
            <Icon name="edit" size={15} />
            Edit
          </button>
          {canResubmit && (
            <button onClick={resubmit} disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 transition-all">
              <Icon name="refresh" size={15} />
              {saving ? 'Submitting...' : 'Resubmit'}
            </button>
          )}
        </div>
      )}

      {/* Bookkeeping — a side errand, not a verdict on this expense */}
      {canRaiseGV && (
        <button onClick={onRaiseGV} disabled={saving}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-[12.5px] font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.99] disabled:opacity-50 transition-all">
          <Icon name="fileText" size={15} />
          Raise JV
        </button>
      )}

      {rejectMode && (
        <div className="space-y-3">
          <div className={"border rounded-xl p-3 " + (rejectMode === 'deduct' ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200")}>
            <label className={"block text-[11px] font-bold uppercase tracking-[0.08em] mb-1.5 " + (rejectMode === 'deduct' ? "text-red-700" : "text-amber-700")}>
              {rejectMode === 'deduct' ? 'Deduction reason' : 'Reason to send back'} <span className="text-red-500">*</span>
            </label>
            <textarea value={rejectReason}
              onChange={function (e) { setRejectReason(e.target.value) }}
              rows="3" maxLength="500" placeholder={rejectMode === 'deduct' ? 'Reason for deduction...' : 'What is the issue? User will see this.'}
              className={"w-full px-3 py-2.5 bg-white border rounded-xl text-[13px] text-slate-900 focus:outline-none focus:ring-2 resize-none " + (rejectMode === 'deduct' ? "border-red-300 focus:border-red-500 focus:ring-red-500/20" : "border-amber-300 focus:border-amber-500 focus:ring-amber-500/20")}
              style={{ fontSize: '16px' }} />
            {rejectMode === 'deduct' && (
              <div className="mt-2 relative">
                <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-red-700 mb-1.5">Deduction type</label>
                <input type="text" value={deductionType}
                  onChange={function (e) { setDeductionType(e.target.value); setShowTypeSuggestions(true) }}
                  onFocus={function () { setShowTypeSuggestions(true) }}
                  onBlur={function () { setTimeout(function () { setShowTypeSuggestions(false) }, 200) }}
                  placeholder="e.g. Late submission, Policy violation..."
                  className="w-full px-3 py-2.5 bg-white border border-red-300 rounded-xl text-[13px] text-slate-900 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  style={{ fontSize: '16px' }} />
                {showTypeSuggestions && deductionTypes.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {deductionTypes.filter(function (t) { return !deductionType || t.toLowerCase().indexOf(deductionType.toLowerCase()) !== -1 }).map(function (t) {
                      return (
                        <button key={t} type="button"
                          onMouseDown={function (e) { e.preventDefault(); setDeductionType(t); setShowTypeSuggestions(false) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-slate-700">
                          {t}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            {rejectMode === 'deduct' && (
              <div className="mt-2">
                <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-red-700 mb-1.5">Deduction amount (points) <span className="text-red-500">*</span></label>
                <input type="number" min="1" step="any" inputMode="decimal" value={deductionAmount}
                  onChange={function (e) { setDeductionAmount(e.target.value) }}
                  placeholder="0"
                  className="w-full px-3 py-2.5 bg-white border border-red-300 rounded-xl text-[13px] text-slate-900 tabular-nums focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                  style={{ fontSize: '16px' }} />
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={function () { setRejectMode(false); setRejectReason(''); setDeductionAmount(''); setDeductionType('') }}
              className="flex-1 py-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.99] transition-all">Cancel</button>
            {rejectMode === 'deduct' ? (
              <button onClick={deduct} disabled={saving || !rejectReason.trim() || !deductionAmount || Number(deductionAmount) <= 0}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 transition-all">
                <Icon name="banknote" size={15} />
                {saving ? 'Deducting...' : 'Confirm deduction'}
              </button>
            ) : (
              <button onClick={flag} disabled={saving || !rejectReason.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-white bg-amber-600 rounded-xl hover:bg-amber-700 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 transition-all">
                <Icon name="undo" size={15} />
                {saving ? 'Sending...' : 'Confirm send back'}
              </button>
            )}
          </div>
        </div>
      )}

      {canDelete && !deleteMode && (
        <div className="pt-2 border-t border-slate-200">
          <button onClick={function () { setDeleteMode(true) }} disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-[12.5px] font-semibold text-red-600 rounded-xl hover:bg-red-50 disabled:opacity-50 transition-colors">
            <Icon name="trash" size={14} />
            Delete expense
          </button>
        </div>
      )}

      {deleteMode && (
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-red-700 mb-1.5">Reason for deletion <span className="text-red-500">*</span></label>
            <VoiceInput as="textarea" value={deleteReason}
              onChange={function (e) { setDeleteReason(e.target.value) }}
              rows="2" maxLength="300" placeholder="Why is this expense being deleted..."
              className="w-full px-3 py-2.5 bg-white border border-red-300 rounded-xl text-[13px] text-slate-900 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 resize-none" />
          </div>
          <div className="flex gap-3">
            <button onClick={function () { setDeleteMode(false); setDeleteReason('') }}
              className="flex-1 py-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 active:scale-[0.99] transition-all">Cancel</button>
            <button onClick={deleteExp} disabled={saving || !deleteReason.trim()}
              className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 transition-all">
              <Icon name="trash" size={15} />
              {saving ? 'Deleting...' : 'Confirm delete'}
            </button>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  )
}

export default ExpenseDetail
