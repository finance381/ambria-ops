import { supabase, getImageUrl, fetchAll } from '../../lib/supabase'
import { useState, useEffect, useRef } from 'react'
import { formatDate, titleCase, formatPaise } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import Icon from '../../components/ui/Icon'
import InventoryForm from './InventoryForm'
import StockBreakdown from '../../components/StockBreakdown'
import inventoryBg from '../../assets/inventory-bg.webp'
import { useRealtime } from '../../lib/useRealtime'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'


// The admin Inventory page's ground, cut for a phone: the warm wall colour
// with the vases photograph across the top, fading into the wall below it,
// so the white cards sit on the same scene as on the desktop. The body takes
// the wall colour while the screen is up, so dragging past either end of the
// list meets the same tone. Phone only — wider screens keep the plain ground.
var INV_WALL = '#F2EAE5'
function InventoryBackdrop() {
  useEffect(function () {
    var b = document.body
    var h = document.documentElement
    var prevBg = b.style.backgroundColor
    var prevHtmlBg = h.style.backgroundColor
    var prevOver = b.style.overscrollBehaviorY
    b.style.backgroundColor = INV_WALL
    h.style.backgroundColor = INV_WALL
    b.style.overscrollBehaviorY = 'none'
    return function () {
      b.style.backgroundColor = prevBg
      h.style.backgroundColor = prevHtmlBg
      b.style.overscrollBehaviorY = prevOver
    }
  }, [])
  return (
    <div aria-hidden="true" className="sm:hidden pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ backgroundColor: INV_WALL, minHeight: '100lvh' }}>
      {/* Blurred, so the photograph is a soft wash of colour behind the
          list rather than a picture competing with the cards. Scaled up a
          little so the blur does not leave a pale rim at the edges. */}
      <div className="absolute inset-x-0 top-0 h-[320px]"
        style={{
          WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 55%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, #000 0%, #000 55%, transparent 100%)',
        }}>
        <div className="absolute inset-0"
          style={{
            backgroundImage: 'url(' + inventoryBg + ')',
            backgroundSize: 'cover',
            backgroundPosition: 'right top',
            filter: 'blur(1.5px)',
            transform: 'scale(1.02)',
          }} />
      </div>
    </div>
  )
}

// One of an item's dimension fields, by a pattern on its name ("Material",
// "Menu Zones", "Vendor"…), the way the desktop card reads them. "Pieces" is
// the form's placeholder unit and never part of a value.
function dimOf(item, re) {
  var dims = Array.isArray(item.dimensions) ? item.dimensions : []
  for (var i = 0; i < dims.length; i++) {
    var d = dims[i]
    if (!d || !d.name || !re.test(d.name)) continue
    var unit = d.unit && String(d.unit).toLowerCase() !== 'pieces' ? d.unit : ''
    var v = d.value != null && String(d.value).trim() !== ''
      ? String(d.value).trim()
      : (d.qty != null && String(d.qty).trim() !== '' ? (d.qty + ' ' + unit).trim() : '')
    v = v.replace(/\s+pieces$/i, '').trim()
    if (v && v.toLowerCase() !== 'pieces') return v
  }
  return ''
}

