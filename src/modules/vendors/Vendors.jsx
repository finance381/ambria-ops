import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'

function Vendors({ profile }) {
  var [vendors, setVendors] = useState([])
  var [categories, setCategories] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [search, setSearch] = useState('')
  var [catFilter, setCatFilter] = useState('')
  var [showInactive, setShowInactive] = useState(false)
  var [editing, setEditing] = useState(null)
  var [form, setForm] = useState({ name: '', contact: '', phone: '', category_ids: [], notes: '' })

  useEffect(function () { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    var [vRes, cRes] = await Promise.all([
      supabase.from('vendors').select('*').order('name'),
      supabase.from('categories').select('id, name').order('name'),
    ])
    setVendors(vRes.data || [])
    setCategories(cRes.data || [])
    setLoading(false)
  }

  function startAdd() {
    setEditing('new')
    setForm({ name: '', contact: '', phone: '', category_ids: [], notes: '' })
  }

  function startEdit(v) {
    setEditing(v.id)
    setForm({
      name: v.name || '',
      contact: v.contact || '',
      phone: v.phone || '',
      category_ids: v.category_ids || [],
      notes: v.notes || '',
    })
  }

  function cancelEdit() {
    setEditing(null)
    setForm({ name: '', contact: '', phone: '', category_ids: [], notes: '' })
  }

  function toggleCat(catId) {
    setForm(function (prev) {
      var ids = prev.category_ids.slice()
      var idx = ids.indexOf(catId)
      if (idx !== -1) ids.splice(idx, 1)
      else ids.push(catId)
      return Object.assign({}, prev, { category_ids: ids })
    })
  }

  async function saveVendor() {
    if (saving) return
    if (!form.name.trim()) { alert('Vendor name required'); return }
    setSaving(true)

    var payload = {
      name: form.name.trim(),
      contact: form.contact.trim() || null,
      phone: form.phone.trim() || null,
      category_ids: form.category_ids,
      notes: form.notes.trim() || null,
    }

    if (editing === 'new') {
      payload.created_by = profile.id
      var { error } = await supabase.from('vendors').insert(payload)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('VENDOR_ADD', payload.name) } catch (_) {}
    } else {
      var { error } = await supabase.from('vendors').update(payload).eq('id', editing)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
      try { await logActivity('VENDOR_EDIT', payload.name) } catch (_) {}
    }

    setSaving(false)
    cancelEdit()
    loadAll()
  }

  async function toggleActive(v) {
    if (saving) return
    setSaving(true)
    var newActive = !v.active
    var { error } = await supabase.from('vendors').update({ active: newActive }).eq('id', v.id)
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    try { await logActivity(newActive ? 'VENDOR_ACTIVATE' : 'VENDOR_DEACTIVATE', v.name) } catch (_) {}
    setSaving(false)
    loadAll()
  }

  // Filter
  var filtered = vendors.filter(function (v) {
    if (!showInactive && !v.active) return false
    if (search && v.name.toLowerCase().indexOf(search.toLowerCase()) === -1) return false
    if (catFilter && (v.category_ids || []).indexOf(Number(catFilter)) === -1) return false
    return true
  })

  // Category name helper
  var catMap = {}
  categories.forEach(function (c) { catMap[c.id] = c.name })

  if (loading) return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>

  // ═══ FORM VIEW ═══
  if (editing) {
    return (
      <div className="max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{editing === 'new' ? 'Add Vendor' : 'Edit Vendor'}</h3>
          <button onClick={cancelEdit} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name}
              onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { name: e.target.value }) }) }}
              placeholder="e.g. Sharma Traders"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
              <input type="text" value={form.contact}
                onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { contact: e.target.value }) }) }}
                placeholder="Name"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input type="tel" value={form.phone}
                onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { phone: e.target.value }) }) }}
                placeholder="9876543210"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '16px' }} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes}
              onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { notes: e.target.value }) }) }}
              rows="2" placeholder="Address, payment terms, etc."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Categories (tap to tag)</label>
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
              {categories.map(function (c) {
                var selected = form.category_ids.indexOf(c.id) !== -1
                return (
                  <button key={c.id} type="button" onClick={function () { toggleCat(c.id) }}
                    className={"px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors " +
                      (selected ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400")}>
                    {c.name}
                  </button>
                )
              })}
            </div>
            {form.category_ids.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-1">{form.category_ids.length} categor{form.category_ids.length === 1 ? 'y' : 'ies'} selected</p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={cancelEdit}
            className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
          <button onClick={saveVendor} disabled={saving}
            className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
            {saving ? 'Saving...' : (editing === 'new' ? 'Add Vendor' : 'Save Changes')}
          </button>
        </div>
      </div>
    )
  }

  // ═══ LIST VIEW ═══
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{filtered.length} vendor{filtered.length !== 1 ? 's' : ''}</p>
        <button onClick={startAdd}
          className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">
          + Add Vendor
        </button>
      </div>

      {/* Search + filters */}
      <div className="flex gap-2 flex-wrap">
        <input type="text" value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search vendors..."
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
        <select value={catFilter}
          onChange={function (e) { setCatFilter(e.target.value) }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Categories</option>
          {categories.map(function (c) { return <option key={c.id} value={c.id}>{c.name}</option> })}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={showInactive}
            onChange={function () { setShowInactive(!showInactive) }}
            className="rounded border-gray-300" />
          Inactive
        </label>
      </div>

      {/* Vendor cards */}
      {filtered.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-400 text-sm">No vendors found</p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map(function (v) {
          var catNames = (v.category_ids || []).map(function (cid) { return catMap[cid] || '—' }).join(', ')
          return (
            <div key={v.id} className={"bg-white rounded-lg border p-4 transition-colors " + (v.active ? "border-gray-200" : "border-gray-100 opacity-60")}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-800">{v.name}</p>
                    {!v.active && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">INACTIVE</span>}
                  </div>
                  {(v.contact || v.phone) && (
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {v.contact}{v.contact && v.phone ? ' · ' : ''}{v.phone}
                    </p>
                  )}
                  {catNames && <p className="text-[11px] text-indigo-500 mt-0.5">{catNames}</p>}
                  {v.notes && <p className="text-[11px] text-gray-400 mt-0.5">{v.notes}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0 ml-3">
                  <button onClick={function () { startEdit(v) }}
                    className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition-colors">Edit</button>
                  <button onClick={function () { toggleActive(v) }}
                    className={"text-[11px] font-medium transition-colors " + (v.active ? "text-red-500 hover:text-red-700" : "text-green-600 hover:text-green-800")}>
                    {v.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Vendors