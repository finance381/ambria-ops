import { supabase, getImageUrl, fetchAll } from '../../lib/supabase'
import { useState, useEffect, useRef } from 'react'
import { formatDate, titleCase, formatPaise } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import InventoryForm from './InventoryForm'
import { useRealtime } from '../../lib/useRealtime'


function Inventory({ profile }) {

  var [items, setItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [enlargedImg, setEnlargedImg] = useState(null)
  var [editItem, setEditItem] = useState(null)
  var [history, setHistory] = useState([])

  // Realtime handler: stable identity, dereferences latest loadItems (which reads current filter state).
  // Without this, useRealtime captures the mount-time loadItems whose closure has empty filters —
  // a save-triggered UPDATE event would refetch unfiltered and blow away the visible list.
  var loadItemsRef = useRef(null)
  var realtimeHandlerRef = useRef(function () { if (loadItemsRef.current) loadItemsRef.current(false) })
  useRealtime(['inventory_items', 'catering_store_items', 'venue_allocations', 'cs_venue_allocations'], realtimeHandlerRef.current)
  var [search, setSearch] = useState('')
  var [catFilter, setCatFilter] = useState('')
  var [subCatFilter, setSubCatFilter] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [subVenueFilter, setSubVenueFilter] = useState('')
  var [subVenues, setSubVenues] = useState([])
  var [searchDebounced, setSearchDebounced] = useState('')
  var [allCategories, setAllCategories] = useState([])
  var [allSubCategories, setAllSubCategories] = useState([])
  var [allVenues, setAllVenues] = useState([])
  var [hasMore, setHasMore] = useState(false)
  var [loadingMore, setLoadingMore] = useState(false)
  var [tab, setTab] = useState('mine')
  var [metaReady, setMetaReady] = useState(false)
  var PAGE_SIZE = 50

  useEffect(function () { loadMeta(); loadHistory() }, [])

  async function loadHistory() {
    try {
      var { data } = await supabase.from('v_item_purchase_history')
        .select('item_id, item_source, vendor_name, rate_paise, txn_date')
      setHistory(data || [])
    } catch (_) { }
  }
  useEffect(function () {
    var t = setTimeout(function () { setSearchDebounced(search) }, 400)
    return function () { clearTimeout(t) }
  }, [search])
  useEffect(function () {
    if (metaReady) loadItems(false)
  }, [tab, venueFilter, subVenueFilter, catFilter, subCatFilter, searchDebounced, metaReady])

  // Sync ref every render so realtime callback always sees the fresh closure.
  loadItemsRef.current = loadItems

  async function loadMeta() {
    setLoading(true)
    var [catRes, scRes, vRes, svRes] = await Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name'),
      supabase.from('venues').select('id, code, name').order('code'),
      supabase.from('sub_venues').select('id, name, venue_id').eq('active', true),
    ])
    setAllCategories(catRes.data || [])
    setAllSubCategories(scRes.data || [])
    setAllVenues(vRes.data || [])
    setSubVenues(svRes.data || [])
    setMetaReady(true)
  }

  async function loadItems(append) {
    if (append) { setLoadingMore(true) } else { setLoading(true) }
    var cursor = append && items.length > 0 ? items[items.length - 1].created_at : null
    var isAdmin = profile.role === 'admin' || profile.role === 'auditor'
    var myCatIds = profile.category_ids || []

    var venueInvIds = null
    var venueCsIds = null
    if (venueFilter || subVenueFilter) {
      var vaQ = supabase.from('venue_allocations').select('item_id')
      var csVaQ = supabase.from('cs_venue_allocations').select('item_id')
      if (venueFilter) {
        var vObj = allVenues.find(function (v) { return v.code === venueFilter })
        if (vObj) { vaQ = vaQ.eq('venue_id', vObj.id); csVaQ = csVaQ.eq('venue_id', vObj.id) }
      }
      if (subVenueFilter) {
        vaQ = vaQ.eq('sub_venue_id', Number(subVenueFilter))
        csVaQ = csVaQ.eq('sub_venue_id', Number(subVenueFilter))
      }
      var [vaRes, csVaRes] = await Promise.all([vaQ, csVaQ])
      venueInvIds = []; venueCsIds = []
      ;(vaRes.data || []).forEach(function (r) { if (venueInvIds.indexOf(r.item_id) === -1) venueInvIds.push(r.item_id) })
      ;(csVaRes.data || []).forEach(function (r) { if (venueCsIds.indexOf(r.item_id) === -1) venueCsIds.push(r.item_id) })
    }

    var invQ = supabase.from('inventory_items')
      .select('*, categories(name), sub_categories(name), venue_allocations(qty, venue_id, sub_venue_id, venues(code, name))')
      .in('status', ['approved', 'pending', 'pending_dept'])
    var csQ = supabase.from('catering_store_items')
      .select('*, categories(name), sub_categories(name), cs_venue_allocations(qty, venue_id, sub_venue_id, venues(code, name))')
      .in('status', ['approved', 'pending', 'pending_dept'])

    if (tab === 'mine') {
      if (!isAdmin) {
        if (myCatIds.length > 0) {
          invQ = invQ.in('category_id', myCatIds); csQ = csQ.in('category_id', myCatIds)
        } else {
          invQ = invQ.eq('submitted_by', profile.id); csQ = csQ.eq('submitted_by', profile.id)
        }
      }
    } else {
      if (!isAdmin) {
        if (myCatIds.length > 0) {
          invQ = invQ.in('category_id', myCatIds); csQ = csQ.in('category_id', myCatIds)
        } else {
          invQ = invQ.eq('submitted_by', profile.id); csQ = csQ.eq('submitted_by', profile.id)
        }
      }
    }
    if (catFilter) { invQ = invQ.eq('category_id', Number(catFilter)); csQ = csQ.eq('category_id', Number(catFilter)) }
    if (subCatFilter) { invQ = invQ.eq('sub_category_id', Number(subCatFilter)); csQ = csQ.eq('sub_category_id', Number(subCatFilter)) }
    if (searchDebounced) {
      var s = '*' + searchDebounced + '*'
      invQ = invQ.or('name.ilike.' + s + ',name_hindi.ilike.' + s + ',inventory_id.ilike.' + s)
      csQ = csQ.or('name.ilike.' + s + ',name_hindi.ilike.' + s + ',inventory_id.ilike.' + s + ',brand.ilike.' + s)
    }
    if (venueInvIds !== null) {
      invQ = venueInvIds.length > 0 ? invQ.in('id', venueInvIds) : invQ.eq('id', '00000000-0000-0000-0000-000000000000')
    }
    if (venueCsIds !== null) {
      csQ = venueCsIds.length > 0 ? csQ.in('id', venueCsIds) : csQ.eq('id', '00000000-0000-0000-0000-000000000000')
    }

    invQ = invQ.order('created_at', { ascending: false }).limit(PAGE_SIZE)
    csQ = csQ.order('created_at', { ascending: false }).limit(PAGE_SIZE)
    if (cursor) { invQ = invQ.lt('created_at', cursor); csQ = csQ.lt('created_at', cursor) }

    var [invRes, csRes] = await Promise.all([invQ, csQ])
    if (invRes.error) console.error('inv error:', invRes.error)
    if (csRes.error) console.error('cs error:', csRes.error)
    var invItems = (invRes.data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
    var csItems = (csRes.data || []).map(function (i) {
      return Object.assign({}, i, { _source: 'catering_store', venue_allocations: i.cs_venue_allocations || [] })
    })
    var merged = invItems.concat(csItems).sort(function (a, b) {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    })
    var page = merged.slice(0, PAGE_SIZE)
    setHasMore(invItems.length === PAGE_SIZE || csItems.length === PAGE_SIZE)
    if (append) { setItems(function (prev) { return prev.concat(page) }) }
    else { setItems(page) }
    setLoading(false)
    setLoadingMore(false)
  }

  function handleSaved() {
    setEditItem(null)
    loadItems(false)
  }

  var showTabs = profile.role === 'admin' || profile.role === 'auditor' || (profile.category_ids || []).length > 0

  if (loading && !metaReady) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    )
  }

  var catOptions = allCategories
  var subCatOptions = allSubCategories.filter(function (sc) {
    return !catFilter || String(sc.category_id) === catFilter
  })
  var venueOptions = allVenues
  var subVenueOptions = subVenues.filter(function (sv) {
    if (!venueFilter) return true
    var selVenue = allVenues.find(function (v) { return v.code === venueFilter })
    return selVenue ? sv.venue_id === selVenue.id : true
  }).sort(function (a, b) { return a.name.localeCompare(b.name) })

  function resetFilters() {
    setSearch(''); setSearchDebounced(''); setCatFilter(''); setSubCatFilter(''); setVenueFilter(''); setSubVenueFilter('')
  }

  return (
    <div className="space-y-3">
     {/* Tabs */}
     {showTabs && (
       <div className="flex bg-gray-100 rounded-lg p-1">
         <button onClick={function () { setTab('mine') }}
           className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors " + (tab === 'mine' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
           My Items
         </button>
         <button onClick={function () { setTab('all') }}
           className={"flex-1 py-2 text-sm font-semibold rounded-md transition-colors " + (tab === 'all' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500")}>
           Full Inventory
         </button>
       </div>
     )}

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
       <div className="flex gap-2">
         <select value={venueFilter}
           onChange={function (e) { setVenueFilter(e.target.value); setSubVenueFilter('') }}
           className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
           style={{ fontSize: '16px' }}>
           <option value="">All Venues</option>
           {venueOptions.map(function (v) { return <option key={v.code} value={v.code}>{v.code + ' \u2014 ' + v.name}</option> })}
         </select>
         <select value={subVenueFilter}
           onChange={function (e) { setSubVenueFilter(e.target.value) }}
           className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
           style={{ fontSize: '16px' }}>
           <option value="">All Sub-venues</option>
           {subVenueOptions.map(function (sv) { return <option key={sv.id} value={String(sv.id)}>{sv.name}</option> })}
         </select>
       </div>
       <div className="flex items-center gap-2">
         <div className="text-[11px] text-gray-400">{items.length + ' loaded' + (hasMore ? '+' : '')}</div>
         {(search || catFilter || subCatFilter || venueFilter || subVenueFilter) && (
           <button onClick={resetFilters}
             className="px-2 py-1 text-[11px] text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors font-medium">✕ Reset</button>
         )}
       </div>
     </div>

     {items.length === 0 && !loading && (
       <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
         <p className="text-sm text-gray-400">{tab === 'mine' ? 'No items submitted by you' : 'No items match filters'}</p>
       </div>
     )}
     {loading && metaReady && (
       <div className="text-center py-4">
         <p className="text-sm text-gray-400">Loading items...</p>
       </div>
     )}

     {items.map(function (item) {
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
              {item.rate_paise != null && item.rate_paise > 0 && (
                <span>💰 {formatPaise(item.rate_paise)}</span>
              )}
            </div>
            {/* Last 3 purchases */}
            {(function () {
              var matches = history.filter(function (h) {
                return h.item_source === item._source && Number(h.item_id) === Number(item.id)
              })
              if (matches.length === 0) return null
              matches.sort(function (a, b) {
                return (b.txn_date || '').localeCompare(a.txn_date || '')
              })
              var last3 = matches.slice(0, 3)
              return (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">📈 Last {last3.length} purchase{last3.length > 1 ? 's' : ''}</p>
                  {last3.map(function (h, i) {
                    return (
                      <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 text-[11px] py-0.5 items-baseline">
                        <span className="font-semibold text-gray-700 truncate">{h.vendor_name || '—'}</span>
                        <span className="font-semibold text-gray-800">{formatPaise(h.rate_paise || 0)}</span>
                        <span className="text-[10px] text-gray-400">{h.txn_date ? formatDate(h.txn_date) : ''}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
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
              var canEdit = isAdmin || (isDeptHead && (item.status === 'pending_dept' || item.status === 'pending'))
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
      {hasMore && (
        <button onClick={function () { loadItems(true) }} disabled={loadingMore}
          className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          {loadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}
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
