import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'

var RATE_TYPES = [
  { value: 'unit', label: 'Unit' },
  { value: 'set', label: 'Set' },
]

function CasualRoster({ profile }) {
  var [rows, setRows] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [departments, setDepartments] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [casualTypes, setCasualTypes] = useState([])

  // Form
  var [showForm, setShowForm] = useState(false)
  var [editRow, setEditRow] = useState(null)
  var [fDeptId, setFDeptId] = useState('')
  var [fSubDeptId, setFSubDeptId] = useState('')
  var [fCasualType, setFCasualType] = useState('')
  var [fRateType, setFRateType] = useState('unit')
  var [fRate, setFRate] = useState('')

  useEffect(function () { loadRows(); loadRefData() }, [])

  async function loadRows() {
    setLoading(true)
    var { data } = await supabase.from('casual_roster')
      .select('*, departments(name), sub_departments(name)')
      .order('sort_order').order('casual_type')
    setRows(data || [])
    setLoading(false)
  }

  async function loadRefData() {
    var [dR, sdR, ctR] = await Promise.all([
      supabase.from('departments').select('id, name').eq('active', true).eq('hide_from_lists', false).order('name'),
      supabase.from('sub_departments').select('id, name, department_id, departments!inner(hide_from_lists)').eq('active', true).eq('departments.hide_from_lists', false).order('name'),
      supabase.from('casual_types').select('id, name').eq('active', true).order('name'),
    ])
    setDepartments(dR.data || [])
    setSubDepartments(sdR.data || [])
    setCasualTypes(ctR.data || [])
  }

  function resetForm() {
    setFDeptId(''); setFSubDeptId(''); setFCasualType(''); setFRateType('unit'); setFRate('')
    setEditRow(null); setShowForm(false)
  }

  function openEdit(row) {
    setEditRow(row)
    setFDeptId(row.department_id ? String(row.department_id) : '')
    setFSubDeptId(row.sub_department_id ? String(row.sub_department_id) : '')
    setFCasualType(row.casual_type || '')
    setFRateType(row.rate_type || 'unit')
    setFRate(row.rate_paise ? String(row.rate_paise / 100) : '')
    setShowForm(true)
  }

  // Ensures a freshly-typed Casual Type is remembered for next time's
  // suggestions, the same "type freely, persist new ones" shape Purchase.jsx
  // already uses for vendors — just without the extra confirm step, since
  // there's no other metadata to collect for a casual type.
  async function rememberCasualType(name) {
    var isKnown = casualTypes.some(function (ct) { return ct.name.toLowerCase() === name.toLowerCase() })
    if (isKnown) return
    await supabase.from('casual_types').upsert({ name: name }, { onConflict: 'name' })
  }

  async function saveRow() {
    if (!fCasualType.trim() || !fRate || saving) return
    setSaving(true)

    var payload = {
      department_id: fDeptId ? Number(fDeptId) : null,
      sub_department_id: fSubDeptId ? Number(fSubDeptId) : null,
      casual_type: fCasualType.trim(),
      rate_type: fRateType,
      rate_paise: Math.round(Number(fRate) * 100),
    }

    if (editRow) {
      var { error } = await supabase.from('casual_roster').update(payload).eq('id', editRow.id)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('CASUAL_ROLE_UPDATE', fCasualType.trim()) } catch (_) {}
    } else {
      var { error } = await supabase.from('casual_roster').insert(payload)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('CASUAL_ROLE_CREATE', fCasualType.trim()) } catch (_) {}
    }

    await rememberCasualType(fCasualType.trim())

    setSaving(false)
    resetForm()
    loadRows()
    loadRefData()
  }

  async function toggleActive(row) {
    await supabase.from('casual_roster').update({ is_active: !row.is_active }).eq('id', row.id)
    loadRows()
  }

  async function deleteRow(row) {
    if (!confirm('Delete "' + row.casual_type + '"? This fails if assignments exist.')) return
    var { error } = await supabase.from('casual_roster').delete().eq('id', row.id)
    if (error) { alert('Cannot delete: ' + error.message); return }
    try { await logActivity('CASUAL_ROLE_DELETE', row.casual_type) } catch (_) {}
    loadRows()
  }

  var visibleSubDepts = subDepartments.filter(function (sd) { return String(sd.department_id) === String(fDeptId) })

  if (loading) return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{rows.length} entr{rows.length !== 1 ? 'ies' : 'y'}</p>
        {!showForm && (
          <button onClick={function () { resetForm(); setShowForm(true) }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors">
            + Add Entry
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white border border-indigo-200 rounded-lg p-4 space-y-3">
          <p className="text-xs font-bold text-indigo-700 uppercase">{editRow ? 'Edit Entry' : 'New Entry'}</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Department</label>
              <select value={fDeptId} onChange={function (e) { setFDeptId(e.target.value); setFSubDeptId('') }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">—</option>
                {departments.map(function (d) { return <option key={d.id} value={d.id}>{d.name}</option> })}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Sub-Department</label>
              <select value={fSubDeptId} onChange={function (e) { setFSubDeptId(e.target.value) }}
                disabled={!fDeptId}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400">
                <option value="">—</option>
                {visibleSubDepts.map(function (sd) { return <option key={sd.id} value={sd.id}>{sd.name}</option> })}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Casual Type *</label>
              <input type="text" list="casual-type-list" value={fCasualType}
                onChange={function (e) { setFCasualType(e.target.value) }}
                placeholder="e.g. Painter"
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <datalist id="casual-type-list">
                {casualTypes.map(function (ct) { return <option key={ct.id} value={ct.name} /> })}
              </datalist>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Type</label>
              <select value={fRateType} onChange={function (e) { setFRateType(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {RATE_TYPES.map(function (t) { return <option key={t.value} value={t.value}>{t.label}</option> })}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Rate (₹) *</label>
              <input type="number" min="0" value={fRate} onChange={function (e) { setFRate(e.target.value) }}
                placeholder="0"
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveRow} disabled={saving || !fCasualType.trim() || !fRate}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : (editRow ? 'Update' : 'Add')}
            </button>
            <button onClick={resetForm}
              className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {rows.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No casual roster entries defined yet</p>
        )}
        {rows.map(function (row) {
          return (
            <div key={row.id} className={"flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 " +
              (!row.is_active ? "opacity-50" : "")}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{row.casual_type}</p>
                <div className="flex gap-2 text-[11px] text-gray-400">
                  {row.departments?.name && <span>{row.departments.name}</span>}
                  {row.sub_departments?.name && <span>· {row.sub_departments.name}</span>}
                  <span>₹{(row.rate_paise / 100).toLocaleString('en-IN')} / {row.rate_type}</span>
                </div>
              </div>
              <button onClick={function () { toggleActive(row) }}
                className={"text-[10px] px-2 py-0.5 rounded-full font-bold " +
                  (row.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                {row.is_active ? 'Active' : 'Inactive'}
              </button>
              <button onClick={function () { openEdit(row) }}
                className="text-[11px] text-gray-500 hover:text-indigo-600 font-medium">✎</button>
              <button onClick={function () { deleteRow(row) }}
                className="text-[11px] text-gray-400 hover:text-red-600">🗑</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default CasualRoster
