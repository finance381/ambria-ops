import { useState, useEffect } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { titleCase, formatDate } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import Modal from '../../components/ui/Modal'
import InventoryForm from '../inventory/InventoryForm'

function AdminReview({ profile }) {
  var [pendingMasters, setPendingMasters] = useState([])
  var [pendingItems, setPendingItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [rejectTarget, setRejectTarget] = useState(null)
  var [rejectReason, setRejectReason] = useState('')
  var [saving, setSaving] = useState(false)
  var [enlargedImg, setEnlargedImg] = useState(null)
  var [editingItem, setEditingItem] = useState(null)
  var [search, setSearch] = useState('')

  useEffect(function () { loadPending() }, [])

  async function loadPending() {
    var [pendCat, pendSub, pendItem, pendCsItem] = await Promise.all([
      supabase.from('categories').select('*, profiles:added_by(name, email)').eq('status', 'pending'),
      supabase.from('sub_categories').select('*, categories(name), profiles:added_by(name, email)').eq('status', 'pending'),
      supabase.from('inventory_items')
        .select('*, categories(name, code), sub_categories(name), profiles:submitted_by(name, email), dept_approver:dept_approved_by(name), venue_allocations(qty, venues(code, name))')
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.from('catering_store_items')
        .select('*, categories(name, code), sub_categories(name), profiles:submitted_by(name, email), dept_approver:dept_approved_by(name), cs_venue_allocations(qty, venues(code, name))')
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    ])

    var masters = []
    ;(pendCat.data || []).forEach(function (c) {
      masters.push({ id: c.id, table: 'categories', type: 'Category', name: c.name, by: c.profiles?.name || '—' })
    })
    ;(pendSub.data || []).forEach(function (s) {
      masters.push({ id: s.id, table: 'sub_categories', type: 'Sub-cat', name: s.name, parent: s.categories?.name || '—', by: s.profiles?.name || '—' })
    })

    setPendingMasters(masters)
    var invItems = (pendItem.data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
    var csItems = (pendCsItem.data || []).map(function (i) {
      return Object.assign({}, i, { _source: 'catering_store', venue_allocations: i.cs_venue_allocations || [] })
    })
    setPendingItems(invItems.concat(csItems).sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    }))
    setLoading(false)
  }

  async function approveMaster(item) {
    setSaving(true)
    await supabase.from(item.table).update({ status: 'approved' }).eq('id', item.id)
    logActivity('APPROVE_' + item.type.toUpperCase().replace('-', '_'), item.name)
    loadPending()
    setSaving(false)
  }

  async function approveItem(item) {
    setSaving(true)
    try {
      var table = item._source === 'catering_store' ? 'catering_store_items' : 'inventory_items'
      var allocTable = item._source === 'catering_store' ? 'cs_venue_allocations' : 'venue_allocations'
      // Check for existing approved item with same key fields
      var matchQuery = supabase.from(table).select('id, qty, image_path').eq('name', item.name).eq('category_id', item.category_id).eq('status', 'approved').neq('id', item.id)
      if (item.sub_category_id) { matchQuery = matchQuery.eq('sub_category_id', item.sub_category_id) } else { matchQuery = matchQuery.is('sub_category_id', null) }
      if (item._source === 'catering_store') {
        if (item.brand) { matchQuery = matchQuery.eq('brand', item.brand) } else { matchQuery = matchQuery.is('brand', null) }
        if (item.pack_size_qty) { matchQuery = matchQuery.eq('pack_size_qty', item.pack_size_qty) } else { matchQuery = matchQuery.is('pack_size_qty', null) }
        if (item.pack_size_unit) { matchQuery = matchQuery.eq('pack_size_unit', item.pack_size_unit) } else { matchQuery = matchQuery.is('pack_size_unit', null) }
      }
      var { data: existing } = await matchQuery.limit(1).maybeSingle()

      if (existing) {
        var newQty = (existing.qty || 0) + (item.qty || 0)
        await supabase.from(table).update({ qty: newQty }).eq('id', existing.id)
        // Merge allocations
        var { data: pendingAllocs } = await supabase.from(allocTable).select('*').eq('item_id', item.id)
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
        if (item.image_path && !existing.image_path) {
          await supabase.from(table).update({ image_path: item.image_path }).eq('id', existing.id)
        }
        await supabase.from(allocTable).delete().eq('item_id', item.id)
        await supabase.from(table).delete().eq('id', item.id)
        logActivity('APPROVE_ITEM_MERGE', item.name + ' → merged (qty +' + (item.qty || 0) + ')')
      } else {
        await supabase.from(table).update({ status: 'approved' }).eq('id', item.id)
        logActivity('APPROVE_ITEM', item.name)
      }
    } catch (err) {
      alert('Approve failed: ' + (err.message || 'Unknown error'))
    }
    loadPending()
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
    logActivity('REJECT_' + rejectTarget.type.toUpperCase().replace('-', '_'), rejectTarget.name + ' | Reason: ' + rejectReason.trim())
    setRejectTarget(null)
    setRejectReason('')
    loadPending()
    setSaving(false)
  }

  var totalCount = pendingMasters.length + pendingItems.length

  var searchLower = search.toLowerCase()
  var filteredPendingItems = pendingItems.filter(function (item) {
    if (!search) return true
    return item.name.toLowerCase().includes(searchLower) ||
      (item.name_hindi || '').toLowerCase().includes(searchLower) ||
      (item.inventory_id || '').toLowerCase().includes(searchLower) ||
      (item.profiles?.name || '').toLowerCase().includes(searchLower) ||
      (item.profiles?.email || '').toLowerCase().includes(searchLower) ||
      (item.dept_approver?.name || '').toLowerCase().includes(searchLower) ||
      (item.categories?.name || '').toLowerCase().includes(searchLower) ||
      (item.department || '').toLowerCase().includes(searchLower)
  })

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-400">
        {totalCount} pending item{totalCount !== 1 ? 's' : ''}
      </div>

      <input type="text" value={search}
        onChange={function (e) { setSearch(e.target.value) }}
        placeholder="Search item, submitter, dept approver..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        style={{ fontSize: '16px' }} />

      {totalCount === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No items pending review</p>
        </div>
      )}

      {/* ═══ MASTER DATA (Categories/Subcategories) ═══ */}
      {pendingMasters.map(function (m) {
        return (
          <div key={m.table + '-' + m.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                  (m.type === 'Category' ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700")}>
                  {m.type}
                </span>
              </div>
              <h3 className="text-[15px] font-bold text-gray-900">{titleCase(m.name)}</h3>
              {m.parent && <p className="text-xs text-gray-500">Parent: {m.parent}</p>}
              <p className="text-[11px] text-gray-400 mt-1">By: {m.by}</p>
            </div>
            <div className="flex border-t border-gray-100">
              <button onClick={function () { approveMaster(m) }} disabled={saving}
                className="flex-1 py-3 text-sm font-bold text-green-600 hover:bg-green-50 active:bg-green-100 disabled:opacity-50 transition-colors">✓ Approve</button>
              <div className="w-px bg-gray-100" />
              <button onClick={function () { openReject(m.table, m.id, m.name, m.type) }} disabled={saving}
                className="flex-1 py-3 text-sm font-bold text-red-500 hover:bg-red-50 active:bg-red-100 disabled:opacity-50 transition-colors">✗ Reject</button>
            </div>
          </div>
        )
      })}

      {/* ═══ INVENTORY ITEMS ═══ */}
      {filteredPendingItems.map(function (item) {
        var imgUrl = getImageUrl(item.image_path)
        var venueAllocs = item.venue_allocations || []
        var typeColors = { Premium: 'bg-purple-100 text-purple-700', Outdoor: 'bg-green-100 text-green-700', Indoor: 'bg-blue-100 text-blue-700' }

        return (
          <div key={item.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* Image + Name */}
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
                <span className={"font-semibold " + (item.rate_paise > 0 ? "text-gray-700" : "text-red-500")}>{item.rate_paise > 0 ? '₹' + (item.rate_paise / 100).toLocaleString('en-IN') + '/' + (item.unit?.toLowerCase() || 'unit') : '⚠ No rate'}</span>
                {venueAllocs.map(function (va) {
                  return <span key={va.venues?.code} className="text-[11px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">📍 {va.venues?.code}: {va.qty}</span>
                })}
              </div>
              {item.dimensions && Array.isArray(item.dimensions) && item.dimensions.some(function (d) { return d.qty }) && (
                <p className="text-[12px] text-gray-500 mt-1">
                  {item.dimensions.filter(function (d) { return d.qty }).map(function (d) { return d.qty + ' ' + d.unit }).join(' × ')}
                </p>
              )}
              {item.description && (
                <p className="text-[12px] text-gray-400 mt-1.5 line-clamp-2">{item.description}</p>
              )}
            </div>

            {/* Submitter + Dept approval */}
            <div className="px-4 pb-2">
              <div className="text-[11px] text-gray-400">
                <span className="font-medium text-gray-600">{item.profiles?.name || '—'}</span>
                <span className="mx-1">·</span>
                <span>{formatDate(item.entry_date || item.created_at)}</span>
              </div>
              {item.dept_approver && (
                <div className="mt-1 text-[11px] text-green-600 font-medium">✓ Dept approved: {item.dept_approver.name}</div>
              )}
            </div>

            {/* Actions */}
            <div className="flex border-t border-gray-100">
              <button onClick={function () { approveItem(item) }} disabled={saving}
                className="flex-1 py-3 text-sm font-bold text-green-600 hover:bg-green-50 active:bg-green-100 disabled:opacity-50 transition-colors">✓ Approve</button>
              <div className="w-px bg-gray-100" />
              <button onClick={function () { setEditingItem(item) }} disabled={saving}
                className="flex-1 py-3 text-sm font-bold text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 disabled:opacity-50 transition-colors">✎ Edit</button>
              <div className="w-px bg-gray-100" />
              <button onClick={function () { openReject(item._source === 'catering_store' ? 'catering_store_items' : 'inventory_items', item.id, item.name, 'Item') }} disabled={saving}
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
            onSaved={function () { setEditingItem(null); loadPending() }}
          />
        )}
      </Modal>

      {/* Reject modal */}
      <Modal open={!!rejectTarget} onClose={function () { setRejectTarget(null) }} title="Reject">
        {rejectTarget && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium">Reject "{titleCase(rejectTarget.name)}"?</p>
              <p className="text-xs text-red-600 mt-1">This will permanently delete it.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
              <textarea value={rejectReason} onChange={function (e) { setRejectReason(e.target.value) }}
                rows="3" maxLength="500" placeholder="Reason for rejection..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                style={{ fontSize: '16px' }} />
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

      {/* Enlarged image */}
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

export default AdminReview