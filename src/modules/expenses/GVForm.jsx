import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'
import { isPrivilegedRole } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'

function byName(a, b) { return (a.name || '').localeCompare(b.name || '') }

function makeAlloc() {
  return { _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8), departmentId: '', expenseTypeId: '', expenseSubTypeId: '', venueId: '', subVenueId: '', amountPts: '', remarks: '' }
}

function GVForm({ exp, profile, onCancel, onSaved }) {
  var isAdmin = isPrivilegedRole(profile)
  var [reason, setReason] = useState('')
  var [allocations, setAllocations] = useState([])
  var [departments, setDepartments] = useState([])
  var refData = useReferenceData()
  var venues = refData.venues.filter(function (v) { return v.active }).slice().sort(byName)
  var expenseTypes = refData.expenseTypes.filter(function (t) { return t.active }).slice().sort(byName)
  var expenseSubTypes = refData.expenseSubTypes.filter(function (t) { return t.active }).slice().sort(byName)
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  // Optional: update parent expense fields (admin/finance_gv only)
  var [fieldsExpanded, setFieldsExpanded] = useState(false)
  var [newTypeId, setNewTypeId] = useState(exp.expense_type_id ? String(exp.expense_type_id) : '')
  var [newSubTypeId, setNewSubTypeId] = useState(exp.expense_sub_type_id ? String(exp.expense_sub_type_id) : '')

  useEffect(function () {
    Promise.all([
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('expense_allocations')
        .select('id, department, department_id, expense_type_id, expense_sub_type_id, venue_id, sub_venue_id, amount_paise, remarks')
        .eq('expense_id', exp.id)
        .order('id'),
    ]).then(function (res) {
      setDepartments(res[0].data || [])
      // Prefill from freshly-fetched allocation rows
      var allocRows = res[1].data || []
      var prefill = allocRows.map(function (a) {
        return {
          _key: Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + a.id,
          departmentId: a.department_id ? String(a.department_id) : '',
          expenseTypeId: a.expense_type_id ? String(a.expense_type_id) : '',
          expenseSubTypeId: a.expense_sub_type_id ? String(a.expense_sub_type_id) : '',
          venueId: a.venue_id ? String(a.venue_id) : '',
          subVenueId: a.sub_venue_id ? String(a.sub_venue_id) : '',
          amountPts: a.amount_paise != null ? String(a.amount_paise / 100) : '',
          remarks: a.remarks || '',
          _departmentText: a.department || '',
        }
      })
      if (prefill.length === 0) {
        // Legacy expense with no allocations — seed one row from the parent expense's type/sub-type
        var seed = makeAlloc()
        var parentTypeId = exp.expense_type_id ? Number(exp.expense_type_id) : null
        var parentType = parentTypeId ? expenseTypes.find(function (t) { return t.id === parentTypeId }) : null
        seed.departmentId = parentType && parentType.department_id ? String(parentType.department_id) : ''
        seed.expenseTypeId = parentTypeId ? String(parentTypeId) : ''
        seed.expenseSubTypeId = exp.expense_sub_type_id ? String(exp.expense_sub_type_id) : ''
        seed.amountPts = exp.amount_paise ? String(exp.amount_paise / 100) : ''
        prefill = [seed]
      }
      setAllocations(prefill)
      setLoading(false)
    })
  }, [exp.id])

  function updateAlloc(idx, field, val) {
    setAllocations(function (prev) {
      return prev.map(function (a, i) { return i === idx ? Object.assign({}, a, (function () { var o = {}; o[field] = val; return o })()) : a })
    })
  }

  function addAlloc() {
    setAllocations(function (prev) { return prev.concat([makeAlloc()]) })
  }

  function removeAlloc(idx) {
    setAllocations(function (prev) {
      if (prev.length <= 1) return prev
      return prev.filter(function (_, i) { return i !== idx })
    })
  }

  var totalPaise = allocations.reduce(function (sum, a) { return sum + Math.round((Number(a.amountPts) || 0) * 100) }, 0)
  var expectedPaise = exp.amount_paise || 0
  var diff = totalPaise - expectedPaise
  var sumOk = diff === 0
  var reasonOk = reason.trim().length >= 3

  async function submit() {
    if (saving) return
    setError('')
    if (!reasonOk) { setError('Reason must be at least 3 characters'); return }
    if (!sumOk) { setError('Allocation total must equal expense amount'); return }
    for (var i = 0; i < allocations.length; i++) {
      var a = allocations[i]
      if (!a.departmentId) { setError('Row ' + (i + 1) + ': department required'); return }
      if (!Number(a.amountPts)) { setError('Row ' + (i + 1) + ': amount required'); return }
    }
    setSaving(true)

    var payload = allocations.map(function (a) {
      var deptName = (departments.find(function (d) { return String(d.id) === String(a.departmentId) }) || {}).name || a._departmentText || ''
      return {
        department: deptName,
        department_id: a.departmentId ? Number(a.departmentId) : null,
        expense_type_id: a.expenseTypeId ? Number(a.expenseTypeId) : null,
        expense_sub_type_id: a.expenseSubTypeId ? Number(a.expenseSubTypeId) : null,
        venue_id: a.venueId ? Number(a.venueId) : null,
        sub_venue_id: a.subVenueId ? Number(a.subVenueId) : null,
        amount_paise: Math.round(Number(a.amountPts) * 100),
        remarks: (a.remarks || '').trim() || null,
      }
    })

    // Only submit field updates if the section is expanded AND at least one value changed
    var typeChanged = fieldsExpanded && Number(newTypeId) !== Number(exp.expense_type_id || 0)
    var subChanged  = fieldsExpanded && Number(newSubTypeId || 0) !== Number(exp.expense_sub_type_id || 0)
    var sendFieldUpdate = typeChanged || subChanged

    var { data, error: rpcErr } = await supabase.rpc('fn_create_gv', {
      p_expense_id: exp.id,
      p_reason: reason.trim(),
      p_allocations: payload,
      p_new_expense_type_id: sendFieldUpdate ? (newTypeId ? Number(newTypeId) : null) : null,
      p_new_expense_sub_type_id: sendFieldUpdate ? (newSubTypeId ? Number(newSubTypeId) : null) : null,
    })

    if (rpcErr) {
      setError(rpcErr.message || 'Failed to raise JV')
      setSaving(false)
      return
    }

    try { await logActivity({ action: 'gv_create', entity: 'expense', entity_id: exp.id, meta: { gv_number: data?.gv_number, fields_changed: data?.fields_changed || false } }) } catch (e) {}

    setSaving(false)
    if (onSaved) onSaved(data)
  }

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={onCancel} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 mb-2">← Cancel</button>
          <h2 className="text-lg font-bold text-gray-900">Raise Journal Voucher</h2>
          <p className="text-xs text-gray-500">Adjust expense #{exp.id} · {formatPoints(exp.amount_paise)}</p>
          {exp.description && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-md">{exp.description}</p>}
        </div>
      </div>

      {/* Reason */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1.5">Reason <span className="text-red-500">*</span></label>
        <textarea value={reason} onChange={function (e) { setReason(e.target.value) }}
          placeholder="Why is this expense being adjusted?"
          rows={2} maxLength={500}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
      </div>

      {/* Optional: Update parent expense fields */}
      {isAdmin && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button type="button" onClick={function () { setFieldsExpanded(function (v) { return !v }) }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-gray-500 uppercase">Update parent expense fields</span>
              <span className="text-[10px] text-gray-400 normal-case tracking-normal">optional · admin only</span>
            </div>
            <span className={"text-gray-400 transition-transform " + (fieldsExpanded ? "rotate-180" : "")}>▾</span>
          </button>
          {fieldsExpanded && (function () {
            var currentTypeName = (expenseTypes.find(function (t) { return t.id === Number(exp.expense_type_id) }) || {}).name || '—'
            var currentSubName = (expenseSubTypes.find(function (s) { return s.id === Number(exp.expense_sub_type_id) }) || {}).name || '—'
            var subOpts = newTypeId ? expenseSubTypes.filter(function (s) { return s.expense_type_id === Number(newTypeId) }) : []
            var typeChangedPreview = Number(newTypeId || 0) !== Number(exp.expense_type_id || 0)
            var subChangedPreview = Number(newSubTypeId || 0) !== Number(exp.expense_sub_type_id || 0)
            var willUpdate = typeChangedPreview || subChangedPreview
            return (
              <div className="border-t border-gray-100 p-4 space-y-3 bg-gray-50">
                <div className="text-[10px] text-gray-500">
                  Current: <span className="font-semibold text-gray-700">{currentTypeName}</span>
                  {currentSubName !== '—' && <span> › <span className="font-semibold text-gray-700">{currentSubName}</span></span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">New expense type</label>
                    <select value={newTypeId}
                      onChange={function (e) { setNewTypeId(e.target.value); setNewSubTypeId('') }}
                      className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
                      style={{ fontSize: '16px' }}>
                      <option value="">— Select —</option>
                      {expenseTypes.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name}</option> })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">New sub-type</label>
                    <select value={newSubTypeId}
                      onChange={function (e) { setNewSubTypeId(e.target.value) }}
                      disabled={!newTypeId}
                      className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-100 disabled:text-gray-400"
                      style={{ fontSize: '16px' }}>
                      <option value="">— None —</option>
                      {subOpts.map(function (s) { return <option key={s.id} value={String(s.id)}>{s.name}</option> })}
                    </select>
                  </div>
                </div>
                {willUpdate ? (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-semibold">
                    ⚠ This JV will update the parent expense fields. The change is captured in the audit trail.
                  </div>
                ) : (
                  <div className="text-[11px] text-gray-500 italic">No changes — leave collapsed to skip field updates.</div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Allocations */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <label className="text-[11px] font-bold text-gray-500 uppercase">New Allocations</label>
          <button onClick={addAlloc} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">+ Add Row</button>
        </div>
        <div className="space-y-3">
          {allocations.map(function (alloc, aIdx) {
            var allocDeptId = alloc.departmentId ? Number(alloc.departmentId) : null
            var scopedTypes = allocDeptId ? expenseTypes.filter(function (t) { return t.department_id === allocDeptId }) : []
            var genericTypes = expenseTypes.filter(function (t) { return !t.department_id })
            var subOpts = alloc.expenseTypeId ? expenseSubTypes.filter(function (s) { return s.expense_type_id === Number(alloc.expenseTypeId) }) : []
            return (
              <div key={alloc._key} className="flex gap-2 items-start border-t border-gray-100 pt-3 first:border-0 first:pt-0">
                <div className="flex-1 space-y-1.5">
                  <div className="grid grid-cols-2 gap-2">
                    <select value={alloc.departmentId}
                      onChange={function (e) { updateAlloc(aIdx, 'departmentId', e.target.value); updateAlloc(aIdx, 'expenseTypeId', ''); updateAlloc(aIdx, 'expenseSubTypeId', '') }}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }}>
                      <option value="">Dept *</option>
                      {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                    </select>
                    <select value={alloc.venueId}
                      onChange={function (e) { updateAlloc(aIdx, 'venueId', e.target.value) }}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }}>
                      <option value="">Venue</option>
                      {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code}</option> })}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={alloc.expenseTypeId}
                      onChange={function (e) { updateAlloc(aIdx, 'expenseTypeId', e.target.value); updateAlloc(aIdx, 'expenseSubTypeId', '') }}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }}>
                      <option value="">Type</option>
                      {scopedTypes.length > 0 && (
                        <optgroup label="Dept-specific">
                          {scopedTypes.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name}</option> })}
                        </optgroup>
                      )}
                      {genericTypes.length > 0 && (
                        <optgroup label="Generic">
                          {genericTypes.map(function (t) { return <option key={t.id} value={String(t.id)}>{t.name}</option> })}
                        </optgroup>
                      )}
                    </select>
                    <select value={alloc.expenseSubTypeId}
                      onChange={function (e) { updateAlloc(aIdx, 'expenseSubTypeId', e.target.value) }}
                      disabled={!alloc.expenseTypeId}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-100 disabled:text-gray-400" style={{ fontSize: '16px' }}>
                      <option value="">Sub-type</option>
                      {subOpts.map(function (s) { return <option key={s.id} value={String(s.id)}>{s.name}</option> })}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" inputMode="decimal" step="0.01" value={alloc.amountPts}
                      onChange={function (e) { updateAlloc(aIdx, 'amountPts', e.target.value) }}
                      placeholder="Amount (pts) *" className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }} />
                    <input type="text" value={alloc.remarks}
                      onChange={function (e) { updateAlloc(aIdx, 'remarks', e.target.value) }}
                      placeholder="Remarks" maxLength={200}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }} />
                  </div>
                </div>
                {allocations.length > 1 && (
                  <button type="button" onClick={function () { removeAlloc(aIdx) }}
                    className="text-red-400 hover:text-red-600 text-xs mt-1">✕</button>
                )}
              </div>
            )
          })}
        </div>

        {/* Running total */}
        <div className={"mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs font-bold " + (sumOk ? 'text-green-700' : 'text-red-600')}>
          <span>Total: {formatPoints(totalPaise)}</span>
          <span>Expected: {formatPoints(expectedPaise)}{!sumOk ? ' · Off by ' + formatPoints(Math.abs(diff)) : ' ✓'}</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 font-medium">{error}</div>
      )}

      {/* Submit */}
      <button onClick={submit} disabled={saving || !sumOk || !reasonOk}
        className="w-full py-3 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm">
        {saving ? 'Raising JV...' : 'Raise Journal Voucher'}
      </button>
    </div>
  )
}

export default GVForm