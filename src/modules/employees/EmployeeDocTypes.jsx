import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'

function EmployeeDocTypes({ profile }) {
  var perms = (profile && profile.permissions) || []
  var isAdmin = profile?.role === 'admin' || perms.indexOf('feature_admin') !== -1
  var canEdit = isAdmin || perms.indexOf('admin_masters') !== -1 || perms.indexOf('feature_employees') !== -1
  var canDelete = isAdmin || perms.indexOf('admin_masters') !== -1

  var [rows, setRows] = useState([])
  var [loading, setLoading] = useState(true)
  var [editing, setEditing] = useState({}) // { id: { label, mandatory, has_expiry, sort_order, active } }
  var [saving, setSaving] = useState(false)
  var [newRow, setNewRow] = useState({ key: '', label: '', mandatory: false, has_expiry: false, sort_order: 100 })
  var [error, setError] = useState('')

  useEffect(function () { load() }, [])

  async function load() {
    setLoading(true)
    var { data, error: e } = await supabase.from('employee_document_types')
      .select('id, key, label, mandatory, has_expiry, sort_order, active')
      .order('sort_order', { ascending: true }).order('label')
    if (e) { setError(e.message); setLoading(false); return }
    setRows(data || [])
    setLoading(false)
  }

  function beginEdit(row) {
    setEditing(function (prev) {
      var n = Object.assign({}, prev)
      n[row.id] = { label: row.label, mandatory: row.mandatory, has_expiry: row.has_expiry, sort_order: row.sort_order, active: row.active }
      return n
    })
  }

  function updateEdit(id, field, val) {
    setEditing(function (prev) {
      var n = Object.assign({}, prev)
      n[id] = Object.assign({}, prev[id], (function () { var o = {}; o[field] = val; return o })())
      return n
    })
  }

  function cancelEdit(id) {
    setEditing(function (prev) { var n = Object.assign({}, prev); delete n[id]; return n })
  }

  async function saveRow(row) {
    if (saving) return
    var edit = editing[row.id]
    if (!edit) return
    if (!edit.label.trim()) { setError('Label required'); return }
    setSaving(true); setError('')
    var { error: e } = await supabase.from('employee_document_types')
      .update({
        label: edit.label.trim(),
        mandatory: !!edit.mandatory,
        has_expiry: !!edit.has_expiry,
        sort_order: Number(edit.sort_order) || 100,
        active: !!edit.active,
      })
      .eq('id', row.id)
    setSaving(false)
    if (e) { setError(e.message); return }
    try { await logActivity('EMP_DOC_TYPE_UPDATE', row.key) } catch (_) {}
    cancelEdit(row.id)
    load()
  }

  async function deleteRow(row) {
    if (saving) return
    if (!window.confirm('Delete "' + row.label + '"? Existing employee documents of this type stay in place but will no longer appear as an option.')) return
    setSaving(true)
    var { error: e } = await supabase.from('employee_document_types').delete().eq('id', row.id)
    setSaving(false)
    if (e) { setError(e.message); return }
    try { await logActivity('EMP_DOC_TYPE_DELETE', row.key) } catch (_) {}
    load()
  }

  async function addRow() {
    if (saving) return
    var k = newRow.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
    if (!k) { setError('Key required (lowercase, no spaces)'); return }
    if (!newRow.label.trim()) { setError('Label required'); return }
    setSaving(true); setError('')
    var { error: e } = await supabase.from('employee_document_types').insert({
      key: k,
      label: newRow.label.trim(),
      mandatory: !!newRow.mandatory,
      has_expiry: !!newRow.has_expiry,
      sort_order: Number(newRow.sort_order) || 100,
      active: true,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    try { await logActivity('EMP_DOC_TYPE_CREATE', k) } catch (_) {}
    setNewRow({ key: '', label: '', mandatory: false, has_expiry: false, sort_order: 100 })
    load()
  }

  if (!canEdit) {
    return <p className="text-gray-400 text-sm text-center py-8">Not permitted.</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Employee Document Types</h2>
        <p className="text-xs text-gray-400">Catalog of documents HR can attach to employees</p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>}

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 text-[11px] font-bold text-gray-500 uppercase">Label</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold text-gray-500 uppercase">Key</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold text-gray-500 uppercase">Mandatory</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold text-gray-500 uppercase">Has Expiry</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold text-gray-500 uppercase">Sort</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold text-gray-500 uppercase">Active</th>
                <th className="text-right px-3 py-2 text-[11px] font-bold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(function (r) {
                var e = editing[r.id]
                var isEditing = !!e
                return (
                  <tr key={r.id} className={isEditing ? 'bg-indigo-50/30' : ''}>
                    <td className="px-3 py-2">
                      {isEditing
                        ? <input value={e.label} onChange={function (ev) { updateEdit(r.id, 'label', ev.target.value) }} className="w-full px-2 py-1 border border-gray-300 rounded text-sm" style={{ fontSize: '16px' }} />
                        : <span className="text-sm text-gray-800">{r.label}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono">{r.key}</td>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={isEditing ? !!e.mandatory : !!r.mandatory}
                        disabled={!isEditing}
                        onChange={function (ev) { updateEdit(r.id, 'mandatory', ev.target.checked) }}
                        className="h-4 w-4 text-indigo-600 rounded border-gray-300" />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={isEditing ? !!e.has_expiry : !!r.has_expiry}
                        disabled={!isEditing}
                        onChange={function (ev) { updateEdit(r.id, 'has_expiry', ev.target.checked) }}
                        className="h-4 w-4 text-indigo-600 rounded border-gray-300" />
                    </td>
                    <td className="px-2 py-2 text-center">
                      {isEditing
                        ? <input type="number" value={e.sort_order} onChange={function (ev) { updateEdit(r.id, 'sort_order', ev.target.value) }} className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center" style={{ fontSize: '16px' }} />
                        : <span className="text-sm text-gray-600">{r.sort_order}</span>}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" checked={isEditing ? !!e.active : !!r.active}
                        disabled={!isEditing}
                        onChange={function (ev) { updateEdit(r.id, 'active', ev.target.checked) }}
                        className="h-4 w-4 text-indigo-600 rounded border-gray-300" />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={function () { saveRow(r) }} disabled={saving}
                            className="text-[11px] font-bold text-white bg-indigo-600 rounded px-2 py-1 hover:bg-indigo-700 disabled:opacity-50">Save</button>
                          <button onClick={function () { cancelEdit(r.id) }}
                            className="text-[11px] font-bold text-gray-600 bg-gray-100 rounded px-2 py-1 hover:bg-gray-200">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <button onClick={function () { beginEdit(r) }}
                            className="text-[11px] font-bold text-indigo-600 bg-indigo-50 rounded px-2 py-1 hover:bg-indigo-100">Edit</button>
                          {canDelete && (
                            <button onClick={function () { deleteRow(r) }}
                              className="text-[11px] font-bold text-red-600 bg-red-50 rounded px-2 py-1 hover:bg-red-100">Delete</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {/* Add-new row */}
              <tr className="bg-gray-50">
                <td className="px-3 py-2">
                  <input value={newRow.label} placeholder="New label"
                    onChange={function (e) { setNewRow(Object.assign({}, newRow, { label: e.target.value })) }}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm" style={{ fontSize: '16px' }} />
                </td>
                <td className="px-3 py-2">
                  <input value={newRow.key} placeholder="key_here"
                    onChange={function (e) { setNewRow(Object.assign({}, newRow, { key: e.target.value })) }}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs font-mono" style={{ fontSize: '16px' }} />
                </td>
                <td className="px-2 py-2 text-center">
                  <input type="checkbox" checked={newRow.mandatory}
                    onChange={function (e) { setNewRow(Object.assign({}, newRow, { mandatory: e.target.checked })) }}
                    className="h-4 w-4 text-indigo-600 rounded border-gray-300" />
                </td>
                <td className="px-2 py-2 text-center">
                  <input type="checkbox" checked={newRow.has_expiry}
                    onChange={function (e) { setNewRow(Object.assign({}, newRow, { has_expiry: e.target.checked })) }}
                    className="h-4 w-4 text-indigo-600 rounded border-gray-300" />
                </td>
                <td className="px-2 py-2 text-center">
                  <input type="number" value={newRow.sort_order}
                    onChange={function (e) { setNewRow(Object.assign({}, newRow, { sort_order: e.target.value })) }}
                    className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center" style={{ fontSize: '16px' }} />
                </td>
                <td className="px-2 py-2"></td>
                <td className="px-3 py-2 text-right">
                  <button onClick={addRow} disabled={saving}
                    className="text-[11px] font-bold text-white bg-green-600 rounded px-2 py-1 hover:bg-green-700 disabled:opacity-50">+ Add</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default EmployeeDocTypes