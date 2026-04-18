import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPaise, formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import Modal from '../../components/ui/Modal'

var STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

function Expenses({ profile }) {
  var perms = profile?.permissions || []
  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
  var canApprove = isAdmin || perms.includes('expense_approve')
  var canSubmit = isAdmin || perms.includes('expense_submit')

  var [view, setView] = useState(canApprove ? 'review' : 'my')
  var [expenses, setExpenses] = useState([])
  var [categories, setCategories] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [showForm, setShowForm] = useState(false)
  var [search, setSearch] = useState('')
  var [rejectTarget, setRejectTarget] = useState(null)
  var [rejectReason, setRejectReason] = useState('')
  var [receiptPreview, setReceiptPreview] = useState(null)

  // Form state
  var [formCat, setFormCat] = useState('')
  var [formAmount, setFormAmount] = useState('')
  var [formDesc, setFormDesc] = useState('')
  var [formDate, setFormDate] = useState(new Date().toISOString().substring(0, 10))
  var [formReceipt, setFormReceipt] = useState(null)

  useEffect(function () { loadData() }, [view])

  async function loadData() {
    setLoading(true)
    var [catRes, expRes] = await Promise.all([
      supabase.from('expense_categories').select('id, name').eq('active', true).order('name'),
      view === 'review'
        ? supabase.from('expenses')
            .select('id, user_id, category_id, amount_paise, description, receipt_path, status, reviewed_by, reviewed_at, rejection_reason, expense_date, created_at, expense_categories(name), profiles!expenses_user_id_fkey(name, email)')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
        : supabase.from('expenses')
            .select('id, user_id, category_id, amount_paise, description, receipt_path, status, reviewed_by, reviewed_at, rejection_reason, expense_date, created_at, expense_categories(name), reviewer:profiles!expenses_reviewed_by_fkey(name)')
            .eq('user_id', profile.id)
            .order('created_at', { ascending: false })
            .limit(100)
    ])
    setCategories(catRes.data || [])
    setExpenses(expRes.data || [])
    setLoading(false)
  }

  function resetForm() {
    setFormCat('')
    setFormAmount('')
    setFormDesc('')
    setFormDate(new Date().toISOString().substring(0, 10))
    setFormReceipt(null)
    setShowForm(false)
  }

  async function handleSubmit() {
    if (!formCat || !formAmount || !formDesc.trim()) {
      alert('Category, amount, description required')
      return
    }
    var amtPaise = Math.round(Number(formAmount) * 100)
    if (amtPaise <= 0 || isNaN(amtPaise)) {
      alert('Enter valid amount')
      return
    }
    setSaving(true)

    var receiptPath = null
    if (formReceipt) {
      var ext = formReceipt.name.split('.').pop() || 'jpg'
      var filePath = profile.id + '/' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(filePath, formReceipt)
      if (upErr) {
        alert('Receipt upload failed: ' + upErr.message)
        setSaving(false)
        return
      }
      receiptPath = filePath
    }

    var { error } = await supabase.from('expenses').insert({
      user_id: profile.id,
      category_id: Number(formCat),
      amount_paise: amtPaise,
      description: formDesc.trim(),
      expense_date: formDate,
      receipt_path: receiptPath,
      status: 'pending',
    })
    if (error) {
      alert('Submit failed: ' + error.message)
      setSaving(false)
      return
    }
    logActivity('EXPENSE_SUBMIT', formatPaise(amtPaise) + ' | ' + formDesc.trim().substring(0, 50))
    resetForm()
    setSaving(false)
    loadData()
  }

  async function approveExpense(exp) {
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'approved',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', exp.id)
    if (error) { alert('Approve failed: ' + error.message); setSaving(false); return }
    logActivity('EXPENSE_APPROVE', formatPaise(exp.amount_paise) + ' | ' + (exp.profiles?.name || '—'))
    loadData()
    setSaving(false)
  }

  async function confirmReject() {
    if (!rejectTarget || !rejectReason.trim()) return
    setSaving(true)
    var { error } = await supabase.from('expenses').update({
      status: 'rejected',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: rejectReason.trim(),
    }).eq('id', rejectTarget.id)
    if (error) { alert('Reject failed: ' + error.message); setSaving(false); return }
    logActivity('EXPENSE_REJECT', formatPaise(rejectTarget.amount_paise) + ' | ' + rejectReason.trim().substring(0, 50))
    setRejectTarget(null)
    setRejectReason('')
    loadData()
    setSaving(false)
  }

  function getReceiptUrl(path) {
    if (!path) return null
    var { data } = supabase.storage.from('receipts').getPublicUrl(path)
    return data?.publicUrl || null
  }

  var searchLower = search.toLowerCase()
  var filtered = expenses.filter(function (e) {
    if (!search) return true
    return (e.description || '').toLowerCase().includes(searchLower) ||
      (e.expense_categories?.name || '').toLowerCase().includes(searchLower) ||
      (e.profiles?.name || '').toLowerCase().includes(searchLower) ||
      String(e.amount_paise).includes(search)
  })

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
  }

  return (
    <div className="space-y-3">
      {/* View toggle + Add button */}
      <div className="flex items-center gap-2">
        {canApprove && (
          <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden">
            <button onClick={function () { setView('review') }}
              className={"px-3 py-1.5 text-xs font-bold transition-colors " + (view === 'review' ? "bg-gray-900 text-white" : "text-gray-400")}>
              Review
            </button>
            <button onClick={function () { setView('my') }}
              className={"px-3 py-1.5 text-xs font-bold transition-colors " + (view === 'my' ? "bg-gray-900 text-white" : "text-gray-400")}>
              My Expenses
            </button>
          </div>
        )}
        <div className="flex-1" />
        {canSubmit && view === 'my' && (
          <button onClick={function () { setShowForm(true) }}
            className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
            + New Expense
          </button>
        )}
      </div>

      {/* Search */}
      <input type="text" value={search}
        onChange={function (e) { setSearch(e.target.value) }}
        placeholder="Search expenses..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        style={{ fontSize: '16px' }} />

      {/* Count */}
      <div className="text-sm text-gray-400">
        {filtered.length} expense{filtered.length !== 1 ? 's' : ''}{view === 'review' ? ' pending review' : ''}
      </div>

      {/* List */}
      {filtered.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">{view === 'review' ? 'No expenses pending review' : 'No expenses yet'}</p>
        </div>
      )}

      {filtered.map(function (exp) {
        var receiptUrl = getReceiptUrl(exp.receipt_path)
        return (
          <div key={exp.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  {/* Amount — admin/auditor always see, staff see own */}
                  <p className="text-lg font-bold text-gray-900">{formatPaise(exp.amount_paise)}</p>
                  <p className="text-sm text-gray-700 mt-0.5">{exp.description}</p>
                </div>
                <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0 " + (STATUS_COLORS[exp.status] || '')}>
                  {exp.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                <span>📁 {exp.expense_categories?.name || '—'}</span>
                <span>📅 {formatDate(exp.expense_date)}</span>
                {view === 'review' && exp.profiles && (
                  <span>👤 {exp.profiles.name}</span>
                )}
                {view === 'my' && exp.status === 'rejected' && exp.rejection_reason && (
                  <span className="text-red-500">❌ {exp.rejection_reason}</span>
                )}
                {view === 'my' && exp.status !== 'pending' && exp.reviewer?.name && (
                  <span>🔍 {exp.reviewer.name}</span>
                )}
              </div>
              {receiptUrl && (
                <button onClick={function () { setReceiptPreview(receiptUrl) }}
                  className="mt-2 text-xs text-indigo-600 font-medium hover:underline">
                  📎 View Receipt
                </button>
              )}
            </div>

            {/* Admin actions — only on review view, only pending */}
            {view === 'review' && exp.status === 'pending' && canApprove && (
              <div className="flex border-t border-gray-100">
                <button onClick={function () { approveExpense(exp) }} disabled={saving}
                  className="flex-1 py-3 text-sm font-bold text-green-600 hover:bg-green-50 active:bg-green-100 disabled:opacity-50 transition-colors">
                  ✓ Approve
                </button>
                <div className="w-px bg-gray-100" />
                <button onClick={function () { setRejectTarget(exp); setRejectReason('') }} disabled={saving}
                  className="flex-1 py-3 text-sm font-bold text-red-500 hover:bg-red-50 active:bg-red-100 disabled:opacity-50 transition-colors">
                  ✗ Reject
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* ═══ SUBMIT FORM MODAL ═══ */}
      <Modal open={showForm} onClose={resetForm} title="New Expense">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category <span className="text-red-500">*</span></label>
            <select value={formCat} onChange={function (e) { setFormCat(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }}>
              <option value="">Select category</option>
              {categories.map(function (c) {
                return <option key={c.id} value={String(c.id)}>{c.name}</option>
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹) <span className="text-red-500">*</span></label>
            <input type="number" inputMode="decimal" step="0.01" min="0" value={formAmount}
              onChange={function (e) { setFormAmount(e.target.value) }}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
            <textarea value={formDesc} onChange={function (e) { setFormDesc(e.target.value) }}
              rows="2" maxLength="500" placeholder="What was this expense for?"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={formDate}
              onChange={function (e) { setFormDate(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Receipt (optional)</label>
            <input type="file" accept="image/*,application/pdf"
              onChange={function (e) { setFormReceipt(e.target.files?.[0] || null) }}
              className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={resetForm}
              className="flex-1 px-4 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={saving || !formCat || !formAmount || !formDesc.trim()}
              className="flex-1 px-4 py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
              {saving ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ═══ REJECT MODAL ═══ */}
      <Modal open={!!rejectTarget} onClose={function () { setRejectTarget(null) }} title="Reject Expense">
        {rejectTarget && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium">Reject {formatPaise(rejectTarget.amount_paise)} expense?</p>
              <p className="text-xs text-red-600 mt-1">{rejectTarget.description}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
              <textarea value={rejectReason}
                onChange={function (e) { setRejectReason(e.target.value) }}
                rows="3" maxLength="500" placeholder="Reason for rejection..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                style={{ fontSize: '16px' }} />
            </div>
            <div className="flex gap-3">
              <button onClick={function () { setRejectTarget(null) }}
                className="flex-1 px-4 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
              <button onClick={confirmReject} disabled={saving || !rejectReason.trim()}
                className="flex-1 px-4 py-3 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ═══ RECEIPT PREVIEW MODAL ═══ */}
      <Modal open={!!receiptPreview} onClose={function () { setReceiptPreview(null) }} title="Receipt">
        {receiptPreview && (
          <div className="flex items-center justify-center">
            {receiptPreview.endsWith('.pdf') ? (
              <a href={receiptPreview} target="_blank" rel="noopener noreferrer"
                className="text-indigo-600 font-medium text-sm hover:underline">Open PDF in new tab</a>
            ) : (
              <img src={receiptPreview} alt="Receipt" className="max-w-full max-h-[70vh] rounded-lg" />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default Expenses
