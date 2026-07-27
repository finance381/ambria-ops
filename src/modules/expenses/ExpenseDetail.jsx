import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'

function ExpenseDetail({ exp, profile, isAdmin, isDeptApprover, onBack, onUpdated, onEdit }) {
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
  var [lookupLabels, setLookupLabels] = useState({})
  var [reviewerName, setReviewerName] = useState('')
  var [penalizerName, setPenalizerName] = useState('')

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
    if (ids.length === 0) { setReviewerName(''); setPenalizerName(''); return }
    supabase.from('profiles').select('id, name').in('id', ids).then(function (res) {
      var map = {}
      ;(res.data || []).forEach(function (p) { map[p.id] = p.name || '' })
      setReviewerName(exp.reviewed_by ? (map[exp.reviewed_by] || '—') : '')
      setPenalizerName(exp.penalized_by ? (map[exp.penalized_by] || '—') : '')
    })
  }, [exp.id, exp.reviewed_by, exp.penalized_by])

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
        return supabase.from('employees').select('id, full_name, employee_code').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (e) { return { id: String(e.id), label: e.full_name + ' (' + e.employee_code + ')' } }) } })
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
        return supabase.from('venues').select('id, code, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (v) { return { id: String(v.id), label: v.code + ' — ' + v.name } }) } })
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
      .select('id, department, venue_id, sub_venue_id, amount_paise, department_id, expense_type_id, expense_sub_type_id, remarks')
      .eq('expense_id', exp.id)
      .then(function (res) {
        var rows = res.data || []
        setAllocations(rows)
        if (rows.length > 0) {
          var vIds = rows.map(function (r) { return r.venue_id }).filter(Boolean)
          var svIds = rows.map(function (r) { return r.sub_venue_id }).filter(Boolean)
          var dIds = rows.map(function (r) { return r.department_id }).filter(Boolean)
          var etIds = rows.map(function (r) { return r.expense_type_id }).filter(Boolean)
          var estIds = rows.map(function (r) { return r.expense_sub_type_id }).filter(Boolean)
          Promise.all([
            vIds.length > 0 ? supabase.from('venues').select('id, code, name').in('id', vIds) : { data: [] },
            svIds.length > 0 ? supabase.from('sub_venues').select('id, name').in('id', svIds) : { data: [] },
            dIds.length > 0 ? supabase.from('departments').select('id, name').in('id', dIds) : { data: [] },
            etIds.length > 0 ? supabase.from('expense_types').select('id, name').in('id', etIds) : { data: [] },
            estIds.length > 0 ? supabase.from('expense_sub_types').select('id, name').in('id', estIds) : { data: [] }
          ]).then(function (results) {
            var map = {}
            ;(results[0].data || []).forEach(function (v) { map['v_' + v.id] = v.code + ' — ' + v.name })
            ;(results[1].data || []).forEach(function (sv) { map['sv_' + sv.id] = sv.name })
            ;(results[2].data || []).forEach(function (d) { map['d_' + d.id] = d.name })
            ;(results[3].data || []).forEach(function (et) { map['et_' + et.id] = et.name })
            ;(results[4].data || []).forEach(function (est) { map['est_' + est.id] = est.name })
            setAllocVenues(map)
          })
        }
      })
  }, [exp.id])

  var isDeleted = !!exp.deleted_at
  var canReview = !isDeleted && (isAdmin || isDeptApprover) && (exp.status === 'recorded' || exp.status === 'flagged') && exp.user_id !== profile?.id
  var canDelete = !isDeleted && ((exp.user_id === profile?.id && (exp.status === 'recorded' || exp.status === 'flagged')) || isAdmin)
  var canEdit = !isDeleted && (exp.user_id === profile?.id || isAdmin) && (exp.status === 'recorded' || exp.status === 'flagged')
  var canResubmit = !isDeleted && exp.user_id === profile?.id && exp.status === 'flagged'

  var receiptPaths = (exp.receipt_paths && exp.receipt_paths.length > 0)
    ? exp.receipt_paths
    : (exp.receipt_path ? [exp.receipt_path] : [])
  var receipts = receiptPaths.map(function (path) {
    return {
      path: path,
      url: supabase.storage.from('receipts').getPublicUrl(path).data?.publicUrl,
      isVoice: /\.(webm|ogg|mp3|wav)$/i.test(path),
      isImage: /\.(jpg|jpeg|png|gif|webp)$/i.test(path)
    }
  })

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
    if (error) { alert('Flag failed: ' + error.message); setSaving(false); return }
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
    var { error: debitErr } = await supabase.rpc('wallet_admin_debit', {
      p_user_id: exp.user_id,
      p_amount_paise: deductionPaise,
      p_description: 'Deduction: ' + rejectReason.trim().slice(0, 80),
      p_ref_type: 'expense_deduction',
      p_ref_id: String(exp.id),
    })
    if (debitErr) alert('Deduction failed: ' + debitErr.message)
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
    <div className="@container space-y-4">
      <div>
        <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-2">← Back</button>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{exp.description || 'Expense'}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {exp.profiles?.name || '—'} · {formatDate(exp.expense_date)}
            </p>
          </div>
          <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (APPROVAL_STATUS_COLORS[exp.status] || 'bg-gray-100 text-gray-600')}>
            {APPROVAL_STATUS_LABELS[exp.status] || exp.status}
          </span>
        </div>
      </div>

      {exp.status === 'rejected' && exp.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs font-bold text-red-700 mb-0.5">Rejection Reason</p>
          <p className="text-sm text-red-600">{exp.rejection_reason}</p>
        </div>
      )}

      {isDeleted && (
        <div className="bg-gray-100 border border-gray-300 rounded-lg p-3">
          <p className="text-xs font-bold text-gray-700 mb-0.5">🗑 Deleted by user</p>
          {exp.delete_reason && <p className="text-sm text-gray-600">{exp.delete_reason}</p>}
          <p className="text-[11px] text-gray-500 mt-1">
            {exp.deleted_at ? new Date(exp.deleted_at).toLocaleString() : ''}
          </p>
        </div>
      )}

      {(exp.status === 'flagged' || exp.status === 'deducted') && exp.flag_reason && (
        <div className={"border rounded-lg p-3 " + (exp.status === 'deducted' ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200")}>
          <p className={"text-xs font-bold mb-0.5 " + (exp.status === 'deducted' ? "text-red-700" : "text-amber-700")}>
            {exp.status === 'deducted' ? '💰 Deducted' : '⚠ Flagged — Fix & Resubmit'}
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
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              {receipts.length === 1 && receipts[0].isVoice ? '🎙 Voice Receipt' : (receipts.length > 1 ? '📎 Receipts (' + receipts.length + ')' : '📎 Receipt')}
            </p>
          </div>
          <div className="p-3 space-y-2">
            {receipts.map(function (r, rIdx) {
              if (r.isVoice) {
                return <audio key={rIdx} src={r.url} controls className="w-full" />
              }
              if (r.isImage) {
                return (
                  <div key={rIdx}>
                    <img
                      src={r.url} alt={"Receipt " + (rIdx + 1)}
                      onClick={function () { setImgFullscreen(r.url) }}
                      className="w-full max-h-64 @3xl:max-h-[520px] object-contain rounded-lg border border-gray-100 bg-gray-50 cursor-pointer active:opacity-80"
                    />
                    {receipts.length === 1 && <p className="text-[10px] text-gray-400 text-center mt-1">Tap to enlarge</p>}
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
              <p className="text-[10px] text-gray-400 text-center pt-1">Tap any image to enlarge</p>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
          <span className="text-amber-500 text-lg">⚠</span>
          <p className="text-sm text-amber-700 font-medium">No receipt attached</p>
        </div>
      )}

      {imgFullscreen && (
        <div
          onClick={function () { setImgFullscreen('') }}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          style={{ margin: 0 }}
        >
          <button
            onClick={function () { setImgFullscreen('') }}
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 text-white rounded-full text-xl flex items-center justify-center hover:bg-white/30"
          >✕</button>
          <img src={imgFullscreen} alt="Receipt" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}

        </div>
        <div className="@3xl:col-span-6 space-y-4">

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Amount</span>
          <span className="text-sm font-bold text-gray-900">{formatPoints(exp.amount_paise)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Date</span>
          <span className="text-sm text-gray-800">{formatDate(exp.expense_date)}</span>
        </div>
        {exp.expense_types?.name && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Type</span>
            <span className="text-sm text-gray-800">{exp.expense_types.name}{exp.expense_sub_types?.name ? ' > ' + exp.expense_sub_types.name : ''}</span>
          </div>
        )}
        {exp.vendor_name && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Vendor</span>
            <span className="text-sm text-gray-800">{exp.vendor_name}</span>
          </div>
        )}
        {exp.travel_from && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Travel</span>
            <span className="text-sm text-gray-800">{exp.travel_from}{exp.travel_to ? ' → ' + exp.travel_to : ''}{exp.travel_mode ? ' (' + exp.travel_mode + ')' : ''}</span>
          </div>
        )}
        {exp.events?.event_name && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Event</span>
            <span className="text-sm text-gray-800">{exp.events.event_name}</span>
          </div>
        )}
        {exp.expense_sub_types?.extra_fields && exp.expense_sub_types.extra_fields.map(function (field) {
          var val = (exp.metadata && exp.metadata[field.key]) || exp[field.key] || null
          if (!val) return null
          var display = val
          if (field.type === 'lookup' && field.source) {
            display = lookupLabels[field.source + ':' + String(val)] || val
          }
          return (
            <div key={field.key} className="flex justify-between">
              <span className="text-sm text-gray-500">{field.label}</span>
              <span className="text-sm text-gray-800">{display}</span>
            </div>
          )
        })}
        {exp.tax_paise > 0 && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Tax</span>
            <span className="text-sm text-gray-800">{formatPoints(exp.tax_paise)}</span>
          </div>
        )}
        {exp.description && (
          <div className="border-t border-gray-100 pt-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Description</span>
            <p className="text-sm text-gray-800 mt-1">{exp.description}</p>
          </div>
        )}
        <div className="border-t border-gray-100 pt-2">
          <p className="text-[10px] text-gray-400">Submitted {exp.created_at ? formatDate(exp.created_at) : '—'}</p>
        </div>
      </div>

      {allocations.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Allocations</p>
            <p className="text-xs font-bold text-gray-700">{formatPoints(allocations.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0))}</p>
          </div>
          <div className="divide-y divide-gray-100">
            {allocations.map(function (a) {
              var deptLabel = a.department_id && allocVenues['d_' + a.department_id] ? allocVenues['d_' + a.department_id] : a.department || '—'
              var typeLabel = a.expense_type_id && allocVenues['et_' + a.expense_type_id] ? allocVenues['et_' + a.expense_type_id] : null
              var subTypeLabel = a.expense_sub_type_id && allocVenues['est_' + a.expense_sub_type_id] ? allocVenues['est_' + a.expense_sub_type_id] : null
              var venueLabel = a.venue_id && allocVenues['v_' + a.venue_id] ? allocVenues['v_' + a.venue_id] : null
              var subVenueLabel = a.sub_venue_id && allocVenues['sv_' + a.sub_venue_id] ? allocVenues['sv_' + a.sub_venue_id] : null
              return (
                <div key={a.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{deptLabel}</span>
                    {a.amount_paise > 0 && <span className="text-sm font-bold text-gray-900">{formatPoints(a.amount_paise)}</span>}
                  </div>
                  {(typeLabel || subTypeLabel) && (
                    <p className="text-[11px] text-indigo-600 font-medium mt-0.5">{typeLabel || '—'}{subTypeLabel ? ' › ' + subTypeLabel : ''}</p>
                  )}
                  {venueLabel && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{venueLabel}{subVenueLabel ? ' › ' + subVenueLabel : ''}</p>
                  )}
                  {a.remarks && (
                    <p className="text-[11px] text-gray-500 italic mt-0.5">"{a.remarks}"</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="flex gap-2">
          <button onClick={onEdit} disabled={saving}
            className="flex-1 py-3 text-sm font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
            ✎ Edit Expense
          </button>
          {canResubmit && (
            <button onClick={resubmit} disabled={saving}
              className="flex-1 py-3 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
              {saving ? 'Submitting...' : '↻ Resubmit'}
            </button>
          )}
        </div>
      )}

      {canReview && !rejectMode && (
        <div className="space-y-2">
          {exp.status === 'recorded' && (
            <button onClick={acknowledge} disabled={saving}
              className="w-full py-3 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : '✓ Acknowledge'}
            </button>
          )}
          <div className="flex gap-2">
            {exp.status !== 'flagged' && (
              <button onClick={function () { setRejectMode('flag') }} disabled={saving}
                className="flex-1 py-3 text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors">
                ⚠ Flag
              </button>
            )}
            <button onClick={function () { setRejectMode('deduct') }} disabled={saving}
              className="flex-1 py-3 text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
              💰 Deduct
            </button>
            {exp.status === 'flagged' && (
              <button onClick={acknowledge} disabled={saving}
                className="flex-1 py-3 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                {saving ? '...' : '✓ Accept'}
              </button>
            )}
          </div>
        </div>
      )}

      {rejectMode && (
        <div className="space-y-3">
          <div className={"border rounded-lg p-3 " + (rejectMode === 'deduct' ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200")}>
            <label className={"block text-sm font-medium mb-1 " + (rejectMode === 'deduct' ? "text-red-700" : "text-amber-700")}>
              {rejectMode === 'deduct' ? 'Deduction Reason' : 'Flag Reason'} <span className="text-red-500">*</span>
            </label>
            <textarea value={rejectReason}
              onChange={function (e) { setRejectReason(e.target.value) }}
              rows="3" maxLength="500" placeholder={rejectMode === 'deduct' ? 'Reason for deduction...' : 'What is the issue? User will see this.'}
              className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 resize-none " + (rejectMode === 'deduct' ? "border-red-300 focus:ring-red-500" : "border-amber-300 focus:ring-amber-500")}
              style={{ fontSize: '16px' }} />
            {rejectMode === 'deduct' && (
              <div className="mt-2 relative">
                <label className="block text-sm font-medium text-red-700 mb-1">Deduction Type</label>
                <input type="text" value={deductionType}
                  onChange={function (e) { setDeductionType(e.target.value); setShowTypeSuggestions(true) }}
                  onFocus={function () { setShowTypeSuggestions(true) }}
                  onBlur={function () { setTimeout(function () { setShowTypeSuggestions(false) }, 200) }}
                  placeholder="e.g. Late submission, Policy violation..."
                  className="w-full px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  style={{ fontSize: '16px' }} />
                {showTypeSuggestions && deductionTypes.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {deductionTypes.filter(function (t) { return !deductionType || t.toLowerCase().indexOf(deductionType.toLowerCase()) !== -1 }).map(function (t) {
                      return (
                        <button key={t} type="button"
                          onMouseDown={function (e) { e.preventDefault(); setDeductionType(t); setShowTypeSuggestions(false) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-red-50 text-gray-700">
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
                <label className="block text-sm font-medium text-red-700 mb-1">Deduction Amount (Points) <span className="text-red-500">*</span></label>
                <input type="number" min="1" step="any" inputMode="decimal" value={deductionAmount}
                  onChange={function (e) { setDeductionAmount(e.target.value) }}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  style={{ fontSize: '16px' }} />
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={function () { setRejectMode(false); setRejectReason(''); setDeductionAmount(''); setDeductionType('') }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
            {rejectMode === 'deduct' ? (
              <button onClick={deduct} disabled={saving || !rejectReason.trim() || !deductionAmount || Number(deductionAmount) <= 0}
                className="flex-1 py-3 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Deducting...' : '💰 Confirm Deduction'}
              </button>
            ) : (
              <button onClick={flag} disabled={saving || !rejectReason.trim()}
                className="flex-1 py-3 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Flagging...' : '⚠ Confirm Flag'}
              </button>
            )}
          </div>
        </div>
      )}

      {canDelete && !deleteMode && (
        <button onClick={function () { setDeleteMode(true) }} disabled={saving}
          className="w-full py-3 text-sm font-bold text-red-500 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
          Delete Expense
        </button>
      )}

      {deleteMode && (
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <label className="block text-sm font-medium text-red-700 mb-1">Reason for Deletion <span className="text-red-500">*</span></label>
            <textarea value={deleteReason}
              onChange={function (e) { setDeleteReason(e.target.value) }}
              rows="2" maxLength="300" placeholder="Why is this expense being deleted..."
              className="w-full px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex gap-3">
            <button onClick={function () { setDeleteMode(false); setDeleteReason('') }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
            <button onClick={deleteExp} disabled={saving || !deleteReason.trim()}
              className="flex-1 py-3 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Deleting...' : 'Confirm Delete'}
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
