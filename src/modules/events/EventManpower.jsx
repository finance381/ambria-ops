import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPaise } from '../../lib/format'
import { logActivity } from '../../lib/logger'

var SOURCE_LABELS = {
  permanent: 'Staff',
  casual_direct: 'Casual',
  casual_vendor: 'Vendor',
}

var SOURCE_COLORS = {
  permanent: 'bg-indigo-100 text-indigo-700',
  casual_direct: 'bg-amber-100 text-amber-700',
  casual_vendor: 'bg-orange-100 text-orange-700',
}

var ASSIGN_STATUS_LABELS = {
  assigned: 'Assigned',
  confirmed: 'Confirmed',
  no_show: 'No Show',
  completed: 'Completed',
}

var ASSIGN_STATUS_COLORS = {
  assigned: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  no_show: 'bg-red-100 text-red-600',
  completed: 'bg-green-100 text-green-700',
}

function EventManpower({ eventId, profile, departments }) {
  var [requirements, setRequirements] = useState([])
  var [roles, setRoles] = useState([])
  var [profiles, setProfiles] = useState([])
  var [vendors, setVendors] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)

  // Add requirement form
  var [showReqForm, setShowReqForm] = useState(false)
  var [rRole, setRRole] = useState('')
  var [rDept, setRDept] = useState('')
  var [rQty, setRQty] = useState('1')
  var [rNotes, setRNotes] = useState('')

  // Add assignment form
  var [assigningReq, setAssigningReq] = useState(null)
  var [aSource, setASource] = useState('permanent')
  var [aProfile, setAProfile] = useState('')
  var [aCasualName, setACasualName] = useState('')
  var [aCasualPhone, setACasualPhone] = useState('')
  var [aVendor, setAVendor] = useState('')
  var [aRate, setARate] = useState('')
  var [aNotes, setANotes] = useState('')

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var isDeptHead = (profile?.permissions || []).indexOf('dept_approve') !== -1
  var canManage = isAdmin || isDeptHead

  useEffect(function () { loadAll() }, [eventId])

  async function loadAll() {
    setLoading(true)
    var results = await Promise.allSettled([
      supabase.from('event_manpower')
        .select('id, event_id, staff_role_id, department, qty_required, notes, created_by, staff_roles(name, default_rate_paise)')
        .eq('event_id', eventId)
        .order('created_at'),
      supabase.from('staff_roles').select('id, name, department, default_rate_paise').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('profiles').select('id, name, event_dept_ids').eq('active', true).order('name'),
      supabase.from('vendors').select('id, name, contact_person, phone').eq('is_active', true).order('name'),
    ])

    var reqs = results[0].value?.data || []
    setRoles(results[1].value?.data || [])
    setProfiles(results[2].value?.data || [])
    setVendors(results[3].value?.data || [])

    // Load assignments for all requirements
    if (reqs.length > 0) {
      var reqIds = reqs.map(function (r) { return r.id })
      var { data: assigns } = await supabase.from('manpower_assignments')
        .select('id, event_manpower_id, source_type, profile_id, casual_name, casual_phone, vendor_id, rate_paise, status, notes')
        .in('event_manpower_id', reqIds)

      var assignMap = {}
      ;(assigns || []).forEach(function (a) {
        if (!assignMap[a.event_manpower_id]) assignMap[a.event_manpower_id] = []
        assignMap[a.event_manpower_id].push(a)
      })

      reqs = reqs.map(function (r) {
        return Object.assign({}, r, { assignments: assignMap[r.id] || [] })
      })
    }

    setRequirements(reqs)
    setLoading(false)
  }

  // ── REQUIREMENT CRUD ──

  function resetReqForm() {
    setRRole(''); setRDept(''); setRQty('1'); setRNotes('')
    setShowReqForm(false)
  }

  async function addRequirement() {
    if (!rRole || !rQty || saving) return
    setSaving(true)
    var { error } = await supabase.from('event_manpower').insert({
      event_id: eventId,
      staff_role_id: Number(rRole),
      department: rDept || null,
      qty_required: Number(rQty),
      notes: rNotes.trim() || null,
      created_by: profile.id,
    })
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    var roleName = roles.find(function (r) { return r.id === Number(rRole) })?.name || ''
    try { await logActivity('MANPOWER_REQ', roleName + ' × ' + rQty) } catch (_) {}
    setSaving(false)
    resetReqForm()
    loadAll()
  }

  async function deleteRequirement(req) {
    if (!confirm('Remove this requirement? All assignments will be deleted.')) return
    await supabase.from('event_manpower').delete().eq('id', req.id)
    try { await logActivity('MANPOWER_REQ_DELETE', req.staff_roles?.name || '') } catch (_) {}
    loadAll()
  }

  async function updateReqQty(req, newQty) {
    if (newQty < 1) return
    await supabase.from('event_manpower').update({ qty_required: newQty }).eq('id', req.id)
    loadAll()
  }

  // ── ASSIGNMENT CRUD ──

  function openAssignForm(req) {
    setAssigningReq(req)
    setASource('permanent')
    setAProfile('')
    setACasualName('')
    setACasualPhone('')
    setAVendor('')
    setARate(req.staff_roles?.default_rate_paise ? String(req.staff_roles.default_rate_paise / 100) : '')
    setANotes('')
  }

  async function addAssignment() {
    if (saving) return
    if (aSource === 'permanent' && !aProfile) return
    if (aSource === 'casual_direct' && !aCasualName.trim()) return
    if (aSource === 'casual_vendor' && (!aCasualName.trim() || !aVendor)) return
    setSaving(true)

    var payload = {
      event_manpower_id: assigningReq.id,
      source_type: aSource,
      rate_paise: aRate ? Math.round(Number(aRate) * 100) : 0,
      notes: aNotes.trim() || null,
    }

    if (aSource === 'permanent') {
      payload.profile_id = aProfile
    } else {
      payload.casual_name = aCasualName.trim()
      payload.casual_phone = aCasualPhone.trim() || null
      if (aSource === 'casual_vendor') {
        payload.vendor_id = Number(aVendor)
      }
    }

    var { error } = await supabase.from('manpower_assignments').insert(payload)
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }

    var name = aSource === 'permanent'
      ? (profiles.find(function (p) { return p.id === aProfile })?.name || '')
      : aCasualName.trim()
    try { await logActivity('MANPOWER_ASSIGN', name + ' → ' + (assigningReq.staff_roles?.name || '')) } catch (_) {}

    setSaving(false)
    setAssigningReq(null)
    loadAll()
  }

  async function updateAssignStatus(assign, newStatus) {
    await supabase.from('manpower_assignments').update({ status: newStatus }).eq('id', assign.id)
    loadAll()
  }

  async function removeAssignment(assign) {
    if (!confirm('Remove this assignment?')) return
    await supabase.from('manpower_assignments').delete().eq('id', assign.id)
    loadAll()
  }

  function assigneeName(a) {
    if (a.source_type === 'permanent') {
      var p = profiles.find(function (pr) { return pr.id === a.profile_id })
      return p ? p.name : '—'
    }
    return a.casual_name || '—'
  }

  function vendorName(id) {
    if (!id) return null
    var v = vendors.find(function (vn) { return vn.id === id })
    return v ? v.name : null
  }

  // ── SUMMARY ──
  var totalRequired = requirements.reduce(function (s, r) { return s + r.qty_required }, 0)
  var totalAssigned = requirements.reduce(function (s, r) { return s + (r.assignments || []).length }, 0)
  var totalCost = requirements.reduce(function (s, r) {
    return s + (r.assignments || []).reduce(function (ss, a) { return ss + (a.rate_paise || 0) }, 0)
  }, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
          Manpower ({totalAssigned}/{totalRequired})
          {totalCost > 0 && <span className="text-gray-400 ml-2">· {formatPaise(totalCost)}</span>}
        </h4>
        {canManage && !showReqForm && (
          <button onClick={function () { resetReqForm(); setShowReqForm(true) }}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors">
            + Add Requirement
          </button>
        )}
      </div>

      {/* Add requirement form */}
      {showReqForm && (
        <div className="bg-white border border-indigo-200 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Role *</label>
              <select value={rRole} onChange={function (e) { setRRole(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select role...</option>
                {roles.map(function (r) { return <option key={r.id} value={r.id}>{r.name}{r.department ? ' (' + r.department + ')' : ''}</option> })}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Department</label>
              <select value={rDept} onChange={function (e) { setRDept(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">—</option>
                {(departments || []).map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Qty Needed *</label>
              <input type="number" min="1" value={rQty} onChange={function (e) { setRQty(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Notes</label>
              <input type="text" value={rNotes} onChange={function (e) { setRNotes(e.target.value) }}
                placeholder="Optional"
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addRequirement} disabled={saving || !rRole}
              className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? '...' : 'Add'}
            </button>
            <button onClick={resetReqForm}
              className="px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-gray-400 text-center py-4">Loading...</p>}

      {!loading && requirements.length === 0 && !showReqForm && (
        <p className="text-sm text-gray-400 text-center py-4">No manpower requirements</p>
      )}

      {/* Requirements list */}
      {requirements.map(function (req) {
        var assigned = req.assignments || []
        var filled = assigned.length
        var needed = req.qty_required
        var isFull = filled >= needed

        return (
          <div key={req.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Requirement header */}
            <div className={"flex items-center gap-3 px-4 py-3 " + (isFull ? "bg-green-50" : "bg-gray-50")}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-gray-800">{req.staff_roles?.name || '—'}</p>
                  <span className={"text-[10px] px-1.5 py-0.5 rounded-full font-bold " +
                    (isFull ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                    {filled}/{needed}
                  </span>
                  {req.department && <span className="text-[10px] text-gray-400">{req.department}</span>}
                </div>
                {req.notes && <p className="text-[11px] text-gray-400 mt-0.5">{req.notes}</p>}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {/* Qty adjust */}
                <button onClick={function () { updateReqQty(req, needed - 1) }}
                  disabled={needed <= 1}
                  className="w-6 h-6 text-xs text-gray-500 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-30">−</button>
                <button onClick={function () { updateReqQty(req, needed + 1) }}
                  className="w-6 h-6 text-xs text-gray-500 border border-gray-300 rounded hover:bg-gray-100">+</button>
                {canManage && (
                  <button onClick={function () { openAssignForm(req) }}
                    className="text-[11px] px-2 py-1 bg-indigo-600 text-white rounded font-semibold hover:bg-indigo-700 ml-1">
                    + Assign
                  </button>
                )}
                {canManage && filled === 0 && (
                  <button onClick={function () { deleteRequirement(req) }}
                    className="text-[11px] text-gray-400 hover:text-red-600 ml-1">🗑</button>
                )}
              </div>
            </div>

            {/* Assignments */}
            {assigned.length > 0 && (
              <div className="divide-y divide-gray-50">
                {assigned.map(function (a) {
                  return (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-gray-800">{assigneeName(a)}</p>
                          <span className={"text-[10px] px-1.5 py-0.5 rounded-full font-bold " + (SOURCE_COLORS[a.source_type] || '')}>
                            {SOURCE_LABELS[a.source_type]}
                          </span>
                          {a.vendor_id && (
                            <span className="text-[10px] text-gray-400">via {vendorName(a.vendor_id)}</span>
                          )}
                        </div>
                        <div className="flex gap-2 text-[10px] text-gray-400">
                          {a.casual_phone && <span>📱 {a.casual_phone}</span>}
                          {a.rate_paise > 0 && <span>₹{(a.rate_paise / 100).toLocaleString('en-IN')}</span>}
                          {a.notes && <span>{a.notes}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <select value={a.status}
                          onChange={function (e) { updateAssignStatus(a, e.target.value) }}
                          className={"text-[10px] px-1.5 py-1 rounded font-bold border-0 " + (ASSIGN_STATUS_COLORS[a.status] || '')}>
                          {Object.keys(ASSIGN_STATUS_LABELS).map(function (s) {
                            return <option key={s} value={s}>{ASSIGN_STATUS_LABELS[s]}</option>
                          })}
                        </select>
                        {canManage && (
                          <button onClick={function () { removeAssignment(a) }}
                            className="text-[10px] text-gray-400 hover:text-red-600">✕</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Inline assignment form */}
            {assigningReq && assigningReq.id === req.id && (
              <div className="border-t border-indigo-200 bg-indigo-50 p-3 space-y-2">
                <div className="flex gap-2 items-center">
                  <div className="flex bg-white border border-gray-300 rounded-lg overflow-hidden">
                    {['permanent', 'casual_direct', 'casual_vendor'].map(function (s) {
                      return (
                        <button key={s} type="button"
                          onClick={function () { setASource(s) }}
                          className={"px-2.5 py-1.5 text-[11px] font-bold transition-colors " +
                            (aSource === s ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50")}>
                          {SOURCE_LABELS[s]}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {aSource === 'permanent' && (
                    <div className="col-span-2">
                      <label className="block text-[10px] text-gray-500 mb-0.5">Staff Member *</label>
                      <select value={aProfile} onChange={function (e) { setAProfile(e.target.value) }}
                        className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                        <option value="">Select...</option>
                        {profiles.map(function (p) { return <option key={p.id} value={p.id}>{p.name}</option> })}
                      </select>
                    </div>
                  )}
                  {aSource !== 'permanent' && (
                    <>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-0.5">Name *</label>
                        <input type="text" value={aCasualName} onChange={function (e) { setACasualName(e.target.value) }}
                          placeholder="Person name"
                          className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-0.5">Phone</label>
                        <input type="tel" value={aCasualPhone} onChange={function (e) { setACasualPhone(e.target.value) }}
                          className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      </div>
                    </>
                  )}
                  {aSource === 'casual_vendor' && (
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Vendor *</label>
                      <select value={aVendor} onChange={function (e) { setAVendor(e.target.value) }}
                        className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                        <option value="">Select vendor...</option>
                        {vendors.map(function (v) { return <option key={v.id} value={v.id}>{v.name}</option> })}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Rate (₹)</label>
                    <input type="number" min="0" value={aRate} onChange={function (e) { setARate(e.target.value) }}
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={addAssignment} disabled={saving}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                    {saving ? '...' : '✓ Assign'}
                  </button>
                  <button onClick={function () { setAssigningReq(null) }}
                    className="px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default EventManpower
