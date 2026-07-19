import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

var FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Dropdown' },
  { value: 'date', label: 'Date' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'lookup', label: 'System Lookup' },
]

var LOOKUP_SOURCES = [
  { value: 'vendors', label: 'Vendors (Master)' },
  { value: 'staff', label: 'Staff / Users' },
  { value: 'venues', label: 'Venues' },
]

// ═══════════════════════════════════════════════
// FIELD EDITOR — edit extra_fields for a sub-type
// ═══════════════════════════════════════════════
function FieldEditor({ subType, typeName, onBack, onSaved }) {
  var [fields, setFields] = useState(subType.extra_fields || [])
  var [saving, setSaving] = useState(false)
  var [editIdx, setEditIdx] = useState(null)
  var [form, setForm] = useState(null)

  function makeField() {
    return { key: '', label: '', type: 'text', required: false, options: [], source: '' }
  }

  function openAdd() {
    setForm(makeField())
    setEditIdx(-1)
  }

  function openEdit(idx) {
    var f = fields[idx]
    setForm(Object.assign({}, f, { options: f.options || [], source: f.source || '' }))
    setEditIdx(idx)
  }

  function cancelEdit() {
    setForm(null)
    setEditIdx(null)
  }

  function updateForm(key, val) {
    setForm(Object.assign({}, form, (function () { var o = {}; o[key] = val; return o })()))
  }

  function saveField() {
    if (!form.label.trim()) return
    var key = form.key || form.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
    var field = {
      key: key,
      label: form.label.trim(),
      type: form.type,
      required: form.required,
    }
    if (form.type === 'select') {
      field.options = (form.options || []).filter(function (o) { return o.trim() })
    }
    if (form.type === 'lookup') {
      field.source = form.source
    }

    var updated
    if (editIdx === -1) {
      updated = fields.concat([field])
    } else {
      updated = fields.map(function (f, i) { return i === editIdx ? field : f })
    }
    setFields(updated)
    cancelEdit()
  }

  function removeField(idx) {
    if (!confirm('Remove this field?')) return
    setFields(fields.filter(function (_, i) { return i !== idx }))
  }

  function moveField(idx, dir) {
    if (idx + dir < 0 || idx + dir >= fields.length) return
    var arr = fields.slice()
    var tmp = arr[idx]
    arr[idx] = arr[idx + dir]
    arr[idx + dir] = tmp
    setFields(arr)
  }

  async function saveAll() {
    if (saving) return
    setSaving(true)
    var { error } = await supabase.from('expense_sub_types')
      .update({ extra_fields: fields })
      .eq('id', subType.id)
    if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
    setSaving(false)
    if (onSaved) onSaved()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 mb-1">← Back</button>
          <p className="text-xs text-gray-400 mb-0.5">{typeName} → {subType.name}</p>
          <h2 className="text-lg font-bold text-gray-900">Custom Fields</h2>
          <p className="text-xs text-gray-400">{fields.length} field{fields.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAdd}
            className="px-3 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
            + Add Field
          </button>
          <button onClick={saveAll} disabled={saving}
            className="px-3 py-2 text-xs font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Saving...' : '✓ Save All'}
          </button>
        </div>
      </div>

      {/* Field list */}
      {fields.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No custom fields yet</p>
        </div>
      )}

      {fields.map(function (f, idx) {
        return (
          <div key={f.key + '_' + idx} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{f.label}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-bold uppercase">{f.type}</span>
                  {f.required && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-bold">Required</span>}
                  {f.type === 'lookup' && f.source && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-bold">
                      → {LOOKUP_SOURCES.find(function (s) { return s.value === f.source })?.label || f.source}
                    </span>
                  )}
                </div>
                {f.type === 'select' && f.options && (
                  <p className="text-[11px] text-gray-400 mt-1">Options: {f.options.join(', ')}</p>
                )}
              </div>
              <div className="flex gap-1">
                <button onClick={function () { moveField(idx, -1) }} disabled={idx === 0}
                  className="w-7 h-7 text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">↑</button>
                <button onClick={function () { moveField(idx, 1) }} disabled={idx === fields.length - 1}
                  className="w-7 h-7 text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30">↓</button>
                <button onClick={function () { openEdit(idx) }}
                  className="w-7 h-7 text-xs text-gray-500 hover:text-indigo-600">✎</button>
                <button onClick={function () { removeField(idx) }}
                  className="w-7 h-7 text-xs text-gray-400 hover:text-red-600">✕</button>
              </div>
            </div>
          </div>
        )
      })}

      {/* Add/Edit field form */}
      {form && (
        <div className="bg-white border-2 border-indigo-300 rounded-xl p-4 space-y-3">
          <p className="text-sm font-bold text-indigo-700">{editIdx === -1 ? 'New Field' : 'Edit Field'}</p>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Label *</label>
            <input type="text" value={form.label}
              onChange={function (e) { updateForm('label', e.target.value) }}
              placeholder="e.g. Vendor Name, Distance (km)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              style={{ fontSize: '16px' }} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <select value={form.type}
              onChange={function (e) { updateForm('type', e.target.value) }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
              style={{ fontSize: '16px' }}>
              {FIELD_TYPES.map(function (t) { return <option key={t.value} value={t.value}>{t.label}</option> })}
            </select>
          </div>

          {form.type === 'lookup' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data Source</label>
              <select value={form.source}
                onChange={function (e) { updateForm('source', e.target.value) }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                style={{ fontSize: '16px' }}>
                <option value="">Select source...</option>
                {LOOKUP_SOURCES.map(function (s) { return <option key={s.value} value={s.value}>{s.label}</option> })}
              </select>
            </div>
          )}

          {form.type === 'select' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Options (one per line)</label>
              <textarea
                value={(form.options || []).join('\n')}
                onChange={function (e) { updateForm('options', e.target.value.split('\n')) }}
                rows={4}
                placeholder={"Option 1\nOption 2\nOption 3"}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none"
                style={{ fontSize: '16px' }} />
            </div>
          )}

          <div className="flex items-center gap-2">
            <input type="checkbox" checked={form.required}
              onChange={function (e) { updateForm('required', e.target.checked) }}
              id="field_required" />
            <label htmlFor="field_required" className="text-sm text-gray-700">Required</label>
          </div>

          <div className="flex gap-2">
            <button onClick={cancelEdit}
              className="flex-1 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium">Cancel</button>
            <button onClick={saveField} disabled={!form.label.trim() || (form.type === 'lookup' && !form.source)}
              className="flex-1 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">
              {editIdx === -1 ? 'Add' : 'Update'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════
// SUB-TYPE LIST — for a given expense type
// ═══════════════════════════════════════════════
function SubTypeList({ expenseType, onBack }) {
  var [subTypes, setSubTypes] = useState([])
  var [loading, setLoading] = useState(true)
  var [editId, setEditId] = useState(null)
  var [form, setForm] = useState({ name: '', description: '' })
  var [saving, setSaving] = useState(false)
  var [fieldView, setFieldView] = useState(null)

  useEffect(function () { load() }, [])

  async function load() {
    var { data } = await supabase.from('expense_sub_types')
      .select('*')
      .eq('expense_type_id', expenseType.id)
      .order('sort_order')
      .order('name')
    setSubTypes(data || [])
    setLoading(false)
  }

  function openAdd() {
    setForm({ name: '', description: '' })
    setEditId('new')
  }

  function openEdit(st) {
    setForm({ name: st.name, description: st.description || '' })
    setEditId(st.id)
  }

  function cancelEdit() {
    setForm({ name: '', description: '' })
    setEditId(null)
  }

  async function saveSubType() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    if (editId === 'new') {
      var { error } = await supabase.from('expense_sub_types').insert({
        expense_type_id: expenseType.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        sort_order: subTypes.length,
      })
      if (error) { alert('Add failed: ' + error.message); setSaving(false); return }
    } else {
      var { error: uErr } = await supabase.from('expense_sub_types').update({
        name: form.name.trim(),
        description: form.description.trim() || null,
      }).eq('id', editId)
      if (uErr) { alert('Update failed: ' + uErr.message); setSaving(false); return }
    }
    setSaving(false)
    cancelEdit()
    load()
  }

  async function deleteSubType(st) {
    if (!confirm('Delete "' + st.name + '"? This cannot be undone.')) return
    var { error } = await supabase.from('expense_sub_types').delete().eq('id', st.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }

  async function toggleActive(st) {
    await supabase.from('expense_sub_types').update({ active: !st.active }).eq('id', st.id)
    load()
  }

  if (fieldView) {
    return (
      <FieldEditor
        subType={fieldView}
        typeName={expenseType.name}
        onBack={function () { setFieldView(null); load() }}
        onSaved={function () { setFieldView(null); load() }}
      />
    )
  }

  if (loading) return <p className="text-center py-8 text-gray-400 text-sm">Loading...</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 mb-1">← Back</button>
          <h2 className="text-lg font-bold text-gray-900">{expenseType.name}</h2>
          <p className="text-xs text-gray-400">{subTypes.length} sub-type{subTypes.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={openAdd}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
          + Add Sub-Type
        </button>
      </div>

      {subTypes.length === 0 && !editId && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No sub-types yet. Add one to get started.</p>
        </div>
      )}

      {subTypes.map(function (st) {
        var fieldCount = (st.extra_fields || []).length
        return (
          <div key={st.id} className={"bg-white border rounded-xl p-4 " + (st.active ? "border-gray-200" : "border-gray-100 opacity-60")}>
            <div className="flex items-center justify-between">
              <div className="flex-1 cursor-pointer" onClick={function () { setFieldView(st) }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{st.name}</span>
                  {fieldCount > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-bold">
                      {fieldCount} field{fieldCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {!st.active && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-bold">OFF</span>
                  )}
                </div>
                {st.description && <p className="text-xs text-gray-400 mt-0.5">{st.description}</p>}
              </div>
              <div className="flex gap-1">
                <button onClick={function () { setFieldView(st) }}
                  className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded font-medium">⚙ Fields</button>
                <button onClick={function () { openEdit(st) }}
                  className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded">✎</button>
                <button onClick={function () { toggleActive(st) }}
                  className={"px-2 py-1 text-xs rounded font-medium " + (st.active ? "text-green-600 hover:bg-green-50" : "text-gray-400 hover:bg-gray-100")}>
                  {st.active ? 'On' : 'Off'}
                </button>
                <button onClick={function () { deleteSubType(st) }}
                  className="px-2 py-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded">✕</button>
              </div>
            </div>
          </div>
        )
      })}

      {/* Add/Edit form */}
      {editId && (
        <div className="bg-white border-2 border-indigo-300 rounded-xl p-4 space-y-3">
          <p className="text-sm font-bold text-indigo-700">{editId === 'new' ? 'New Sub-Type' : 'Edit Sub-Type'}</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input type="text" value={form.name}
              onChange={function (e) { setForm(Object.assign({}, form, { name: e.target.value })) }}
              placeholder="e.g. Fuel, Electricity, Cab"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input type="text" value={form.description}
              onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value })) }}
              placeholder="Optional description"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="flex gap-2">
            <button onClick={cancelEdit}
              className="flex-1 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium">Cancel</button>
            <button onClick={saveSubType} disabled={!form.name.trim() || saving}
              className="flex-1 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">
              {saving ? 'Saving...' : (editId === 'new' ? 'Add' : 'Update')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════
// MAIN — expense types list
// ═══════════════════════════════════════════════
function ExpenseTypeMaster({ onBack }) {
  var [types, setTypes] = useState([])
  var [loading, setLoading] = useState(true)
  var [editId, setEditId] = useState(null)
  var [form, setForm] = useState({ name: '', description: '', icon: '', department_id: '', sub_department_id: '' })
  var [saving, setSaving] = useState(false)
  var [subView, setSubView] = useState(null)
  var [departments, setDepartments] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [search, setSearch] = useState('')
  var [deptFilter, setDeptFilter] = useState('')
  var [collapsed, setCollapsed] = useState({})

  function toggleCollapsed(key) {
    setCollapsed(function (prev) {
      var next = Object.assign({}, prev)
      next[key] = !prev[key]
      return next
    })
  }

  useEffect(function () {
    load()
    supabase.from('departments').select('id, name').eq('active', true).order('name').then(function (r) { setDepartments(r.data || []) })
    supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name').then(function (r) { setSubDepartments(r.data || []) })
  }, [])

  async function load() {
    var { data } = await supabase.from('expense_types')
      .select('*, expense_sub_types(id)')
      .eq('active', true)
      .order('sort_order')
      .order('name')
    setTypes(data || [])
    setLoading(false)
  }

  function openAdd() {
    setForm({ name: '', description: '', icon: '', department_id: '', sub_department_id: '' })
    setEditId('new')
  }

  function openEdit(t) {
    setForm({ name: t.name, description: t.description || '', icon: t.icon || '', department_id: t.department_id ? String(t.department_id) : '', sub_department_id: t.sub_department_id ? String(t.sub_department_id) : '' })
    setEditId(t.id)
  }

  function cancelEdit() {
    setForm({ name: '', description: '', icon: '', department_id: '', sub_department_id: '' })
    setEditId(null)
  }

  async function saveType() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    var payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      icon: form.icon.trim() || null,
      department_id: form.department_id ? Number(form.department_id) : null,
      sub_department_id: form.sub_department_id ? Number(form.sub_department_id) : null,
    }
    if (editId === 'new') {
      payload.sort_order = types.length
      payload.active = true
      var { error } = await supabase.from('expense_types').insert(payload)
      if (error) { alert('Add failed: ' + error.message); setSaving(false); return }
    } else {
      var { error: uErr } = await supabase.from('expense_types').update(payload).eq('id', editId)
      if (uErr) { alert('Update failed: ' + uErr.message); setSaving(false); return }
    }
    setSaving(false)
    cancelEdit()
    load()
  }

  async function deleteType(t) {
    var subCount = (t.expense_sub_types || []).length
    var msg = 'Delete "' + t.name + '"?'
    if (subCount > 0) msg += ' This will also delete ' + subCount + ' sub-type' + (subCount > 1 ? 's' : '') + '.'
    if (!confirm(msg)) return
    var { error } = await supabase.from('expense_types').delete().eq('id', t.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }

  async function toggleActive(t) {
    await supabase.from('expense_types').update({ active: !t.active }).eq('id', t.id)
    load()
  }

  if (subView) {
    return <SubTypeList expenseType={subView} onBack={function () { setSubView(null); load() }} />
  }

  if (loading) return <p className="text-center py-8 text-gray-400 text-sm">Loading...</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {onBack && <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 mb-1">← Back</button>}
          <h2 className="text-lg font-bold text-gray-900">Expense Types</h2>
          <p className="text-xs text-gray-400">Manage types, sub-types, and custom fields</p>
        </div>
        <button onClick={openAdd}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
          + Add Type
        </button>
      </div>

      {/* Filter row */}
      {types.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <input type="text" value={search}
            onChange={function (e) { setSearch(e.target.value) }}
            placeholder="🔍 Search types..."
            className="flex-1 min-w-[180px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            style={{ fontSize: '16px' }} />
          <select value={deptFilter}
            onChange={function (e) { setDeptFilter(e.target.value) }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            style={{ fontSize: '16px' }}>
            <option value="">All departments</option>
            <option value="none">Unassigned</option>
            {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
          </select>
          {(search || deptFilter) && (
            <button type="button" onClick={function () { setSearch(''); setDeptFilter('') }}
              className="px-3 py-2 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium">Reset</button>
          )}
        </div>
      )}

      {types.length === 0 && !editId && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No expense types yet. Add one to get started.</p>
        </div>
      )}

      {(function () {
        var q = search.trim().toLowerCase()
        var filtered = types.filter(function (t) {
          if (deptFilter === 'none' && t.department_id) return false
          if (deptFilter && deptFilter !== 'none' && String(t.department_id || '') !== deptFilter) return false
          if (q) {
            var hay = (t.name || '').toLowerCase() + ' ' + (t.description || '').toLowerCase()
            if (hay.indexOf(q) === -1) return false
          }
          return true
        })
        if (types.length > 0 && filtered.length === 0) {
          return (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-gray-400 text-sm">No types match filters</p>
            </div>
          )
        }
        var groupMap = {}
        filtered.forEach(function (t) {
          var key = String(t.department_id || 0)
          if (!groupMap[key]) {
            var d = t.department_id ? departments.find(function (x) { return x.id === t.department_id }) : null
            groupMap[key] = { key: key, label: d ? d.name : 'Unassigned', deptId: t.department_id || 0, items: [] }
          }
          groupMap[key].items.push(t)
        })
        var groups = Object.keys(groupMap).map(function (k) { return groupMap[k] }).sort(function (a, b) {
          if (a.deptId === 0 && b.deptId !== 0) return 1
          if (b.deptId === 0 && a.deptId !== 0) return -1
          return a.label.localeCompare(b.label)
        })
        var forceOpen = !!q
        return groups.map(function (g) {
          var open = forceOpen || !collapsed[g.key]
          return (
            <div key={g.key} className="space-y-2">
              <button type="button" onClick={function () { toggleCollapsed(g.key) }}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200">
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{g.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-gray-600 font-bold">{g.items.length}</span>
                  <span className="text-gray-500 text-xs">{open ? '▾' : '▸'}</span>
                </div>
              </button>
              {open && g.items.map(function (t) {
                var subCount = (t.expense_sub_types || []).length
                var isEditing = editId === t.id
                return (
                  <div key={t.id}>
                    {!isEditing && (
                      <div className="bg-white border border-gray-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 cursor-pointer" onClick={function () { setSubView(t) }}>
                            <div className="flex items-center gap-2 flex-wrap">
                              {t.icon && <span className="text-lg">{t.icon}</span>}
                              <span className="text-sm font-semibold text-gray-900">{t.name}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-bold">
                                {subCount} sub-type{subCount !== 1 ? 's' : ''}
                              </span>
                              {t.sub_department_id && (function () {
                                var sd = subDepartments.find(function (x) { return x.id === t.sub_department_id })
                                return sd ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-bold">{sd.name}</span> : null
                              })()}
                            </div>
                            {t.description && <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>}
                          </div>
                          <div className="flex gap-1">
                            <button onClick={function () { setSubView(t) }}
                              className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded font-medium">Sub-Types →</button>
                            <button onClick={function () { openEdit(t) }}
                              className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded">✎</button>
                            <button onClick={function () { deleteType(t) }}
                              className="px-2 py-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded">✕</button>
                          </div>
                        </div>
                      </div>
                    )}
            {isEditing && (function () {
              var formSubDepts = form.department_id ? subDepartments.filter(function (sd) { return sd.department_id === Number(form.department_id) }) : []
              return (
                <div className="bg-white border-2 border-indigo-300 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-bold text-indigo-700">Edit Expense Type</p>
                  <div className="grid grid-cols-6 gap-3">
                    <div className="col-span-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Icon</label>
                      <input type="text" value={form.icon}
                        onChange={function (e) { setForm(Object.assign({}, form, { icon: e.target.value })) }}
                        placeholder="💰"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-center"
                        style={{ fontSize: '16px' }}
                        maxLength={4} />
                    </div>
                    <div className="col-span-5">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                      <input type="text" value={form.name}
                        onChange={function (e) { setForm(Object.assign({}, form, { name: e.target.value })) }}
                        placeholder="e.g. Transport, Vendor Payment, Utility"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        style={{ fontSize: '16px' }} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                    <input type="text" value={form.description}
                      onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value })) }}
                      placeholder="Optional description"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      style={{ fontSize: '16px' }} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                      <select value={form.department_id}
                        onChange={function (e) { setForm(Object.assign({}, form, { department_id: e.target.value, sub_department_id: '' })) }}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        style={{ fontSize: '16px' }}>
                        <option value="">All departments</option>
                        {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Sub-department</label>
                      <select value={form.sub_department_id}
                        onChange={function (e) { setForm(Object.assign({}, form, { sub_department_id: e.target.value })) }}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                        style={{ fontSize: '16px' }}
                        disabled={formSubDepts.length === 0}>
                        <option value="">All</option>
                        {formSubDepts.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={cancelEdit}
                      className="flex-1 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium">Cancel</button>
                    <button onClick={saveType} disabled={!form.name.trim() || saving}
                      className="flex-1 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">
                      {saving ? 'Saving...' : 'Update'}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        )
      })}
            </div>
          )
        })
      })()}

      {/* Add NEW form — shown at bottom only for new */}
      {editId === 'new' && (function () {
        var formSubDepts = form.department_id ? subDepartments.filter(function (sd) { return sd.department_id === Number(form.department_id) }) : []
        return (
          <div className="bg-white border-2 border-indigo-300 rounded-xl p-4 space-y-3">
            <p className="text-sm font-bold text-indigo-700">New Expense Type</p>
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Icon</label>
                <input type="text" value={form.icon}
                  onChange={function (e) { setForm(Object.assign({}, form, { icon: e.target.value })) }}
                  placeholder="💰"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-center"
                  style={{ fontSize: '16px' }}
                  maxLength={4} />
              </div>
              <div className="col-span-5">
                <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                <input type="text" value={form.name}
                  onChange={function (e) { setForm(Object.assign({}, form, { name: e.target.value })) }}
                  placeholder="e.g. Transport, Vendor Payment, Utility"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  style={{ fontSize: '16px' }} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <input type="text" value={form.description}
                onChange={function (e) { setForm(Object.assign({}, form, { description: e.target.value })) }}
                placeholder="Optional description"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                style={{ fontSize: '16px' }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                <select value={form.department_id}
                  onChange={function (e) { setForm(Object.assign({}, form, { department_id: e.target.value, sub_department_id: '' })) }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  style={{ fontSize: '16px' }}>
                  <option value="">All departments</option>
                  {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sub-department</label>
                <select value={form.sub_department_id}
                  onChange={function (e) { setForm(Object.assign({}, form, { sub_department_id: e.target.value })) }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                  style={{ fontSize: '16px' }}
                  disabled={formSubDepts.length === 0}>
                  <option value="">All</option>
                  {formSubDepts.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={cancelEdit}
                className="flex-1 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium">Cancel</button>
              <button onClick={saveType} disabled={!form.name.trim() || saving}
                className="flex-1 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">
                {saving ? 'Saving...' : 'Add'}
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default ExpenseTypeMaster
