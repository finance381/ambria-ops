import { useState, useEffect } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { titleCase, formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'

var PAGE_SIZE = 20

var STATUS_COLORS = {
  pending_dept: 'bg-amber-100 text-amber-700',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

var STATUS_LABELS = {
  pending_dept: 'Dept Review',
  pending: 'Admin Review',
  approved: 'Approved',
  rejected: 'Rejected',
}

function formatPoints(paise) {
  if (paise == null) return '—'
  return (paise / 100).toLocaleString('en-IN') + ' pts'
}

function Expenses({ profile }) {
  var [view, setView] = useState('list') // list | form | detail | approve
  var [myExpenses, setMyExpenses] = useState([])
  var [approvalExpenses, setApprovalExpenses] = useState([])
  var [myHasMore, setMyHasMore] = useState(false)
  var [approvalHasMore, setApprovalHasMore] = useState(false)
  var [loading, setLoading] = useState(true)
  var [loadingMore, setLoadingMore] = useState(false)
  var [detailExp, setDetailExp] = useState(null)
  var [statusFilter, setStatusFilter] = useState('')
  var [editExp, setEditExp] = useState(null)

  var isAdmin = profile?.role === 'admin'
  var isAuditor = profile?.role === 'auditor'
  var isDeptApprover = (profile?.permissions || []).indexOf('dept_approve') !== -1
  var showApproveTab = isAdmin || isAuditor || isDeptApprover

  useEffect(function () {
    loadMyExpenses(false)
    loadApprovalExpenses(false)
  }, [statusFilter])

  async function loadMyExpenses(append) {
    var offset = append ? myExpenses.length : 0
    if (!append) setLoading(true)
    else setLoadingMore(true)

    var query = supabase.from('expenses')
      .select('id, category_id, sub_category_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, categories(name), sub_categories(name)')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    if (statusFilter) query = query.eq('status', statusFilter)

    var { data, error } = await query
    if (error) { alert('Failed to load: ' + error.message); setLoading(false); setLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    if (append) {
      setMyExpenses(function (prev) { return prev.concat(rows) })
    } else {
      setMyExpenses(rows)
    }
    setMyHasMore(hasMore)
    setLoading(false)
    setLoadingMore(false)
  }

  async function loadApprovalExpenses(append) {
    if (!showApproveTab) { setApprovalExpenses([]); return }

    var offset = append ? approvalExpenses.length : 0
    if (append) setLoadingMore(true)

    var statuses = []
    if (isAdmin || isAuditor) {
      statuses = isDeptApprover ? ['pending_dept', 'pending'] : ['pending']
    } else if (isDeptApprover) {
      statuses = ['pending_dept']
    }
    if (statuses.length === 0) { setApprovalExpenses([]); return }

    var query = supabase.from('expenses')
      .select('id, user_id, category_id, sub_category_id, amount_paise, description, status, expense_date, receipt_path, created_at, rejection_reason, categories(name), sub_categories(name), profiles:user_id(name)')
      .neq('user_id', profile.id)
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)

    var { data, error } = await query
    if (error) { alert('Failed to load approvals: ' + error.message); setLoadingMore(false); return }

    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    if (append) {
      setApprovalExpenses(function (prev) { return prev.concat(rows) })
    } else {
      setApprovalExpenses(rows)
    }
    setApprovalHasMore(hasMore)
    setLoadingMore(false)
  }

  function openDetail(exp) {
    setDetailExp(exp)
    setView('detail')
  }

  function handleFormDone() {
    setView('list')
    setEditExp(null)
    loadMyExpenses(false)
    loadApprovalExpenses(false)
  }

  var displayList = view === 'approve' ? approvalExpenses : myExpenses
  var displayHasMore = view === 'approve' ? approvalHasMore : myHasMore

  // Total points for my expenses
  var myTotal = myExpenses.reduce(function (sum, e) { return sum + (e.amount_paise || 0) }, 0)

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
  }

  // ═══════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════
  if (view === 'form') {
    return (
      <ExpenseForm
        profile={profile}
        editExp={editExp}
        onCancel={function () { setView('list'); setEditExp(null) }}
        onSaved={handleFormDone}
      />
    )
  }

  // ═══════════════════════════════════════════════
  // DETAIL VIEW
  // ═══════════════════════════════════════════════
  if (view === 'detail' && detailExp) {
    return (
      <ExpenseDetail
        exp={detailExp}
        profile={profile}
        isAdmin={isAdmin}
        isDeptApprover={isDeptApprover}
        onBack={function () { setView(detailExp._fromApprove ? 'approve' : 'list'); setDetailExp(null) }}
        onUpdated={function () { loadMyExpenses(false); loadApprovalExpenses(false); setView(detailExp._fromApprove ? 'approve' : 'list'); setDetailExp(null) }}
        onEdit={function () { setEditExp(detailExp); setView('form') }}
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
          <h2 className="text-lg font-bold text-gray-900">PC & Direct Expenses</h2>
          <p className="text-xs text-gray-400">
            {view === 'approve'
              ? approvalExpenses.length + ' pending approval'
              : myExpenses.length + ' expenses' + (myTotal > 0 ? ' · ' + formatPoints(myTotal) + ' total' : '')}
          </p>
        </div>
        <button onClick={function () { setEditExp(null); setView('form') }}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
          + New Expense
        </button>
      </div>

      {/* Tabs */}
      {showApproveTab && (
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button onClick={function () { setView('list'); setStatusFilter('') }}
            className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors " + (view === 'list' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
            My Expenses
          </button>
          <button onClick={function () { setView('approve'); setStatusFilter('') }}
            className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors relative " + (view === 'approve' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
            Approvals
            {approvalExpenses.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {approvalExpenses.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Status filter — My Expenses only */}
      {view === 'list' && (
        <div className="flex gap-2 flex-wrap">
          {['', 'pending_dept', 'pending', 'approved', 'rejected'].map(function (s) {
            var label = s ? STATUS_LABELS[s] : 'All'
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
          <p className="text-gray-400 text-sm">{view === 'approve' ? 'No pending approvals' : 'No expenses yet'}</p>
        </div>
      )}

      <div className="space-y-3">
        {displayList.map(function (exp) {
          return (
            <div key={exp.id}
              onClick={function () {
                var e = Object.assign({}, exp, { _fromApprove: view === 'approve' })
                openDetail(e)
              }}
              className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md active:bg-gray-50 cursor-pointer transition-all">
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{exp.description || 'Expense'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {view === 'approve' ? (exp.profiles?.name || '—') + ' · ' : ''}
                    {exp.categories?.name || '—'}
                    {exp.sub_categories?.name ? ' > ' + exp.sub_categories.name : ''}
                    {' · ' + formatDate(exp.expense_date)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                  <span className="text-sm font-bold text-gray-800">{formatPoints(exp.amount_paise)}</span>
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (STATUS_COLORS[exp.status] || 'bg-gray-100 text-gray-600')}>
                    {STATUS_LABELS[exp.status] || exp.status}
                  </span>
                </div>
              </div>
              {exp.status === 'rejected' && exp.rejection_reason && (
                <p className="text-[11px] text-red-500 mt-1 line-clamp-1">Reason: {exp.rejection_reason}</p>
              )}
              {exp.receipt_path && (
                <span className="text-[10px] text-green-600 font-medium">📎 Receipt attached</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Load More */}
      {displayHasMore && (
        <button onClick={function () {
          if (view === 'approve') loadApprovalExpenses(true)
          else loadMyExpenses(true)
        }} disabled={loadingMore}
          className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          {loadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// FORM — Submit / Edit expense
// ═══════════════════════════════════════════════════════════════
function ExpenseForm({ profile, editExp, onCancel, onSaved }) {
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [categoryId, setCategoryId] = useState(editExp ? String(editExp.category_id) : '')
  var [subCategoryId, setSubCategoryId] = useState(editExp?.sub_category_id ? String(editExp.sub_category_id) : '')
  var [amount, setAmount] = useState(editExp ? String(editExp.amount_paise / 100) : '')
  var [description, setDescription] = useState(editExp ? (editExp.description || '') : '')
  var [expenseDate, setExpenseDate] = useState(editExp ? editExp.expense_date : new Date().toISOString().split('T')[0])
  var [receiptFile, setReceiptFile] = useState(null)
  var [saving, setSaving] = useState(false)
  var [errors, setErrors] = useState({})

  var isEditing = !!editExp

  useEffect(function () {
    supabase.from('categories').select('id, name, status').order('name')
      .then(function (res) { setCategories(res.data || []) })
  }, [])

  useEffect(function () {
    if (categoryId) {
      supabase.from('sub_categories').select('id, name').eq('category_id', Number(categoryId)).order('name')
        .then(function (res) { setSubCategories(res.data || []) })
    } else { setSubCategories([]); setSubCategoryId('') }
  }, [categoryId])

  var catItems = categories.map(function (c) { return { label: c.name, value: String(c.id) } })
  var subCatItems = subCategories.map(function (s) { return { label: s.name, value: String(s.id) } })

  function validate() {
    var errs = {}
    if (!categoryId) errs.cat = 'Category required'
    if (!amount || Number(amount) <= 0) errs.amount = 'Amount required'
    if (!description.trim()) errs.desc = 'Description required'
    if (!expenseDate) errs.date = 'Date required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function uploadReceipt(expenseId) {
    if (!receiptFile) return null
    var ext = receiptFile.name.split('.').pop()
    var path = profile.id + '/' + expenseId + '_' + Date.now() + '.' + ext
    var { error } = await supabase.storage.from('receipts').upload(path, receiptFile, { upsert: true })
    if (error) return null
    return path
  }

  async function handleSubmit() {
    if (saving) return
    if (!validate()) return
    setSaving(true)

    try {
      var amountPaise = Math.round(Number(amount) * 100)

      if (isEditing) {
        var { error: updErr } = await supabase.from('expenses').update({
          category_id: Number(categoryId),
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
          amount_paise: amountPaise,
          description: description.trim(),
          expense_date: expenseDate,
        }).eq('id', editExp.id)
        if (updErr) throw new Error(updErr.message)

        if (receiptFile) {
          var path = await uploadReceipt(editExp.id)
          if (path) {
            var { error: pathErr } = await supabase.from('expenses').update({ receipt_path: path }).eq('id', editExp.id)
            if (pathErr) throw new Error(pathErr.message)
          }
        }

        try { await logActivity('EXPENSE_EDIT', description.trim() + ' | ' + formatPoints(amountPaise)) } catch (_) {}
      } else {
        // Determine status — same two-tier logic
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
          if (!approvers || approvers.length === 0) {
            status = 'pending'
          }
        }

        var { data: newExp, error: insErr } = await supabase.from('expenses').insert({
          user_id: profile.id,
          category_id: Number(categoryId),
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
          amount_paise: amountPaise,
          description: description.trim(),
          expense_date: expenseDate,
          status: status,
          dept_approved_by: deptApprovedBy,
          dept_approved_at: deptApprovedAt,
        }).select('id').single()
        if (insErr) throw new Error(insErr.message)

        if (receiptFile && newExp) {
          var path = await uploadReceipt(newExp.id)
          if (path) {
            await supabase.from('expenses').update({ receipt_path: path }).eq('id', newExp.id)
          }
        }

        try { await logActivity('EXPENSE_SUBMIT', description.trim() + ' | ' + formatPoints(amountPaise)) } catch (_) {}
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
        <h2 className="text-lg font-bold text-gray-900">{isEditing ? 'Edit Expense' : 'New Expense'}</h2>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 font-medium">Cancel</button>
      </div>

      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date <span className="text-red-500">*</span></label>
          <input type="date" value={expenseDate} onChange={function (e) { setExpenseDate(e.target.value) }}
            className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (errors.date ? "border-red-300" : "border-gray-300")}
            style={{ fontSize: '16px' }} />
          {errors.date && <p className="text-xs text-red-500 mt-1">{errors.date}</p>}
        </div>

        <SearchDropdown label="Category" required items={catItems} value={categoryId}
          onChange={function (val) { setCategoryId(val); setSubCategoryId('') }}
          placeholder="Search category..." error={errors.cat} />

        {subCatItems.length > 0 && (
          <SearchDropdown label="Sub-Category" items={subCatItems} value={subCategoryId}
            onChange={setSubCategoryId} placeholder="Search sub-category..." />
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Points) <span className="text-red-500">*</span></label>
          <div className="relative">
            <input type="number" min="1" step="any" inputMode="decimal" value={amount}
              onChange={function (e) { setAmount(e.target.value) }}
              placeholder="0"
              className={"w-full px-3 py-2 pr-12 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (errors.amount ? "border-red-300" : "border-gray-300")}
              style={{ fontSize: '16px' }} />
            <span className="absolute right-3 top-2.5 text-xs font-bold text-gray-400">pts</span>
          </div>
          {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
          <textarea value={description} onChange={function (e) { setDescription(e.target.value) }}
            rows="2" maxLength="500" placeholder="What was this expense for?"
            className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none " + (errors.desc ? "border-red-300" : "border-gray-300")}
            style={{ fontSize: '16px' }} />
          {errors.desc && <p className="text-xs text-red-500 mt-1">{errors.desc}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Receipt (optional)</label>
          <input type="file" accept="image/*,.pdf"
            onChange={function (e) { setReceiptFile(e.target.files?.[0] || null) }}
            className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100" />
          {editExp?.receipt_path && !receiptFile && (
            <p className="text-[11px] text-green-600 mt-1">📎 Existing receipt attached</p>
          )}
        </div>
      </div>

      {/* Summary */}
      {amount && Number(amount) > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-indigo-700">Total</span>
          <span className="text-sm font-bold text-indigo-900">{Number(amount).toLocaleString('en-IN')} pts</span>
        </div>
      )}

      {errors.submit && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errors.submit}</div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onCancel}
          className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={saving}
          className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
          {saving ? (isEditing ? 'Updating...' : 'Submitting...') : (isEditing ? 'Update Expense' : 'Submit Expense')}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// DETAIL + APPROVAL VIEW
// ═══════════════════════════════════════════════════════════════
function ExpenseDetail({ exp, profile, isAdmin, isDeptApprover, onBack, onUpdated, onEdit }) {
  var [saving, setSaving] = useState(false)
  var [rejectMode, setRejectMode] = useState(false)
  var [rejectReason, setRejectReason] = useState('')

  var canDeptApprove = isDeptApprover && exp.status === 'pending_dept' && exp.user_id !== profile?.id
  var canAdminApprove = isAdmin && exp.status === 'pending'
  var canApprove = canDeptApprove || canAdminApprove
  var canDelete = (exp.user_id === profile?.id && (exp.status === 'pending_dept' || exp.status === 'pending')) || isAdmin
  var canEdit = exp.user_id === profile?.id && (exp.status === 'pending_dept' || exp.status === 'pending')

  async function approve() {
    if (saving) return
    setSaving(true)
    var update = {}
    if (canDeptApprove) {
      update = { status: 'pending', dept_approved_by: profile.id, dept_approved_at: new Date().toISOString() }
    } else if (canAdminApprove) {
      update = { status: 'approved', reviewed_by: profile.id, reviewed_at: new Date().toISOString() }
    }
    var { error } = await supabase.from('expenses').update(update).eq('id', exp.id)
    if (error) { alert('Approve failed: ' + error.message); setSaving(false); return }
    try { await logActivity('EXPENSE_APPROVE', (exp.description || 'Expense') + ' | ' + formatPoints(exp.amount_paise) + ' | ' + (canDeptApprove ? 'dept' : 'admin')) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function reject() {
    if (!rejectReason.trim()) return
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'rejected',
      rejection_reason: rejectReason.trim(),
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Reject failed: ' + error.message); setSaving(false); return }
    try { await logActivity('EXPENSE_REJECT', (exp.description || 'Expense') + ' | ' + rejectReason.trim()) } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  async function deleteExp() {
    if (!confirm('Delete this expense? This cannot be undone.')) return
    if (saving) return
    setSaving(true)
    // Delete receipt from storage if exists
    if (exp.receipt_path) {
      await supabase.storage.from('receipts').remove([exp.receipt_path])
    }
    var { error } = await supabase.from('expenses').delete().eq('id', exp.id)
    if (error) { alert('Delete failed: ' + error.message); setSaving(false); return }
    try { await logActivity('EXPENSE_DELETE', exp.description || 'Expense') } catch (_) {}
    setSaving(false)
    onUpdated()
  }

  var receiptUrl = exp.receipt_path ? supabase.storage.from('receipts').getPublicUrl(exp.receipt_path).data?.publicUrl : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-2">← Back</button>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{exp.description || 'Expense'}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {exp.profiles?.name || '—'} · {formatDate(exp.expense_date)}
            </p>
          </div>
          <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " + (STATUS_COLORS[exp.status] || 'bg-gray-100 text-gray-600')}>
            {STATUS_LABELS[exp.status] || exp.status}
          </span>
        </div>
      </div>

      {/* Rejection reason */}
      {exp.status === 'rejected' && exp.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs font-bold text-red-700 mb-0.5">Rejection Reason</p>
          <p className="text-sm text-red-600">{exp.rejection_reason}</p>
        </div>
      )}

      {/* Details card */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Amount</span>
          <span className="text-sm font-bold text-gray-900">{formatPoints(exp.amount_paise)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Category</span>
          <span className="text-sm text-gray-800">{exp.categories?.name || '—'}{exp.sub_categories?.name ? ' > ' + exp.sub_categories.name : ''}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Date</span>
          <span className="text-sm text-gray-800">{formatDate(exp.expense_date)}</span>
        </div>
        {exp.description && (
          <div>
            <span className="text-sm text-gray-500">Description</span>
            <p className="text-sm text-gray-800 mt-0.5">{exp.description}</p>
          </div>
        )}
      </div>

      {/* Receipt */}
      {receiptUrl && (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Receipt</p>
          <a href={receiptUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
            📎 View Receipt
          </a>
        </div>
      )}

      {/* Edit button */}
      {canEdit && (
        <button onClick={onEdit} disabled={saving}
          className="w-full py-3 text-sm font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          ✎ Edit Expense
        </button>
      )}

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

      {/* Delete */}
      {canDelete && !canApprove && (
        <button onClick={deleteExp} disabled={saving}
          className="w-full py-3 text-sm font-bold text-red-500 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
          Delete Expense
        </button>
      )}
    </div>
  )
}

export default Expenses