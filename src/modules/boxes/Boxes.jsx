import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { titleCase } from '../../lib/format'
import { logActivity } from '../../lib/logger'

var STATUS_COLORS = {
  stored: 'bg-gray-100 text-gray-600',
  packed: 'bg-amber-100 text-amber-700',
  dispatched: 'bg-blue-100 text-blue-700',
  at_venue: 'bg-green-100 text-green-700',
  returned: 'bg-indigo-100 text-indigo-700',
}

var STATUS_LABELS = {
  stored: 'Stored',
  packed: 'Packed',
  dispatched: 'Dispatched',
  at_venue: 'At Venue',
  returned: 'Returned',
}

function Boxes({ profile }) {
  var [view, setView] = useState('list')
  var [boxes, setBoxes] = useState([])
  var [loading, setLoading] = useState(true)
  var [saving, setSaving] = useState(false)
  var [categories, setCategories] = useState([])
  var [venues, setVenues] = useState([])
  var [departments, setDepartments] = useState([])
  var [search, setSearch] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('')
  var [deptFilter, setDeptFilter] = useState('')

  // Form state
  var [editBox, setEditBox] = useState(null)
  var [formLabel, setFormLabel] = useState('')
  var [formCategory, setFormCategory] = useState('')
  var [formVenue, setFormVenue] = useState('')
  var [formDept, setFormDept] = useState('')
  var [formNotes, setFormNotes] = useState('')

  // Detail state
  var [activeBox, setActiveBox] = useState(null)
  var [boxItems, setBoxItems] = useState([])
  var [itemsLoading, setItemsLoading] = useState(false)
  var [addItemSearch, setAddItemSearch] = useState('')
  var [searchResults, setSearchResults] = useState([])
  var [searching, setSearching] = useState(false)
  var [addQty, setAddQty] = useState('')
  var [selectedItem, setSelectedItem] = useState(null)

  var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'

  useEffect(function () {
    loadBoxes()
    loadRefs()
  }, [])

  async function loadRefs() {
    var results = await Promise.allSettled([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('venues').select('id, code, name').eq('active', true).order('code'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
    ])
    setCategories(results[0].value?.data || [])
    setVenues(results[1].value?.data || [])
    setDepartments(results[2].value?.data || [])
  }

  async function loadBoxes() {
    setLoading(true)
    var { data, error } = await supabase
      .from('boxes')
      .select('id, code, label, category_id, venue_id, department, status, notes, created_at, categories(name), venues(code, name)')
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      // FK hint fallback
      var { data: fb } = await supabase
        .from('boxes')
        .select('id, code, label, category_id, venue_id, department, status, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(500)
      setBoxes(fb || [])
    } else {
      setBoxes(data || [])
    }
    setLoading(false)
  }

  // ── FORM ──

  function openForm(box) {
    setEditBox(box || null)
    setFormLabel(box?.label || '')
    setFormCategory(box?.category_id ? String(box.category_id) : '')
    setFormVenue(box?.venue_id ? String(box.venue_id) : '')
    setFormDept(box?.department || '')
    setFormNotes(box?.notes || '')
    setView('form')
  }

  async function saveBox() {
    if (!formDept) return
    if (saving) return
    setSaving(true)

    var payload = {
      label: formLabel.trim() || null,
      category_id: formCategory ? Number(formCategory) : null,
      venue_id: formVenue ? Number(formVenue) : null,
      department: formDept,
      notes: formNotes.trim() || null,
    }

    if (editBox) {
      var { error } = await supabase.from('boxes').update(payload).eq('id', editBox.id)
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
      await logActivity('BOX_EDIT', 'Updated box ' + editBox.code)
    } else {
      payload.created_by = profile.id
      payload.code = '' // trigger generates it
      var { error } = await supabase.from('boxes').insert(payload)
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
      await logActivity('BOX_CREATE', 'Created box in ' + formDept)
    }

    setSaving(false)
    setView('list')
    loadBoxes()
  }

  // ── DETAIL ──

  async function openDetail(box) {
    setActiveBox(box)
    setView('detail')
    setAddItemSearch('')
    setSearchResults([])
    setSelectedItem(null)
    setAddQty('')
    loadBoxItems(box.id)
  }

  async function loadBoxItems(boxId) {
    setItemsLoading(true)
    var { data } = await supabase
      .from('box_items')
      .select('id, box_id, inventory_item_id, cs_item_id, qty')
      .eq('box_id', boxId)

    var items = data || []
    if (items.length === 0) { setBoxItems([]); setItemsLoading(false); return }

    // Fetch names for inventory items
    var invIds = items.filter(function (i) { return i.inventory_item_id }).map(function (i) { return i.inventory_item_id })
    var csIds = items.filter(function (i) { return i.cs_item_id }).map(function (i) { return i.cs_item_id })

    var invMap = {}
    var csMap = {}

    if (invIds.length > 0) {
      var { data: invItems } = await supabase.from('inventory_items').select('id, name, unit, qty').in('id', invIds)
      ;(invItems || []).forEach(function (it) { invMap[it.id] = it })
    }
    if (csIds.length > 0) {
      var { data: csItems } = await supabase.from('catering_store_items').select('id, name, unit, qty').in('id', csIds)
      ;(csItems || []).forEach(function (it) { csMap[it.id] = it })
    }

    var enriched = items.map(function (bi) {
      var source = bi.inventory_item_id ? invMap[bi.inventory_item_id] : csMap[bi.cs_item_id]
      return Object.assign({}, bi, {
        item_name: source?.name || '—',
        item_unit: source?.unit || '',
        stock_qty: source?.qty || 0,
        source_type: bi.inventory_item_id ? 'inventory' : 'catering',
      })
    })

    setBoxItems(enriched)
    setItemsLoading(false)
  }

  // ── ADD ITEM TO BOX ──

  async function searchItems(q) {
    if (!q || q.length < 2) { setSearchResults([]); return }
    setSearching(true)

    var results = []
    var { data: inv } = await supabase
      .from('inventory_items')
      .select('id, name, unit, qty, category_id')
      .eq('status', 'approved')
      .ilike('name', '%' + q + '%')
      .limit(10)

    ;(inv || []).forEach(function (it) {
      results.push(Object.assign({}, it, { source_type: 'inventory' }))
    })

    var { data: cs } = await supabase
      .from('catering_store_items')
      .select('id, name, unit, qty, category_id')
      .eq('status', 'approved')
      .ilike('name', '%' + q + '%')
      .limit(10)

    ;(cs || []).forEach(function (it) {
      results.push(Object.assign({}, it, { source_type: 'catering' }))
    })

    setSearchResults(results)
    setSearching(false)
  }

  function pickItem(item) {
    setSelectedItem(item)
    setAddItemSearch(item.name)
    setSearchResults([])
    setAddQty('1')
  }

  async function addItemToBox() {
    if (!selectedItem || !addQty || Number(addQty) <= 0 || saving) return
    setSaving(true)

    var payload = {
      box_id: activeBox.id,
      qty: Number(addQty),
    }
    if (selectedItem.source_type === 'inventory') {
      payload.inventory_item_id = selectedItem.id
    } else {
      payload.cs_item_id = selectedItem.id
    }

    // Check if item already in box — merge qty
    var existing = boxItems.find(function (bi) {
      if (selectedItem.source_type === 'inventory') return bi.inventory_item_id === selectedItem.id
      return bi.cs_item_id === selectedItem.id
    })

    if (existing) {
      var newQty = existing.qty + Number(addQty)
      var { error } = await supabase.from('box_items').update({ qty: newQty }).eq('id', existing.id)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    } else {
      var { error } = await supabase.from('box_items').insert(payload)
      if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    }

    setSelectedItem(null)
    setAddItemSearch('')
    setAddQty('')
    await loadBoxItems(activeBox.id)
    setSaving(false)
  }

  async function removeItem(biId) {
    if (saving) return
    setSaving(true)
    await supabase.from('box_items').delete().eq('id', biId)
    await loadBoxItems(activeBox.id)
    setSaving(false)
  }

  async function updateItemQty(biId, newQty) {
    if (newQty <= 0) return removeItem(biId)
    await supabase.from('box_items').update({ qty: newQty }).eq('id', biId)
    await loadBoxItems(activeBox.id)
  }

  // ── DELETE BOX ──

  async function deleteBox(box) {
    if (!confirm('Delete box ' + box.code + '? All contents will be removed.')) return
    setSaving(true)
    await supabase.from('boxes').delete().eq('id', box.id)
    await logActivity('BOX_DELETE', 'Deleted box ' + box.code)
    setSaving(false)
    setView('list')
    loadBoxes()
  }

  // ── FILTER ──

  var filtered = boxes.filter(function (b) {
    if (venueFilter && String(b.venue_id) !== venueFilter) return false
    if (statusFilter && b.status !== statusFilter) return false
    if (deptFilter && b.department !== deptFilter) return false
    if (search) {
      var q = search.toLowerCase()
      var match = (b.code || '').toLowerCase().indexOf(q) !== -1 ||
        (b.label || '').toLowerCase().indexOf(q) !== -1 ||
        (b.categories?.name || '').toLowerCase().indexOf(q) !== -1
      if (!match) return false
    }
    return true
  })

  // ════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════

  if (loading) {
    return <div className="text-center py-8 text-sm text-gray-400">Loading boxes...</div>
  }

  // ── FORM VIEW ──
  if (view === 'form') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={function () { setView('list') }}
            className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
          <h3 className="text-base font-bold text-gray-800">
            {editBox ? 'Edit Box — ' + editBox.code : 'New Box'}
          </h3>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Label / Description</label>
            <input type="text" value={formLabel} onChange={function (e) { setFormLabel(e.target.value) }}
              placeholder="e.g. Red Flower Set A, Crystal Display Box"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Department *</label>
              <select value={formDept} onChange={function (e) { setFormDept(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select...</option>
                {departments.map(function (d) {
                  return <option key={d.id} value={d.name}>{d.name}</option>
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
              <select value={formCategory} onChange={function (e) { setFormCategory(e.target.value) }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">None</option>
                {categories.map(function (c) {
                  return <option key={c.id} value={c.id}>{c.name}</option>
                })}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Home Venue (where box is stored)</label>
            <select value={formVenue} onChange={function (e) { setFormVenue(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Select...</option>
              {venues.map(function (v) {
                return <option key={v.id} value={v.id}>{v.code + ' — ' + v.name}</option>
              })}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
            <textarea value={formNotes} onChange={function (e) { setFormNotes(e.target.value) }}
              rows={2} placeholder="Optional notes..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={saveBox} disabled={saving || !formDept}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : (editBox ? 'Update Box' : 'Create Box')}
            </button>
            <button onClick={function () { setView('list') }}
              className="px-5 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── DETAIL VIEW ──
  if (view === 'detail' && activeBox) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <button onClick={function () { setView('list'); setActiveBox(null) }}
              className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
            <h3 className="text-base font-bold text-gray-800">{activeBox.code}</h3>
            <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase " + (STATUS_COLORS[activeBox.status] || '')}>
              {STATUS_LABELS[activeBox.status] || activeBox.status}
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={function () { openForm(activeBox) }}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">
              Edit
            </button>
            <button onClick={function () { deleteBox(activeBox) }}
              className="text-xs px-3 py-1.5 border border-red-200 rounded-lg text-red-500 hover:bg-red-50 font-medium">
              Delete
            </button>
          </div>
        </div>

        {/* Box info */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            {activeBox.label && <span><strong>Label:</strong> {activeBox.label}</span>}
            {activeBox.department && <span><strong>Dept:</strong> {activeBox.department}</span>}
            {activeBox.categories?.name && <span><strong>Category:</strong> {activeBox.categories.name}</span>}
            {activeBox.venues && <span><strong>Venue:</strong> {activeBox.venues.code + ' — ' + activeBox.venues.name}</span>}
          </div>
          {activeBox.notes && <p className="text-xs text-gray-400 mt-2">{activeBox.notes}</p>}
        </div>

        {/* Add item */}
        {activeBox.status === 'stored' && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase">Add Item to Box</p>
            <div className="relative">
              <input type="text" value={addItemSearch}
                onChange={function (e) {
                  setAddItemSearch(e.target.value)
                  setSelectedItem(null)
                  searchItems(e.target.value)
                }}
                placeholder="Search inventory items..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              {searchResults.length > 0 && !selectedItem && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map(function (item) {
                    return (
                      <button key={item.source_type + '-' + item.id}
                        onClick={function () { pickItem(item) }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                        <span className="text-sm font-medium text-gray-800">{item.name}</span>
                        <span className="text-[10px] text-gray-400 ml-2">{item.unit} · Stock: {item.qty}</span>
                        <span className={"text-[10px] ml-2 px-1.5 py-0.5 rounded " +
                          (item.source_type === 'catering' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600')}>
                          {item.source_type === 'catering' ? 'CS' : 'INV'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {selectedItem && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-700 flex-1">{selectedItem.name}</span>
                <input type="number" value={addQty}
                  onChange={function (e) { setAddQty(e.target.value) }}
                  min="1" placeholder="Qty"
                  className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <button onClick={addItemToBox} disabled={saving}
                  className="px-4 py-1.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                  {saving ? '...' : 'Add'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Contents */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-500 uppercase">
              Contents ({boxItems.length} item{boxItems.length !== 1 ? 's' : ''})
            </p>
          </div>
          {itemsLoading && (
            <div className="text-center py-6 text-sm text-gray-400">Loading...</div>
          )}
          {!itemsLoading && boxItems.length === 0 && (
            <div className="text-center py-6 text-sm text-gray-400">Box is empty</div>
          )}
          {!itemsLoading && boxItems.map(function (bi) {
            return (
              <div key={bi.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{bi.item_name}</p>
                  <p className="text-[10px] text-gray-400">
                    {bi.source_type === 'catering' ? 'Catering Store' : 'Inventory'}
                    {bi.item_unit ? ' · ' + bi.item_unit : ''}
                    {' · Stock: ' + bi.stock_qty}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeBox.status === 'stored' && (
                    <>
                      <button onClick={function () { updateItemQty(bi.id, bi.qty - 1) }}
                        className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 text-gray-500 hover:bg-gray-200 text-xs font-bold">−</button>
                      <span className="text-sm font-bold text-gray-700 w-8 text-center">{bi.qty}</span>
                      <button onClick={function () { updateItemQty(bi.id, bi.qty + 1) }}
                        className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 text-gray-500 hover:bg-gray-200 text-xs font-bold">+</button>
                      <button onClick={function () { removeItem(bi.id) }}
                        className="ml-2 text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
                    </>
                  )}
                  {activeBox.status !== 'stored' && (
                    <span className="text-sm font-bold text-gray-700">× {bi.qty}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── LIST VIEW ──
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap flex-1">
          <input type="text" value={search}
            onChange={function (e) { setSearch(e.target.value) }}
            placeholder="Search code, label..."
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48" />
          <select value={deptFilter} onChange={function (e) { setDeptFilter(e.target.value) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Depts</option>
            {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
          </select>
          <select value={venueFilter} onChange={function (e) { setVenueFilter(e.target.value) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Venues</option>
            {venues.map(function (v) { return <option key={v.id} value={v.id}>{v.code}</option> })}
          </select>
          <select value={statusFilter} onChange={function (e) { setStatusFilter(e.target.value) }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Status</option>
            {Object.keys(STATUS_LABELS).map(function (k) { return <option key={k} value={k}>{STATUS_LABELS[k]}</option> })}
          </select>
        </div>
        <button onClick={function () { openForm(null) }}
          className="ml-3 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors flex-shrink-0">
          + New Box
        </button>
      </div>

      {/* Summary */}
      <p className="text-xs text-gray-400">{filtered.length} box{filtered.length !== 1 ? 'es' : ''}</p>

      {/* Grid */}
      {filtered.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">No boxes found</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(function (box) {
          return (
            <div key={box.id}
              onClick={function () { openDetail(box) }}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-gray-300 cursor-pointer transition-all">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-gray-800">{box.code}</p>
                  {box.label && <p className="text-xs text-gray-500 mt-0.5">{box.label}</p>}
                </div>
                <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase " + (STATUS_COLORS[box.status] || '')}>
                  {STATUS_LABELS[box.status] || box.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
                {box.department && <span>{box.department}</span>}
                {box.categories?.name && <span>{box.categories.name}</span>}
                {box.venues && <span>{box.venues.code}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Boxes
