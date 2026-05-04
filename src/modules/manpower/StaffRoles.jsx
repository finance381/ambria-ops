import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'

function StaffRoles({ profile }) {
  var [roles, setRoles] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [departments, setDepartments] = useState([])

  // Form
  var [showForm, setShowForm] = useState(false)
  var [editRole, setEditRole] = useState(null)
  var [fName, setFName] = useState('')
  var [fDept, setFDept] = useState('')
  var [fRate, setFRate] = useState('')
  var [fSort, setFSort] = useState('0')

  useEffect(function () { loadRoles(); loadDepts() }, [])

  async function loadRoles() {
    setLoading(true)
    var { data } = await supabase.from('staff_roles').select('*').order('sort_order').order('name')
    setRoles(data || [])
    setLoading(false)
  }

  async function loadDepts() {
    var { data } = await supabase.from('departments').select('id, name').eq('active', true).order('name')
    setDepartments(data || [])
  }

  function resetForm() {
    setFName(''); setFDept(''); setFRate(''); setFSort('0')
    setEditRole(null); setShowForm(false)
  }

  function openEdit(role) {
    setEditRole(role)
    setFName(role.name)
    setFDept(role.department || '')
    setFRate(role.default_rate_paise ? String(role.default_rate_paise / 100) : '')
    setFSort(String(role.sort_order || 0))
    setShowForm(true)
  }

  async function saveRole() {
    if (!fName.trim() || saving) return
    setSaving(true)

    var payload = {
      name: fName.trim(),
      department: fDept || null,
      default_rate_paise: fRate ? Math.round(Number(fRate) * 100) : 0,
      sort_order: Number(fSort) || 0,
    }

    if (editRole) {
      var { error } = await supabase.from('staff_roles').update(payload).eq('id', editRole.id)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('ROLE_UPDATE', fName.trim()) } catch (_) {}
    } else {
      var { error } = await supabase.from('staff_roles').insert(payload)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('ROLE_CREATE', fName.trim()) } catch (_) {}
    }

    setSaving(false)
    resetForm()
    loadRoles()
  }

  async function toggleActive(role) {
    await supabase.from('staff_roles').update({ is_active: !role.is_active }).eq('id', role.id)
    loadRoles()
  }

  async function deleteRole(role) {
    if (!confirm('Delete role "' + role.name + '"? This fails if assignments exist.')) return
    var { error } = await supabase.from('staff_roles').delete().eq('id', role.id)
    if (error) { alert('Cannot delete: ' + error.message); return }
    try { await logActivity('ROLE_DELETE', role.name) } catch (_) {}
    loadRoles()
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">{roles.length} role{roles.length !== 1 ? 's' : ''}</p>
        {!showForm && (
          <button onClick={function () { resetForm(); setShowForm(true) }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors">
            + Add Role
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white border border-indigo-200 rounded-lg p-4 space-y-3">
          <p className="text-xs font-bold text-indigo-700 uppercase">{editRole ? 'Edit Role' : 'New Role'}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Name *</label>
              <input type="text" value={fName} onChange={function (e) { setFName(e.target.value) }}
                placeholder="e.g. Head Decorator"
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Department</label>
              <select value={fDept} onChange={function (e) { setFDept(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">—</option>
                {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Default Rate (₹)</label>
              <input type="number" min="0" value={fRate} onChange={function (e) { setFRate(e.target.value) }}
                placeholder="0"
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Sort Order</label>
              <input type="number" value={fSort} onChange={function (e) { setFSort(e.target.value) }}
                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveRole} disabled={saving || !fName.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : (editRole ? 'Update' : 'Add')}
            </button>
            <button onClick={resetForm}
              className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {roles.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No staff roles defined yet</p>
        )}
        {roles.map(function (role) {
          return (
            <div key={role.id} className={"flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 " +
              (!role.is_active ? "opacity-50" : "")}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{role.name}</p>
                <div className="flex gap-2 text-[11px] text-gray-400">
                  {role.department && <span>{role.department}</span>}
                  {role.default_rate_paise > 0 && <span>₹{(role.default_rate_paise / 100).toLocaleString('en-IN')}/day</span>}
                  <span>#{role.sort_order}</span>
                </div>
              </div>
              <button onClick={function () { toggleActive(role) }}
                className={"text-[10px] px-2 py-0.5 rounded-full font-bold " +
                  (role.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                {role.is_active ? 'Active' : 'Inactive'}
              </button>
              <button onClick={function () { openEdit(role) }}
                className="text-[11px] text-gray-500 hover:text-indigo-600 font-medium">✎</button>
              <button onClick={function () { deleteRole(role) }}
                className="text-[11px] text-gray-400 hover:text-red-600">🗑</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default StaffRoles
