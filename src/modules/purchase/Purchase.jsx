import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, titleCase, formatPaise } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'

var PAGE_SIZE = 20

var STATUS_LABELS = {
  pending_dept: 'Dept Pending',
  pending: 'Admin Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  procured: 'Procured',
  received: 'Received',
  closed: 'Closed',
}

var STATUS_COLORS = {
  pending_dept: 'bg-yellow-100 text-yellow-700',
  pending: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  procured: 'bg-purple-100 text-purple-700',
  received: 'bg-teal-100 text-teal-700',
  closed: 'bg-gray-100 text-gray-500',
}

var URGENCY_COLORS = {
  low: 'bg-gray-100 text-gray-500',
  normal: 'bg-blue-100 text-blue-600',
  urgent: 'bg-red-100 text-red-600',
}

var UNITS = [
  'Pieces', 'Nos', 'Sets', 'Pairs', 'Dozens',
  'Kg', 'Grams', 'Tons', 'Quintals',
  'Liters', 'ML',
  'Meters', 'CM', 'Feet', 'Yards', 'Inches',
  'Sq.Ft', 'Sq.Mt', 'Cu.Ft', 'Cu.Mt',
  'Rolls', 'Bundles', 'Bunches', 'Packets', 'Bags', 'Cartons', 'Boxes',
  'Bottles', 'Cans', 'Drums', 'Sheets', 'Plates', 'Coils',
  'Trips', 'Hours', 'Days', 'Loads',
]

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
function Purchase({ profile }) {
  var [view, setView] = useState('list')
  var [myReqs, setMyReqs] = useState([])
  var [approvalReqs, setApprovalReqs] = useState([])
  var [loading, setLoading] = useState(true)
  var [loadingMore, setLoadingMore] = useState(false)
  var [myHasMore, setMyHasMore] = useState(false)
  var [approvalHasMore, setApprovalHasMore] = useState(false)
  var [statusFilter, setStatusFilter] = useState('')
  var [detailReq, setDetailReq] = useState(null)
  var [detailItems, setDetailItems] = useState([])
  var [editReq, setEditReq] = useState(null)
  var [editItems, setEditItems] = useState([])

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var isAuditor = profile?.role === 'auditor'
  var perms = profile?.permissions || []
  var isDeptApprover = perms.indexOf('dept_approve') !== -1

  var showApproveTab = isAdmin || isDeptApprover

  // Dept-scoped approval: get approver's department names
  var [approverDeptNames, setApproverDeptNames] = useState([])
  useEffect(function () {
    if (isDeptApprover && !isAdmin) {
      supabase.from('departments').select('id, name, category_ids').eq('active', true).then(function (res) {
        var depts = res.data || []
        var profileCatIds = profile?.category_ids || []
        var matched = depts.filter(function (d) {
          return (d.category_ids || []).some(function (cid) { return profileCatIds.indexOf(cid) !== -1 })
        })
        setApproverDeptNames(matched.map(function (d) { return d.name }))
      })
    }
  }, [])

  useEffect(function () {
    loadMyReqs(false)
    if (showApproveTab) loadApprovalReqs(false)
    setLoading(false)
  }, [])

  async function loadMyReqs(append) {
    var offset = append ? myReqs.length : 0
    if (append) setLoadingMore(true)

    var query = supabase.from('purchase_requests')
      .select('id, department, urgency, vendor_name, justification, status, created_at, needed_by, requested_by, rejection_reason, total_estimated_paise, profiles:requested_by(name)')
      .eq('requested_by', profile.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (statusFilter) query = query.eq('status', statusFilter)

    var { data, error } = await query
    if (error) { alert('Failed to load purchases: ' + error.message); setLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    if (append) {
      setMyReqs(function (prev) { return prev.concat(rows) })
    } else {
      setMyReqs(rows)
    }
    setMyHasMore(hasMore)
    setLoadingMore(false)
  }

  async function loadApprovalReqs(append) {
    var offset = append ? approvalReqs.length : 0
    if (append) setLoadingMore(true)

    var statuses = []
    if (isAdmin || isAuditor) {
      statuses = isDeptApprover ? ['pending_dept', 'pending'] : ['pending']
    } else if (isDeptApprover) {
      statuses = ['pending_dept']
    }
    if (statuses.length === 0) { setApprovalReqs([]); return }

    var query = supabase.from('purchase_requests')
      .select('id, department, urgency, vendor_name, justification, status, created_at, needed_by, requested_by, rejection_reason, total_estimated_paise, profiles:requested_by(name)')
      .neq('requested_by', profile.id)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (isDeptApprover && !isAdmin && !isAuditor && approverDeptNames.length > 0) {
      query = query.in('department', approverDeptNames)
    }

    var { data, error } = await query
    if (error) { alert('Failed to load approvals: ' + error.message); setLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    if (append) {
      setApprovalReqs(function (prev) { return prev.concat(rows) })
    } else {
      setApprovalReqs(rows)
    }
    setApprovalHasMore(hasMore)
    setLoadingMore(false)
  }

  useEffect(function () { loadMyReqs(false) }, [statusFilter])

  async function openDetail(req) {
    setDetailReq(req)
    var { data } = await supabase
      .from('purchase_items')
      .select('id, item_id, item_name, category_id, sub_category_id, _source, qty, unit, estimated_cost_paise, actual_cost_paise, dimensions, notes, categories(name)')
      .eq('purchase_id', req.id)
    setDetailItems(data || [])
    setView('detail')
  }

  function startEdit(req, items) {
    setEditReq(req)
    setEditItems(items)
    setView('form')
  }

  function handleFormDone() {
    setView('list')
    setEditReq(null)
    setEditItems([])
    loadMyReqs(false)
    loadApprovalReqs(false)
  }

  var displayList = view === 'approve' ? approvalReqs : myReqs
  var displayHasMore = view === 'approve' ? approvalHasMore : myHasMore

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
  }

  // ═══════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════
  if (view === 'form') {
    return (
      <PurchaseForm
        profile={profile}
        editReq={editReq}
        editItems={editItems}
        onCancel={function () { setView('list'); setEditReq(null); setEditItems([]) }}
        onSaved={handleFormDone}
      />
    )
  }

  // ═══════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════
  if (view === 'detail' && detailReq) {
    return (
      <PurchaseDetail
        req={detailReq}
        items={detailItems}
        profile={profile}
        isAdmin={isAdmin}
        isDeptApprover={isDeptApprover}
        onBack={function () { setView(detailReq._fromApprove ? 'approve' : 'list'); setDetailReq(null); setDetailItems([]) }}
        onUpdated={function () { loadMyReqs(false); loadApprovalReqs(false); setView(detailReq._fromApprove ? 'approve' : 'list'); setDetailReq(null); setDetailItems([]) }}
        onEdit={function () { startEdit(detailReq, detailItems) }}
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
          <h2 className="text-lg font-bold text-gray-900">Purchase Requests</h2>
          <p className="text-xs text-gray-400">{view === 'approve' ? approvalReqs.length + ' pending approval' : myReqs.length + ' requests'}</p>
        </div>
        <button onClick={function () { setEditReq(null); setEditItems([]); setView('form') }}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
          + New Purchase
        </button>
      </div>

      {/* Tabs */}
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

      {/* Status filter — My Requests only */}
      {view === 'list' && (
        <div className="flex gap-2 flex-wrap">
          {['', 'pending_dept', 'pending', 'approved', 'rejected', 'procured', 'received'].map(function (s) {
            var label = s ? STATUS_LABELS[s] : 'All'
            return (
              <button key={s} onClick={function () { setStatusFilter(s === statusFilter ? '' : s) }}
                className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                  (statusFilter === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400")}>
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* List */}
      {displayList.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-400 text-sm">{view === 'approve' ? 'No pending approvals' : 'No purchase requests yet'}</p>
        </div>
      )}

      <div className="space-y-2">
        {displayList.map(function (req) {
          return (
            <div key={req.id} onClick={function () { openDetail(Object.assign({}, req, { _fromApprove: view === 'approve' })) }}
              className="bg-white rounded-lg border border-gray-200 p-3 hover:border-gray-300 active:bg-gray-50 transition-colors cursor-pointer">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">
                    {req.vendor_name || req.justification || 'Purchase #' + req.id.slice(0, 8)}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {view === 'approve' ? (req.profiles?.name || '—') + ' · ' : ''}
                    {req.department} · {formatDate(req.created_at)}{req.needed_by ? ' · Need by ' + formatDate(req.needed_by) : ''}
                  </p>
                  {req.total_estimated_paise > 0 && (
                    <p className="text-[11px] text-gray-500 mt-0.5 font-medium">Est. {formatPaise(req.total_estimated_paise)}</p>
                  )}
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

      {/* Load More */}
      {displayHasMore && (
        <button onClick={function () {
          if (view === 'approve') loadApprovalReqs(true)
          else loadMyReqs(true)
        }} disabled={loadingMore}
          className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          {loadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// FORM — Multi-item cart
// ═══════════════════════════════════════════════════════════════
function PurchaseForm({ profile, editReq, editItems, onCancel, onSaved }) {
  var [departments, setDepartments] = useState([])
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [inventoryItems, setInventoryItems] = useState([])
  var [department, setDepartment] = useState(editReq ? editReq.department : '')
  var [urgency, setUrgency] = useState(editReq ? editReq.urgency : 'normal')
  var [vendorName, setVendorName] = useState(editReq ? (editReq.vendor_name || '') : '')
  var [justification, setJustification] = useState(editReq ? (editReq.justification || '') : '')
  var [neededBy, setNeededBy] = useState(editReq && editReq.needed_by ? editReq.needed_by : '')
  var [attachment, setAttachment] = useState(null)
  var [cart, setCart] = useState([])
  var [saving, setSaving] = useState(false)
  var [errors, setErrors] = useState({})
  var [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  var searchContainerRef = useRef(null)

  var isEditing = !!editReq

  function emptyCartItem() {
    return { mode: 'existing', item_id: null, item_name: '', category_id: '', sub_category_id: '', qty: '1', unit: 'Pieces', estimated_cost: '', notes: '', _source: 'new', search: '' }
  }

  useEffect(function () {
    if (isEditing && editItems && editItems.length > 0) {
      var prefilled = editItems.map(function (li) {
        return {
          mode: li._source === 'new' ? 'new' : 'existing',
          item_id: li.item_id,
          item_name: li.item_name || '',
          category_id: li.category_id ? String(li.category_id) : '',
          sub_category_id: li.sub_category_id ? String(li.sub_category_id) : '',
          qty: String(li.qty || 1),
          unit: li.unit || 'Pieces',
          estimated_cost: li.estimated_cost_paise ? String(li.estimated_cost_paise / 100) : '',
          notes: li.notes || '',
          _source: li._source || 'new',
          search: li.item_name || '',
        }
      })
      setCart(prefilled)
    } else {
      setCart([emptyCartItem()])
    }
  }, [])

  useEffect(function () { loadLookups() }, [])

  // Click-outside to close search dropdown
  useEffect(function () {
    function handleClickOutside(e) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setActiveSearchIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return function () {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [])

  async function loadLookups() {
    var [deptRes, catRes, subCatRes, invRes, csRes] = await Promise.all([
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('categories').select('id, name, sub_department_id').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name'),
      supabase.from('inventory_items')
        .select('id, name, unit, qty, category_id, status, categories(name)')
        .in('status', ['approved', 'pending', 'pending_dept'])
        .order('name')
        .limit(2000),
      supabase.from('catering_store_items')
        .select('id, name, unit, qty, category_id, status, categories(name)')
        .in('status', ['approved', 'pending', 'pending_dept'])
        .order('name')
        .limit(2000),
    ])
    setDepartments(deptRes.data || [])
    setCategories(catRes.data || [])
    setSubCategories(subCatRes.data || [])

    var inv = (invRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
    var cs = (csRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store' }) })
    setInventoryItems(inv.concat(cs))
  }

  function updateCart(index, field, value) {
    setCart(function (prev) {
      return prev.map(function (item, i) {
        if (i !== index) return item
        return Object.assign({}, item, { [field]: value })
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
    setActiveSearchIndex(-1)
  }

  function toggleMode(index) {
    setCart(function (prev) {
      return prev.map(function (item, i) {
        if (i !== index) return item
        var newMode = item.mode === 'existing' ? 'new' : 'existing'
        return Object.assign({}, emptyCartItem(), { mode: newMode, qty: item.qty, notes: item.notes, estimated_cost: item.estimated_cost })
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

  // Total estimated cost
  var totalCostPaise = 0
  cart.forEach(function (c) {
    if (c.estimated_cost && Number(c.estimated_cost) > 0) {
      totalCostPaise += Math.round(Number(c.estimated_cost) * 100)
    }
  })

  function validate() {
    var errs = {}
    if (!department) errs.dept = 'Department required'
    if (!justification.trim()) errs.justification = 'Justification required'
    var validItems = cart.filter(function (c) { return c.item_name.trim() && Number(c.qty) > 0 })
    if (validItems.length === 0) errs.cart = 'Add at least one item with qty'
    // Cost required for each item
    var missingCost = validItems.some(function (c) { return !c.estimated_cost || Number(c.estimated_cost) <= 0 })
    if (missingCost) errs.cart = 'Estimated cost required for each item'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    try {
      var lineItems = cart
        .filter(function (c) { return c.item_name.trim() && Number(c.qty) > 0 })
        .map(function (c) {
          return {
            item_id: c.mode === 'existing' && c.item_id ? c.item_id : null,
            item_name: c.item_name.trim(),
            category_id: c.category_id ? Number(c.category_id) : null,
            sub_category_id: c.sub_category_id ? Number(c.sub_category_id) : null,
            _source: c.mode === 'existing' ? c._source : 'new',
            qty: Number(c.qty),
            unit: c.unit,
            estimated_cost_paise: Math.round(Number(c.estimated_cost) * 100),
            notes: c.notes.trim() || null,
          }
        })

      var totalEstPaise = 0
      lineItems.forEach(function (li) { totalEstPaise += li.estimated_cost_paise })

      // Upload attachment if present
      var attachPath = editReq?.attachment_path || null
      if (attachment) {
        var ext = attachment.name.split('.').pop()
        var fileName = profile.id + '/' + Date.now() + '.' + ext
        var { error: upErr } = await supabase.storage.from('receipts').upload(fileName, attachment)
        if (!upErr) attachPath = fileName
      }

      if (isEditing) {
        var { error: updErr } = await supabase.from('purchase_requests').update({
          department: department,
          urgency: urgency,
          vendor_name: vendorName.trim() || null,
          justification: justification.trim(),
          needed_by: neededBy || null,
          attachment_path: attachPath,
          total_estimated_paise: totalEstPaise,
        }).eq('id', editReq.id)
        if (updErr) throw new Error(updErr.message)

        var { error: delErr } = await supabase.from('purchase_items').delete().eq('purchase_id', editReq.id)
        if (delErr) throw new Error(delErr.message)

        if (lineItems.length > 0) {
          var itemsWithId = lineItems.map(function (li) { return Object.assign({}, li, { purchase_id: editReq.id }) })
          var { error: insErr } = await supabase.from('purchase_items').insert(itemsWithId)
          if (insErr) throw new Error(insErr.message)
        }

        try { await logActivity('PURCHASE_EDIT', justification.trim() + ' | ' + lineItems.length + ' items | ' + formatPaise(totalEstPaise)) } catch (_) {}
      } else {
        // Status logic — same as requisitions
        var selfIsDeptApprover = (profile?.permissions || []).indexOf('dept_approve') !== -1
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

        var { data: req, error: reqErr } = await supabase.from('purchase_requests').insert({
          requested_by: profile.id,
          department: department,
          purchase_type: 'general',
          urgency: urgency,
          vendor_name: vendorName.trim() || null,
          justification: justification.trim(),
          needed_by: neededBy || null,
          attachment_path: attachPath,
          status: status,
          dept_approved_by: deptApprovedBy,
          dept_approved_at: deptApprovedAt,
          total_estimated_paise: totalEstPaise,
        }).select('id').single()
        if (reqErr) throw new Error(reqErr.message)

        if (lineItems.length > 0) {
          var itemsWithReqId = lineItems.map(function (li) { return Object.assign({}, li, { purchase_id: req.id }) })
          var { error: itemErr } = await supabase.from('purchase_items').insert(itemsWithReqId)
          if (itemErr) throw new Error(itemErr.message)
        }

        try { await logActivity('PURCHASE_CREATE', justification.trim() + ' | ' + lineItems.length + ' items | ' + formatPaise(totalEstPaise)) } catch (_) {}
      }

      setSaving(false)
      onSaved()
    } catch (err) {
      alert('Save failed: ' + err.message)
      setSaving(false)
    }
  }

  var deptItems = departments.map(function (d) { return { label: d.name, value: d.name } })
  var catItems = categories.map(function (c) { return { label: c.name, value: String(c.id) } })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{isEditing ? 'Edit Purchase' : 'New Purchase Request'}</h2>
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600">Cancel</button>
      </div>

      {/* Request info card */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <SearchDropdown label="Department" required items={deptItems} value={department} onChange={setDepartment} placeholder="Select dept..." error={errors.dept} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Urgency</label>
            <div className="flex gap-0 bg-white border border-gray-300 rounded-md overflow-hidden">
              {['low', 'normal', 'urgent'].map(function (u) {
                var colors = { low: 'bg-gray-600 text-white', normal: 'bg-blue-600 text-white', urgent: 'bg-red-600 text-white' }
                return (
                  <button key={u} type="button" onClick={function () { setUrgency(u) }}
                    className={"flex-1 py-2 text-sm font-medium transition-colors capitalize " + (urgency === u ? colors[u] : "text-gray-500 hover:bg-gray-50")}>
                    {u}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name</label>
          <input type="text" value={vendorName} onChange={function (e) { setVendorName(e.target.value) }}
            maxLength="200" placeholder="Vendor / supplier name"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ fontSize: '16px' }} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Justification <span className="text-red-500">*</span></label>
          <textarea value={justification} onChange={function (e) { setJustification(e.target.value) }}
            rows="2" maxLength="500" placeholder="Why is this purchase needed?"
            className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none " + (errors.justification ? "border-red-300" : "border-gray-300")}
            style={{ fontSize: '16px' }} />
          {errors.justification && <p className="text-xs text-red-500 mt-1">{errors.justification}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Needed By</label>
            <input type="date" value={neededBy} onChange={function (e) { setNeededBy(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quote / Receipt</label>
            <input type="file" accept="image/*,application/pdf" onChange={function (e) { setAttachment(e.target.files[0] || null) }}
              className="w-full text-sm text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-600" />
          </div>
        </div>
      </div>

      {/* Cart items */}
      <div className="space-y-3" ref={searchContainerRef}>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Items</h3>
          <button type="button" onClick={addCartItem}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">+ Add Item</button>
        </div>
        {errors.cart && <p className="text-xs text-red-500">{errors.cart}</p>}

        {cart.map(function (item, index) {
          var searchResults = []
          if (item.mode === 'existing' && item.search.trim().length >= 2 && activeSearchIndex === index && !item.item_id) {
            var q = item.search.toLowerCase()
            searchResults = inventoryItems.filter(function (inv) {
              return inv.name.toLowerCase().indexOf(q) !== -1 || (inv.categories?.name || '').toLowerCase().indexOf(q) !== -1
            }).slice(0, 8)
          }

          var filteredSubCats = item.category_id ? subCategories.filter(function (sc) { return String(sc.category_id) === item.category_id }) : []

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
                    onFocus={function () { setActiveSearchIndex(index) }}
                    onChange={function (e) {
                      updateCart(index, 'search', e.target.value)
                      setActiveSearchIndex(index)
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
                  {searchResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map(function (inv) {
                        return (
                          <button key={inv._source + '-' + inv.id} type="button"
                            onClick={function () { selectInventoryItem(index, inv) }}
                            className="w-full text-left px-3 py-2 hover:bg-indigo-50 active:bg-indigo-100 transition-colors border-b border-gray-100 last:border-0">
                            <p className="text-sm font-medium text-gray-800">{titleCase(inv.name)}</p>
                            <p className="text-[11px] text-gray-400">{inv.categories?.name || '—'} · {inv.unit} · <span className={"font-bold " + (inv.qty > 0 ? "text-green-600" : "text-red-500")}>{inv.qty} in stock</span> · {inv._source === 'catering_store' ? 'CS' : 'INV'}</p>
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
                    placeholder="Item name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    style={{ fontSize: '16px' }} />
                  <div className="grid grid-cols-2 gap-2">
                    <SearchDropdown label="Category" items={catItems} value={item.category_id}
                      onChange={function (val) { updateCart(index, 'category_id', val); updateCart(index, 'sub_category_id', '') }}
                      placeholder="Category..." />
                    <SearchDropdown label="Sub-Category"
                      items={filteredSubCats.map(function (sc) { return { label: sc.name, value: String(sc.id) } })}
                      value={item.sub_category_id}
                      onChange={function (val) { updateCart(index, 'sub_category_id', val) }}
                      placeholder="Sub-cat..." />
                  </div>
                </div>
              )}

              {/* Common fields: qty, unit, cost, notes */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-gray-400 mb-0.5">Qty</label>
                  <input type="number" min="0" step="any" inputMode="decimal" value={item.qty}
                    onChange={function (e) { updateCart(index, 'qty', e.target.value) }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-0.5">Unit</label>
                  <select value={item.unit} onChange={function (e) { updateCart(index, 'unit', e.target.value) }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                    {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-0.5">Est. Cost (₹)</label>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={item.estimated_cost}
                    onChange={function (e) { updateCart(index, 'estimated_cost', e.target.value) }}
                    placeholder="0.00"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <input type="text" value={item.notes} onChange={function (e) { updateCart(index, 'notes', e.target.value) }}
                placeholder="Notes (optional)" maxLength="300"
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '14px' }} />
            </div>
          )
        })}
      </div>

      {/* Total + Submit */}
      <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4 space-y-3">
        {totalCostPaise > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-gray-700">Total Estimated</span>
            <span className="text-lg font-bold text-indigo-700">{formatPaise(totalCostPaise)}</span>
          </div>
        )}
        <button onClick={handleSubmit} disabled={saving}
          className="w-full py-3 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 transition-colors">
          {saving ? (isEditing ? 'Updating...' : 'Submitting...') : (isEditing ? 'Update Request' : 'Submit Request')}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// DETAIL + APPROVAL VIEW
// ═══════════════════════════════════════════════════════════════
function PurchaseDetail({ req, items, profile, isAdmin, isDeptApprover, onBack, onUpdated, onEdit }) {
  var [saving, setSaving] = useState(false)
  var [rejectMode, setRejectMode] = useState(false)
  var [rejectReason, setRejectReason] = useState('')

  var canDeptApprove = isDeptApprover && req.status === 'pending_dept' && req.requested_by !== profile?.id
  var canAdminApprove = isAdmin && req.status === 'pending'
  var canApprove = canDeptApprove || canAdminApprove
  var canDelete = (req.requested_by === profile?.id && (req.status === 'pending_dept' || req.status === 'pending')) || isAdmin
  var canEdit = req.requested_by === profile?.id && (req.status === 'pending_dept' || req.status === 'pending')

  var totalPaise = 0
  items.forEach(function (li) {
    if (li.estimated_cost_paise) totalPaise += li.estimated_cost_paise
  })

  async function approve() {
    if (saving) return
    setSaving(true)
    var update = {}
    if (canDeptApprove) {
      update = { status: 'pending', dept_approved_by: profile.id, dept_approved_at: new Date().toISOString() }
    } else if (canAdminApprove) {
      update = { status: 'approved', reviewed_by: profile.id, reviewed_at: new Date().toISOString() }
    }
    var { error } = await supabase.from('purchase_requests').update(update).eq('id', req.id)
    if (error) { alert('Approve failed: ' + error.message); setSaving(false); return }
    try { await logActivity('PURCHASE_APPROVE', (req.justification || 'Purchase #' + req.id.slice(0, 8)) + ' | ' + (canDeptApprove ? 'dept' : 'admin')) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function reject() {
    if (saving) return
    if (!rejectReason.trim()) return
    setSaving(true)
    var { error } = await supabase.from('purchase_requests').update({
      status: 'rejected',
      rejection_reason: rejectReason.trim(),
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', req.id)
    if (error) { alert('Reject failed: ' + error.message); setSaving(false); return }
    try { await logActivity('PURCHASE_REJECT', (req.justification || 'Purchase #' + req.id.slice(0, 8)) + ' | ' + rejectReason.trim()) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function deleteReq() {
    if (!confirm('Delete this purchase request? This cannot be undone.')) return
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('purchase_requests').delete().eq('id', req.id)
    if (error) { alert('Delete failed: ' + error.message); setSaving(false); return }
    try { await logActivity('PURCHASE_DELETE', req.justification || 'Purchase #' + req.id.slice(0, 8)) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
        {canDelete && (
          <button onClick={deleteReq} disabled={saving}
            className="text-xs text-red-400 hover:text-red-600 font-medium disabled:opacity-50">Delete</button>
        )}
      </div>

      {/* Info card */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (STATUS_COLORS[req.status] || '')}>
            {STATUS_LABELS[req.status] || req.status}
          </span>
          <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (URGENCY_COLORS[req.urgency] || '')}>
            {req.urgency}
          </span>
        </div>
        <p className="text-sm font-bold text-gray-800">{req.justification || 'Purchase Request'}</p>
        <div className="text-[11px] text-gray-400 space-y-0.5">
          <p>By: {req.profiles?.name || '—'} · {req.department}</p>
          <p>Created: {formatDate(req.created_at)}{req.needed_by ? ' · Need by: ' + formatDate(req.needed_by) : ''}</p>
          {req.vendor_name && <p>Vendor: <span className="text-gray-600 font-medium">{req.vendor_name}</span></p>}
        </div>
        {totalPaise > 0 && (
          <p className="text-sm font-bold text-indigo-700">Est. Total: {formatPaise(totalPaise)}</p>
        )}
        {req.status === 'rejected' && req.rejection_reason && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 mt-2">
            <p className="text-[11px] text-red-600 font-medium">Rejected: {req.rejection_reason}</p>
          </div>
        )}
        {req.attachment_path && (
          <a href={supabase.storage.from('receipts').getPublicUrl(req.attachment_path).data.publicUrl}
            target="_blank" rel="noopener noreferrer"
            className="inline-block text-[11px] text-indigo-600 font-medium hover:underline mt-1">
            📎 View Attachment
          </a>
        )}
      </div>

      {/* Items */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{items.length + ' Item' + (items.length !== 1 ? 's' : '')}</h3>
        {items.map(function (li) {
          return (
            <div key={li.id} className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{titleCase(li.item_name)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {li.categories?.name || '—'} · <span className={"font-medium " + (li._source === 'new' ? "text-amber-600" : "text-indigo-600")}>
                      {li._source === 'new' ? 'New Item' : li._source === 'catering_store' ? 'CS' : 'Inventory'}
                    </span>
                  </p>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="text-sm font-bold text-gray-800">{li.qty} {li.unit}</p>
                  {li.estimated_cost_paise && <p className="text-[11px] text-gray-400">Est. {formatPaise(li.estimated_cost_paise)}</p>}
                  {li.actual_cost_paise && <p className="text-[11px] text-green-600 font-medium">Actual: {formatPaise(li.actual_cost_paise)}</p>}
                </div>
              </div>
              {li.notes && <p className="text-[11px] text-gray-500 mt-1">{li.notes}</p>}
            </div>
          )
        })}
      </div>

      {/* Edit */}
      {canEdit && (
        <button onClick={onEdit} disabled={saving}
          className="w-full py-3 text-sm font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          ✎ Edit Purchase Request
        </button>
      )}

      {/* Approval */}
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
    </div>
  )
}

export default Purchase
