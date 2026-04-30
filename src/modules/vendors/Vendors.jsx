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

  var filtered = vendors.filter(function (v) {
    if (!showInactive && !v.active) return false
    if (search && v.name.toLowerCase().indexOf(search.toLowerCase()) === -1) return false
    if (catFilter && (v.category_ids || []).indexOf(Number(catFilter)) === -1) return false
    return true
  })

  var catMap = {}
  categories.forEach(function (c) { catMap[c.id] = c.name })

  var activeCount = vendors.filter(function (v) { return v.active }).length
  var inactiveCount = vendors.length - activeCount
  var taggedCount = vendors.filter(function (v) { return (v.category_ids || []).length > 0 }).length

  if (loading) return <p className="text-gray-400 text-sm text-center py-12">Loading vendors...</p>

  // ═══ FORM VIEW ═══
  if (editing) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{editing === 'new' ? 'Add Vendor' : 'Edit Vendor'}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{editing === 'new' ? 'Register a new vendor in the system' : 'Update vendor details'}</p>
          </div>
          <button onClick={cancelEdit} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">✕ Cancel</button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
          {/* Name */}
          <div className="p-5">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Vendor Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name}
              onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { name: e.target.value }) }) }}
              placeholder="e.g. Sharma Traders"
              className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-gray-50"
              style={{ fontSize: '16px' }} />
          </div>

          {/* Contact + Phone */}
          <div className="p-5">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Contact Info</label>
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={form.contact}
                onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { contact: e.target.value }) }) }}
                placeholder="Contact person name"
                className="px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                style={{ fontSize: '16px' }} />
              <input type="tel" value={form.phone}
                onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { phone: e.target.value }) }) }}
                placeholder="Phone number"
                className="px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                style={{ fontSize: '16px' }} />
            </div>
          </div>

          {/* Notes */}
          <div className="p-5">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Notes</label>
            <textarea value={form.notes}
              onChange={function (e) { setForm(function (p) { return Object.assign({}, p, { notes: e.target.value }) }) }}
              rows="2" placeholder="Address, payment terms, delivery schedule..."
              className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none bg-gray-50"
              style={{ fontSize: '16px' }} />
          </div>

          {/* Categories */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Categories</label>
              {form.category_ids.length > 0 && (
                <span className="text-[11px] text-indigo-600 font-semibold">{form.category_ids.length} selected</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto p-1">
              {categories.map(function (c) {
                var selected = form.category_ids.indexOf(c.id) !== -1
                return (
                  <button key={c.id} type="button" onClick={function () { toggleCat(c.id) }}
                    className={"px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all " +
                      (selected ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600")}>
                    {c.name}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={cancelEdit}
            className="flex-1 py-3 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-semibold">Cancel</button>
          <button onClick={saveVendor} disabled={saving}
            className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-semibold shadow-sm">
            {saving ? 'Saving...' : (editing === 'new' ? '+ Add Vendor' : 'Save Changes')}
          </button>
        </div>
      </div>
    )
  }

  // ═══ LIST VIEW ═══
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
          <p className="text-xs text-gray-400 font-medium mt-0.5">Active Vendors</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
          <p className="text-2xl font-bold text-indigo-600">{taggedCount}</p>
          <p className="text-xs text-gray-400 font-medium mt-0.5">Category Tagged</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
          <p className="text-2xl font-bold text-gray-400">{inactiveCount}</p>
          <p className="text-xs text-gray-400 font-medium mt-0.5">Inactive</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px] relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-sm">🔍</span>
          <input type="text" value={search}
            onChange={function (e) { setSearch(e.target.value) }}
            placeholder="Search vendors..."
            className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50"
            style={{ fontSize: '16px' }} />
        </div>
        <select value={catFilter}
          onChange={function (e) { setCatFilter(e.target.value) }}
          className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[180px]">
          <option value="">All Categories</option>
          {categories.map(function (c) { return <option key={c.id} value={c.id}>{c.name}</option> })}
        </select>
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none whitespace-nowrap">
          <input type="checkbox" checked={showInactive}
            onChange={function () { setShowInactive(!showInactive) }}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
          Show inactive
        </label>
        <button onClick={startAdd}
          className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-sm whitespace-nowrap ml-auto">
          + Add Vendor
        </button>
      </div>

      {/* Results count */}
      {(search || catFilter) && (
        <p className="text-xs text-gray-400 px-1">{filtered.length} result{filtered.length !== 1 ? 's' : ''}{search ? ' for "' + search + '"' : ''}</p>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
          <div className="text-4xl mb-3">🏪</div>
          <p className="text-sm font-semibold text-gray-700 mb-1">
            {vendors.length === 0 ? 'No vendors yet' : 'No matching vendors'}
          </p>
          <p className="text-xs text-gray-400 mb-4">
            {vendors.length === 0 ? 'Add your first vendor to start building your directory' : 'Try changing your search or filter'}
          </p>
          {vendors.length === 0 && (
            <button onClick={startAdd}
              className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
              + Add First Vendor
            </button>
          )}
        </div>
      )}

      {/* Vendor table-style cards */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-12 gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
            <div className="col-span-3">Vendor</div>
            <div className="col-span-2">Contact</div>
            <div className="col-span-4">Categories</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {/* Rows */}
          {filtered.map(function (v, vi) {
            var catNames = (v.category_ids || []).map(function (cid) { return catMap[cid] }).filter(Boolean)
            return (
              <div key={v.id}
                className={"grid grid-cols-12 gap-3 px-5 py-4 items-center transition-colors " +
                  (vi < filtered.length - 1 ? "border-b border-gray-50 " : "") +
                  (v.active ? "hover:bg-gray-50" : "opacity-50 bg-gray-50/50")}>
                {/* Name + notes */}
                <div className="col-span-3 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{v.name}</p>
                  {v.notes && <p className="text-[11px] text-gray-400 truncate mt-0.5">{v.notes}</p>}
                </div>
                {/* Contact */}
                <div className="col-span-2 min-w-0">
                  {v.contact && <p className="text-xs text-gray-600 truncate">{v.contact}</p>}
                  {v.phone && <p className="text-[11px] text-gray-400 truncate">{v.phone}</p>}
                  {!v.contact && !v.phone && <span className="text-[11px] text-gray-300">—</span>}
                </div>
                {/* Categories */}
                <div className="col-span-4 min-w-0">
                  {catNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {catNames.slice(0, 4).map(function (cn, ci) {
                        return <span key={ci} className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{cn}</span>
                      })}
                      {catNames.length > 4 && <span className="text-[10px] text-gray-400 font-medium">+{catNames.length - 4}</span>}
                    </div>
                  ) : (
                    <span className="text-[11px] text-gray-300 italic">No categories</span>
                  )}
                </div>
                {/* Status */}
                <div className="col-span-1">
                  <span className={"text-[10px] font-bold uppercase px-2 py-0.5 rounded-full " +
                    (v.active ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500")}>
                    {v.active ? 'Active' : 'Off'}
                  </span>
                </div>
                {/* Actions */}
                <div className="col-span-2 flex justify-end gap-3">
                  <button onClick={function () { startEdit(v) }}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">Edit</button>
                  <button onClick={function () { toggleActive(v) }}
                    className={"text-xs font-semibold transition-colors " + (v.active ? "text-gray-400 hover:text-red-600" : "text-green-600 hover:text-green-800")}>
                    {v.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Vendors