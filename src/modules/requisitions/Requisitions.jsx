import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { titleCase, formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import Modal from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'

var URGENCY_COLORS = {
  low: 'bg-gray-100 text-gray-600',
  normal: 'bg-blue-100 text-blue-700',
  urgent: 'bg-red-100 text-red-700',
}

var STATUS_COLORS = {
  pending_dept: 'bg-amber-100 text-amber-700',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  fulfilled: 'bg-indigo-100 text-indigo-700',
}

var STATUS_LABELS = {
  pending_dept: 'Dept Review',
  pending: 'Admin Review',
  approved: 'Approved',
  rejected: 'Rejected',
  fulfilled: 'Fulfilled',
}

var UNITS = [
  'Pieces', 'Nos', 'Sets', 'Pairs', 'Dozens',
  'Kg', 'Grams', 'Liters', 'ML',
  'Meters', 'Feet', 'Rolls', 'Packets', 'Bags',
  'Boxes', 'Cartons', 'Bottles', 'Sheets', 'Reams',
]

function Requisitions({ profile, onBack }) {
  var [view, setView] = useState('list') // list | form | detail | approve
  var [requisitions, setRequisitions] = useState([])
  var [loading, setLoading] = useState(true)
  var [detailReq, setDetailReq] = useState(null)
  var [detailItems, setDetailItems] = useState([])
  var [statusFilter, setStatusFilter] = useState('')

  var isAdmin = profile?.role === 'admin'
  var isAuditor = profile?.role === 'auditor'
  var isDeptApprover = (profile?.permissions || []).includes('dept_approve')
  var showApproveTab = isAdmin || isDeptApprover

  useEffect(function () { loadRequisitions() }, [])

  async function loadRequisitions() {
    var { data, error } = await supabase
      .from('requisitions')
      .select('id, department, urgency, purpose, status, created_at, requested_by, rejection_reason, profiles:requested_by(name)')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) { alert('Failed to load: ' + error.message); setLoading(false); return }
    setRequisitions(data || [])
    setLoading(false)
  }

  async function openDetail(req) {
    setDetailReq(req)
    var { data } = await supabase
      .from('requisition_items')
      .select('id, item_id, item_name, category_id, qty, unit, notes, _source, categories(name)')
      .eq('requisition_id', req.id)
    setDetailItems(data || [])
    setView('detail')
  }

  // ─── Filter logic ───
  var myReqs = requisitions.filter(function (r) { return r.requested_by === profile?.id })
  var approvalReqs = requisitions.filter(function (r) {
    if (r.requested_by === profile?.id) return false
    if (isAdmin && r.status === 'pending') return true
    if (isDeptApprover && r.status === 'pending_dept') return true
    return false
  })

  var displayList = view === 'approve' ? approvalReqs : myReqs
  if (statusFilter) {
    displayList = displayList.filter(function (r) { return r.status === statusFilter })
  }

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
  }

  // ═══════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════
  if (view === 'form') {
    return (
      <RequisitionForm
        profile={profile}
        onCancel={function () { setView('list') }}
        onSaved={function () { setView('list'); loadRequisitions() }}
      />
    )
  }

  // ═══════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════
  if (view === 'detail' && detailReq) {
    return (
      <RequisitionDetail
        req={detailReq}
        items={detailItems}
        profile={profile}
        isAdmin={isAdmin}
        isDeptApprover={isDeptApprover}
        onBack={function () { setView(detailReq._fromApprove ? 'approve' : 'list'); setDetailReq(null); setDetailItems([]) }}
        onUpdated={function () { loadRequisitions(); setView(detailReq._fromApprove ? 'approve' : 'list'); setDetailReq(null); setDetailItems([]) }}
      />
    )
  }

  // ═══════════════════════════════════════════════
  // LIST / APPROVE VIEW
  // ═══════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Requisitions</h2>
          <p className="text-xs text-gray-400">{view === 'approve' ? approvalReqs.length + ' pending approval' : myReqs.length + ' requests'}</p>
        </div>
        <button onClick={function () { setView('form') }}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
          + New Request
        </button>
      </div>

      {/* Tabs: My Requests | Pending Approval */}
      {showApproveTab && (
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button onClick={function () { setView('list'); setStatusFilter('') }}
            className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors " + (view === 'list' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
            My Requests
          </button>
          <button onClick={function () { setView('approve'); setStatusFilter('') }}
            className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors relative " + (view === 'approve' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
            Approvals
            {approvalReqs.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {approvalReqs.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {['', 'pending_dept', 'pending', 'approved', 'rejected', 'fulfilled'].map(function (s) {
          var label = s ? STATUS_LABELS[s] : 'All'
          var count = s ? displayList.filter(function (r) { return !statusFilter ? r.status === s : true }).length : (view === 'approve' ? approvalReqs.length : myReqs.length)
          if (s && !statusFilter && count === 0) return null
          return (
            <button key={s} onClick={function () { setStatusFilter(s === statusFilter ? '' : s) }}
              className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                (statusFilter === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
              {label}
            </button>
          )
        })}
      </div>

      {/* List */}
      {displayList.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">{view === 'approve' ? 'No pending approvals' : 'No requisitions yet'}</p>
        </div>
      )}

      <div className="space-y-3">
        {displayList.map(function (req) {
          return (
            <div key={req.id}
              onClick={function () {
                var r = Object.assign({}, req, { _fromApprove: view === 'approve' })
                openDetail(r)
              }}
              className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md active:bg-gray-50 cursor-pointer transition-all">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {req.purpose || 'Requisition #' + req.id}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {view === 'approve' ? (req.profiles?.name || '—') + ' · ' : ''}
                    {req.department} · {formatDate(req.created_at)}
                  </p>
                </div>
                <div className="flex gap-1.5 flex-shrink-0 ml-2">
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (URGENCY_COLORS[req.urgency] || '')}>
                    {req.urgency}
                  </span>
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (STATUS_COLORS[req.status] || '')}>
                    {STATUS_LABELS[req.status] || req.status}
                  </span>
                </div>
              </div>
              {req.status === 'rejected' && req.rejection_reason && (
                <p className="text-[11px] text-red-500 mt-1 line-clamp-1">Reason: {req.rejection_reason}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// FORM — Multi-item cart
// ═══════════════════════════════════════════════════════════════
function RequisitionForm({ profile, onCancel, onSaved }) {
  var [departments, setDepartments] = useState([])
  var [categories, setCategories] = useState([])
  var [inventoryItems, setInventoryItems] = useState([])
  var [department, setDepartment] = useState('')
  var [urgency, setUrgency] = useState('normal')
  var [purpose, setPurpose] = useState('')
  var [cart, setCart] = useState([emptyCartItem()])
  var [saving, setSaving] = useState(false)
  var [errors, setErrors] = useState({})

  function emptyCartItem() {
    return { mode: 'existing', item_id: null, item_name: '', category_id: '', qty: '1', unit: 'Pieces', notes: '', _source: 'new', search: '' }
  }

  useEffect(function () { loadLookups() }, [])

  async function loadLookups() {
    var [deptRes, catRes, invRes, csRes] = await Promise.all([
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('categories').select('id, name, sub_department_id').order('name'),
      supabase.from('inventory_items')
        .select('id, name, unit, category_id, status, categories(name)')
        .in('status', ['approved', 'pending', 'pending_dept'])
        .order('name')
        .limit(2000),
      supabase.from('catering_store_items')
        .select('id, name, unit, category_id, status, categories(name)')
        .in('status', ['approved', 'pending', 'pending_dept'])
        .order('name')
        .limit(2000),
    ])
    setDepartments(deptRes.data || [])
    setCategories(catRes.data || [])

    var inv = (invRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
    var cs = (csRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store' }) })
    setInventoryItems(inv.concat(cs))
  }

  function updateCart(index, field, value) {
    setCart(function (prev) {
      return prev.map(function (item, i) {
        if (i !== index) return item
        var updated = Object.assign({}, item, { [field]: value })
        return updated
      })
    })
  }

  function selectInventoryItem(index, invItem) {
    setCart(function (prev) {
      return prev.map(function (item, i) {
        if (i !== index) return item
        return Object.assign({}, item, {
          item_id: invItem.id,
          item_name: invItem.name,
          unit: invItem.unit || 'Pieces',
          category_id: invItem.category_id ? String(invItem.category_id) : '',
          _source: invItem._source,
          search: invItem.name,
        })
      })
    })
  }

  function toggleMode(index) {
    setCart(function (prev) {
      return prev.map(function (item, i) {
        if (i !== index) return item
        var newMode = item.mode === 'existing' ? 'new' : 'existing'
        return Object.assign({}, emptyCartItem(), { mode: newMode, qty: item.qty, notes: item.notes })
      })
    })
  }

  function addCartItem() {
    setCart(function (prev) { return prev.concat([emptyCartItem()]) })
  }

  function removeCartItem(index) {
    setCart(function (prev) {
      if (prev.length <= 1) return prev
      return prev.filter(function (_, i) { return i !== index })
    })
  }

  function validate() {
    var errs = {}
    if (!department) errs.dept = 'Department required'
    if (!purpose.trim()) errs.purpose = 'Purpose required'
    var validItems = cart.filter(function (c) { return c.item_name.trim() && Number(c.qty) > 0 })
    if (validItems.length === 0) errs.cart = 'Add at least one item'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    try {
      // Determine status — same logic as inventory
      var selfIsDeptApprover = (profile?.permissions || []).includes('dept_approve')
      var isAdminRole = profile?.role === 'admin' || profile?.role === 'auditor'

      var status = 'pending_dept'
      var deptApprovedBy = null
      var deptApprovedAt = null

      if (isAdminRole) {
        status = 'approved'
      } else if (selfIsDeptApprover) {
        status = 'pending'
        deptApprovedBy = profile.id
        deptApprovedAt = new Date().toISOString()
      } else {
        // Check if any dept approver exists (other than self)
        var { data: approvers } = await supabase
          .from('profiles')
          .select('id')
          .contains('permissions', ['dept_approve'])
          .eq('active', true)
          .neq('id', profile.id)
          .limit(1)
        if (approvers && approvers.length > 0) {
          status = 'pending_dept'
        } else {
          status = 'pending'
        }
      }

      // Insert requisition header
      var { data: req, error: reqErr } = await supabase.from('requisitions').insert({
        requested_by: profile.id,
        department: department,
        urgency: urgency,
        purpose: purpose.trim(),
        status: status,
        dept_approved_by: deptApprovedBy,
        dept_approved_at: deptApprovedAt,
      }).select('id').single()
      if (reqErr) throw new Error(reqErr.message)

      // Insert line items
      var lineItems = cart
        .filter(function (c) { return c.item_name.trim() && Number(c.qty) > 0 })
        .map(function (c) {
          return {
            requisition_id: req.id,
            item_id: c.mode === 'existing' && c.item_id ? c.item_id : null,
            item_name: c.item_name.trim(),
            category_id: c.category_id ? Number(c.category_id) : null,
            qty: Number(c.qty),
            unit: c.unit,
            notes: c.notes.trim() || null,
            _source: c.mode === 'existing' ? c._source : 'new',
          }
        })

      if (lineItems.length > 0) {
        var { error: itemsErr } = await supabase.from('requisition_items').insert(lineItems)
        if (itemsErr) throw new Error(itemsErr.message)
      }

      logActivity('REQUISITION_CREATE', purpose.trim() + ' | ' + lineItems.length + ' items | ' + urgency)
      onSaved()
    } catch (err) {
      setErrors(function (prev) { return Object.assign({}, prev, { submit: err.message }) })
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">New Requisition</h2>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
      </div>

      {/* Department + Urgency */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Department <span className="text-red-500">*</span></label>
          <select value={department} onChange={function (e) { setDepartment(e.target.value) }}
            className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white " + (errors.dept ? "border-red-300" : "border-gray-300")}
            style={{ fontSize: '16px' }}>
            <option value="">Select department...</option>
            {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
          </select>
          {errors.dept && <p className="text-xs text-red-500 mt-1">{errors.dept}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Urgency</label>
          <div className="flex gap-0 bg-white border border-gray-300 rounded-md overflow-hidden">
            {['low', 'normal', 'urgent'].map(function (u) {
              var active = urgency === u
              var colors = {
                low: active ? 'bg-gray-600 text-white' : 'text-gray-500 hover:bg-gray-50',
                normal: active ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50',
                urgent: active ? 'bg-red-600 text-white' : 'text-gray-500 hover:bg-gray-50',
              }
              return (
                <button key={u} type="button" onClick={function () { setUrgency(u) }}
                  className={"flex-1 py-2 text-sm font-medium capitalize transition-colors " + colors[u]}>
                  {u}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Purpose / Reason <span className="text-red-500">*</span></label>
          <textarea value={purpose} onChange={function (e) { setPurpose(e.target.value) }}
            rows="2" maxLength="500" placeholder="e.g. Monthly stationery restock, new workstation setup..."
            className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none " + (errors.purpose ? "border-red-300" : "border-gray-300")}
            style={{ fontSize: '16px' }} />
          {errors.purpose && <p className="text-xs text-red-500 mt-1">{errors.purpose}</p>}
        </div>
      </div>

      {/* Cart items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Items</h3>
          <button type="button" onClick={addCartItem}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">+ Add Item</button>
        </div>
        {errors.cart && <p className="text-xs text-red-500">{errors.cart}</p>}

        {cart.map(function (item, index) {
          var searchResults = []
          if (item.mode === 'existing' && item.search.trim().length >= 2) {
            var q = item.search.toLowerCase()
            searchResults = inventoryItems.filter(function (inv) {
              return inv.name.toLowerCase().includes(q) || (inv.categories?.name || '').toLowerCase().includes(q)
            }).slice(0, 8)
          }

          return (
            <div key={index} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-400">Item #{index + 1}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={function () { toggleMode(index) }}
                    className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-gray-500">{item.mode === 'new' ? '✦ New' : '📦 Inventory'}</span>
                    <div className={"relative w-9 h-5 rounded-full transition-colors " + (item.mode === 'new' ? "bg-amber-400" : "bg-indigo-500")}>
                      <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (item.mode === 'new' ? "translate-x-4" : "translate-x-0.5")} />
                    </div>
                  </button>
                  {cart.length > 1 && (
                    <button type="button" onClick={function () { removeCartItem(index) }}
                      className="text-xs text-red-400 hover:text-red-600 font-semibold">✕</button>
                  )}
                </div>
              </div>

              {item.mode === 'existing' ? (
                <div className="relative">
                  <input type="text" value={item.search}
                    onChange={function (e) {
                      updateCart(index, 'search', e.target.value)
                      if (!e.target.value.trim()) {
                        updateCart(index, 'item_id', null)
                        updateCart(index, 'item_name', '')
                      }
                    }}
                    placeholder="Search inventory..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    style={{ fontSize: '16px' }} />
                  {item.item_id && (
                    <span className="absolute right-2 top-2.5 text-[10px] text-green-600 font-bold">✓ Linked</span>
                  )}
                  {searchResults.length > 0 && !item.item_id && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map(function (inv) {
                        return (
                          <button key={inv._source + '-' + inv.id} type="button"
                            onClick={function () { selectInventoryItem(index, inv) }}
                            className="w-full text-left px-3 py-2 hover:bg-indigo-50 active:bg-indigo-100 transition-colors border-b border-gray-100 last:border-0">
                            <p className="text-sm font-medium text-gray-800">{titleCase(inv.name)}</p>
                            <p className="text-[11px] text-gray-400">{inv.categories?.name || '—'} · {inv.unit} · {inv._source === 'catering_store' ? 'CS' : 'INV'}{inv.status !== 'approved' ? ' · ⏳ Pending' : ''}</p>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <input type="text" value={item.item_name}
                    onChange={function (e) { updateCart(index, 'item_name', e.target.value) }}
                    placeholder="Item name (e.g. A4 Sheets, Broom, Chair)"
                    maxLength="200"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    style={{ fontSize: '16px' }} />
                  <select value={item.category_id}
                    onChange={function (e) { updateCart(index, 'category_id', e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    style={{ fontSize: '16px' }}>
                    <option value="">Category (optional)</option>
                    {categories.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
                  </select>
                </div>
              )}

              {/* Qty + Unit row */}
              <div className="flex gap-2">
                <div className="w-24">
                  <label className="block text-[11px] text-gray-400 mb-0.5">Qty</label>
                  <input type="number" min="1" step="any" inputMode="numeric" value={item.qty}
                    onChange={function (e) { updateCart(index, 'qty', e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    style={{ fontSize: '16px' }} />
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] text-gray-400 mb-0.5">Unit</label>
                  <select value={item.unit}
                    onChange={function (e) { updateCart(index, 'unit', e.target.value) }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    style={{ fontSize: '16px' }}>
                    {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-gray-400 mb-0.5">Notes</label>
                <input type="text" value={item.notes}
                  onChange={function (e) { updateCart(index, 'notes', e.target.value) }}
                  placeholder="Specific brand, size, specification..."
                  maxLength="300"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={{ fontSize: '16px' }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Submit */}
      {errors.submit && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errors.submit}</div>
      )}
      <div className="flex gap-3">
        <button type="button" onClick={onCancel}
          className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
          {saving ? 'Submitting...' : 'Submit Request'}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// DETAIL + APPROVAL VIEW
// ═══════════════════════════════════════════════════════════════
function RequisitionDetail({ req, items, profile, isAdmin, isDeptApprover, onBack, onUpdated }) {
  var [saving, setSaving] = useState(false)
  var [rejectMode, setRejectMode] = useState(false)
  var [rejectReason, setRejectReason] = useState('')

  var canDeptApprove = isDeptApprover && req.status === 'pending_dept' && req.requested_by !== profile?.id
  var canAdminApprove = isAdmin && req.status === 'pending'
  var canApprove = canDeptApprove || canAdminApprove
  var canDelete = (req.requested_by === profile?.id && (req.status === 'pending_dept' || req.status === 'pending')) || isAdmin

  async function approve() {
    setSaving(true)
    var update = {}
    if (canDeptApprove) {
      update = { status: 'pending', dept_approved_by: profile.id, dept_approved_at: new Date().toISOString() }
    } else if (canAdminApprove) {
      update = { status: 'approved', reviewed_by: profile.id, reviewed_at: new Date().toISOString() }
    }
    var { error } = await supabase.from('requisitions').update(update).eq('id', req.id)
    if (error) { alert('Approve failed: ' + error.message); setSaving(false); return }
    logActivity('REQUISITION_APPROVE', (req.purpose || 'Req #' + req.id) + ' | ' + (canDeptApprove ? 'dept' : 'admin'))
    setSaving(false)
    onUpdated()
  }

  async function reject() {
    if (!rejectReason.trim()) return
    setSaving(true)
    var { error } = await supabase.from('requisitions').update({
      status: 'rejected',
      rejection_reason: rejectReason.trim(),
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', req.id)
    if (error) { alert('Reject failed: ' + error.message); setSaving(false); return }
    logActivity('REQUISITION_REJECT', (req.purpose || 'Req #' + req.id) + ' | ' + rejectReason.trim())
    setSaving(false)
    onUpdated()
  }

  async function deleteReq() {
    if (!confirm('Delete this requisition? This cannot be undone.')) return
    setSaving(true)
    var { error } = await supabase.from('requisitions').delete().eq('id', req.id)
    if (error) { alert('Delete failed: ' + error.message); setSaving(false); return }
    logActivity('REQUISITION_DELETE', req.purpose || 'Req #' + req.id)
    setSaving(false)
    onUpdated()
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-2">← Back</button>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{req.purpose || 'Requisition #' + req.id}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {req.profiles?.name || '—'} · {req.department} · {formatDate(req.created_at)}
            </p>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (URGENCY_COLORS[req.urgency] || '')}>
              {req.urgency}
            </span>
            <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (STATUS_COLORS[req.status] || '')}>
              {STATUS_LABELS[req.status] || req.status}
            </span>
          </div>
        </div>
      </div>

      {/* Rejection reason */}
      {req.status === 'rejected' && req.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs font-bold text-red-700 mb-0.5">Rejection Reason</p>
          <p className="text-sm text-red-600">{req.rejection_reason}</p>
        </div>
      )}

      {/* Line items */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{items.length} Items</h3>
        {items.map(function (li) {
          return (
            <div key={li.id} className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{titleCase(li.item_name)}</p>
                  <p className="text-[11px] text-gray-400">
                    {li.categories?.name || '—'}
                    <span className="mx-1">·</span>
                    <span className={"font-bold " + (li._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                      {li._source === 'new' ? 'New Item' : li._source === 'catering_store' ? 'CS' : 'Inventory'}
                    </span>
                  </p>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="text-sm font-bold text-gray-800">{li.qty} {li.unit}</p>
                </div>
              </div>
              {li.notes && (
                <p className="text-[11px] text-gray-500 mt-1">{li.notes}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Approval actions */}
      {canApprove && !rejectMode && (
        <div className="flex gap-3">
          <button onClick={function () { setRejectMode(true) }} disabled={saving}
            className="flex-1 py-3 text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
            ✗ Reject
          </button>
          <button onClick={approve} disabled={saving}
            className="flex-1 py-3 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {saving ? 'Approving...' : '✓ Approve'}
          </button>
        </div>
      )}

      {rejectMode && (
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <label className="block text-sm font-medium text-red-700 mb-1">Rejection Reason <span className="text-red-500">*</span></label>
            <textarea value={rejectReason}
              onChange={function (e) { setRejectReason(e.target.value) }}
              rows="3" maxLength="500" placeholder="Reason for rejection..."
              className="w-full px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex gap-3">
            <button onClick={function () { setRejectMode(false); setRejectReason('') }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
            <button onClick={reject} disabled={saving || !rejectReason.trim()}
              className="flex-1 py-3 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Rejecting...' : 'Confirm Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Delete button for owner */}
      {canDelete && !canApprove && (
        <button onClick={deleteReq} disabled={saving}
          className="w-full py-3 text-sm font-bold text-red-500 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
          Delete Requisition
        </button>
      )}
    </div>
  )
}

export default Requisitions
