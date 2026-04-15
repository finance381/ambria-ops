import { useState, useEffect } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { titleCase, formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import Modal from '../../components/ui/Modal'
import InventoryForm from '../inventory/InventoryForm'

function DeptReview({ profile }) {
  var [items, setItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [rejectTarget, setRejectTarget] = useState(null)
  var [rejectReason, setRejectReason] = useState('')
  var [saving, setSaving] = useState(false)
  var [enlargedImg, setEnlargedImg] = useState(null)
  var [editingItem, setEditingItem] = useState(null)
  var [dateFilter, setDateFilter] = useState('')
  var [catFilter, setCatFilter] = useState('')
  var [search, setSearch] = useState('')

  useEffect(function () { loadItems() }, [])

  async function loadItems() {
    var catIds = profile?.category_ids || []
    if (catIds.length === 0) { setLoading(false); return }
    var [invRes, csRes] = await Promise.all([
      supabase.from('inventory_items')
        .select('*, categories(name, code), sub_categories(name), profiles:submitted_by(name, email), venue_allocations(qty, venues(code, name))')
        .eq('status', 'pending_dept')
        .in('category_id', catIds)
        .order('created_at', { ascending: false }),
      supabase.from('catering_store_items')
        .select('*, categories(name, code), sub_categories(name), profiles:submitted_by(name, email), cs_venue_allocations(qty, venues(code, name))')
        .eq('status', 'pending_dept')
        .in('category_id', catIds)
        .order('created_at', { ascending: false }),
    ])
    var invItems = (invRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
    var csItems = (csRes.data || []).map(function (i) {
      return Object.assign({}, i, { _source: 'catering_store', venue_allocations: i.cs_venue_allocations || [] })
    })
    setItems(invItems.concat(csItems).sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    }))
    setLoading(false)
  }

  async function approveItem(item) {
    setSaving(true)
    var table = item._source === 'catering_store' ? 'catering_store_items' : 'inventory_items'
    var { error } = await supabase.from(table).update({
      status: 'pending',
      dept_approved_by: profile.id,
      dept_approved_at: new Date().toISOString(),
    }).eq('id', item.id)
    if (error) { alert('Approve failed: ' + error.message); setSaving(false); return }
    logActivity('DEPT_APPROVE_ITEM', item.name + ' | Cat: ' + (item.categories?.name || '—'))
    loadItems()
    setSaving(false)
  }

  function openReject(item) {
    setRejectTarget(item)
    setRejectReason('')
  }

  async function confirmReject() {
    if (!rejectTarget || !rejectReason.trim()) return
    setSaving(true)
    var table = rejectTarget._source === 'catering_store' ? 'catering_store_items' : 'inventory_items'
    var allocTable = rejectTarget._source === 'catering_store' ? 'cs_venue_allocations' : 'venue_allocations'
    await supabase.from(allocTable).delete().eq('item_id', rejectTarget.id)
    if (rejectTarget.image_path) {
      await supabase.storage.from('images').remove([rejectTarget.image_path])
    }
    var { error } = await supabase.from(table).delete().eq('id', rejectTarget.id)
    if (error) { alert('Reject failed: ' + error.message); setSaving(false); return }
    logActivity('DEPT_REJECT_ITEM', rejectTarget.name + ' | Reason: ' + rejectReason.trim())
    setRejectTarget(null)
    setRejectReason('')
    loadItems()
    setSaving(false)
  }

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
  }

  var catOptions = [...new Set(items.map(function (i) { return i.category_id }).filter(Boolean))].map(function (cid) {
    var item = items.find(function (i) { return i.category_id === cid })
    return { id: cid, name: item?.categories?.name || '—' }
  }).sort(function (a, b) { return a.name.localeCompare(b.name) })

  var searchLower = search.toLowerCase()
  var filtered = items.filter(function (item) {
   var matchDate = !dateFilter || (item.entry_date || item.created_at || '').substring(0, 10) === dateFilter
   var matchCat = !catFilter || String(item.category_id) === catFilter
   var matchSearch = !search ||
     item.name.toLowerCase().includes(searchLower) ||
     (item.name_hindi || '').toLowerCase().includes(searchLower) ||
     (item.inventory_id || '').toLowerCase().includes(searchLower) ||
     (item.categories?.name || '').toLowerCase().includes(searchLower) ||
     (item.profiles?.name || '').toLowerCase().includes(searchLower)
   return matchDate && matchCat && matchSearch
  })

  var hasFilters = dateFilter || catFilter || search

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-400">
        {items.length} items awaiting your review
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <input type="text" value={search}
         onChange={function (e) { setSearch(e.target.value) }}
         placeholder="Search item name..."
         className="flex-1 min-w-[150px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
         style={{ fontSize: '16px' }} />
        <input type="date" value={dateFilter}
          onChange={function (e) { setDateFilter(e.target.value) }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          style={{ fontSize: '16px' }} />
        <select value={catFilter}
          onChange={function (e) { setCatFilter(e.target.value) }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Categories</option>
          {catOptions.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
        </select>
        {hasFilters && (
          <button onClick={function () { setDateFilter(''); setCatFilter(''); setSearch('') }}
            className="px-3 py-2 text-xs font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 active:bg-gray-300 transition-colors">
            ✕ Reset
          </button>
        )}
        {hasFilters && (
          <span className="text-xs text-gray-400">{filtered.length} / {items.length}</span>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">{hasFilters ? 'No items match filters' : 'No items pending your approval'}</p>
        </div>
      )}

      {filtered.map(function (item) {
        var imgUrl = getImageUrl(item.image_path)
        var venueAllocs = item.venue_allocations || []
        var typeColors = { Premium: 'bg-purple-100 text-purple-700', Outdoor: 'bg-green-100 text-green-700', Indoor: 'bg-blue-100 text-blue-700' }

        return (
          <div key={item.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* Image + Name header */}
            <div className="flex gap-3 p-4 pb-2">
              {imgUrl ? (
                <img src={imgUrl} alt=""
                  onClick={function () { setEnlargedImg(imgUrl) }}
                  className="w-16 h-16 rounded-lg object-cover border border-gray-200 flex-shrink-0 cursor-pointer active:opacity-70" />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xl flex-shrink-0">📷</div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-bold text-gray-900">{titleCase(item.name)}</h3>
                {item.name_hindi && <p className="text-xs text-gray-500">{item.name_hindi}</p>}
                <span className="text-[11px] text-gray-400 font-mono">{item.inventory_id || '—'}</span>
              </div>
              <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full h-fit flex-shrink-0 " + (typeColors[item.type] || 'bg-gray-100 text-gray-600')}>
                {item.type || '—'}
              </span>
            </div>

            {/* Details */}
            <div className="px-4 pb-2">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-gray-500">
                <span>📁 {item.categories?.name || '—'}{item.sub_categories?.name ? ' > ' + item.sub_categories.name : ''}</span>
                <span>🏢 {item.department || '—'}</span>
                <span>📦 {item.qty} {item.unit?.toLowerCase()}</span>
                {venueAllocs.map(function (va) {
                  return <span key={va.venues?.code} className="text-[11px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">📍 {va.venues?.code}: {va.qty}</span>
                })}
              </div>
              {item.description && (
                <p className="text-[12px] text-gray-400 mt-1.5 line-clamp-2">{item.description}</p>
              )}
            </div>

            {/* Submitter + Date */}
            <div className="px-4 pb-2">
              <div className="text-[11px] text-gray-400">
                <span className="font-medium text-gray-600">{item.profiles?.name || '—'}</span>
                <span className="mx-1">·</span>
                <span>{formatDate(item.entry_date || item.created_at)}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex border-t border-gray-100">
              <button onClick={function () { approveItem(item) }} disabled={saving}
                className="flex-1 py-3 text-sm font-bold text-green-600 hover:bg-green-50 active:bg-green-100 disabled:opacity-50 transition-colors">✓ Approve</button>
              <div className="w-px bg-gray-100" />
              <button onClick={function () { setEditingItem(item) }} disabled={saving}
                className="flex-1 py-3 text-sm font-bold text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 disabled:opacity-50 transition-colors">✎ Edit</button>
              <div className="w-px bg-gray-100" />
              <button onClick={function () { openReject(item) }} disabled={saving}
                className="flex-1 py-3 text-sm font-bold text-red-500 hover:bg-red-50 active:bg-red-100 disabled:opacity-50 transition-colors">✗ Reject</button>
            </div>
          </div>
        )
      })}
      {/* Edit item modal */}
      <Modal open={!!editingItem} onClose={function () { setEditingItem(null) }} title={'Edit: ' + titleCase(editingItem?.name || '')} wide>
        {editingItem && (
          <InventoryForm
            item={editingItem}
            profile={profile}
            onClose={function () { setEditingItem(null) }}
            onSaved={function () { setEditingItem(null); loadItems() }}
          />
        )}
      </Modal>

      {/* Reject modal */}
      <Modal open={!!rejectTarget} onClose={function () { setRejectTarget(null) }} title="Reject Item">
        {rejectTarget && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium">Reject "{titleCase(rejectTarget.name)}"?</p>
              <p className="text-xs text-red-600 mt-1">This will permanently delete the item, image, and allocations. This cannot be undone.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
              <textarea
                value={rejectReason}
                onChange={function (e) { setRejectReason(e.target.value) }}
                rows="3"
                maxLength="500"
                placeholder="Reason for rejection..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                style={{ fontSize: '16px' }}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={function () { setRejectTarget(null) }}
                className="flex-1 px-4 py-3 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
              <button onClick={confirmReject} disabled={saving || !rejectReason.trim()}
                className="flex-1 px-4 py-3 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium">
                {saving ? 'Rejecting...' : 'Reject'}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Enlarged image modal */}
      <Modal open={!!enlargedImg} onClose={function () { setEnlargedImg(null) }} title="Photo">
        {enlargedImg && (
          <div className="flex items-center justify-center">
            <img src={enlargedImg} alt="" className="max-w-full max-h-[70vh] rounded-lg" />
          </div>
        )}
      </Modal>
      
    </div>
  )
}

export default DeptReview