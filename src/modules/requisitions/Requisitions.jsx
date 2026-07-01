import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { titleCase, formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { useRealtime } from '../../lib/useRealtime'
import Modal from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from '../../lib/constants'
import EventDatePicker from '../../components/ui/EventDatePicker'
import { filterUserCategories } from '../../lib/categories'
import { pushBack, goBack as navBack } from '../../lib/backNav'

var PAGE_SIZE = 20
var URGENCY_COLORS = {
  low: 'bg-gray-100 text-gray-600',
  normal: 'bg-blue-100 text-blue-700',
  urgent: 'bg-red-100 text-red-700',
}

var UNITS = [
  'Pieces', 'Nos', 'Sets', 'Pairs', 'Dozens',
  'Kg', 'Grams', 'Liters', 'ML',
  'Meters', 'Feet', 'Rolls', 'Packets', 'Bags',
  'Boxes', 'Cartons', 'Bottles', 'Sheets', 'Reams',
]

function Requisitions({ profile, onBack }) {
  var [view, setView] = useState('list') // list | form | detail | approve
  var [myReqs, setMyReqs] = useState([])
  var [approvalReqs, setApprovalReqs] = useState([])
  var [myHasMore, setMyHasMore] = useState(false)
  var [approvalHasMore, setApprovalHasMore] = useState(false)
  var [loading, setLoading] = useState(true)
  var [loadingMore, setLoadingMore] = useState(false)
  useRealtime(['requisitions', 'requisition_items'], function () { loadMyReqs(false); loadApprovalReqs(false) })
  var [detailReq, setDetailReq] = useState(null)
  var [detailItems, setDetailItems] = useState([])
  var [statusFilter, setStatusFilter] = useState('')
  var [editReq, setEditReq] = useState(null)
  var [editItems, setEditItems] = useState([])
  var [departments, setDepartments] = useState([])

  var isAdmin = profile?.role === 'admin' || (profile?.permissions && profile.permissions.indexOf('feature_requisitions') >= 0 && (profile.permissions.indexOf('dept_approve') >= 0 || profile.permissions.indexOf('admin_approve') >= 0))
  var isAuditor = profile?.role === 'auditor'
  var isDeptApprover = (profile?.permissions || []).indexOf('dept_approve') !== -1
  var hasReqApprove = isAdmin || isAuditor || isDeptApprover
  var showApproveTab = hasReqApprove && (profile?.permissions || []).indexOf('feature_requisitions') !== -1

  // Derive dept names for scoping non-admin dept approvers
  var approverDeptNames = []
  if (isDeptApprover && !isAdmin && !isAuditor) {
    var deptIds = profile?.event_dept_ids || []
    if (deptIds.length > 0) {
      approverDeptNames = departments.filter(function (d) { return deptIds.indexOf(d.id) !== -1 }).map(function (d) { return d.name })
    }
  }

  useEffect(function () {
    supabase.from('departments').select('id, name').eq('active', true).then(function (res) {
      setDepartments(res.data || [])
    })
  }, [])

  useEffect(function () {
    if (departments.length === 0) return
    loadMyReqs(false)
    loadApprovalReqs(false)
  }, [statusFilter, departments])

  async function loadMyReqs(append) {
    var offset = append ? myReqs.length : 0
    if (!append) setLoading(true)
    else setLoadingMore(true)

    var query = supabase.from('requisitions')
      .select('id, department, urgency, purpose, status, created_at, needed_by, requested_by, rejection_reason, event_id, sub_department_id, category_id, sub_category_id, req_type, expense_type_id, expense_sub_type_id, expense_amount_paise, expense_date, receipt_path, expense_alloc_json, events(event_name), expense_types(name), expense_sub_types(name), profiles:requested_by(name), categories(name), sub_departments(name)')
      .eq('requested_by', profile.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (statusFilter) query = query.eq('status', statusFilter)

    var { data, error } = await query
    if (error) { alert('Failed to load: ' + error.message); setLoading(false); setLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    if (append) {
      setMyReqs(function (prev) { return prev.concat(rows) })
    } else {
      setMyReqs(rows)
    }
    setMyHasMore(hasMore)
    setLoading(false)
    setLoadingMore(false)
  }

  async function loadApprovalReqs(append) {
    if (!showApproveTab) { setApprovalReqs([]); return }

    var offset = append ? approvalReqs.length : 0
    if (append) setLoadingMore(true)

    var statuses = []
    if (isAdmin || isAuditor) {
      statuses = isDeptApprover ? ['pending_dept', 'pending'] : ['pending']
    } else if (isDeptApprover) {
      statuses = ['pending_dept']
    }
    if (statuses.length === 0) { setApprovalReqs([]); return }

    var query = supabase.from('requisitions')
      .select('id, department, urgency, purpose, status, created_at, needed_by, requested_by, rejection_reason, req_type, expense_type_id, expense_sub_type_id, expense_amount_paise, expense_date, receipt_path, expense_alloc_json, expense_types(name), expense_sub_types(name)')
      .neq('requested_by', profile.id)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    // Dept-scoped: non-admin dept approvers only see their departments
    if (isDeptApprover && !isAdmin && !isAuditor && approverDeptNames.length > 0) {
      query = query.in('department', approverDeptNames)
    }

    var { data, error } = await query
    if (error) { alert('Failed to load approvals: ' + error.message); setLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)
    // Resolve requester names
    var rUserIds = []
    rows.forEach(function (r) { if (r.requested_by && rUserIds.indexOf(r.requested_by) === -1) rUserIds.push(r.requested_by) })
    if (rUserIds.length > 0) {
      var { data: rNames } = await supabase.rpc('get_profile_names', { p_ids: rUserIds })
      var rMap = {}
      ;(rNames || []).forEach(function (n) { rMap[n.id] = n.name })
      rows = rows.map(function (r) { return Object.assign({}, r, { profiles: { name: rMap[r.requested_by] || null } }) })
    }

    if (append) {
      setApprovalReqs(function (prev) { return prev.concat(rows) })
    } else {
      setApprovalReqs(rows)
    }
    setApprovalHasMore(hasMore)
    setLoadingMore(false)
  }

  async function openDetail(req) {
    pushBack(function () { setView(req._fromApprove ? 'approve' : 'list'); setDetailReq(null); setDetailItems([]) })
    setDetailReq(req)
    if (req.req_type === 'expense') {
      var allocRows = req.expense_alloc_json || []
      if (allocRows.length > 0) {
        var vIds = allocRows.map(function (r) { return r.venue_id }).filter(Boolean)
        var dIds = allocRows.map(function (r) { return r.department_id }).filter(Boolean)
        var sdIds = allocRows.map(function (r) { return r.sub_department_id }).filter(Boolean)
        Promise.all([
          vIds.length > 0 ? supabase.from('venues').select('id, code, name').in('id', vIds) : { data: [] },
          dIds.length > 0 ? supabase.from('departments').select('id, name').in('id', dIds) : { data: [] },
          sdIds.length > 0 ? supabase.from('sub_departments').select('id, name').in('id', sdIds) : { data: [] }
        ]).then(function (results) {
          var nameMap = {}
          ;(results[0].data || []).forEach(function (v) { nameMap['v_' + v.id] = v.code || v.name })
          ;(results[1].data || []).forEach(function (d) { nameMap['d_' + d.id] = d.name })
          ;(results[2].data || []).forEach(function (sd) { nameMap['sd_' + sd.id] = sd.name })
          setDetailItems(allocRows.map(function (r) { return Object.assign({}, r, { _names: nameMap }) }))
        })
      } else {
        setDetailItems([])
      }
      setView('detail')
      return
    }
    var { data } = await supabase
      .from('requisition_items')
      .select('id, item_id, item_name, category_id, qty, unit, notes, _source, estimated_cost_paise, po_item_id, item_status, fulfillment_type, dispatched_by, dispatched_at, dispatched_note, acknowledged_at, auto_acknowledged, categories(name), requisition_item_allocations(venue_id, qty)')
      .eq('requisition_id', req.id)
    setDetailItems(data || [])
    setView('detail')
  }

  function startEdit(req, items) {
    pushBack(function () { setView('list'); setEditReq(null); setEditItems([]) })
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
      <RequisitionForm
        profile={profile}
        editReq={editReq}
        editItems={editItems}
        onCancel={function () { navBack() }}
        onSaved={handleFormDone}
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
        onBack={function () { navBack() }}
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
          <h2 className="text-lg font-bold text-gray-900">Requisitions</h2>
          <p className="text-xs text-gray-400">{view === 'approve' ? approvalReqs.length + ' pending approval' : myReqs.length + ' requests'}</p>
        </div>
        <button onClick={function () { pushBack(function () { setView('list'); setEditReq(null); setEditItems([]) }); setEditReq(null); setEditItems([]); setView('form') }}
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

      {/* Status filter — only on My Requests tab */}
      {view === 'list' && (
        <div className="flex gap-2 flex-wrap">
          {['', 'pending_dept', 'pending', 'approved', 'rejected', 'fulfilled', 'deleted'].map(function (s) {
            var label = s ? APPROVAL_STATUS_LABELS[s] : 'All'
            return (
              <button key={s} onClick={function () { setStatusFilter(s === statusFilter ? '' : s) }}
                className={"px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors " +
                  (statusFilter === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                {label}
              </button>
            )
          })}
        </div>
      )}

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
                  <p className="text-xs text-gray-400 mt-0.5">
                    {view === 'approve' ? (req.profiles?.name || '—') + ' · ' : ''}
                    {req.department} · {formatDate(req.created_at)}{req.needed_by ? ' · Need by ' + formatDate(req.needed_by) : ''}
                    {req.events?.event_name ? ' · 📅 ' + req.events.event_name : ''}
                  </p>
                </div>
                <div className="flex gap-1.5 flex-shrink-0 ml-2">
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (URGENCY_COLORS[req.urgency] || '')}>
                    {req.urgency}
                  </span>
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (APPROVAL_STATUS_COLORS[req.status] || '')}>
                    {APPROVAL_STATUS_LABELS[req.status] || req.status}
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
// FORM — Multi-item cart (supports create + edit)
// ═══════════════════════════════════════════════════════════════
function RequisitionForm({ profile, editReq, editItems, onCancel, onSaved }) {
  var [departments, setDepartments] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [venues, setVenues] = useState([])
  var [inventoryItems, setInventoryItems] = useState([])
  var [department, setDepartment] = useState(editReq ? editReq.department : '')
  var [subDeptId, setSubDeptId] = useState(editReq?.sub_department_id ? String(editReq.sub_department_id) : '')
  var [categoryId, setCategoryId] = useState(editReq?.category_id ? String(editReq.category_id) : '')
  var [subCategoryId, setSubCategoryId] = useState(editReq?.sub_category_id ? String(editReq.sub_category_id) : '')
  var [urgency, setUrgency] = useState(editReq ? editReq.urgency : 'normal')
  var [purpose, setPurpose] = useState(editReq ? (editReq.purpose || '') : '')
  var [neededBy, setNeededBy] = useState(editReq && editReq.needed_by ? editReq.needed_by : '')
  var [cart, setCart] = useState([])
  var [saving, setSaving] = useState(false)
  var [errors, setErrors] = useState({})
  var [activeSearchIndex, setActiveSearchIndex] = useState(-1)
  var [eventId, setEventId] = useState(editReq?.event_id ? String(editReq.event_id) : '')
  var [eventDate, setEventDate] = useState('')
  var [events, setEvents] = useState([])
  var [eventsLoading, setEventsLoading] = useState(false)
  var [isFunction, setIsFunction] = useState(!!editReq?.event_id)
  var [reqType, setReqType] = useState(editReq?.req_type || '')
  var [expenseTypes, setExpenseTypes] = useState([])
  var [expTypeId, setExpTypeId] = useState(editReq?.expense_type_id ? String(editReq.expense_type_id) : '')
  var [expAmount, setExpAmount] = useState(editReq?.expense_amount_paise ? String(editReq.expense_amount_paise / 100) : '')
  var [expDate, setExpDate] = useState(editReq?.expense_date || new Date().toISOString().slice(0, 10))
  var [expReceipt, setExpReceipt] = useState(null)
  var [expSubTypeId, setExpSubTypeId] = useState(editReq?.expense_sub_type_id ? String(editReq.expense_sub_type_id) : '')
  var [expSubTypes, setExpSubTypes] = useState([])
  var [expSubTypeFields, setExpSubTypeFields] = useState([])
  var [expFieldValues, setExpFieldValues] = useState({})
  var [expTypeSearch, setExpTypeSearch] = useState('')
  var [expTypeOpen, setExpTypeOpen] = useState(false)
  var [expAllocations, setExpAllocations] = useState(function () {
    if (editReq && editReq.expense_alloc_json && editReq.expense_alloc_json.length > 0) {
      return editReq.expense_alloc_json.map(function (a) {
        return { departmentId: a.department_id ? String(a.department_id) : '', subDepartmentId: a.sub_department_id ? String(a.sub_department_id) : '', venue_id: a.venue_id ? String(a.venue_id) : '', amount: a.amount_paise ? String(a.amount_paise / 100) : '' }
      })
    }
    return [{ departmentId: '', subDepartmentId: '', venue_id: '', amount: '' }]
  })
  var [listening, setListening] = useState(false)
  var searchContainerRef = useRef(null)
  var recognitionRef = useRef(null)

  var isEditing = !!editReq
  var SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

  function emptyCartItem() {
    return { mode: 'existing', item_id: null, item_name: '', category_id: '', qty: '1', unit: 'Pieces', notes: '', _source: 'new', search: '', estimated_cost: '', allocations: [{ venue_id: '', qty: '' }] }
  }

  // Initialize cart — empty for new, pre-filled for edit
  useEffect(function () {
    if (isEditing && editItems && editItems.length > 0) {
      var prefilled = editItems.map(function (li) {
        return {
          mode: li._source === 'new' ? 'new' : 'existing',
          item_id: li.item_id,
          item_name: li.item_name || '',
          category_id: li.category_id ? String(li.category_id) : '',
          qty: String(li.qty || 1),
          unit: li.unit || 'Pieces',
          notes: li.notes || '',
          _source: li._source || 'new',
          search: li.item_name || '',
          estimated_cost: li.estimated_cost_paise ? String(li.estimated_cost_paise / 100) : '',
          allocations: li.requisition_item_allocations && li.requisition_item_allocations.length > 0
            ? li.requisition_item_allocations.map(function (a) { return { venue_id: String(a.venue_id), qty: String(a.qty) } })
            : [{ venue_id: '', qty: '' }],
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

  // Stop dictation on unmount
  useEffect(function () {
    return function () { if (recognitionRef.current) { try { recognitionRef.current.stop() } catch (_) {} } }
  }, [])

  function toggleDictation() {
    if (!SpeechRec) return
    if (listening) {
      if (recognitionRef.current) { try { recognitionRef.current.stop() } catch (_) {} }
      return
    }
    var rec = new SpeechRec()
    rec.lang = 'en-IN'
    rec.interimResults = false
    rec.continuous = true
    rec.onresult = function (e) {
      var txt = ''
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) txt += e.results[i][0].transcript
      }
      if (txt.trim()) {
        setPurpose(function (prev) {
          var next = (prev ? prev + ' ' : '') + txt.trim()
          return next.slice(0, 500)
        })
      }
    }
    rec.onerror = function () { setListening(false) }
    rec.onend = function () { setListening(false); recognitionRef.current = null }
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }

  async function loadLookups() {
    var [deptRes, subDeptRes, catRes, subCatRes, venueRes, expTypeRes, expSubTypeRes, invRes, csRes] = await Promise.all([
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name'),
      supabase.from('categories').select('id, name, sub_department_id, expense_type_ids').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name'),
      supabase.from('venues').select('id, code, name').order('name'),
      supabase.from('expense_types').select('id, name').eq('active', true).order('name'),
      supabase.from('expense_sub_types').select('id, expense_type_id, name, extra_fields, active, sort_order').eq('active', true).order('sort_order').order('name'),
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
    setSubDepartments(subDeptRes.data || [])
    setCategories(catRes.data || [])
    setSubCategories(subCatRes.data || [])
    setVenues(venueRes.data || [])
    setExpenseTypes(expTypeRes.data || [])
    setExpSubTypes(expSubTypeRes.data || [])

    // If editing, pre-load the linked event's date
    if (editReq?.event_id) {
      var { data: evtRow } = await supabase.from('events').select('id, event_name, contract_date, function_date, contract_type, venue_name, session, client_name').eq('id', editReq.event_id).maybeSingle()
      if (evtRow) {
        setEventDate(evtRow.function_date?.slice(0, 10) || evtRow.contract_date?.slice(0, 10) || '')
        setEvents([evtRow])
      }
    }

    var inv = (invRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
    var cs = (csRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store' }) })
    setInventoryItems(inv.concat(cs))
  }

  async function loadEventsByDate(dateStr) {
    if (!dateStr) { setEvents([]); setEventId(''); return }
    setEventsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, contract_date, function_date, contract_type, venue_name, session, client_name')
      .eq('function_date', dateStr)
      .order('event_name')
    var rows = data || []
    setEvents(rows)
    setEventsLoading(false)
    if (rows.length === 1) { setEventId(String(rows[0].id)) }
    else if (!rows.some(function (r) { return String(r.id) === eventId })) { setEventId('') }
  }

  function changeDepartment(name) {
    setDepartment(name)
    setSubDeptId('')
    setCategoryId('')
    setSubCategoryId('')
  }

  function changeSubDept(val) {
    setSubDeptId(val)
    setCategoryId('')
    setSubCategoryId('')
  }

  function changeCategory(val) {
    setCategoryId(val)
    setSubCategoryId('')
  }

  function toggleFunction(val) {
    setIsFunction(val)
    if (!val) { setEventId(''); setEventDate(''); setEvents([]) }
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
    setActiveSearchIndex(-1)
  }

  function toggleMode(index) {
    setCart(function (prev) {
      return prev.map(function (item, i) {
        if (i !== index) return item
        var newMode = item.mode === 'existing' ? 'new' : 'existing'
        return Object.assign({}, emptyCartItem(), { mode: newMode, qty: item.qty, notes: item.notes, allocations: item.allocations })
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

  function updateAllocation(cartIndex, allocIndex, field, value) {
    setCart(function (prev) {
      return prev.map(function (item, i) {
        if (i !== cartIndex) return item
        var allocs = item.allocations.map(function (a, j) {
          if (j !== allocIndex) return a
          return Object.assign({}, a, { [field]: value })
        })
        return Object.assign({}, item, { allocations: allocs })
      })
    })
  }

  function addAllocation(cartIndex) {
    setCart(function (prev) {
      return prev.map(function (item, i) {
        if (i !== cartIndex) return item
        return Object.assign({}, item, { allocations: item.allocations.concat([{ venue_id: '', qty: '' }]) })
      })
    })
  }

  function removeAllocation(cartIndex, allocIndex) {
    setCart(function (prev) {
      return prev.map(function (item, i) {
        if (i !== cartIndex) return item
        if (item.allocations.length <= 1) return item
        return Object.assign({}, item, { allocations: item.allocations.filter(function (_, j) { return j !== allocIndex }) })
      })
    })
  }

  // Total estimated cost (live)
  var totalCostPaise = 0
  cart.forEach(function (c) {
    if (c.estimated_cost && Number(c.estimated_cost) > 0) {
      totalCostPaise += Math.round(Number(c.estimated_cost) * 100)
    }
  })

 // Classification cascade (dept name → sub-dept → category → sub-category)
  var selectedDept = departments.filter(function (d) { return d.name === department })[0]
  var deptSubDepts = selectedDept ? subDepartments.filter(function (sd) { return sd.department_id === selectedDept.id }) : []
  var userCatIds = profile?.category_ids || []
  var isUnrestricted = !userCatIds.length || profile?.role === 'admin' || profile?.role === 'auditor'
  var subDeptCats = subDeptId ? filterUserCategories(categories, profile).filter(function (c) {
    return c.sub_department_id === Number(subDeptId)
  }) : []
  var catSubCats = categoryId ? subCategories.filter(function (sc) { return sc.category_id === Number(categoryId) }) : []
  var selectedCatObj = categoryId ? categories.find(function (c) { return c.id === Number(categoryId) }) : null
  var catExpTypeIds = selectedCatObj && Array.isArray(selectedCatObj.expense_type_ids) && selectedCatObj.expense_type_ids.length > 0 ? selectedCatObj.expense_type_ids : null
  var filteredExpTypes = catExpTypeIds ? expenseTypes.filter(function (et) { return catExpTypeIds.indexOf(et.id) !== -1 }) : expenseTypes

  function validate() {
    var errs = {}
    if (!department) errs.dept = 'Department required'
    if (!purpose.trim()) errs.purpose = 'Purpose required'
    if (reqType === 'expense') {
      if (!expAmount || Number(expAmount) <= 0) errs.cart = 'Amount required'
      setErrors(errs)
      return Object.keys(errs).length === 0
    }
    var validItems = cart.filter(function (c) { return c.item_name.trim() && Number(c.qty) > 0 })
    if (validItems.length === 0) errs.cart = 'Add at least one item'
    var allocErrs = []
    cart.forEach(function (c, cartIdx) {
      if (!c.item_name.trim() || Number(c.qty) <= 0) return
      var filled = c.allocations.filter(function (a) { return a.venue_id && Number(a.qty) > 0 })
      if (filled.length > 0) {
        var sum = 0
        filled.forEach(function (a) { sum += Number(a.qty) })
        if (sum !== Number(c.qty)) {
          allocErrs.push('Item #' + (cartIdx + 1) + ': allocated ' + sum + ' ≠ qty ' + c.qty)
        }
      }
    })
    if (allocErrs.length > 0) errs.alloc = allocErrs.join('. ')
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    try {
      // ─── EXPENSE MODE ───
      if (reqType === 'expense') {
        var amtPaise = Math.round(Number(expAmount) * 100)
        var receiptPath = null
        if (expReceipt) {
          var ext = expReceipt.name.split('.').pop()
          var path = 'requisitions/expense/' + profile.id + '_' + Date.now() + '.' + ext
          var { error: upErr } = await supabase.storage.from('receipts').upload(path, expReceipt, { upsert: true })
          if (upErr) { alert('Image upload failed: ' + upErr.message); setSaving(false); return }
          receiptPath = path
        }
        var expPayload = {
          requested_by: profile.id,
          department: department,
          urgency: urgency,
          purpose: purpose.trim(),
          needed_by: neededBy || null,
          event_id: eventId ? Number(eventId) : null,
          sub_department_id: subDeptId ? Number(subDeptId) : null,
          category_id: categoryId ? Number(categoryId) : null,
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
          req_type: 'expense',
          expense_type_id: expTypeId ? Number(expTypeId) : null,
          expense_sub_type_id: expSubTypeId ? Number(expSubTypeId) : null,
          expense_amount_paise: amtPaise,
          expense_date: expDate || null,
          receipt_path: receiptPath,
        }
        var allocJson = expAllocations.filter(function (a) { return a.venue_id || a.departmentId || Number(a.amount) > 0 }).map(function (a) {
          return { department_id: a.departmentId ? Number(a.departmentId) : null, sub_department_id: a.subDepartmentId ? Number(a.subDepartmentId) : null, venue_id: a.venue_id ? Number(a.venue_id) : null, amount_paise: Math.round(Number(a.amount || 0) * 100) }
        })
        expPayload.expense_alloc_json = allocJson

        if (isEditing) {
          var { error: expUpdErr } = await supabase.from('requisitions').update(expPayload).eq('id', editReq.id)
          if (expUpdErr) throw new Error(expUpdErr.message)
          try { await logActivity('REQUISITION_EDIT', purpose.trim() + ' | expense | ' + (amtPaise / 100)) } catch (_) {}
        } else {
          var selfIsDeptApprover = (profile?.permissions || []).indexOf('dept_approve') !== -1
          var isAdminRole = profile?.role === 'admin' || profile?.role === 'auditor'
          var status = 'pending_dept'
          if (isAdminRole) { status = 'approved' }
          else if (selfIsDeptApprover) { status = 'pending'; expPayload.dept_approved_by = profile.id; expPayload.dept_approved_at = new Date().toISOString() }
          else { var { data: hasAppr } = await supabase.rpc('has_dept_approvers', { p_exclude_id: profile.id }); if (!hasAppr) status = 'pending' }
          expPayload.status = status
          var { error: expInsErr } = await supabase.from('requisitions').insert(expPayload)
          if (expInsErr) throw new Error(expInsErr.message)
          try { await logActivity('REQUISITION_CREATE', purpose.trim() + ' | expense | ' + urgency) } catch (_) {}
        }
        onSaved()
        setSaving(false)
        return
      }

      var lineItems = cart
        .filter(function (c) { return c.item_name.trim() && Number(c.qty) > 0 })
        .map(function (c) {
          return {
            item_id: c.mode === 'existing' && c.item_id ? c.item_id : null,
            item_name: c.item_name.trim(),
            category_id: c.category_id ? Number(c.category_id) : null,
            qty: Number(c.qty),
            unit: c.unit,
            notes: c.notes.trim() || null,
            _source: c.mode === 'existing' ? c._source : 'new',
            estimated_cost_paise: c.estimated_cost ? Math.round(Number(c.estimated_cost) * 100) : null,
            _allocations: c.allocations.filter(function (a) { return a.venue_id && Number(a.qty) > 0 }),
          }
        })

      if (isEditing) {
        // ─── UPDATE existing requisition ───
        var { error: updErr } = await supabase.from('requisitions').update({
          department: department,
          urgency: urgency,
          purpose: purpose.trim(),
          needed_by: neededBy || null,
          event_id: eventId ? Number(eventId) : null,
          sub_department_id: subDeptId ? Number(subDeptId) : null,
          category_id: categoryId ? Number(categoryId) : null,
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
        }).eq('id', editReq.id)
        if (updErr) throw new Error(updErr.message)

        // Delete old items, insert new
        var { error: delErr } = await supabase.from('requisition_items').delete().eq('requisition_id', editReq.id)
        if (delErr) throw new Error(delErr.message)

        if (lineItems.length > 0) {
          var itemsWithReqId = lineItems.map(function (li) {
            var row = Object.assign({}, li, { requisition_id: editReq.id })
            delete row._allocations
            return row
          })
          var { data: insertedEditItems, error: insErr } = await supabase.from('requisition_items').insert(itemsWithReqId).select('id')
          if (insErr) throw new Error(insErr.message)
          var editAllocs = []
          ;(insertedEditItems || []).forEach(function (ins, idx) {
            var la = lineItems[idx]._allocations || []
            la.forEach(function (a) { editAllocs.push({ req_item_id: ins.id, venue_id: Number(a.venue_id), qty: Number(a.qty) }) })
          })
          if (editAllocs.length > 0) {
            var { error: eaErr } = await supabase.from('requisition_item_allocations').insert(editAllocs)
            if (eaErr) throw new Error('Allocation save failed: ' + eaErr.message)
          }
        }

        logActivity('REQUISITION_EDIT', purpose.trim() + ' | ' + lineItems.length + ' items')
      } else {
        // ─── CREATE new requisition ───
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
          var { data: hasAppr } = await supabase.rpc('has_dept_approvers', { p_exclude_id: profile.id })
          if (hasAppr) {
            status = 'pending_dept'
          } else {
            status = 'pending'
          }
        }

        var { data: req, error: reqErr } = await supabase.from('requisitions').insert({
          requested_by: profile.id,
          department: department,
          urgency: urgency,
          purpose: purpose.trim(),
          needed_by: neededBy || null,
          event_id: eventId ? Number(eventId) : null,
          sub_department_id: subDeptId ? Number(subDeptId) : null,
          category_id: categoryId ? Number(categoryId) : null,
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
          req_type: 'inventory',
          status: status,
          dept_approved_by: deptApprovedBy,
          dept_approved_at: deptApprovedAt,
        }).select('id').single()
        if (reqErr) throw new Error(reqErr.message)

        if (lineItems.length > 0) {
          var itemsWithId = lineItems.map(function (li) {
            var row = Object.assign({}, li, { requisition_id: req.id })
            delete row._allocations
            if (isAdminRole) { row.item_status = 'po_queued'; row.fulfillment_type = 'purchase' }
            return row
          })
          var { data: insertedItems, error: itemsErr } = await supabase.from('requisition_items').insert(itemsWithId).select('id')
          if (itemsErr) throw new Error(itemsErr.message)
          var allAllocs = []
          ;(insertedItems || []).forEach(function (ins, idx) {
            var la = lineItems[idx]._allocations || []
            la.forEach(function (a) { allAllocs.push({ req_item_id: ins.id, venue_id: Number(a.venue_id), qty: Number(a.qty) }) })
          })
          if (allAllocs.length > 0) {
            var { error: allocErr } = await supabase.from('requisition_item_allocations').insert(allAllocs)
            if (allocErr) throw new Error('Allocation save failed: ' + allocErr.message)
          }
        }

        try { await logActivity('REQUISITION_CREATE', purpose.trim() + ' | ' + lineItems.length + ' items | ' + urgency) } catch (_) {}
      }

      onSaved()
    } catch (err) {
      setErrors(function (prev) { return Object.assign({}, prev, { submit: err.message }) })
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{isEditing ? 'Edit Requisition' : 'New Requisition'}</h2>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
      </div>

      {/* Department + Urgency */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Department <span className="text-red-500">*</span></label>
          <select value={department} onChange={function (e) { changeDepartment(e.target.value) }}
            className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white " + (errors.dept ? "border-red-300" : "border-gray-300")}
            style={{ fontSize: '16px' }}>
            <option value="">Select department...</option>
            {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
          </select>
          {errors.dept && <p className="text-xs text-red-500 mt-1">{errors.dept}</p>}
        </div>
        {deptSubDepts.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sub-Department</label>
            <select value={subDeptId} onChange={function (e) { changeSubDept(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              style={{ fontSize: '16px' }}>
              <option value="">Select sub-department...</option>
              {deptSubDepts.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
            </select>
          </div>
        )}
        {deptSubDepts.length > 0 && subDeptId && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Request Type</label>
            <div className="flex gap-0 bg-white border border-gray-300 rounded-md overflow-hidden">
              <button type="button" onClick={function () { setReqType('inventory') }}
                className={"flex-1 py-2 text-sm font-medium transition-colors " + (reqType === 'inventory' ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50")}>
                📦 Inventory
              </button>
              <button type="button" onClick={function () { setReqType('expense') }}
                className={"flex-1 py-2 text-sm font-medium transition-colors " + (reqType === 'expense' ? "bg-amber-500 text-white" : "text-gray-500 hover:bg-gray-50")}>
                💰 Expense
              </button>
            </div>
          </div>
        )}
        {subDeptCats.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select value={categoryId} onChange={function (e) { changeCategory(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              style={{ fontSize: '16px' }}>
              <option value="">Select category...</option>
              {subDeptCats.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
            </select>
          </div>
        )}
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Needed By</label>
          <input type="date" value={neededBy} onChange={function (e) { setNeededBy(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ fontSize: '16px' }} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Purpose / Reason <span className="text-red-500">*</span></label>
          <div className="relative">
            <textarea value={purpose} onChange={function (e) { setPurpose(e.target.value) }}
              rows="2" maxLength="500" placeholder="e.g. Monthly stationery restock, new workstation setup..."
              className={"w-full px-3 py-2 pr-11 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none " + (errors.purpose ? "border-red-300" : "border-gray-300")}
              style={{ fontSize: '16px' }} />
            {SpeechRec && (
              <button type="button" onClick={toggleDictation}
                title={listening ? 'Stop' : 'Dictate'}
                className={"absolute right-2 bottom-2 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors " + (listening ? "bg-red-500 text-white animate-pulse" : "bg-gray-100 text-gray-500 hover:bg-gray-200")}>
                {listening ? '■' : '🎤'}
              </button>
            )}
          </div>
          {errors.purpose && <p className="text-xs text-red-500 mt-1">{errors.purpose}</p>}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">For a Function?</label>
            <button type="button" onClick={function () { toggleFunction(!isFunction) }}
              className="flex items-center gap-2">
              <div className={"relative w-9 h-5 rounded-full transition-colors " + (isFunction ? "bg-indigo-500" : "bg-gray-300")}>
                <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (isFunction ? "translate-x-4" : "translate-x-0.5")} />
              </div>
            </button>
          </div>
        </div>
        {isFunction && (
          <div className="space-y-2">
            <EventDatePicker label="Function Date" value={eventDate}
              onChange={function (dateStr) { setEventDate(dateStr); loadEventsByDate(dateStr) }} />
            {eventsLoading && <p className="text-xs text-gray-400">Loading events...</p>}
            {eventDate && !eventsLoading && events.length === 0 && <p className="text-xs text-gray-400">No events on this date</p>}
            {events.length > 0 && (
              <select value={eventId} onChange={function (e) { setEventId(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                style={{ fontSize: '16px' }}>
                <option value="">Select event...</option>
                {events.map(function (ev) { return <option key={ev.id} value={String(ev.id)}>{ev.event_name + ' · ' + (ev.venue_name || '')}</option> })}
              </select>
            )}
            {(function () {
              var sel = eventId ? events.filter(function (ev) { return String(ev.id) === eventId })[0] : null
              if (!sel) return null
              return (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-bold text-indigo-700">{sel.event_name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-indigo-600">
                    {sel.function_date && <span>📅 {sel.function_date}</span>}
                    {sel.contract_type && <span>🎉 {sel.contract_type}</span>}
                    {sel.venue_name && <span>📍 {sel.venue_name}</span>}
                    {sel.session && <span>🕐 {sel.session}</span>}
                    {sel.client_name && <span>👤 {sel.client_name}</span>}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* Cart items — inventory mode */}
      {reqType === 'inventory' && <div className="space-y-3" ref={searchContainerRef}>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Items</h3>
          <button type="button" onClick={addCartItem}
            className="text-xs font-semibold text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors">+ Add Item</button>
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

          return (
            <div key={index} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-400">Item #{index + 1}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={function () { toggleMode(index) }}
                    className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-gray-500">{item.mode === 'new' ? '✦ New Item' : '📦 Inventory Item'}</span>
                    <div className={"relative w-9 h-5 rounded-full transition-colors " + (item.mode === 'new' ? "bg-amber-400" : "bg-indigo-500")}>
                      <div className={"absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (item.mode === 'new' ? "translate-x-4" : "translate-x-0.5")} />
                    </div>
                  </button>
                  {cart.length > 1 && (
                    <button type="button" onClick={function () { removeCartItem(index) }}
                      className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 font-semibold p-2 rounded-lg transition-colors">✕</button>
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
                            <p className="text-[11px] text-gray-400">{inv.categories?.name || '—'} · {inv.unit} · <span className={"font-bold " + (inv.qty > 0 ? "text-green-600" : "text-red-500")}>{inv.qty} in stock</span> · {inv._source === 'catering_store' ? 'CS' : 'INV'}{inv.status !== 'approved' ? ' · ⏳ Pending' : ''}</p>
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

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] text-gray-400 mb-0.5">Notes</label>
                  <input type="text" value={item.notes}
                    onChange={function (e) { updateCart(index, 'notes', e.target.value) }}
                    placeholder="Brand, size, spec..."
                    maxLength="300"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    style={{ fontSize: '16px' }} />
                </div>
                <div className="w-28">
                  <label className="block text-[11px] text-gray-400 mb-0.5">Est. Cost ₹</label>
                  <input type="number" min="0" step="any" inputMode="decimal" value={item.estimated_cost}
                    onChange={function (e) { updateCart(index, 'estimated_cost', e.target.value) }}
                    placeholder="—"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    style={{ fontSize: '16px' }} />
                </div>
              </div>

              {/* Venue Allocations */}
              <div className="border-t border-gray-100 pt-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-400">Venue Allocation</span>
                  <button type="button" onClick={function () { addAllocation(index) }}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800">+ Add</button>
                </div>
                {item.allocations.map(function (alloc, aIdx) {
                  return (
                    <div key={aIdx} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <select value={alloc.venue_id}
                          onChange={function (e) { updateAllocation(index, aIdx, 'venue_id', e.target.value) }}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                          style={{ fontSize: '16px' }}>
                          <option value="">Venue...</option>
                          {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
                        </select>
                      </div>
                      <div className="w-20">
                        <input type="number" min="0" step="any" inputMode="numeric" value={alloc.qty}
                          onChange={function (e) { updateAllocation(index, aIdx, 'qty', e.target.value) }}
                          placeholder="Qty"
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          style={{ fontSize: '16px' }} />
                      </div>
                      {item.allocations.length > 1 && (
                        <button type="button" onClick={function () { removeAllocation(index, aIdx) }}
                          className="text-xs text-red-400 hover:text-red-600 p-1">✕</button>
                      )}
                    </div>
                  )
                })}
                {(function () {
                  var filled = item.allocations.filter(function (a) { return a.venue_id && Number(a.qty) > 0 })
                  if (filled.length === 0) return null
                  var sum = 0
                  filled.forEach(function (a) { sum += Number(a.qty) })
                  var itemQty = Number(item.qty) || 0
                  if (sum === itemQty) return <p className="text-[10px] text-green-600 font-medium">✓ Fully allocated</p>
                  return <p className="text-[10px] text-red-500 font-medium">Allocated {sum} of {itemQty} — must match</p>
                })()}
              </div>
            </div>
          )
        })}
      </div>}

      {/* Expense form — expense mode */}
      {reqType === 'expense' && (
        <div className="bg-amber-50 rounded-lg border border-amber-200 p-4 space-y-3">
          <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wider">Planned Expense</h3>
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expense Type
              {catExpTypeIds && <span className="text-[10px] text-amber-600 ml-1">({filteredExpTypes.length} allowed)</span>}
            </label>
            <div className="relative">
              <input type="text"
                value={expTypeOpen ? expTypeSearch : (expTypeId ? (filteredExpTypes.find(function (et) { return String(et.id) === expTypeId }) || {}).name || '' : '')}
                placeholder="Search expense type..."
                onFocus={function () { setExpTypeOpen(true); setExpTypeSearch('') }}
                onBlur={function () { setTimeout(function () { setExpTypeOpen(false) }, 200) }}
                onChange={function (e) { setExpTypeSearch(e.target.value); setExpTypeId('') }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                style={{ fontSize: '16px' }} />
              {expTypeId && (
                <button type="button" onClick={function () { setExpTypeId(''); setExpSubTypeId(''); setExpSubTypeFields([]); setExpFieldValues({}); setExpTypeSearch('') }}
                  className="absolute right-2 top-2.5 text-xs text-gray-400 hover:text-red-500">✕</button>
              )}
            </div>
            {expTypeOpen && (function () {
              var q = expTypeSearch.toLowerCase()
              var matches = filteredExpTypes.filter(function (et) { return !q || et.name.toLowerCase().indexOf(q) !== -1 })
              if (matches.length === 0) return <p className="text-[11px] text-gray-400 mt-1">{categoryId ? 'No expense types for this category' : 'Select a category first'}</p>
              return (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {matches.map(function (et) {
                    return (
                      <button key={et.id} type="button"
                        onMouseDown={function (e) { e.preventDefault(); setExpTypeId(String(et.id)); setExpSubTypeId(''); setExpSubTypeFields([]); setExpFieldValues({}); setExpTypeOpen(false); setExpTypeSearch('') }}
                        className="w-full text-left px-3 py-2 hover:bg-amber-50 active:bg-amber-100 text-sm transition-colors border-b border-gray-100 last:border-0">
                        {et.name}
                      </button>
                    )
                  })}
                </div>
              )
            })()}
          </div>
          {expTypeId && (function () {
            var subTypesForType = expSubTypes.filter(function (st) { return st.expense_type_id === Number(expTypeId) })
            if (subTypesForType.length === 0) return null
            if (subTypesForType.length === 1 && !expSubTypeId) {
              setTimeout(function () {
                setExpSubTypeId(String(subTypesForType[0].id))
                var fields = subTypesForType[0].extra_fields || []
                setExpSubTypeFields(fields)
              }, 0)
            }
            return (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sub-Type</label>
                <select value={expSubTypeId}
                  onChange={function (e) {
                    setExpSubTypeId(e.target.value)
                    setExpFieldValues({})
                    var st = expSubTypes.find(function (s) { return String(s.id) === e.target.value })
                    setExpSubTypeFields(st && st.extra_fields ? st.extra_fields : [])
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  style={{ fontSize: '16px' }}>
                  <option value="">Select sub-type...</option>
                  {subTypesForType.map(function (st) { return <option key={st.id} value={String(st.id)}>{st.name}</option> })}
                </select>
              </div>
            )
          })()}
          {expSubTypeFields.length > 0 && expSubTypeFields.map(function (field) {
            return (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required ? ' *' : ''}</label>
                {field.type === 'lookup' ? (
                  <input type="text" value={expFieldValues[field.key] || ''}
                    onChange={function (e) { setExpFieldValues(function (p) { var n = Object.assign({}, p); n[field.key] = e.target.value; return n }) }}
                    placeholder={field.label + '...'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    style={{ fontSize: '16px' }} />
                ) : (
                  <input type={field.type === 'number' ? 'number' : 'text'} value={expFieldValues[field.key] || ''}
                    onChange={function (e) { setExpFieldValues(function (p) { var n = Object.assign({}, p); n[field.key] = e.target.value; return n }) }}
                    placeholder={field.label + '...'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    style={{ fontSize: '16px' }} />
                )}
              </div>
            )
          })}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={purpose} onChange={function (e) { setPurpose(e.target.value) }}
              rows="2" maxLength="500" placeholder="What is this expense for..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (pts)</label>
            <input type="number" min="0" step="any" inputMode="decimal" value={expAmount}
              onChange={function (e) { setExpAmount(e.target.value) }}
              placeholder="0"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              style={{ fontSize: '16px' }} />
          </div>
          {(function () {
            var allocTotal = expAllocations.reduce(function (s, a) { return s + (Number(a.amount) || 0) }, 0)
            var target = Number(expAmount) || 0
            var diff = target - allocTotal
            var isMatch = target > 0 && Math.abs(diff) < 0.01
            var isOver = allocTotal > target && target > 0
            return (
              <div className="border border-amber-200 rounded-xl bg-amber-50/40 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-amber-100/60">
                  <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wide">Allocations</span>
                  <button type="button" onClick={function () { setExpAllocations(function (p) { return p.concat([{ departmentId: '', subDepartmentId: '', venue_id: '', amount: '' }]) }) }}
                    className="text-[11px] font-bold text-amber-700 hover:text-amber-900 px-2 py-0.5 rounded bg-amber-200/60 hover:bg-amber-200">+ Add</button>
                </div>
                <div className="p-2.5 space-y-2">
                  {expAllocations.map(function (alloc, aIdx) {
                    var allocSubDepts = alloc.departmentId ? subDepartments.filter(function (sd) { return sd.department_id === Number(alloc.departmentId) }) : []
                    return (
                      <div key={aIdx} className="bg-white rounded-lg border border-gray-200 p-2.5 relative">
                        {expAllocations.length > 1 && (
                          <button type="button" onClick={function () { setExpAllocations(function (p) { return p.filter(function (_, j) { return j !== aIdx }) }) }}
                            className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full">✕</button>
                        )}
                        <div className="space-y-2">
                          {(function () {
                            var selDept = alloc.departmentId ? departments.find(function (d) { return String(d.id) === alloc.departmentId }) : null
                            var isVenueDept = selDept && selDept.name.toLowerCase().indexOf('venue') === 0
                            return (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <select value={alloc.departmentId}
                                    onChange={function (e) { setExpAllocations(function (p) { return p.map(function (a, j) { return j === aIdx ? Object.assign({}, a, { departmentId: e.target.value, subDepartmentId: '', venue_id: '' }) : a }) }) }}
                                    className="w-full px-2 py-2 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 bg-gray-50"
                                    style={{ fontSize: '16px' }}>
                                    <option value="">Dept</option>
                                    {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                                  </select>
                                  {isVenueDept ? (
                                    <select value={alloc.venue_id}
                                      onChange={function (e) { setExpAllocations(function (p) { return p.map(function (a, j) { return j === aIdx ? Object.assign({}, a, { venue_id: e.target.value }) : a }) }) }}
                                      className="w-full px-2 py-2 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 bg-gray-50"
                                      style={{ fontSize: '16px' }}>
                                      <option value="">Venue</option>
                                      {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code || v.name}</option> })}
                                    </select>
                                  ) : allocSubDepts.length > 0 ? (
                                    <select value={alloc.subDepartmentId}
                                      onChange={function (e) { setExpAllocations(function (p) { return p.map(function (a, j) { return j === aIdx ? Object.assign({}, a, { subDepartmentId: e.target.value }) : a }) }) }}
                                      className="w-full px-2 py-2 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 bg-gray-50"
                                      style={{ fontSize: '16px' }}>
                                      <option value="">Sub-dept</option>
                                      {allocSubDepts.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
                                    </select>
                                  ) : <div />}
                                </div>
                                <div className={"grid gap-2 " + (isVenueDept ? "" : "grid-cols-2")}>
                                  {!isVenueDept && (
                                    <select value={alloc.venue_id}
                                      onChange={function (e) { setExpAllocations(function (p) { return p.map(function (a, j) { return j === aIdx ? Object.assign({}, a, { venue_id: e.target.value }) : a }) }) }}
                                      className="w-full px-2 py-2 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 bg-gray-50"
                                      style={{ fontSize: '16px' }}>
                                      <option value="">Venue</option>
                                      {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code || v.name}</option> })}
                                    </select>
                                  )}
                                  <input type="number" min="0" step="any" inputMode="decimal" value={alloc.amount}
                                    onChange={function (e) { setExpAllocations(function (p) { return p.map(function (a, j) { return j === aIdx ? Object.assign({}, a, { amount: e.target.value }) : a }) }) }}
                                    placeholder="Amount"
                                    className="w-full px-2 py-2 border border-gray-200 rounded-md text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
                                    style={{ fontSize: '16px' }} />
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {target > 0 && (
                  <div className={"flex items-center justify-between px-3 py-2 border-t " + (isMatch ? 'bg-green-50 border-green-200' : isOver ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200')}>
                    <span className={"text-[11px] font-bold " + (isMatch ? 'text-green-700' : isOver ? 'text-red-700' : 'text-amber-700')}>
                      {isMatch ? '✓ Fully allocated' : isOver ? '⚠ Over by ' + diff.toFixed(0).replace('-', '') : 'Remaining: ' + diff.toFixed(0)}
                    </span>
                    <span className={"text-[12px] font-bold " + (isMatch ? 'text-green-800' : isOver ? 'text-red-800' : 'text-amber-800')}>
                      {allocTotal.toLocaleString('en-IN')} / {target.toLocaleString('en-IN')}
                    </span>
                  </div>
                )}
              </div>
            )
          })()}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">📷 Receipt / Quote</label>
            {expReceipt ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {expReceipt.name}</span>
                <button type="button" onClick={function () { setExpReceipt(null) }}
                  className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <label className="flex-1 py-2.5 text-center text-sm text-amber-700 border border-dashed border-amber-300 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors">
                  📁 Gallery
                  <input type="file" accept="image/*" className="hidden"
                    onChange={function (e) { if (e.target.files?.[0]) setExpReceipt(e.target.files[0]); e.target.value = '' }} />
                </label>
                <label className="flex-1 py-2.5 text-center text-sm text-amber-700 border border-dashed border-amber-300 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors">
                  📷 Camera
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={function (e) { if (e.target.files?.[0]) setExpReceipt(e.target.files[0]); e.target.value = '' }} />
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Total cost summary */}
      {totalCostPaise > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-indigo-700">Estimated Total</span>
          <span className="text-sm font-bold text-indigo-900">₹{(totalCostPaise / 100).toLocaleString('en-IN')}</span>
        </div>
      )}

      {/* Submit */}
      {errors.alloc && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errors.alloc}</div>
      )}
      {errors.submit && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errors.submit}</div>
      )}
      <div className="flex gap-3">
        <button type="button" onClick={onCancel}
          className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
          {saving ? (isEditing ? 'Updating...' : 'Submitting...') : (isEditing ? 'Update Request' : 'Submit Request')}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// DETAIL + APPROVAL VIEW
// ═══════════════════════════════════════════════════════════════
function RequisitionDetail({ req, items, profile, isAdmin, isDeptApprover, onBack, onUpdated, onEdit }) {
  var [saving, setSaving] = useState(false)
  var [rejectMode, setRejectMode] = useState(false)
  var [rejectReason, setRejectReason] = useState('')
  var [poStatuses, setPoStatuses] = useState({})
  var [stockQty, setStockQty] = useState({})
  var [stockLoading, setStockLoading] = useState(false)
  var [fulfillChoices, setFulfillChoices] = useState({})
  var [dispatchNote, setDispatchNote] = useState('')
  var [confirmAction, setConfirmAction] = useState(null)
  var [deleteMode, setDeleteMode] = useState(false)
  var [deleteReason, setDeleteReason] = useState('')

  useEffect(function () {
    // Fetch PO status for items that have po_item_id
    var poItemIds = items.filter(function (li) { return !!li.po_item_id }).map(function (li) { return li.po_item_id })
    if (poItemIds.length === 0) return
    supabase.from('purchase_order_items')
      .select('id, status, vendor_name, actual_qty, actual_cost_paise, inventory_item_id, cs_item_id, received_at, purchase_orders!inner(id, status)')
      .in('id', poItemIds)
      .then(function (res) {
        var map = {}
        ;(res.data || []).forEach(function (poi) { map[poi.id] = poi })
        setPoStatuses(map)
      })
}, [items])

  // Fetch stock qty for existing items when admin can approve
  useEffect(function () {
    var canAdmin = isAdmin && req.status === 'pending'
    if (!canAdmin) return
    var existingItems = items.filter(function (li) { return li.item_id && li._source !== 'new' })
    if (existingItems.length === 0) return

    setStockLoading(true)
    var invIds = existingItems.filter(function (li) { return li._source !== 'catering_store' }).map(function (li) { return li.item_id })
    var csIds = existingItems.filter(function (li) { return li._source === 'catering_store' }).map(function (li) { return li.item_id })

    var promises = []
    if (invIds.length > 0) {
      promises.push(
        supabase.from('inventory_items').select('id, qty').in('id', invIds)
          .then(function (r) { return { data: r.data || [], source: 'inventory' } })
      )
    }
    if (csIds.length > 0) {
      promises.push(
        supabase.from('catering_store_items').select('id, qty').in('id', csIds)
          .then(function (r) { return { data: r.data || [], source: 'catering_store' } })
      )
    }

    Promise.all(promises).then(function (results) {
      var qtyMap = {}
      var choices = {}
      results.forEach(function (res) {
        res.data.forEach(function (row) { qtyMap[row.id] = row.qty })
      })
      existingItems.forEach(function (li) {
        var available = qtyMap[li.item_id] || 0
        choices[li.id] = available >= li.qty ? 'stock' : 'po'
      })
      items.forEach(function (li) {
        if (!choices[li.id]) choices[li.id] = 'po'
      })
      setStockQty(qtyMap)
      setFulfillChoices(choices)
      setStockLoading(false)
    }).catch(function () { setStockLoading(false) })
  }, [items, req.status])

  var canDeptApprove = isDeptApprover && req.status === 'pending_dept' && req.requested_by !== profile?.id
  var canAdminApprove = isAdmin && req.status === 'pending'
  var canApprove = canDeptApprove || canAdminApprove
  var canDelete = (req.requested_by === profile?.id && (req.status === 'pending_dept' || req.status === 'pending')) || isAdmin
  var canEdit = req.requested_by === profile?.id && (req.status === 'pending_dept' || req.status === 'pending')
  var noneInPO = items.length > 0 && items.every(function (li) { return !li.po_item_id })
  var canCancel = req.requested_by === profile?.id && req.status === 'approved' && noneInPO

  // Total cost
  var totalPaise = 0
  items.forEach(function (li) {
    if (li.estimated_cost_paise) totalPaise += li.estimated_cost_paise
  })

  async function approve() {
    setSaving(true)

    // Dept approve — just forward to admin, no fulfillment logic
    if (canDeptApprove) {
      var { error } = await supabase.from('requisitions').update({
        status: 'pending', dept_approved_by: profile.id, dept_approved_at: new Date().toISOString()
      }).eq('id', req.id)
      if (error) { alert('Approve failed: ' + error.message); setSaving(false); return }
      try { await logActivity('REQUISITION_APPROVE', (req.purpose || 'Req #' + req.id) + ' | dept') } catch (_) {}
      setSaving(false)
      onUpdated()
      return
    }

    // Admin approve + fulfill
    var { error: reqErr } = await supabase.from('requisitions').update({
      status: 'approved', reviewed_by: profile.id, reviewed_at: new Date().toISOString()
    }).eq('id', req.id)
    if (reqErr) { alert('Approve failed: ' + reqErr.message); setSaving(false); return }

    var stockCount = 0
    var poCount = 0
    var errors = []

    for (var i = 0; i < items.length; i++) {
      var li = items[i]
      var choice = fulfillChoices[li.id] || 'po'

      if (choice === 'stock' && li.item_id && li._source !== 'new') {
        var { data: result, error: rpcErr } = await supabase.rpc('issue_from_stock', {
          p_req_item_id: li.id,
          p_dispatched_by: profile.id,
          p_note: dispatchNote.trim() || null,
        })
        if (rpcErr || (result && !result.ok)) {
          errors.push(li.item_name + ': ' + (rpcErr?.message || result?.error || 'Unknown error'))
          // Fallback to PO
          await supabase.from('requisition_items').update({ item_status: 'po_queued', fulfillment_type: 'purchase' }).eq('id', li.id)
          poCount++
        } else {
          stockCount++
        }
      } else {
        await supabase.from('requisition_items').update({ item_status: 'po_queued', fulfillment_type: 'purchase' }).eq('id', li.id)
        poCount++
      }
    }

    if (errors.length > 0) {
      alert('Some items fell back to PO:\n' + errors.join('\n'))
    }

    var logMsg = (req.purpose || 'Req #' + req.id) + ' | admin | stock:' + stockCount + ' po:' + poCount
    try { await logActivity('REQUISITION_APPROVE', logMsg) } catch (_) {}
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
    try { await logActivity('REQUISITION_REJECT', (req.purpose || 'Req #' + req.id) + ' | ' + rejectReason.trim()) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function cancelReq() {
    if (!confirm('Cancel this requisition? Items will be removed from the procurement queue.')) return
    setSaving(true)
    var { error: reqErr } = await supabase.from('requisitions').update({ status: 'cancelled' }).eq('id', req.id)
    if (reqErr) { alert('Cancel failed: ' + reqErr.message); setSaving(false); return }
    var itemIds = items.map(function (li) { return li.id })
    if (itemIds.length > 0) {
      await supabase.from('requisition_items').update({ item_status: 'cancelled' }).in('id', itemIds)
    }
    try { await logActivity('REQUISITION_CANCEL', req.purpose || 'Req #' + req.id) } catch (_) {}
    setSaving(false)
    onUpdated()
  }
  async function convertToExpense() {
    if (saving || req.req_type !== 'expense' || req.status !== 'approved' || req.requested_by !== profile?.id) return
    setSaving(true)
    try {
      var { data: newExp, error: insErr } = await supabase.from('expenses').insert({
        user_id: profile.id,
        category_id: req.category_id || null,
        sub_category_id: req.sub_category_id || null,
        expense_type_id: req.expense_type_id || null,
        expense_sub_type_id: req.expense_sub_type_id || null,
        amount_paise: req.expense_amount_paise,
        description: req.purpose || 'From requisition #' + req.id,
        expense_date: req.expense_date || new Date().toISOString().split('T')[0],
        status: 'recorded',
        receipt_path: req.receipt_path || null,
      }).select('id').single()
      if (insErr) throw new Error(insErr.message)

      // Copy allocations from requisition to expense
      var allocRows = req.expense_alloc_json || []
      if (allocRows.length > 0) {
        var expAllocs = allocRows.map(function (a) {
          return {
            expense_id: newExp.id,
            department: req.department || null,
            department_id: a.department_id || null,
            sub_department_id: a.sub_department_id || null,
            venue_id: a.venue_id || null,
            amount_paise: a.amount_paise || 0,
          }
        })
        await supabase.from('expense_allocations').insert(expAllocs)
      }

      try {
        await supabase.rpc('wallet_self_debit', {
          p_amount_paise: req.expense_amount_paise,
          p_description: 'Expense: ' + (req.purpose || '').slice(0, 50),
          p_ref_type: 'expense',
          p_ref_id: String(newExp.id),
        })
      } catch (_) {}

      var { error: updErr } = await supabase.rpc('fulfill_expense_requisition', { p_req_id: req.id, p_expense_id: newExp.id })
      if (updErr) console.warn('Requisition status update failed:', updErr.message)

      try { await logActivity('EXPENSE_FROM_REQ', (req.purpose || 'Req #' + req.id) + ' | ' + formatPoints(req.expense_amount_paise)) } catch (_) {}
      setSaving(false)
      onUpdated()
    } catch (err) {
      alert('Failed: ' + err.message)
      setSaving(false)
    }
  }

  async function deleteReq() {
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('requisitions').update({
      status: 'deleted',
      rejection_reason: deleteReason.trim() || null,
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', req.id)
    if (error) { alert('Delete failed: ' + error.message); setSaving(false); return }
    try { await logActivity('REQUISITION_DELETE', (req.purpose || 'Req #' + req.id) + (deleteReason.trim() ? ' | ' + deleteReason.trim() : '')) } catch (_) {}
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
              {req.events?.event_name ? ' · 📅 ' + req.events.event_name : ''}
            </p>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (URGENCY_COLORS[req.urgency] || '')}>
              {req.urgency}
            </span>
            <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (APPROVAL_STATUS_COLORS[req.status] || '')}>
              {APPROVAL_STATUS_LABELS[req.status] || req.status}
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

      {req.status === 'deleted' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs font-bold text-red-700 mb-0.5">🗑 Deleted</p>
          {req.rejection_reason && <p className="text-sm text-red-600">{req.rejection_reason}</p>}
        </div>
      )}

      {/* Expense-type detail */}
      {req.req_type === 'expense' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700">💰 Expense Request</span>
            <span className="text-sm font-bold text-amber-900">{formatPoints(req.expense_amount_paise)}</span>
          </div>
          <div className="p-4 space-y-3">
            {req.expense_types?.name && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Type</span>
                <span className="text-sm text-gray-800 text-right">{req.expense_types.name}{req.expense_sub_types?.name ? ' › ' + req.expense_sub_types.name : ''}</span>
              </div>
            )}
            {req.categories?.name && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Category</span>
                <span className="text-sm text-gray-800">{req.categories.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Department</span>
              <span className="text-sm text-gray-800">{req.department}{req.sub_departments?.name ? ' › ' + req.sub_departments.name : ''}</span>
            </div>
            {req.expense_date && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Expense Date</span>
                <span className="text-sm text-gray-800">{formatDate(req.expense_date)}</span>
              </div>
            )}
            {req.event_id && req.events?.event_name && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Event</span>
                <span className="text-sm text-gray-800">📅 {req.events.event_name}</span>
              </div>
            )}
            {req.purpose && (
              <div className="border-t border-gray-100 pt-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Purpose</span>
                <p className="text-sm text-gray-800 mt-1">{req.purpose}</p>
              </div>
            )}
          </div>

          {/* Receipt */}
          {(function () {
            var rUrl = req.receipt_path ? supabase.storage.from('receipts').getPublicUrl(req.receipt_path).data?.publicUrl : null
            if (!rUrl) return (
              <div className="px-4 py-2.5 bg-amber-50/50 border-t border-amber-100 flex items-center gap-2">
                <span className="text-amber-500">⚠</span>
                <span className="text-xs font-medium text-amber-700">No receipt attached</span>
              </div>
            )
            return (
              <div className="border-t border-gray-200 p-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">📎 Receipt</p>
                {/\.(jpg|jpeg|png|gif|webp)$/i.test(req.receipt_path || '') ? (
                  <a href={rUrl} target="_blank" rel="noopener noreferrer">
                    <img src={rUrl} alt="Receipt" className="w-full max-h-60 object-contain rounded-lg border border-gray-200 bg-gray-50" />
                  </a>
                ) : (
                  <a href={rUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
                    📎 View Attachment
                  </a>
                )}
              </div>
            )
          })()}

          {/* Allocations from detailItems (expense allocs loaded in openDetail) */}
          {items.length > 0 && items[0]._names && (
            <div className="border-t border-gray-200">
              <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Allocations</span>
                <span className="text-xs font-bold text-gray-700">{formatPoints(items.reduce(function (s, a) { return s + (a.amount_paise || 0) }, 0))}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {items.map(function (a) {
                  var nm = a._names || {}
                  var deptLabel = a.department_id && nm['d_' + a.department_id] ? nm['d_' + a.department_id] : a.department || '—'
                  var subDeptLabel = a.sub_department_id && nm['sd_' + a.sub_department_id] ? nm['sd_' + a.sub_department_id] : null
                  var venueLabel = a.venue_id && nm['v_' + a.venue_id] ? nm['v_' + a.venue_id] : null
                  return (
                    <div key={a.id} className="px-4 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800">{deptLabel}{subDeptLabel ? ' › ' + subDeptLabel : ''}</span>
                        {a.amount_paise > 0 && <span className="text-sm font-bold text-gray-900">{formatPoints(a.amount_paise)}</span>}
                      </div>
                      {venueLabel && <p className="text-[11px] text-gray-500 mt-0.5">{venueLabel}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Total cost summary */}
      {totalPaise > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-indigo-700">Estimated Total</span>
          <span className="text-sm font-bold text-indigo-900">₹{(totalPaise / 100).toLocaleString('en-IN')}</span>
        </div>
      )}

      {/* Line items */}
      {req.req_type !== 'expense' && (<div className="space-y-2">
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
                  {li.estimated_cost_paise && <p className="text-[11px] text-gray-400">~₹{(li.estimated_cost_paise / 100).toLocaleString('en-IN')}</p>}
                </div>
              </div>
              {li.notes && (
                <p className="text-[11px] text-gray-500 mt-1">{li.notes}</p>
              )}

              {/* Stock availability + fulfillment choice — admin approval view */}
              {canAdminApprove && !stockLoading && li._source !== 'new' && li.item_id && (function () {
                var available = stockQty[li.item_id] || 0
                var sufficient = available >= li.qty
                var choice = fulfillChoices[li.id] || 'po'
                return (
                  <div className="mt-2 pt-2 border-t border-gray-100 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full " +
                        (sufficient ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600")}>
                        {available} in stock
                      </span>
                      {!sufficient && <span className="text-[10px] text-red-500">Need {li.qty}, short by {li.qty - available}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={function () { setFulfillChoices(function (p) { var n = Object.assign({}, p); n[li.id] = 'stock'; return n }) }}
                        disabled={!sufficient}
                        className={"flex-1 py-1.5 text-[11px] font-bold rounded-md border transition-colors " +
                          (choice === 'stock' ? "bg-green-600 text-white border-green-600" : sufficient ? "bg-white text-green-700 border-green-300 hover:bg-green-50" : "bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed")}>
                        📦 Issue from Stock
                      </button>
                      <button onClick={function () { setFulfillChoices(function (p) { var n = Object.assign({}, p); n[li.id] = 'po'; return n }) }}
                        className={"flex-1 py-1.5 text-[11px] font-bold rounded-md border transition-colors " +
                          (choice === 'po' ? "bg-blue-600 text-white border-blue-600" : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50")}>
                        🛒 Send to PO
                      </button>
                    </div>
                  </div>
                )
              })()}
              {canAdminApprove && !stockLoading && li._source === 'new' && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">New item → PO</span>
                </div>
              )}
              {canAdminApprove && stockLoading && li.item_id && li._source !== 'new' && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <span className="text-[10px] text-gray-400">Checking stock...</span>
                </div>
              )}

              {/* Dispatched status — for requester view */}
              {li.item_status === 'dispatched' && (
                <div className="mt-1.5 pt-1.5 border-t border-gray-100 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">📦 Dispatched</span>
                    {li.dispatched_note && <span className="text-[10px] text-gray-400">{li.dispatched_note}</span>}
                    {li.dispatched_at && <span className="text-[10px] text-gray-400">{formatDate(li.dispatched_at)}</span>}
                  </div>
                  {req.requested_by === profile?.id && (
                    <button disabled={saving} onClick={async function () {
                      setSaving(true)
                      var { data: result, error: rpcErr } = await supabase.rpc('acknowledge_receipt', {
                        p_req_item_id: li.id,
                        p_user_id: profile.id,
                      })
                      setSaving(false)
                      if (rpcErr || (result && !result.ok)) {
                        alert('Failed: ' + (rpcErr?.message || result?.error || 'Unknown error'))
                        return
                      }
                      try { await logActivity('REQUISITION_ACKNOWLEDGE', titleCase(li.item_name) + ' | ' + (req.purpose || 'Req #' + req.id)) } catch (_) {}
                      onUpdated()
                    }}
                      className="w-full py-2 text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50 transition-colors">
                      {saving ? 'Confirming...' : '✓ Confirm Received'}
                    </button>
                  )}
                </div>
              )}

              {/* Fulfilled from stock */}
              {li.item_status === 'fulfilled' && li.fulfillment_type === 'stock' && (
                <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700">✓ Received from Stock</span>
                    {li.acknowledged_at && <span className="text-[10px] text-gray-400">{formatDate(li.acknowledged_at)}</span>}
                    {li.auto_acknowledged && <span className="text-[10px] text-amber-500">Auto</span>}
                  </div>
                </div>
              )}

              {/* PO tracking — existing behavior */}
              {li.po_item_id && poStatuses[li.po_item_id] && (function () {
                var poi = poStatuses[li.po_item_id]
                var itemStatus = poi.status
                var colors = { pending: 'bg-yellow-100 text-yellow-700', purchased: 'bg-green-100 text-green-700', received: 'bg-indigo-100 text-indigo-700', cancelled: 'bg-red-100 text-red-600' }
                return (
                  <div className="mt-1.5 pt-1.5 border-t border-gray-100 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (colors[itemStatus] || 'bg-gray-100 text-gray-500')}>
                        {itemStatus === 'received' ? '✓ Received' : itemStatus === 'purchased' ? '🛒 Purchased' : itemStatus}
                      </span>
                      {poi.vendor_name && <span className="text-[10px] text-gray-400">{poi.vendor_name}</span>}
                      {poi.actual_cost_paise > 0 && <span className="text-[10px] text-green-600 font-medium">₹{(poi.actual_cost_paise / 100).toLocaleString('en-IN')}</span>}
                    </div>
                    {itemStatus === 'received' && (poi.inventory_item_id || poi.cs_item_id) && (
                      <p className="text-[10px] text-indigo-600 font-medium">
                        → Added to {poi.cs_item_id ? 'Catering Store' : 'Inventory'} #{poi.inventory_item_id || poi.cs_item_id}
                      </p>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>)}

      {/* Convert expense req to actual expense */}
      {req.req_type === 'expense' && req.status === 'approved' && req.requested_by === profile?.id && (
        <button onClick={function () { setConfirmAction('expense') }} disabled={saving}
          className="w-full py-3 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
          {saving ? 'Recording...' : '💰 Record Expense · ' + formatPoints(req.expense_amount_paise)}
        </button>
      )}

      {confirmAction === 'expense' && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" style={{ margin: 0 }}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="p-5 text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">💰</span>
              </div>
              <h3 className="text-lg font-bold text-gray-900">Record Expense?</h3>
              <p className="text-sm text-gray-500 mt-2">
                <span className="font-bold text-gray-800">{formatPoints(req.expense_amount_paise)}</span> will be deducted from your wallet.
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button onClick={function () { setConfirmAction(null) }}
                className="flex-1 py-3.5 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors border-r border-gray-200">
                Cancel
              </button>
              <button onClick={function () { setConfirmAction(null); convertToExpense() }}
                className="flex-1 py-3.5 text-sm font-bold text-green-600 hover:bg-green-50 transition-colors">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit button for owner on pending */}
      {canEdit && (
        <button onClick={onEdit} disabled={saving}
          className="w-full py-3 text-sm font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          ✎ Edit Requisition
        </button>
      )}

      {/* Dispatch note — only on admin approve when stock items exist */}
      {canAdminApprove && !rejectMode && (function () {
        var hasStock = Object.keys(fulfillChoices).some(function (k) { return fulfillChoices[k] === 'stock' })
        if (!hasStock) return null
        return (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
            <label className="block text-[11px] font-bold text-blue-700 uppercase">Dispatch Note <span className="text-blue-400 font-normal">(optional)</span></label>
            <input type="text" value={dispatchNote}
              onChange={function (e) { setDispatchNote(e.target.value) }}
              placeholder="Delivery person name, location..."
              maxLength="200"
              className="w-full px-3 py-2 border border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ fontSize: '16px' }} />
          </div>
        )
      })()}

      {/* Approval actions */}
      {canApprove && !rejectMode && (
        <div className="flex gap-3">
          <button onClick={function () { setRejectMode(true) }} disabled={saving}
            className="flex-1 py-3 text-sm font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors">
            ✗ Reject
          </button>
          <button onClick={approve} disabled={saving}
            className="flex-1 py-3 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {saving ? 'Processing...' : canAdminApprove ? '✓ Approve & Process' : '✓ Approve'}
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
      {canCancel && (
        <button onClick={cancelReq} disabled={saving}
          className="w-full py-3 text-sm font-bold text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 disabled:opacity-50 transition-colors">
          Cancel Requisition
        </button>
      )}
      {canDelete && !canApprove && !deleteMode && (
        <button onClick={function () { setDeleteMode(true) }} disabled={saving}
          className="w-full py-3 text-sm font-bold text-red-500 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
          Delete Requisition
        </button>
      )}

      {deleteMode && (
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <label className="block text-sm font-medium text-red-700 mb-1">Reason for Deletion <span className="text-red-500">*</span></label>
            <textarea value={deleteReason}
              onChange={function (e) { setDeleteReason(e.target.value) }}
              rows="2" maxLength="300" placeholder="Why is this requisition being deleted..."
              className="w-full px-3 py-2 border border-red-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex gap-3">
            <button onClick={function () { setDeleteMode(false); setDeleteReason('') }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
            <button onClick={deleteReq} disabled={saving || !deleteReason.trim()}
              className="flex-1 py-3 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Deleting...' : 'Confirm Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Requisitions
