import { useState, useEffect } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { titleCase, formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import Modal from '../../components/ui/Modal'
import InventoryForm from '../inventory/InventoryForm'

function PendingReview({ profile }) {
  var [pendingMasters, setPendingMasters] = useState([])
  var [pendingItems, setPendingItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [rejectTarget, setRejectTarget] = useState(null)
  var [rejectReason, setRejectReason] = useState('')
  var [saving, setSaving] = useState(false)
  var [enlargedImg, setEnlargedImg] = useState(null)
  var [editingItem, setEditingItem] = useState(null)
  var [search, setSearch] = useState('')
  var [deptFilter, setDeptFilter] = useState('')
  var [catFilter, setCatFilter] = useState('')
  var [subCatFilter, setSubCatFilter] = useState('')
  var [departments, setDepartments] = useState([])
  var [page, setPage] = useState(0)
  var PAGE_SIZE = 50

  useEffect(function () { loadPending() }, [])

  async function loadPending() {
    var [pendCat, pendSub, pendItem, pendCsItem, deptRes, catRes, subCatRes, subDeptRes] = await Promise.all([
      supabase.from('categories').select('*, profiles:added_by(name, email)').eq('status', 'pending'),
      supabase.from('sub_categories').select('*, categories(name), profiles:added_by(name, email)').eq('status', 'pending'),
      supabase.from('inventory_items')
        .select('*, categories(name, code), sub_categories(name), profiles:submitted_by(name, email), dept_approver:dept_approved_by(name, email), venue_allocations(qty, venues(code, name))')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('catering_store_items')
        .select('*, categories(name, code), sub_categories(name), profiles:submitted_by(name, email), dept_approver:dept_approved_by(name, email), cs_venue_allocations(qty, venues(code, name))')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('departments').select('id, name, category_ids').eq('active', true).order('name'),
      supabase.from('categories').select('id, name, sub_department_id').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name'),
      supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name'),
    ])
    var masters = []
    ;(pendCat.data || []).forEach(function (c) {
      masters.push({ id: c.id, table: 'categories', type: 'Category', name: c.name, category: '—', by: c.profiles?.name || c.profiles?.email || '—', byEmail: c.profiles?.email || '' })
    })
    ;(pendSub.data || []).forEach(function (s) {
      masters.push({ id: s.id, table: 'sub_categories', type: 'Sub-category', name: s.name, category: s.categories?.name || '—', by: s.profiles?.name || s.profiles?.email || '—', byEmail: s.profiles?.email || '' })
    })

    setPendingMasters(masters)
    var invItems = (pendItem.data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
    var csItems = (pendCsItem.data || []).map(function (i) {
      return Object.assign({}, i, { _source: 'catering_store', venue_allocations: i.cs_venue_allocations || [] })
    })
    setPendingItems(invItems.concat(csItems).sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    }))
    setDepartments(deptRes.data || [])
    setLoading(false)
  }

  async function approveItem(table, id, name, type) {
    if (saving) return
    setSaving(true)
    try {
      if (table === 'inventory_items' || table === 'catering_store_items') {
        var allocTable = table === 'catering_store_items' ? 'cs_venue_allocations' : 'venue_allocations'
        // Fetch the pending item
        var { data: pending } = await supabase.from(table).select('*').eq('id', id).maybeSingle()
        if (pending) {
          // Check for existing approved item with same key fields
          var matchQuery = supabase.from(table).select('id, qty, image_path').eq('name', pending.name).eq('category_id', pending.category_id).eq('status', 'approved').neq('id', id)
          if (pending.sub_category_id) { matchQuery = matchQuery.eq('sub_category_id', pending.sub_category_id) } else { matchQuery = matchQuery.is('sub_category_id', null) }
          if (table === 'catering_store_items') {
            if (pending.brand) { matchQuery = matchQuery.eq('brand', pending.brand) } else { matchQuery = matchQuery.is('brand', null) }
            if (pending.pack_size_qty) { matchQuery = matchQuery.eq('pack_size_qty', pending.pack_size_qty) } else { matchQuery = matchQuery.is('pack_size_qty', null) }
            if (pending.pack_size_unit) { matchQuery = matchQuery.eq('pack_size_unit', pending.pack_size_unit) } else { matchQuery = matchQuery.is('pack_size_unit', null) }
          }
          var { data: existing } = await matchQuery.limit(1).maybeSingle()

          if (existing) {
            // Merge: add qty to existing
            var newQty = (existing.qty || 0) + (pending.qty || 0)
            await supabase.from(table).update({ qty: newQty }).eq('id', existing.id)
            // Merge allocations
            var { data: pendingAllocs } = await supabase.from(allocTable).select('*').eq('item_id', id)
            var { data: existingAllocs } = await supabase.from(allocTable).select('*').eq('item_id', existing.id)
            for (var ai = 0; ai < (pendingAllocs || []).length; ai++) {
              var pa = pendingAllocs[ai]
              var match = (existingAllocs || []).find(function (ea) { return ea.venue_id === pa.venue_id && (ea.sub_venue_id || null) === (pa.sub_venue_id || null) })
              if (match) {
                await supabase.from(allocTable).update({ qty: match.qty + pa.qty }).eq('id', match.id)
              } else {
                await supabase.from(allocTable).insert({ item_id: existing.id, venue_id: pa.venue_id, sub_venue_id: pa.sub_venue_id || null, qty: pa.qty })
              }
            }
            // If pending item has image but existing doesn't, keep it
            if (pending.image_path && !existing.image_path) {
              await supabase.from(table).update({ image_path: pending.image_path }).eq('id', existing.id)
            }
            // Delete the pending row + its allocations
            await supabase.from(allocTable).delete().eq('item_id', id)
            await supabase.from(table).delete().eq('id', id)
            try { await logActivity('APPROVE_ITEM_MERGE', name + ' → merged into existing (qty +' + (pending.qty || 0) + ')') } catch (_) {}
          } else {
            // No existing match — just approve
            await supabase.from(table).update({ status: 'approved' }).eq('id', id)
            try { await logActivity('APPROVE_ITEM', name) } catch (_) {}
          }
        }
      } else {
        // Categories / sub-categories
        await supabase.from(table).update({ status: 'approved' }).eq('id', id)
        try { await logActivity('APPROVE_' + type.toUpperCase().replace('-', '_'), name) } catch (_) {}
      }
    } catch (err) {
      alert('Approve failed: ' + (err.message || 'Unknown error'))
    }
    await loadPending()
    setSaving(false)
  }

  function openReject(table, id, name, type) {
    setRejectTarget({ table: table, id: id, name: name, type: type })
    setRejectReason('')
  }

  async function confirmReject() {
    if (!rejectTarget || !rejectReason.trim()) return
    setSaving(true)
    if (rejectTarget.table === 'inventory_items' || rejectTarget.table === 'catering_store_items') {
      var allocTable = rejectTarget.table === 'catering_store_items' ? 'cs_venue_allocations' : 'venue_allocations'
      await supabase.from(allocTable).delete().eq('item_id', rejectTarget.id)
      var { data: itemData } = await supabase.from(rejectTarget.table).select('image_path').eq('id', rejectTarget.id).maybeSingle()
      if (itemData?.image_path) {
        await supabase.storage.from('images').remove([itemData.image_path])
      }
    }
    await supabase.from(rejectTarget.table).delete().eq('id', rejectTarget.id)
    try { await logActivity('REJECT_' + rejectTarget.type.toUpperCase().replace('-', '_'), rejectTarget.name + ' | Reason: ' + rejectReason.trim()) } catch (_) {}
    setRejectTarget(null)
    setRejectReason('')
    await loadPending()
    setSaving(false)
  }

  var totalCount = pendingMasters.length + pendingItems.length

  // Derive filter options from selected dept
  var deptCatIds = null
  if (deptFilter) {
    var selectedDept = departments.find(function (d) { return d.name === deptFilter })
    deptCatIds = selectedDept?.category_ids || []
  }

  var searchLower = search.toLowerCase()
  var filteredItems = pendingItems.filter(function (item) {
    var matchSearch = !search ||
      (item.name || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (item.name_hindi || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (item.inventory_id || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (item.profiles?.name || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (item.profiles?.email || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (item.dept_approver?.name || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (item.dept_approver?.email || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (item.categories?.name || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (item.department || '').toLowerCase().indexOf(searchLower) !== -1
    var matchDept = !deptFilter || item.department === deptFilter
    var matchCat = !catFilter || item.category_id === Number(catFilter)
    var matchSubCat = !subCatFilter || item.sub_category_id === Number(subCatFilter)
    var matchDeptCats = !deptCatIds || deptCatIds.indexOf(item.category_id) !== -1
    return matchSearch && matchDept && matchDeptCats && matchCat && matchSubCat
  })

  // Category options: if dept selected, only show tagged categories
  var catOptions = [...new Set(pendingItems.map(function (i) { return i.category_id }).filter(Boolean))].map(function (cid) {
    var item = pendingItems.find(function (i) { return i.category_id === cid })
    return { id: cid, name: item?.categories?.name || '—' }
  }).filter(function (c) {
    return !deptCatIds || deptCatIds.includes(c.id)
  }).sort(function (a, b) { return a.name.localeCompare(b.name) })

  // Sub-category options: filtered by selected category
  var subCatOptions = [...new Set(pendingItems.map(function (i) { return i.sub_category_id }).filter(Boolean))].map(function (sid) {
    var item = pendingItems.find(function (i) { return i.sub_category_id === sid })
    return { id: sid, name: item?.sub_categories?.name || '—', category_id: item?.category_id }
  }).filter(function (sc) {
    return !catFilter || String(sc.category_id) === catFilter
  }).sort(function (a, b) { return a.name.localeCompare(b.name) })

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading pending items...</p>
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-gray-400">
        {totalCount} pending item{totalCount !== 1 ? 's' : ''}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input type="text" value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          placeholder="Search item, submitter, dept approver..."
          className="flex-1 min-w-[200px] px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <select value={deptFilter}
          onChange={function (e) { setDeptFilter(e.target.value); setCatFilter(''); setSubCatFilter('') }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Departments</option>
          {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
        </select>
        <select value={catFilter}
          onChange={function (e) { setCatFilter(e.target.value); setSubCatFilter('') }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Categories</option>
          {catOptions.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
        </select>
        <select value={subCatFilter}
          onChange={function (e) { setSubCatFilter(e.target.value) }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Sub-categories</option>
          {subCatOptions.map(function (sc) { return <option key={sc.id} value={String(sc.id)}>{sc.name}</option> })}
        </select>
      </div>

      {totalCount === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">No pending items to review</p>
        </div>
      )}

      {/* ═══ PENDING CATEGORIES / SUB-CATEGORIES ═══ */}
      {pendingMasters.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Categories & Sub-categories ({pendingMasters.length})</h3>
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Parent Category</th>
                  <th className="text-left px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Submitted By</th>
                  <th className="px-4 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingMasters.map(function (m) {
                  return (
                    <tr key={m.table + '-' + m.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                          (m.type === 'Category' ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700")}>
                          {m.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{titleCase(m.name)}</td>
                      <td className="px-4 py-3 text-gray-500">{m.category}</td>
                      <td className="px-4 py-3">
                        <div className="text-gray-600 text-[12px]">{m.by}</div>
                        <div className="text-[11px] text-gray-400">{m.byEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button onClick={function () { approveItem(m.table, m.id, m.name, m.type) }} disabled={saving}
                            className="px-3 py-1.5 text-[11px] font-bold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors">✓ Approve</button>
                          <button onClick={function () { openReject(m.table, m.id, m.name, m.type) }} disabled={saving}
                            className="px-3 py-1.5 text-[11px] font-bold text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50 transition-colors">✗ Reject</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ PENDING INVENTORY ITEMS ═══ */}
      {filteredItems.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Inventory Items ({filteredItems.length})</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {filteredItems.slice(0, (page + 1) * PAGE_SIZE).map(function (item) {
              var imgUrl = getImageUrl(item.image_path)
              var venueAllocs = item.venue_allocations || []
              var typeColors = { Premium: 'bg-purple-100 text-purple-700', Outdoor: 'bg-green-100 text-green-700', Indoor: 'bg-blue-100 text-blue-700' }
              return (
                <div key={item.id} className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                  <div className="flex">
                    {/* Image */}
                    <div className="flex-shrink-0 w-32 bg-gray-50">
                      {imgUrl ? (
                        <img src={imgUrl} alt="" onClick={function () { setEnlargedImg(imgUrl) }}
                          className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity" style={{ minHeight: 140 }} />
                      ) : (
                        <div className="w-full flex items-center justify-center text-gray-300 text-2xl" style={{ minHeight: 140 }}>📷</div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="text-sm font-bold text-gray-900">{titleCase(item.name)}</h4>
                          {item.name_hindi && <p className="text-[11px] text-gray-500">{item.name_hindi}</p>}
                          {item.brand && <p className="text-[11px] text-amber-600 font-medium">{item.brand}{item.pack_size_qty ? ' · ' + item.pack_size_qty + ' ' + (item.pack_size_unit || '') : ''}</p>}
                          <span className="text-[11px] text-gray-400 font-mono">{item.inventory_id || '—'}</span>
                        </div>
                        <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0 " + (typeColors[item.type] || 'bg-gray-100 text-gray-600')}>{item.type || '—'}</span>
                      </div>
                      <div className="px-0 pb-2">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-gray-500">
                          <span>📁 {item.categories?.name || '—'}{item.sub_categories?.name ? ' > ' + item.sub_categories.name : ''}</span>
                          <span>🏢 {item.department || '—'}</span>
                          <span>📦 {item.qty} {item.unit?.toLowerCase()}</span>
                          {venueAllocs.map(function (va) {
                            return <span key={va.venues?.code} className="text-[11px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">📍 {va.venues?.code}: {va.qty}</span>
                          })}
                        </div>
                        {item.dimensions && Array.isArray(item.dimensions) && item.dimensions.some(function (d) { return d.qty }) && (
                            <p className="text-[12px] text-gray-500 mt-1">
                            {item.dimensions.filter(function (d) { return d.qty }).map(function (d) { return d.qty + ' ' + d.unit }).join(' × ')}
                          </p>
                        )}
                        {(item.min_order_qty || item.reorder_qty) && (
                          <div className="flex gap-3 text-[11px] text-gray-400 mt-1">
                            {item.min_order_qty > 0 && <span>Min order: {item.min_order_qty}</span>}
                            {item.reorder_qty > 0 && <span>Reorder at: {item.reorder_qty}</span>}
                          </div>
                        )}
                        {item.location && <p className="text-[11px] text-gray-400 mt-1">📍 {item.location}</p>}
                        {item.notes && <p className="text-[12px] text-gray-400 mt-1 italic line-clamp-2">"{item.notes}"</p>}
                        {item.description && (
                          <p className="text-[12px] text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                        )}
                        <div className="flex flex-wrap gap-x-3 text-[11px] text-gray-400 mt-1">
                        <span>By: <span className="font-medium text-gray-600">{item.profiles?.name || '—'}</span></span>
                        <span>{formatDate(item.entry_date || item.created_at)}</span>
                        {item.dept_approver && (
                          <span className="text-green-600 font-medium">✓ Dept: {item.dept_approver.name}{item.dept_approver.email ? ' (' + item.dept_approver.email + ')' : ''}</span>
                        )}
                      </div>
                    </div>
                      </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 p-4 border-l border-gray-100 justify-center flex-shrink-0">
                      <button onClick={function () { approveItem(item._source === 'catering_store' ? 'catering_store_items' : 'inventory_items', item.id, item.name, 'Item') }} disabled={saving}
                        className="px-4 py-2 text-xs font-bold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors whitespace-nowrap">✓ Approve</button>
                      <button onClick={function () { setEditingItem(item) }} disabled={saving}
                        className="px-4 py-2 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors whitespace-nowrap">✎ Edit</button>
                      <button onClick={function () { openReject(item._source === 'catering_store' ? 'catering_store_items' : 'inventory_items', item.id, item.name, 'Item') }} disabled={saving}
                        className="px-4 py-2 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors whitespace-nowrap">✗ Reject</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {filteredItems.length > (page + 1) * PAGE_SIZE && (
            <button onClick={function () { setPage(page + 1) }}
              className="w-full mt-4 py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
              Load More ({filteredItems.length - (page + 1) * PAGE_SIZE} remaining)
            </button>
          )}
        </div>
      )}
      <Modal open={!!editingItem} onClose={function () { setEditingItem(null) }} title={'Edit: ' + titleCase(editingItem?.name || '')} wide>
        {editingItem && (
          <InventoryForm
            item={editingItem}
            profile={profile}
            onClose={function () { setEditingItem(null) }}
            onSaved={function () { setEditingItem(null); loadPending() }}
          />
        )}
      </Modal>

      {/* Reject confirmation modal */}
      <Modal open={!!rejectTarget} onClose={function () { setRejectTarget(null) }} title="Reject Item">
        {rejectTarget && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium">Are you sure you want to reject this {rejectTarget.type.toLowerCase()}?</p>
              <p className="text-sm text-red-700 mt-1">"{titleCase(rejectTarget.name)}" will be permanently deleted and the submitter can re-add it in the future.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason for rejection <span className="text-red-500">*</span></label>
              <textarea
                value={rejectReason}
                onChange={function (e) { setRejectReason(e.target.value) }}
                rows="3"
                maxLength="500"
                placeholder="Explain why this is being rejected..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={function () { setRejectTarget(null) }}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={confirmReject} disabled={saving || !rejectReason.trim()}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Rejecting...' : 'Confirm Reject'}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Enlarged image modal */}
      <Modal open={!!enlargedImg} onClose={function () { setEnlargedImg(null) }} title="Item Photo">
        {enlargedImg && (
          <div className="flex items-center justify-center">
            <img src={enlargedImg} alt="" className="max-w-full max-h-[70vh] rounded-lg" />
          </div>
        )}
      </Modal>
    </div>
  )
}

export default PendingReview