function Inventory({ profile }) {

  var [items, setItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [enlargedImg, setEnlargedImg] = useState(null)
  var [editItem, setEditItem] = useState(null)
  // The item whose stock breakdown is open (components/StockBreakdown).
  var [stockItem, setStockItem] = useState(null)
  var [history, setHistory] = useState([])
  // Who submitted each item: profile id → name, filled in as pages load.
  var [submitters, setSubmitters] = useState({})

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
  var allVenues = useReferenceData().venues
  var [hasMore, setHasMore] = useState(false)
  var [loadingMore, setLoadingMore] = useState(false)
  var [tab, setTab] = useState('mine')
  var [metaReady, setMetaReady] = useState(false)
  // The four filters sit behind the filter button next to the search.
  var [filtersOpen, setFiltersOpen] = useState(false)
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
    var [catRes, scRes, svRes] = await Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name'),
      supabase.from('sub_venues').select('id, name, venue_id').eq('active', true),
    ])
    setAllCategories(catRes.data || [])
    setAllSubCategories(scRes.data || [])
    setSubVenues(svRes.data || [])
    setMetaReady(true)
  }

  async function loadItems(append) {
    if (append) { setLoadingMore(true) } else { setLoading(true) }
    var cursor = append && items.length > 0 ? items[items.length - 1].created_at : null
    var isAdmin = hasPerm(profile?.permsNew, 'inventory.items')
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
    // Names for the submitters on this page not looked up yet.
    var missing = page.map(function (i) { return i.submitted_by }).filter(function (id, idx, arr) { return id && arr.indexOf(id) === idx && !submitters[id] })
    if (missing.length > 0) {
      supabase.from('profiles').select('id, name').in('id', missing).then(function (res) {
        if (!res.data) return
        setSubmitters(function (prev) {
          var next = Object.assign({}, prev)
          res.data.forEach(function (pr) { next[pr.id] = pr.name })
          return next
        })
      })
    }
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

  var showTabs = hasPerm(profile?.permsNew, 'inventory.items') || (profile.category_ids || []).length > 0

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

  var SEL = "w-full h-11 pl-3 pr-8 appearance-none bg-white border border-slate-200 rounded-xl text-[14px] text-slate-800 focus:outline-none focus:ring-4 focus:ring-[#3B4668]/10 focus:border-[#A9B1CB]"
  var anyFilter = !!(search || catFilter || subCatFilter || venueFilter || subVenueFilter)
  var filterCount = [catFilter, subCatFilter, venueFilter, subVenueFilter].filter(Boolean).length
  var FLBL = "block text-[12px] font-semibold text-slate-600 mb-1"

  return (
    <div className="space-y-3.5">
     <InventoryBackdrop />
     {/* Tabs */}
     {showTabs && (
       <div className="flex gap-1 p-1 bg-white/80 backdrop-blur-md border border-white rounded-xl shadow-[0_4px_14px_-8px_rgba(90,60,30,0.3)]">
         {[{ k: 'mine', label: 'My Items', icon: 'box' }, { k: 'all', label: 'Full Inventory', icon: 'list' }].map(function (tb) {
           var on = tab === tb.k
           return (
             <button key={tb.k} onClick={function () { setTab(tb.k) }}
               className={"flex-1 h-9 inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold rounded-lg transition-colors " +
                 (on ? "bg-[#8B6A50] text-white shadow-[0_4px_12px_-4px_rgba(139,106,80,0.7)]" : "text-slate-800 active:bg-white")}>
               <Icon name={tb.icon} size={14} />{tb.label}
             </button>
           )
         })}
       </div>
     )}

     {/* Search, and a filter button beside it: category, sub-category,
         venue and sub-venue open in a panel under it — four selects in two
         rows did not fit a phone and cut their own labels off. */}
     <div className="space-y-2">
       <div className="flex gap-2">
         <div className="relative flex-1 min-w-0">
           <Icon name="search" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
           <input type="text" value={search}
             onChange={function (e) { setSearch(e.target.value) }}
             placeholder="Search item name, ID..."
             className="w-full h-12 pl-11 pr-3 bg-white border border-white rounded-2xl text-[15px] text-slate-900 placeholder:text-slate-400 shadow-[0_6px_20px_-12px_rgba(90,60,30,0.35)] focus:outline-none focus:ring-4 focus:ring-[#8B6A50]/15"
             style={{ fontSize: '16px' }} />
         </div>
         <button type="button" onClick={function () { setFiltersOpen(!filtersOpen) }} aria-expanded={filtersOpen} aria-label="Filters" title="Filters"
           className={"relative shrink-0 w-12 h-12 inline-flex items-center justify-center rounded-2xl border shadow-[0_6px_20px_-12px_rgba(90,60,30,0.35)] transition-colors " +
             (filtersOpen || filterCount > 0 ? "bg-[#F6EEE7] border-[#E7D8CA] text-[#8B6A50]" : "bg-white border-white text-slate-700 active:bg-slate-50")}>
           <Icon name="filter" size={20} />
           {filterCount > 0 && (
             <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-[#3B4668] text-white text-[10.5px] font-bold tabular-nums ring-2 ring-white">{filterCount}</span>
           )}
         </button>
       </div>

       {filtersOpen && (
         <div className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-3 shadow-[0_6px_20px_-10px_rgba(15,23,42,0.25)]">
           {/* Two to a row: each parent beside its child. */}
           <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
           <div className="min-w-0">
             <label className={FLBL}>Category</label>
             <div className="relative">
               <select value={catFilter} onChange={function (e) { setCatFilter(e.target.value); setSubCatFilter('') }} className={SEL}>
                 <option value="">All</option>
                 {catOptions.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
               </select>
               <Icon name="chevronDown" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
             </div>
           </div>
           <div className="min-w-0">
             <label className={FLBL}>Sub-category</label>
             <div className="relative">
               <select value={subCatFilter} onChange={function (e) { setSubCatFilter(e.target.value) }} className={SEL}>
                 <option value="">All</option>
                 {subCatOptions.map(function (sc) { return <option key={sc.id} value={String(sc.id)}>{sc.name}</option> })}
               </select>
               <Icon name="chevronDown" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
             </div>
           </div>
           <div className="min-w-0">
             <label className={FLBL}>Venue</label>
             <div className="relative">
               <select value={venueFilter} onChange={function (e) { setVenueFilter(e.target.value); setSubVenueFilter('') }} className={SEL}>
                 <option value="">All</option>
                 {venueOptions.map(function (v) { return <option key={v.code} value={v.code}>{v.code + ' — ' + v.name}</option> })}
               </select>
               <Icon name="chevronDown" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
             </div>
           </div>
           <div className="min-w-0">
             <label className={FLBL}>Sub-venue</label>
             <div className="relative">
               <select value={subVenueFilter} onChange={function (e) { setSubVenueFilter(e.target.value) }} className={SEL}>
                 <option value="">All</option>
                 {subVenueOptions.map(function (sv) { return <option key={sv.id} value={String(sv.id)}>{sv.name}</option> })}
               </select>
               <Icon name="chevronDown" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
             </div>
           </div>
           </div>
           <div className="flex gap-2 pt-1">
             <button type="button" onClick={function () { setCatFilter(''); setSubCatFilter(''); setVenueFilter(''); setSubVenueFilter('') }} disabled={filterCount === 0}
               className="flex-1 h-10 rounded-xl border border-slate-200 bg-white text-[13.5px] font-semibold text-slate-700 disabled:text-slate-400 active:bg-slate-50 transition-colors">
               Clear filters
             </button>
             <button type="button" onClick={function () { setFiltersOpen(false) }}
               className="flex-1 h-10 rounded-xl bg-[#3B4668] text-white text-[13.5px] font-semibold active:bg-[#2F3854] transition-colors">
               Done
             </button>
           </div>
         </div>
       )}

       <div className="flex items-center gap-2 px-0.5">
         <span className="text-[13px] font-medium text-slate-600"><b className="text-slate-800 tabular-nums">{items.length}</b> loaded{hasMore ? '+' : ''}</span>
         {anyFilter && (
           <button onClick={resetFilters}
             className="inline-flex items-center gap-1 h-7 px-2.5 text-[12px] font-semibold text-red-600 rounded-full hover:bg-red-50 transition-colors">
             <Icon name="refresh" size={12} />Reset
           </button>
         )}
       </div>
     </div>

     {items.length === 0 && !loading && (
       <div className="flex flex-col items-center gap-2 py-12 bg-white border border-slate-200 rounded-2xl text-center">
         <span className="w-11 h-11 rounded-xl bg-slate-100 text-slate-400 inline-flex items-center justify-center"><Icon name="box" size={20} /></span>
         <p className="text-[13.5px] font-semibold text-slate-700">{tab === 'mine' ? 'No items submitted by you' : 'No items match filters'}</p>
       </div>
     )}
     {loading && metaReady && (
       <div className="text-center py-4">
         <p className="text-sm text-gray-400">Loading items...</p>
       </div>
     )}

     {items.map(function (item) {
        var venueAllocs = item.venue_allocations || []
        var isAdminU = hasPerm(profile?.permsNew, 'inventory.items')
        var catIdsU = profile.category_ids || []
        var isDeptHeadU = hasPerm(profile.permsNew, 'review.dept.approve') && catIdsU.some(function (cid) { return Number(cid) === Number(item.category_id) })
        var canEdit = isAdminU || (isDeptHeadU && (item.status === 'pending_dept' || item.status === 'pending'))
        var onHand = Number(item.qty) || 0
        var placed = venueAllocs.reduce(function (sum, va) { return sum + (Number(va.qty) || 0) }, 0)
        var rest = Math.round((onHand - placed) * 1000) / 1000
        var facts = [{ label: 'Stock', value: onHand + ' ' + (item.unit || ''), icon: 'box' }]
        var mat = dimOf(item, /materi/i); if (mat) facts.push({ label: 'Material', value: mat, icon: 'tag' })
        var zone = dimOf(item, /menu\s*zone/i); if (zone) facts.push({ label: 'Menu zone', value: zone, icon: 'utensils' })
        var vendor = dimOf(item, /^\s*vendors?\s*$/i) || dimOf(item, /vendor\s*name/i); if (vendor) facts.push({ label: 'Vendor', value: vendor, icon: 'truck' })
        var byPlace = {}, order = []
        venueAllocs.forEach(function (va) {
          var k = (va.venue_id || va.venues?.code || '') + '|' + (va.sub_venue_id || '')
          if (!byPlace[k]) { byPlace[k] = { code: va.venues?.code, name: va.venues?.name, sub_venue_id: va.sub_venue_id, qty: 0 }; order.push(k) }
          byPlace[k].qty += Number(va.qty) || 0
        })

        return (
          <div key={item.id} className="relative bg-white/95 border border-white rounded-3xl p-3.5 shadow-[0_10px_28px_-14px_rgba(90,60,30,0.35)]">
            <div className="flex gap-3.5">
              {/* The photograph, filling its tile. */}
              {item.image_path ? (
                <button type="button" onClick={function () { setEnlargedImg(getImageUrl(item.image_path)) }} aria-label={'Photo of ' + item.name}
                  className="shrink-0 w-[112px] h-[112px] rounded-2xl overflow-hidden bg-slate-100 shadow-[0_6px_14px_-8px_rgba(90,60,30,0.5)] active:opacity-80">
                  <img src={getImageUrl(item.image_path)} alt="" loading="lazy" className="w-full h-full object-cover" />
                </button>
              ) : (
                <div className="shrink-0 w-[112px] h-[112px] rounded-2xl bg-[#F6EEE7] flex items-center justify-center text-[#C9B19C]">
                  <Icon name="gallery" size={28} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-1">
                  <h3 className="flex-1 min-w-0 text-[16px] font-bold text-slate-900 leading-snug">{titleCase(item.name)}</h3>
                  {item.status && item.status !== 'approved' && (
                    <span className={"shrink-0 mt-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full " +
                      (item.status === 'pending_dept' ? "bg-sky-100 text-sky-700" : item.status === 'pending' ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600")}>
                      {item.status === 'pending_dept' || item.status === 'pending' ? 'Pending' : item.status}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-[11.5px] font-bold text-slate-600 font-mono">{item.inventory_id || '—'}</span>
                  {item.name_hindi && <span className="text-[13px] text-slate-500">{item.name_hindi}</span>}
                </div>
                {item.categories?.name && (
                  <p className="mt-1.5 text-[12px] text-slate-500">
                    {item.categories.name}{item.sub_categories?.name ? ' › ' + item.sub_categories.name : ''}
                  </p>
                )}
                {/* Brand and pack size up here, as on the desktop card, not
                    as a tile among the details. */}
                {item.brand && (
                  <p className="mt-1 text-[13px] font-semibold text-amber-600">{item.brand}{item.pack_size_qty ? ' · ' + item.pack_size_qty + ' ' + (item.pack_size_unit || '') : ''}</p>
                )}
              </div>
            </div>

            {/* The facts, each with its own icon tile. */}
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
              {facts.map(function (f) {
                return (
                  <div key={f.label} className="flex items-center gap-2.5 min-w-0">
                    <span className="shrink-0 w-9 h-9 rounded-xl bg-[#F6EEE7] text-[#9A7656] inline-flex items-center justify-center"><Icon name={f.icon} size={16} /></span>
                    <span className="min-w-0">
                      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-400 leading-tight">{f.label}</span>
                      <span className="block text-[14px] font-bold text-slate-900 truncate" title={f.value}>{f.value}</span>
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="mt-3 border-t border-dashed border-slate-200" />

            {/* Stored at: one chip per place; tapping one opens the breakdown. */}
            {order.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Stored at</p>
                <div className="flex flex-wrap gap-1.5 p-1.5 rounded-2xl bg-[#FAF6F2]">
                  {order.map(function (k) {
                    var pl = byPlace[k]
                    var sv = pl.sub_venue_id ? subVenues.find(function (x) { return x.id === pl.sub_venue_id }) : null
                    return (
                      <button key={k} type="button" onClick={function () { setStockItem(item) }}
                        className="inline-flex items-stretch h-9 rounded-xl overflow-hidden border border-slate-200 bg-white active:bg-slate-50">
                        <span className="inline-flex items-center gap-1 px-2.5 bg-slate-50 text-slate-800 text-[12.5px] font-extrabold">
                          <Icon name="mapPin" size={12} className="text-slate-400" />{pl.code}
                        </span>
                        {sv && <span className="inline-flex items-center px-2.5 text-[13px] font-medium text-slate-800 whitespace-nowrap">{sv.name}</span>}
                        <span className="inline-flex items-center px-2.5 border-l border-slate-200 text-[14px] font-extrabold text-slate-900 tabular-nums">{Math.round(pl.qty * 1000) / 1000}</span>
                        <span className="inline-flex items-center pr-2 pl-1 text-slate-400"><Icon name="chevronRight" size={13} /></span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* When, who, which department. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Icon name="calendar" size={13} className="text-slate-400" />{formatDate(item.entry_date || item.created_at)}</span>
              {submitters[item.submitted_by] && <span className="inline-flex items-center gap-1.5"><Icon name="user" size={13} className="text-slate-400" />{submitters[item.submitted_by]}</span>}
              {item.department && <span className="inline-flex items-center gap-1.5"><Icon name="building" size={13} className="text-slate-400" />{item.department}</span>}
              {item.is_asset && item.is_asset !== 'unknown' && <span className="inline-flex items-center gap-1.5"><Icon name="idCard" size={13} className="text-slate-400" />Asset: {item.is_asset === 'yes' ? 'Yes' : 'No'}</span>}
            </div>

            {/* Last 3 purchases */}
            {(function () {
              var matches = history.filter(function (h) {
                return h.item_source === item._source && Number(h.item_id) === Number(item.id)
              })
              if (matches.length === 0) return null
              matches.sort(function (x, y) { return (y.txn_date || '').localeCompare(x.txn_date || '') })
              var last3 = matches.slice(0, 3)
              return (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="flex items-center gap-1 text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-1"><Icon name="chart" size={11} />Last {last3.length} purchase{last3.length > 1 ? 's' : ''}</p>
                  {last3.map(function (h, i) {
                    return (
                      <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 text-[11.5px] py-0.5 items-baseline">
                        <span className="font-semibold text-slate-700 truncate">{h.vendor_name || '—'}</span>
                        <span className="font-semibold text-slate-900">{formatPaise(h.rate_paise || 0)}</span>
                        <span className="text-[10.5px] text-slate-400">{h.txn_date ? formatDate(h.txn_date) : ''}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Stock and Edit. */}
            <div className="mt-3.5 flex items-center gap-2.5">
              <button type="button" onClick={function () { setStockItem(item) }} title="Stock breakdown"
                className={"flex-1 min-w-0 inline-flex items-center gap-3 h-14 pl-2 pr-3 rounded-2xl border text-left transition-colors " +
                  (rest > 0 ? "border-amber-300 bg-amber-50 active:bg-amber-100" : "border-slate-200 bg-white active:bg-slate-50")}>
                <span aria-hidden="true" className={"shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center " + (rest > 0 ? "bg-amber-500 text-white" : "bg-[#F6EEE7] text-[#8B6A50]")}>
                  <Icon name="box" size={18} />
                </span>
                <span className="flex-1 min-w-0 flex flex-col leading-tight">
                  <span className="text-[15.5px] font-extrabold text-slate-900 tabular-nums">{onHand} <span className="text-[13px] font-semibold text-slate-700">{item.unit || ''}</span></span>
                  {rest > 0
                    ? <span className="text-[12px] font-bold text-amber-800 tabular-nums">{rest} not allocated</span>
                    : <span className="text-[12.5px] text-slate-500">View breakdown</span>}
                </span>
                <Icon name="chevronRight" size={17} className="shrink-0 text-slate-500" />
              </button>
              {canEdit && (
                <button type="button" onClick={function () { setEditItem(item) }}
                  className="shrink-0 inline-flex items-center justify-center gap-2 h-14 px-6 rounded-2xl bg-[#232B45] text-white text-[15px] font-semibold active:bg-[#1A2036] transition-colors">
                  <Icon name="edit" size={16} />Edit
                </button>
              )}
            </div>
          </div>
        )
      })}
      {hasMore && (
        <button onClick={function () { loadItems(true) }} disabled={loadingMore}
          className="w-full h-11 inline-flex items-center justify-center gap-1.5 text-[13.5px] font-semibold text-[#333D5E] bg-[#EDEFF5] border border-[#D8DCE8] rounded-xl hover:bg-[#E3E6F0] disabled:opacity-50 transition-colors">
          {loadingMore ? 'Loading...' : (<><Icon name="chevronDown" size={15} />Load More</>)}
        </button>
      )}
      {stockItem && (
        <StockBreakdown item={stockItem} profile={profile} onClose={function () { setStockItem(null) }} onChanged={function () { loadItems(false) }} />
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
