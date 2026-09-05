import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { useRealtime } from '../../lib/useRealtime'
import { dupExists } from '../../lib/format'

function JobDepartments() {
  var [rows, setRows] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')
  var [search, setSearch] = useState('')

  var [newName, setNewName] = useState('')
  var [newSort, setNewSort] = useState('')

  var [editing, setEditing] = useState(null) // row id
  var [editName, setEditName] = useState('')
  var [editSort, setEditSort] = useState('')

  useRealtime(['job_departments'], function () { if (!saving) loadAll() })

  useEffect(function () { loadAll() }, [])

  async function loadAll() {
    var { data, error: err } = await supabase.from('job_departments')
      .select('*').order('sort_order').order('name')
    if (err) { setError(err.message) } else { setRows(data || []) }
    setLoading(false)
  }

  async function addRow(e) {
    e.preventDefault()
    if (saving) return
    if (!newName.trim()) return
    if (dupExists(rows, function (r) { return r.name }, newName)) {
      setError('Job department "' + newName.trim() + '" already exists'); return
    }
    setSaving(true); setError('')
    var payload = { name: newName.trim(), sort_order: Number(newSort) || 0, is_active: true }
    var { error: err } = await supabase.from('job_departments').insert(payload)
    if (err) { setError(err.message) } else {
      try { await logActivity('JOBDEPT_CREATE', newName.trim()) } catch (_) {}
      setNewName(''); setNewSort(''); loadAll()
    }
    setSaving(false)
  }

  function openEdit(row) {
    setEditing(row.id)
    setEditName(row.name)
    setEditSort(String(row.sort_order || 0))
    setError('')
  }

  async function saveEdit(row) {
    if (saving) return
    if (!editName.trim()) return
    if (dupExists(rows, function (r) { return r.name }, editName, row.id)) {
      setError('Job department "' + editName.trim() + '" already exists'); return
    }
    setSaving(true); setError('')
    var payload = { name: editName.trim(), sort_order: Number(editSort) || 0 }
    var { error: err } = await supabase.from('job_departments').update(payload).eq('id', row.id)
    if (err) { setError(err.message) } else {
      try { await logActivity('JOBDEPT_UPDATE', row.name + ' → ' + editName.trim()) } catch (_) {}
      setEditing(null); loadAll()
    }
    setSaving(false)
  }

  async function toggleActive(row) {
    if (saving) return
    setSaving(true)
    var { error: err } = await supabase.from('job_departments')
      .update({ is_active: !row.is_active }).eq('id', row.id)
    if (err) { setError(err.message) } else {
      try { await logActivity('JOBDEPT_TOGGLE', row.name + ' → ' + (row.is_active ? 'inactive' : 'active')) } catch (_) {}
      loadAll()
    }
    setSaving(false)
  }

  async function deleteRow(row) {
    if (!confirm('Delete job department "' + row.name + '"? Employees tagged with this dept will lose the tag.')) return
    setSaving(true); setError('')
    var { error: err } = await supabase.from('job_departments').delete().eq('id', row.id)
    if (err) { setError('Delete failed: ' + err.message) } else {
      try { await logActivity('JOBDEPT_DELETE', row.name) } catch (_) {}
      loadAll()
    }
    setSaving(false)
  }

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
  }

  var filtered = rows.filter(function (r) {
    return !search || r.name.toLowerCase().indexOf(search.toLowerCase()) !== -1
  })

  return (
    <div className="space-y-4">
      {/* Search */}
      <input type="text" value={search}
        onChange={function (e) { setSearch(e.target.value) }}
        placeholder="Search job departments..."
        style={{ fontSize: '16px' }}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />

      {/* Add form */}
      <form onSubmit={addRow} className="flex gap-2 flex-wrap">
        <input type="text" value={newName}
          onChange={function (e) { setNewName(e.target.value) }}
          placeholder="New job department name (e.g. Venue Sales)"
          style={{ fontSize: '16px' }}
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <input type="number" value={newSort}
          onChange={function (e) { setNewSort(e.target.value) }}
          placeholder="Sort"
          style={{ fontSize: '16px' }}
          className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button type="submit" disabled={saving || !newName.trim()}
          className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
          + Add
        </button>
      </form>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider w-20">Sort</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider w-28">Status</th>
              <th className="px-3 py-2 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider w-40">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan="4" className="px-3 py-6 text-center text-gray-400 text-sm">
                {search ? 'No matches.' : 'No job departments yet. Add the first one above.'}
              </td></tr>
            )}
            {filtered.map(function (row) {
              var isEditing = editing === row.id
              return (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-600 font-mono text-xs">
                    {isEditing ? (
                      <input type="number" value={editSort}
                        onChange={function (e) { setEditSort(e.target.value) }}
                        style={{ fontSize: '16px' }}
                        className="w-16 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    ) : (row.sort_order || 0)}
                  </td>
                  <td className="px-3 py-2 text-gray-800">
                    {isEditing ? (
                      <input type="text" value={editName}
                        onChange={function (e) { setEditName(e.target.value) }}
                        onKeyDown={function (e) { if (e.key === 'Enter') saveEdit(row) }}
                        style={{ fontSize: '16px' }}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    ) : (
                      <span className="font-medium">{row.name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={function () { toggleActive(row) }}
                      disabled={saving || isEditing}
                      className={"px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors " +
                        (row.is_active
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-200 text-gray-500 hover:bg-gray-300")}>
                      {row.is_active ? '● Active' : '○ Inactive'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button onClick={function () { saveEdit(row) }} disabled={saving}
                          className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 mr-1">Save</button>
                        <button onClick={function () { setEditing(null); setError('') }}
                          className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={function () { openEdit(row) }}
                          className="text-xs px-2 py-1 rounded text-indigo-600 hover:bg-indigo-50 mr-1">Edit</button>
                        <button onClick={function () { deleteRow(row) }}
                          className="text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50">Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-gray-400 pt-1">
        {filtered.length} department{filtered.length === 1 ? '' : 's'}. Sort order controls display order in pickers (lower = higher up).
      </div>
    </div>
  )
}

export default JobDepartments