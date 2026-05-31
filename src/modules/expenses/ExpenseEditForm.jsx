import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { filterUserCategories } from '../../lib/categories'
import SearchDropdown from '../../components/ui/SearchDropdown'

function ExpenseEditForm({ profile, editExp, walletBalance, onCancel, onSaved }) {
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
  var [dupeWarning, setDupeWarning] = useState('')
  var [fieldValues, setFieldValues] = useState(function () {
    if (!editExp) return {}
    var fv = editExp.metadata && typeof editExp.metadata === 'object' ? Object.assign({}, editExp.metadata) : {}
    if (!fv.vendor_name && editExp.vendor_name) fv.vendor_name = editExp.vendor_name
    if (!fv.travel_from && editExp.travel_from) fv.travel_from = editExp.travel_from
    if (!fv.travel_to && editExp.travel_to) fv.travel_to = editExp.travel_to
    if (!fv.travel_mode && editExp.travel_mode) fv.travel_mode = editExp.travel_mode
    return fv
  })

  var isEditing = !!editExp
  var typeFields = editExp?.expense_types?.extra_fields || []

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

  useEffect(function () {
    if (!amount || !expenseDate || Number(amount) <= 0 || isEditing) { setDupeWarning(''); return }
    var paise = Math.round(Number(amount) * 100)
    supabase.from('expenses')
      .select('id, description')
      .eq('user_id', profile.id)
      .eq('amount_paise', paise)
      .eq('expense_date', expenseDate)
      .limit(1)
      .maybeSingle()
      .then(function (res) {
        if (res.data) {
          setDupeWarning('Possible duplicate: "' + (res.data.description || 'Expense') + '" with same amount on same date')
        } else {
          setDupeWarning('')
        }
      })
  }, [amount, expenseDate])

  var catItems = filterUserCategories(categories, profile).map(function (c) { return { label: c.name, value: String(c.id) } })
  var subCatItems = subCategories.map(function (s) { return { label: s.name, value: String(s.id) } })

  function validate() {
    var errs = {}
    if (!categoryId) errs.cat = 'Category required'
    if (!amount || Number(amount) <= 0) errs.amount = 'Amount required'
    if (!description.trim()) errs.desc = 'Description required'
    if (!expenseDate) errs.date = 'Date required'
    for (var f = 0; f < typeFields.length; f++) {
      if (typeFields[f].required && !(fieldValues[typeFields[f].key] || '').toString().trim()) {
        errs.field = typeFields[f].label + ' is required'
        break
      }
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function updateFieldValue(key, val) {
    setFieldValues(function (prev) { return Object.assign({}, prev, { [key]: val }) })
  }

  function renderDynamicField(field, value, onChange) {
    var cls = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
    var sty = { fontSize: '16px' }
    if (field.type === 'select') {
      return (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <select value={value || ''} onChange={function (e) { onChange(e.target.value) }} className={cls + ' bg-white'} style={sty}>
            <option value="">Select...</option>
            {(field.options || []).map(function (opt) { return <option key={opt} value={opt}>{opt}</option> })}
          </select>
        </div>
      )
    }
    if (field.type === 'number') {
      return (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="number" inputMode="numeric" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
        </div>
      )
    }
    if (field.type === 'textarea') {
      return (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <textarea value={value || ''} onChange={function (e) { onChange(e.target.value) }} rows={2} className={cls + ' resize-none'} style={sty} />
        </div>
      )
    }
    if (field.type === 'date') {
      return (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
          <input type="date" value={value || ''} onChange={function (e) { onChange(e.target.value) }} className={cls} style={sty} />
        </div>
      )
    }
    return (
      <div key={field.key}>
        <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}{field.required && <span className="text-red-500"> *</span>}</label>
        <input type="text" value={value || ''} onChange={function (e) { onChange(e.target.value) }} placeholder={field.label} className={cls} style={sty} />
      </div>
    )
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
          metadata: fieldValues,
          vendor_name: fieldValues.vendor_name || null,
          travel_from: fieldValues.travel_from || null,
          travel_to: fieldValues.travel_to || null,
          travel_mode: fieldValues.travel_mode || null,
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

        var oldPaise = editExp.amount_paise || 0
        var diffPaise = amountPaise - oldPaise
        if (diffPaise !== 0) {
          var wRpc = diffPaise > 0 ? 'wallet_self_debit' : 'wallet_self_credit'
          var wAmt = Math.abs(diffPaise)
          var wRef = diffPaise > 0 ? 'expense' : 'expense_refund'
          var wDesc = 'Expense edited: ' + (diffPaise > 0 ? '+' : '-') + formatPoints(wAmt)
          var { error: wErr } = await supabase.rpc(wRpc, {
            p_amount_paise: wAmt,
            p_description: wDesc,
            p_ref_type: wRef,
            p_ref_id: editExp.id,
          })
          if (wErr) console.warn('Wallet adjust failed:', wErr.message)
        }
      } else {
        var { data: newExp, error: insErr } = await supabase.from('expenses').insert({
          user_id: profile.id,
          category_id: Number(categoryId),
          sub_category_id: subCategoryId ? Number(subCategoryId) : null,
          amount_paise: amountPaise,
          description: description.trim(),
          expense_date: expenseDate,
          status: 'recorded',
        }).select('id').single()
        if (insErr) throw new Error(insErr.message)

        if (receiptFile && newExp) {
          var path = await uploadReceipt(newExp.id)
          if (path) {
            await supabase.from('expenses').update({ receipt_path: path }).eq('id', newExp.id)
          }
        }

        try {
          await supabase.rpc('wallet_self_debit', {
            p_amount_paise: amountPaise,
            p_description: 'Expense: ' + description.trim().slice(0, 50),
            p_ref_type: 'expense',
            p_ref_id: String(newExp.id),
          })
        } catch (_) {}
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

        {typeFields.map(function (field) {
          return renderDynamicField(field, fieldValues[field.key] || '', function (val) { updateFieldValue(field.key, val) })
        })}
        {errors.field && <p className="text-xs text-red-500 mt-1">{errors.field}</p>}

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

      {amount && Number(amount) > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-indigo-700">Total</span>
          <span className="text-sm font-bold text-indigo-900">{Number(amount).toLocaleString('en-IN')} pts</span>
        </div>
      )}
      {dupeWarning && (
        <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3">
          <span className="text-orange-600 text-lg">⚠️</span>
          <p className="text-sm text-orange-700">{dupeWarning}</p>
        </div>
      )}
      {amount && Number(amount) > 0 && walletBalance != null && Math.round(Number(amount) * 100) > walletBalance && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <span className="text-amber-600 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-700">Insufficient balance</p>
            <p className="text-xs text-amber-600">Wallet: {formatPoints(walletBalance)} · Expense: {Number(amount).toLocaleString('en-IN')} pts · Shortfall: {formatPoints(Math.round(Number(amount) * 100) - walletBalance)}</p>
          </div>
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

export default ExpenseEditForm
