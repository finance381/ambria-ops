import { supabase, getImageUrl } from '../../lib/supabase'
import { useState, useEffect } from 'react'
import { formatDate, titleCase } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import InventoryForm from './InventoryForm'


function Inventory({ profile }) {

  var [items, setItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [editItem, setEditItem] = useState(null)
  var [enlargedImg, setEnlargedImg] = useState(null)
  var [search, setSearch] = useState('')
  var [catFilter, setCatFilter] = useState('')
  var [subCatFilter, setSubCatFilter] = useState('')

  useEffect(function () {
    loadMyItems()
  }, [])

  async function loadMyItems() {
    setLoading(true)
    var isAdmin = profile.role === 'admin' || profile.role === 'auditor'
    var myCatIds = profile.category_ids || []

    var query = supabase
      .from('inventory_items')
      .select('*, categories(name), sub_categories(name), venue_allocations(qty, venues(code, name))')
      .order('created_at', { ascending: false })
      .limit(500)

    var csQuery = supabase
      .from('catering_store_items')
      .select('*, categories(name), sub_categories(name), cs_venue_allocations(qty, venues(code, name))')
      .order('created_at', { ascending: false })
      .limit(500)

    if (isAdmin) {
      // Admin sees all
    } else if (myCatIds.length > 0) {
      query = query.in('category_id', myCatIds)
      csQuery = csQuery.in('category_id', myCatIds)
    } else {
      query = query.eq('submitted_by', profile.id)
      csQuery = csQuery.eq('submitted_by', profile.id)
    }

    var [invRes, csRes] = await Promise.all([query, csQuery])
    var invItems = (invRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
    var csItems = (csRes.data || []).map(function (i) {
      return Object.assign({}, i, {
        _source: 'catering_store',
        venue_allocations: i.cs_venue_allocations || [],
      })
    })
    // Merge and sort by created_at descending
    var merged = invItems.concat(csItems).sort(function (a, b) {
      return new Date(b.created_at || b.entry_date || 0) - new Date(a.created_at || a.entry_date || 0)
    })
    setItems(merged)
    setLoading(false)
  }

  function handleSaved() {
    setEditItem(null)
    loadMyItems()
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-400">Loading your items...</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <p className="text-sm text-gray-400">No items yet</p>
      </div>
    )
  }
    var catOptions = [...new Set(items.map(function (i) { return i.category_id }).filter(Boolean))].map(function (cid) {
    var item = items.find(function (i) { return i.category_id === cid })
    return { id: cid, name: item?.categories?.name || '—' }
  }).sort(function (a, b) { return a.name.localeCompare(b.name) })

   var subCatOptions = [...new Set(items.filter(function (i) {
    return i.sub_categories?.name && (!catFilter || String(i.category_id) === catFilter)
  }).map(function (i) { return i.sub_category_id }).filter(Boolean))].map(function (sid) {
    var item = items.find(function (i) { return i.sub_category_id === sid })
    return { id: sid, name: item?.sub_categories?.name || '—' }
  }).sort(function (a, b) { return a.name.localeCompare(b.name) })

   var searchLower = search.toLowerCase()
   var filtered = items.filter(function (item) {
   var matchSearch = !search ||
     item.name.toLowerCase().includes(searchLower) ||
     (item.name_hindi || '').toLowerCase().includes(searchLower) ||
     (item.inventory_id || '').toLowerCase().includes(searchLower) ||
     (item.categories?.name || '').toLowerCase().includes(searchLower) ||
     (item.brand || '').toLowerCase().includes(searchLower)
   var matchCat = !catFilter || String(item.category_id) === catFilter
   var matchSubCat = !subCatFilter || String(item.sub_category_id) === subCatFilter
    return matchSearch && matchCat && matchSubCat
  })

  return (
    <div className="space-y-3">
     {/* Filters */}
     <div className="space-y-2">
       <input type="text" value={search}
         onChange={function (e) { setSearch(e.target.value) }}
         placeholder="Search item name, ID..."
         className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
         style={{ fontSize: '16px' }} />
       <div className="flex gap-2">
         <select value={catFilter}
           onChange={function (e) { setCatFilter(e.target.value); setSubCatFilter('') }}
           className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
           <option value="">All Categories</option>
           {catOptions.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
         </select>
         <select value={subCatFilter}
           onChange={function (e) { setSubCatFilter(e.target.value) }}
           className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
           <option value="">All Sub-categories</option>
           {subCatOptions.map(function (sc) { return <option key={sc.id} value={String(sc.id)}>{sc.name}</option> })}
         </select>
       </div>
       <div className="text-[11px] text-gray-400">{filtered.length} / {items.length} items</div>
     </div>

     {filtered.length === 0 && (
       <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
         <p className="text-sm text-gray-400">No items match filters</p>
       </div>
     )}

     {filtered.map(function (item) {
        var venueAllocs = item.venue_allocations || []

        return (
          <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            {/* Header: image + name + inventory ID */}
            <div className="flex gap-3 mb-2">
              {item.image_path ? (
                <img
                  src={getImageUrl(item.image_path)}
                  alt=""
                  onClick={function () { setEnlargedImg(getImageUrl(item.image_path)) }}
                  className="w-14 h-14 rounded-lg object-cover border border-gray-200 flex-shrink-0 cursor-pointer active:opacity-70"
                />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xl flex-shrink-0">
                  📷
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-bold text-gray-900">{titleCase(item.name)}</h3>
                <span className="text-[11px] text-gray-400 font-mono">
                  {item.inventory_id || '—'}
                </span>
              </div>
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-gray-500">
              {item.categories?.name && (
                <span>📁 {item.categories.name}{item.sub_categories?.name ? ' > ' + item.sub_categories.name : ''}</span>
              )}
              {item.department && (
                <span>🏢 {item.department}</span>
              )}
              {item.brand && (
                <span>🏷️ {item.brand}</span>
              )}
              {item.pack_size_qty && (
                <span>📦 Pack: {item.pack_size_qty} {item.pack_size_unit}</span>
              )}
              {venueAllocs.length > 0 && venueAllocs.map(function (va) {
                return (
                  <span key={va.venues?.code}>📍 {va.venues?.code} – {va.venues?.name}</span>
                )
              })}
              <span>📦 {item.qty} {item.unit?.toLowerCase()}</span>
              <span>📅 {formatDate(item.entry_date || item.created_at)}</span>
              {item.is_asset && item.is_asset !== 'unknown' && (
                <span>🏷️ Asset: {item.is_asset === 'yes' ? 'Yes' : 'No'}</span>
              )}
            </div>
            {/* Status badge */}
            {item.status && item.status !== 'approved' && (
              <div className="mt-2">
                <span className={"text-[11px] font-bold uppercase px-2 py-0.5 rounded-full " +
                  (item.status === 'pending_dept' ? "bg-blue-100 text-blue-700" :
                   item.status === 'pending' ? "bg-amber-100 text-amber-700" :
                   "bg-gray-100 text-gray-600")}>
                  {item.status === 'pending_dept' ? 'Pending (Dept)' : item.status === 'pending' ? 'Pending (Admin)' : item.status}
                </span>
              </div>
            )}

            {/* Edit button */}
            {(function () {
              var isAdmin = profile.role === 'admin' || profile.role === 'auditor'
              var isOwner = item.submitted_by === profile.id
              var catIds = profile.category_ids || []
              var itemCatNum = Number(item.category_id)
              var isDeptHead = (profile.permissions || []).includes('dept_approve') && catIds.some(function (c) { return Number(c) === itemCatNum })
              var canEdit = isAdmin || isOwner || isDeptHead              
              if (!canEdit) return null
              return (
                <div className="mt-3">
                  <button
                    onClick={function () { setEditItem(item) }}
                    className="px-3 py-1.5 text-[12px] font-semibold border border-gray-200 rounded-lg text-gray-700 hover:border-gray-900 transition-colors"
                  >
                    Edit
                  </button>
                </div>
              )
            })()}
          </div>
        )
      })}
      <Modal open={!!editItem} onClose={function () { setEditItem(null) }} title="Edit Entry">
        {editItem && (
          <InventoryForm
            item={editItem}
            profile={profile}
            onClose={function () { setEditItem(null) }}
            onSaved={handleSaved}
          />
        )}
      </Modal>
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

export default Inventory
