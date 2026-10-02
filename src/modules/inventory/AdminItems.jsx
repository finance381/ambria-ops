import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { prepUpload } from '../../lib/uploadHelper'
import { supabase, getImageUrl } from '../../lib/supabase'
import { formatDate, titleCase, formatPaise } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import Modal from '../../components/ui/Modal'
import Icon from '../../components/ui/Icon'
import EventDatePicker from '../../components/ui/EventDatePicker'
import InventoryForm from './InventoryForm'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { stockValuePaise } from '../../lib/stockBatches'
import StockBreakdown from '../../components/StockBreakdown'

function FilterDropdown({ value, onChange, options, placeholder, multi }) {
  var [open, setOpen] = useState(false)
  var [q, setQ] = useState('')
  // Closes on a press anywhere outside it, or on Escape. It used a fixed
  // full-screen overlay for this, but inside the toolbar's backdrop-blur panel
  // a fixed element is sized to that panel, not the window — so a click
  // anywhere else on the page never reached it and the list stayed open.
  var wrapRef = useRef(null)
  useEffect(function () {
    if (!open) return
    function onDown(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return function () {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  var qLower = q.toLowerCase()
  var filtered = q ? options.filter(function (o) { return o.label.toLowerCase().indexOf(qLower) !== -1 }) : options
  var vals = multi ? (value || []) : []
  var selected = multi ? null : options.find(function (o) { return o.value === value })
  var displayLabel = multi
    ? (function () {
        if (vals.length === 0) return placeholder
        if (vals.length <= 2) {
          return vals.map(function (v) {
            var o = options.find(function (x) { return x.value === v })
            return (o && o.label) || v
          }).join(', ')
        }
        return vals.length + ' selected'
      })()
    : (selected ? selected.label : placeholder)
  var hasValue = multi ? vals.length > 0 : !!value
  function toggle(v) {
    if (!multi) { onChange(v); setOpen(false); return }
    var idx = vals.indexOf(v)
    if (idx === -1) { onChange(vals.concat([v])) }
    else { onChange(vals.filter(function (x) { return x !== v })) }
  }
  function clearAll() { onChange(multi ? [] : ''); setOpen(false) }
  return (
    <div ref={wrapRef} className="relative" style={{ minWidth: 140 }}>
      <button type="button" onClick={function () { setOpen(!open); setQ('') }} aria-expanded={open}
        className={"w-full h-11 flex items-center gap-2 pl-3.5 pr-3 rounded-xl border text-[14px] text-left transition-colors focus:outline-none focus:ring-4 focus:ring-[#3B4668]/10 " +
          (hasValue
            ? "border-[#8A93B0] bg-[#E3E6F0] text-[#2B3452] font-semibold"
            : "border-slate-300 bg-white text-slate-800 font-medium shadow-[0_1px_2px_rgba(15,23,42,0.06)] hover:border-slate-400") +
          (open ? " border-[#A9B1CB]" : "")}>
        <span className="flex-1 min-w-0 truncate">{displayLabel}</span>
        <Icon name="chevronDown" size={15} className={"shrink-0 transition-[rotate] duration-200 " + (open ? "rotate-180 " : "") + (hasValue ? "text-[#3B4668]" : "text-slate-600")} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1.5 w-full min-w-[240px] bg-white border border-slate-200 rounded-xl shadow-[0_16px_40px_-12px_rgba(30,35,60,0.35)] overflow-hidden" style={{ maxHeight: 320, display: 'flex', flexDirection: 'column' }}>
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="text" value={q} onChange={function (e) { setQ(e.target.value) }} placeholder="Type to filter..."
                autoFocus className="w-full h-9 pl-8 pr-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-[#A9B1CB]" />
            </div>
          </div>
          <div className="overflow-y-auto p-1" style={{ maxHeight: 256 }}>
            <button type="button" onClick={clearAll}
              className={"w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-50 " + (!hasValue ? "font-semibold text-[#333D5E]" : "text-slate-500")}>
              {placeholder}
            </button>
            {filtered.map(function (o) {
              var isOn = multi ? vals.indexOf(o.value) !== -1 : o.value === value
              return (
                <button key={o.value} type="button" onClick={function () { toggle(o.value) }}
                  className={"w-full text-left px-3 py-2 rounded-lg text-sm truncate flex items-center gap-2.5 transition-colors " + (isOn ? "bg-[#EDEFF5] text-[#333D5E] font-semibold" : "text-slate-700 hover:bg-slate-50")}>
                  {multi && (
                    <span className={"shrink-0 w-4 h-4 rounded-[5px] border inline-flex items-center justify-center " + (isOn ? "bg-[#3B4668] border-[#3B4668] text-white" : "border-slate-300 bg-white")}>
                      {isOn && <Icon name="check" size={10} strokeWidth={3} />}
                    </span>
                  )}
                  <span className="truncate">{o.label}</span>
                </button>
              )
            })}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No matches</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// Every page of a table at once. fetchAll asks for 1,000 rows, waits, asks
// for the next 1,000, and so on — three items tables' worth of round trips in
// a row. This asks for the first page with a row count, then for all the rest
// together. makeQuery builds a fresh query each time: a Supabase query is
// mutated by .range(), so one builder cannot serve several pages at once.
async function fetchAllParallel(makeQuery, pageSize) {
  pageSize = pageSize || 1000
  var first = await makeQuery({ count: 'exact' }).range(0, pageSize - 1)
  if (first.error) throw first.error
  var rows = first.data || []
  var total = first.count == null ? rows.length : first.count
  if (rows.length < pageSize || total <= pageSize) return rows
  var pages = []
  for (var from = pageSize; from < total; from += pageSize) pages.push(from)
  var rest = await Promise.all(pages.map(function (f) { return makeQuery().range(f, f + pageSize - 1) }))
  rest.forEach(function (r) { if (r.error) throw r.error; rows = rows.concat(r.data || []) })
  return rows
}

// One of an item's dimension fields, by a pattern on its name — "Material"
// or "Materials", "Menu zone" or "Menu Zones" — as the Material and Menu zone
// filters read them. "Pieces" is the form's placeholder unit, never part of a
// value, so it is dropped.
function dimValueOf(item, re) {
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
var MATERIAL_RE = /materi/i
var MENU_ZONE_RE = /menu\s*zone/i

// The last load, kept for the life of the page. Coming back to All Items —
// from Production, Boxes, another section — shows it at once and refreshes
// behind it, instead of a blank "Loading" every time.
var adminItemsCache = null

function AdminItems({ profile, invSubDept, navNonce, onInvSubDeptChange }) {
  var canViewCosts = hasPerm(profile?.permsNew, 'finance.view_costs')
  var [items, setItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [statusFilter, setStatusFilter] = useState([])
  var [departments, setDepartments] = useState([])
  var venues = useReferenceData().venues.filter(function (v) { return v.active })
  var [venueFilter, setVenueFilter] = useState([])
  var [catFilter, setCatFilter] = useState([])
  var [subCatFilter, setSubCatFilter] = useState([])
  var [categories, setCategories] = useState([])
  var [subCategoriesAll, setSubCategoriesAll] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [subDeptFilter, setSubDeptFilter] = useState(invSubDept ? [String(invSubDept)] : [])
  var [masterDeptFilter, setMasterDeptFilter] = useState([])

  // The sidebar lists the master sub-departments under Inventory. A pick
  // there lands here as invSubDept (navNonce makes a second pick of the same
  // one count too) and replaces this filter, clearing the category filters
  // that hang off it the way the dropdown does. The other way, the sidebar is
  // told what is picked here.
  useEffect(function () {
    if (navNonce == null) return
    setSubDeptFilter(invSubDept ? [String(invSubDept)] : [])
    setCatFilter([]); setSubCatFilter([]); setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navNonce])
  useEffect(function () {
    if (!onInvSubDeptChange) return
    // One picked → that one; none → "All items"; several → neither, since no
    // single line in the sidebar says what is on screen.
    onInvSubDeptChange(subDeptFilter.length === 1 ? subDeptFilter[0] : (subDeptFilter.length === 0 ? '' : null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subDeptFilter])
  var [defaultApplied, setDefaultApplied] = useState(false)
  var [subVenues, setSubVenues] = useState([])
  var [subVenueFilter, setSubVenueFilter] = useState([])
  var [materialFilter, setMaterialFilter] = useState([])
  var [menuZoneFilter, setMenuZoneFilter] = useState([])
  var [enlargedImg, setEnlargedImg] = useState(null)
  // Hover preview: the whole photograph, large, in a panel beside the card —
  // outside it, so nothing of the card is covered and nothing of the picture
  // is cut. { url, rect } of the photo under the pointer; any scroll clears
  // it, since the rect it was placed from is stale the moment the page moves.
  var [hoverPreview, setHoverPreview] = useState(null)
  // Leaving the photo marks the panel closing and removes it once its exit
  // animation has run; coming back onto a photo in that window cancels it.
  var previewTimerRef = useRef(null)
  function openPreview(url, name, rect) {
    clearTimeout(previewTimerRef.current)
    setHoverPreview({ url: url, name: name, rect: rect, closing: false })
  }
  function closePreview(immediate) {
    clearTimeout(previewTimerRef.current)
    if (immediate) { setHoverPreview(null); return }
    setHoverPreview(function (p) { return p ? Object.assign({}, p, { closing: true }) : p })
    previewTimerRef.current = setTimeout(function () { setHoverPreview(null) }, 180)
  }
  useEffect(function () { return function () { clearTimeout(previewTimerRef.current) } }, [])

  // Hover intent. Scrolling slides photos under a pointer that never moved,
  // and the browser counts each one as the pointer entering it — so the
  // preview opened on photo after photo down the page. Two guards:
  //   · the pointer has to rest on a photo for a moment before it opens;
  //   · nothing opens while the page is scrolling, or for a beat after.
  // After a scroll, moving the pointer on the photo it stopped over is what
  // brings the preview back (mousemove re-arms it; mouseenter alone is not
  // trusted).
  var HOVER_DELAY = 320
  var SCROLL_QUIET = 250
  var intentTimerRef = useRef(null)
  var scrollingRef = useRef(false)
  var scrollQuietRef = useRef(null)
  useEffect(function () {
    function onScroll() {
      scrollingRef.current = true
      clearTimeout(intentTimerRef.current)
      intentTimerRef.current = null
      closePreview(true)
      clearTimeout(scrollQuietRef.current)
      scrollQuietRef.current = setTimeout(function () { scrollingRef.current = false }, SCROLL_QUIET)
    }
    window.addEventListener('scroll', onScroll, true)
    return function () {
      window.removeEventListener('scroll', onScroll, true)
      clearTimeout(scrollQuietRef.current)
      clearTimeout(intentTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function armPreview(el, url, name) {
    if (scrollingRef.current || intentTimerRef.current) return
    intentTimerRef.current = setTimeout(function () {
      intentTimerRef.current = null
      if (scrollingRef.current || !el.isConnected || !el.matches(':hover')) return
      openPreview(url, name, el.getBoundingClientRect())
    }, HOVER_DELAY)
  }
  function disarmPreview() {
    clearTimeout(intentTimerRef.current)
    intentTimerRef.current = null
    closePreview(false)
  }
  var [editItem, setEditItem] = useState(null)
  // The item a delete is being confirmed for (the whole row, so the dialog
  // can show what it is), and whether the delete is running.
  var [deleteConfirm, setDeleteConfirm] = useState(null)
  var [deleting, setDeleting] = useState(false)
  var [holdItem, setHoldItem] = useState(null)
  // The item whose stock breakdown is open.
  var [stockItem, setStockItem] = useState(null)
  // Every item's batches (qty and rate, oldest first), keyed
  // "source|item id", for the Stock value on the cards.
  var [batchesByItem, setBatchesByItem] = useState({})
  var [holds, setHolds] = useState([])
  var [holdForm, setHoldForm] = useState({ hold_from: '', hold_to: '', qty: 1, reason: '' })
  var [holdSaving, setHoldSaving] = useState(false)
  var [page, setPage] = useState(1)
  var [perPage, setPerPage] = useState(48)
  // The Filters panel holds the finer filters — sub-category and sub-venue —
  // that used to appear in the toolbar row once a category or venue was set.
  var [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  var searchRef = useRef(null)
  // "/" jumps to the search from anywhere on the page, unless you are already
  // typing in a field.
  useEffect(function () {
    function onKey(e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      var el = document.activeElement
      var tag = el && el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return
      if (!searchRef.current) return
      e.preventDefault()
      searchRef.current.focus()
    }
    window.addEventListener('keydown', onKey)
    return function () { window.removeEventListener('keydown', onKey) }
  }, [])
  var [sortKey, setSortKey] = useState(null)
  var [sortDir, setSortDir] = useState('asc')
  var [importModal, setImportModal] = useState(null) // { rows, header, file }
  var [importMode, setImportMode] = useState('add') // 'add' or 'update'
  var [importProgress, setImportProgress] = useState(null) // { done, total, skipped }
  var [importing, setImporting] = useState(false)
  var [exportModal, setExportModal] = useState(false)
  var [toolsModal, setToolsModal] = useState(false)
  var [bulkImgModal, setBulkImgModal] = useState(null) // { file, matched, unmatched, duplicates, replacing, total }
  var [bulkImgProgress, setBulkImgProgress] = useState(null) // { done, failed, total, failedRows }
  var [bulkImgProcessing, setBulkImgProcessing] = useState(false)

  useEffect(function () {
    if (adminItemsCache) applyData(adminItemsCache)
    loadData()
  }, [])

  // The batches behind each card's Stock value. Loaded after the items so a
  // missing table (migration 00066 not applied) cannot hold the list up.
  async function loadBatchValues() {
    try {
      var rows = await fetchAllParallel(function (opts) {
        return supabase.from('stock_batches').select('item_id, item_source, qty, rate_paise, created_at', opts)
          .order('created_at', { ascending: true }).order('id', { ascending: true })
      })
      var map = {}
      rows.forEach(function (b) {
        var k = b.item_source + '|' + b.item_id
        if (!map[k]) map[k] = []
        map[k].push(b)
      })
      setBatchesByItem(map)
    } catch (_) {}
  }

  function applyData(d) {
    setItems(d.items)
    setDepartments(d.departments)
    if (!defaultApplied) {
      var defDept = d.departments.find(function (x) { return x.is_inventory_default })
      if (defDept) setMasterDeptFilter([String(defDept.id)])
      setDefaultApplied(true)
    }
    setCategories(d.categories)
    setSubCategoriesAll(d.subCategories)
    setSubDepartments(d.subDepartments)
    setSubVenues(d.subVenues)
    setLoading(false)
  }

  async function loadData() {
    try {
      var INV_COLS = 'id, name, name_hindi, inventory_id, qty, blocked, unit, type, status, department, category_id, sub_category_id, rate_paise, min_order_qty, reorder_qty, is_asset, image_path, submitted_by, entry_date, description, dimensions, categories(name, sub_department_id), sub_categories(name), venue_allocations(qty, venues(code, name), sub_venue_id, sub_department_id)'
      var CS_COLS = 'id, name, name_hindi, inventory_id, qty, unit, type, status, department, category_id, sub_category_id, rate_paise, is_asset, image_path, submitted_by, entry_date, description, dimensions, brand, pack_size_qty, pack_size_unit, season_reorder_qty, off_season_reorder_qty, categories(name, sub_department_id), sub_categories(name), cs_venue_allocations(qty, venues(code, name), sub_venue_id, sub_department_id)'
      // Ordered by id as well as created_at, so rows sharing a timestamp
      // cannot shift between pages fetched side by side.
      var [invAll, csAll, deptRes, profilesRes, catRes, subCatRes, subDeptRes, subVenueRes] = await Promise.all([
        fetchAllParallel(function (opts) {
          return supabase.from('inventory_items').select(INV_COLS, opts).order('created_at', { ascending: false }).order('id', { ascending: false })
        }),
        fetchAllParallel(function (opts) {
          return supabase.from('catering_store_items').select(CS_COLS, opts).order('created_at', { ascending: false }).order('id', { ascending: false })
        }),
        supabase.from('departments').select('id, name, category_ids, is_inventory_default').eq('active', true).order('name'),
        supabase.from('profiles').select('id, name, email'),
        supabase.from('categories').select('id, name, sub_department_id, dimension_fields').order('name'),
        supabase.from('sub_categories').select('id, name, category_id').order('name'),
        supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name'),
        supabase.from('sub_venues').select('id, name, venue_id').eq('active', true).order('name'),
      ])
      var profileMap = {}
      ;(profilesRes.data || []).forEach(function (p) { profileMap[p.id] = p })
      var invItems = (invAll || []).map(function (item) {
        return Object.assign({}, item, { _source: 'inventory', profiles: profileMap[item.submitted_by] || null })
      })
      var csItems = (csAll || []).map(function (item) {
        return Object.assign({}, item, {
          _source: 'catering_store',
          blocked: 0,
          venue_allocations: item.cs_venue_allocations || [],
          profiles: profileMap[item.submitted_by] || null,
        })
      })
      var data = {
        items: invItems.concat(csItems).sort(function (a, b) {
          return new Date(b.entry_date || 0) - new Date(a.entry_date || 0)
        }),
        departments: deptRes.data || [],
        categories: catRes.data || [],
        subCategories: subCatRes.data || [],
        subDepartments: subDeptRes.data || [],
        subVenues: subVenueRes.data || [],
      }
      adminItemsCache = data
      loadBatchValues()
      applyData(data)
    } catch (err) {
      alert('Failed to load items: ' + (err.message || 'Unknown error'))
      setLoading(false)
    }
  }

  function resetFilters() {
    // masterDeptFilter is deliberately left alone — it's no longer a user-facing
    // filter, just the locked inventory-default department scope for this screen.
    setSearch(''); setStatusFilter([]); setSubDeptFilter([])
    setCatFilter([]); setSubCatFilter([]); setVenueFilter([]); setSubVenueFilter([])
    setMaterialFilter([]); setMenuZoneFilter([])
    setPage(1)
  }

  function formatDimensionsCsv(dims) {
    if (!Array.isArray(dims) || dims.length === 0) return ''
    var parts = []
    dims.forEach(function (d) {
      if (!d || !d.name) return
      var t = d.type || 'number'
      var val = ''
      var unit = ''
      if (t === 'number') {
        val = d.qty != null ? String(d.qty).trim() : ''
        unit = d.unit ? String(d.unit).trim() : ''
        if (unit.toLowerCase() === 'pieces') unit = ''
      } else {
        val = d.value != null ? String(d.value).trim() : ''
      }
      if (!val || val.toLowerCase() === 'pieces') return
      parts.push(d.name + ': ' + val + (unit ? ' ' + unit : ''))
    })
    return parts.join('; ')
  }

  function csvEscape(val) {
    var s = String(val == null ? '' : val)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }

  function exportItems() {
    var headers = ['ID', 'Inventory ID', 'Name', 'Name Hindi', 'Category', 'Sub-category', 'Type', 'Qty', 'Unit', 'Department', 'Description', 'Status', 'Source', 'Brand', 'Pack Size Qty', 'Pack Size Unit', 'Min Order / Season Reorder', 'Reorder / Off Season Reorder']
    if (canViewCosts) headers.push('Rate (₹)')
    headers = headers.concat(['Is Asset', 'Dimensions', 'Venue Code', 'Sub-Venue', 'Venue Qty', 'Image URL', 'Date Added'])
    var rows = sorted.map(function (i) {
      var allocs = i.venue_allocations || []
      if (venueFilter.length > 0) {
        allocs = allocs.filter(function (va) { return va.venues && venueFilter.indexOf(va.venues.code) !== -1 })
      }
      if (subVenueFilter.length > 0) {
        allocs = allocs.filter(function (va) { return subVenueFilter.indexOf(String(va.sub_venue_id || '')) !== -1 })
      }
      var venueCodes = allocs.map(function (va) { return va.venues?.code || '' }).join('; ')
      var venueSubVenues = allocs.map(function (va) { var sv = subVenues.find(function (s) { return s.id === va.sub_venue_id }); return sv?.name || '' }).join('; ')
      var venueQtys = allocs.map(function (va) { return va.qty }).join('; ')
      var imgUrl = i.image_path ? supabase.storage.from('images').getPublicUrl(i.image_path).data?.publicUrl || '' : ''
      var row = [
        i.id, i.inventory_id || '', i.name, i.name_hindi || '',
        i.categories?.name || '', i.sub_categories?.name || '',
        i.type || '', venueFilter.length > 0 ? allocs.reduce(function (sum, va) { return sum + (va.qty || 0) }, 0) : i.qty, i.unit || '', i.department || '',
        i.description || '', i.status, i._source || 'inventory',
        i.brand || '', i.pack_size_qty || '', i.pack_size_unit || '',
        i.season_reorder_qty || i.min_order_qty || '',
        i.off_season_reorder_qty || i.reorder_qty || '',
      ]
      if (canViewCosts) row.push(i.rate_paise ? (i.rate_paise / 100) : '')
      row.push(i.is_asset || '', formatDimensionsCsv(i.dimensions), venueCodes, venueSubVenues, venueQtys, imgUrl, i.entry_date || (i.created_at ? i.created_at.split('T')[0] : ''))
      return row.map(csvEscape).join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ambria_inventory_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }

  function exportPdf() {
    function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
    var filterParts = []
    if (search && search.trim()) filterParts.push({ label: 'Search', value: search.trim() })
    if (masterDeptFilter.length) filterParts.push({ label: 'Master Dept', value: masterDeptFilter.map(function (id) { var d = departments.find(function (x) { return String(x.id) === id }); return d ? d.name : id }).join(', ') })
    if (subDeptFilter.length) filterParts.push({ label: 'Master Sub-dept', value: subDeptFilter.map(function (id) { var sd = subDepartments.find(function (x) { return String(x.id) === id }); return sd ? sd.name : id }).join(', ') })
    if (statusFilter.length) filterParts.push({ label: 'Status', value: statusFilter.join(', ') })
    if (catFilter.length) filterParts.push({ label: 'Category', value: catFilter.map(function (cid) { var c = categories.find(function (x) { return String(x.id) === cid }); return c ? c.name : cid }).join(', ') })
    if (subCatFilter.length) filterParts.push({ label: 'Sub-category', value: subCatFilter.map(function (scid) { var sc = subCategoriesAll.find(function (x) { return String(x.id) === scid }); return sc ? sc.name : scid }).join(', ') })
    if (venueFilter.length) filterParts.push({ label: 'Venue', value: venueFilter.join(', ') })
    if (subVenueFilter.length) filterParts.push({ label: 'Sub-venue', value: subVenueFilter.map(function (svid) { var sv = subVenues.find(function (x) { return String(x.id) === svid }); return sv ? sv.name : svid }).join(', ') })
    var rows = sorted.map(function (item, idx) {
      var allocs = item.venue_allocations || []
      if (venueFilter.length > 0) allocs = allocs.filter(function (va) { return va.venues && venueFilter.indexOf(va.venues.code) !== -1 })
      if (subVenueFilter.length > 0) allocs = allocs.filter(function (va) { return subVenueFilter.indexOf(String(va.sub_venue_id || '')) !== -1 })
      var subDeptMap = {}
      allocs.forEach(function (va) {
        var sdKey = va.sub_department_id || 'null'
        if (!subDeptMap[sdKey]) {
          var sd = subDepartments.find(function (x) { return x.id === va.sub_department_id })
          subDeptMap[sdKey] = { name: sd ? sd.name : (item.department || '—'), total: 0, venues: [] }
        }
        subDeptMap[sdKey].total += (va.qty || 0)
        var svName = va.sub_venue_id ? (subVenues.find(function (sv) { return sv.id === va.sub_venue_id }) || {}).name : null
        subDeptMap[sdKey].venues.push({ code: (va.venues?.code || '') + (svName ? ':' + svName : ''), qty: va.qty || 0 })
      })
      var subDeptBlocks = Object.keys(subDeptMap).map(function (k) { return subDeptMap[k] })
      var totalQty = venueFilter.length > 0 ? allocs.reduce(function (s, va) { return s + (va.qty || 0) }, 0) : item.qty
      var imgUrl = getImageUrl(item.image_path)
      return { idx: idx + 1, invId: item.inventory_id || '', name: item.name, hindi: item.name_hindi || '', cat: item.categories?.name || '', subCat: item.sub_categories?.name || '', subDeptBlocks: subDeptBlocks, qty: totalQty, unit: item.unit || '', remarks: item.description || '', img: imgUrl || '' }
    })
    var w = window.open('', '_blank')
    if (!w) { alert('Pop-up blocked. Allow pop-ups for this site.'); return }
    var css = 'body{font-family:sans-serif;margin:20px;color:#333}' +
      'h1{font-size:22px;margin:0 0 4px;font-weight:800}' +
      '.filters{font-size:11px;color:#888;margin-bottom:6px}' +
      'table{border-collapse:collapse;width:100%;font-size:12px}' +
      'th{background:#fff;color:#666;padding:10px 8px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #ddd}' +
      'td{padding:10px 8px;vertical-align:middle}' +
      '.item-row td{border-top:1px solid #e5e7eb}' +
      '.remarks-row td{padding:2px 8px 12px;font-size:11px;color:#555;border-bottom:1px solid #e5e7eb}' +
      '.remarks-lbl{font-weight:700;color:#888;letter-spacing:0.5px;margin-right:6px}' +
      '.hindi{font-size:11px;color:#888;margin-top:2px}' +
      '.subcat{font-size:11px;color:#888;margin-top:2px}' +
      '.qty-big{font-size:22px;font-weight:700;color:#111}' +
      '.unit{font-size:12px;color:#666}' +
      '.name-big{font-size:14px;font-weight:700;color:#111}' +
      '.cat-name{font-size:13px;font-weight:600;color:#111}' +
      '.sd-block{margin-bottom:8px}' +
      '.sd-block:last-child{margin-bottom:0}' +
      '.sd-name{font-size:13px;font-weight:700;color:#111;margin-right:8px}' +
      '.sd-total{display:inline-block;background:#065f46;color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;vertical-align:middle}' +
      '.venues{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}' +
      '.venue{font-size:11px;color:#4338ca;background:#eef2ff;padding:2px 8px;border-radius:6px;font-weight:600}' +
      '.img{width:170px;height:170px;object-fit:cover;border-radius:8px;border:1px solid #ddd}' +
      '.no-img{width:170px;height:170px;background:#f3f4f6;border-radius:8px;display:inline-block}' +
      '.inv-id{font-family:monospace;font-size:12px}' +
      '.num{font-size:14px;color:#888;font-weight:600}' +
      '.filter-box{margin:8px 0 12px;padding:8px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px}' +
      '.filter-title{font-size:10px;font-weight:700;color:#888;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px}' +
      '.filter-chips{display:flex;flex-wrap:wrap;gap:6px}' +
      '.filter-chip{display:inline-flex;align-items:baseline;gap:4px;font-size:11px;background:#fff;border:1px solid #d1d5db;border-radius:12px;padding:2px 10px}' +
      '.filter-chip .k{font-weight:700;color:#4338ca}' +
      '.filter-chip .v{color:#111}' +
      '@media print{body{margin:10px}@page{size:A4 landscape;margin:8mm}.item-row,.remarks-row{page-break-inside:avoid}.item-row{page-break-after:avoid}.remarks-row{page-break-before:avoid}}'
    var html = '<!DOCTYPE html><html><head><title>Ambria Inventory</title><style>' + css + '</style></head><body>'
    html += '<h1>Ambria Inventory</h1>'
    html += '<div class="filters">' + filtered.length + ' items | Exported ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + '</div>'
    if (filterParts.length) {
      var chips = filterParts.map(function (f) { return '<span class="filter-chip"><span class="k">' + escHtml(f.label) + ':</span><span class="v">' + escHtml(f.value) + '</span></span>' }).join('')
      html += '<div class="filter-box"><div class="filter-title">Applied Filters</div><div class="filter-chips">' + chips + '</div></div>'
    }
    html += '<table><thead><tr>' +
      '<th style="width:36px">#</th>' +
      '<th style="width:190px">Photo</th>' +
      '<th style="width:90px">Inv ID</th>' +
      '<th>Item Name</th>' +
      '<th>Category</th>' +
      '<th>Sub-Department &amp; Venues</th>' +
      '<th style="width:60px">Qty</th>' +
      '<th style="width:60px">Unit</th>' +
      '</tr></thead><tbody>'
    rows.forEach(function (r) {
      var imgHtml = r.img ? '<img class="img" src="' + r.img + '" loading="lazy" />' : '<span class="no-img"></span>'
      var sdHtml = r.subDeptBlocks.length ? r.subDeptBlocks.map(function (sd) {
        var venueChips = sd.venues.map(function (v) { return '<span class="venue">' + escHtml(v.code) + ':' + v.qty + '</span>' }).join('')
        return '<div class="sd-block"><span class="sd-name">' + escHtml(sd.name || '—') + '</span><span class="sd-total">' + sd.total + '</span>' + (venueChips ? '<div class="venues">' + venueChips + '</div>' : '') + '</div>'
      }).join('') : '<span style="color:#999">—</span>'
      html += '<tr class="item-row">' +
        '<td class="num">' + r.idx + '</td>' +
        '<td>' + imgHtml + '</td>' +
        '<td class="inv-id">' + escHtml(r.invId) + '</td>' +
        '<td><div class="name-big">' + escHtml(r.name) + '</div>' + (r.hindi ? '<div class="hindi">' + escHtml(r.hindi) + '</div>' : '') + '</td>' +
        '<td><div class="cat-name">' + escHtml(r.cat) + '</div>' + (r.subCat ? '<div class="subcat">' + escHtml(r.subCat) + '</div>' : '') + '</td>' +
        '<td>' + sdHtml + '</td>' +
        '<td class="qty-big">' + r.qty + '</td>' +
        '<td class="unit">' + escHtml(r.unit) + '</td>' +
        '</tr>'
      if (r.remarks) {
        html += '<tr class="remarks-row"><td></td><td colspan="7"><span class="remarks-lbl">REMARKS:</span>' + escHtml(r.remarks) + '</td></tr>'
      }
    })
    html += '</tbody></table></body></html>'
    w.document.write(html)
    w.document.close()
    setTimeout(function () { w.print() }, 1500)
  }

  function downloadTemplate() {
    var headers = ['Name', 'Name Hindi', 'Category', 'Sub-category', 'Type', 'Qty', 'Unit', 'Department', 'Description', 'Brand', 'Pack Size Qty', 'Pack Size Unit', 'Min Order Qty', 'Reorder Qty', 'Rate (₹)', 'Is Asset', 'Dimensions', 'Venue Code', 'Sub-Venue', 'Venue Qty']
    var example = ['Table Top White', 'टेबल टॉप सफेद', 'Cloths', 'Table Top', 'Indoor', '50', 'Pieces', 'Decor', 'White crushed cloth', '', '', '', '10', '15', '500', 'yes', 'Length:10 Feet; Width:6 Feet', 'PHD', 'Main Hall', '50']
    var csv = '\uFEFF' + headers.join(',') + '\n' + example.map(csvEscape).join(',')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ambria_import_template.csv'; a.click()
  } 
  async function deleteItem(item) {
    if (deleting) return
    setDeleting(true)
    var allocTable = item._source === 'catering_store' ? 'cs_venue_allocations' : 'venue_allocations'
    var itemTable = item._source === 'catering_store' ? 'catering_store_items' : 'inventory_items'
    await supabase.from(allocTable).delete().eq('item_id', item.id)
    if (item.image_path) {
      await supabase.storage.from('images').remove([item.image_path])
    }
    var { error: delErr } = await supabase.from(itemTable).delete().eq('id', item.id)
    if (delErr) { setDeleting(false); alert('Delete failed: ' + delErr.message); return }
    try { await supabase.from('stock_batches').delete().eq('item_id', item.id).eq('item_source', item._source === 'catering_store' ? 'catering_store' : 'inventory') } catch (_) {}
    try { await logActivity('ITEM_DELETE', item.name + ' | ID: ' + (item.inventory_id || item.id)) } catch (_) {}
    setDeleting(false)
    setDeleteConfirm(null)
    loadData()
  }

  function parseCsvLine(line) {
    var result = []; var current = ''; var inQuotes = false
    for (var i = 0; i < line.length; i++) {
      var ch = line[i]
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
        else if (ch === '"') { inQuotes = false }
        else { current += ch }
      } else {
        if (ch === '"') { inQuotes = true }
        else if (ch === ',') { result.push(current.trim()); current = '' }
        else { current += ch }
      }
    }
    result.push(current.trim())
    return result
  }

  function parseImportFile(e) {
    var file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    var reader = new FileReader()
    reader.onload = function (ev) {
      var text = ev.target.result
      var lines = text.split('\n').filter(function (l) { return l.trim() })
      if (lines.length < 2) { alert('CSV must have header + at least 1 data row'); return }
      var header = parseCsvLine(lines[0]).map(function (h) { return h.replace(/^\uFEFF/, '').trim().toLowerCase() })
      var nameIdx = header.findIndex(function (h) { return h === 'name' })
      if (nameIdx === -1) { alert('CSV must have a "Name" column'); return }
      var rows = []
      for (var r = 1; r < lines.length; r++) {
        var cols = parseCsvLine(lines[r])
        if (!cols[nameIdx]?.trim()) continue
        var row = {}
        header.forEach(function (h, i) { row[h] = (cols[i] || '').trim() })
        rows.push(row)
      }
      if (rows.length === 0) { alert('No valid data rows found'); return }
      var hasIdCol = header.indexOf('id') !== -1
      setImportModal({ rows: rows, header: header, fileName: file.name, hasId: hasIdCol })
      setImportMode('add')
      setImportProgress(null)
    }
    reader.readAsText(file, 'UTF-8')
  }

  function findCol(row, keys) {
    for (var k = 0; k < keys.length; k++) { if (row[keys[k]] != null && row[keys[k]] !== '') return row[keys[k]] }
    return ''
  }

  // ─── BULK IMAGE IMPORT ─────────────────────────────────────
  async function parseBulkImageZip(e) {
    var file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size > 500 * 1024 * 1024) { alert('ZIP too large (max 500MB)'); return }
    try {
      var mod = await import('jszip')
      var JSZip = mod.default || mod
      var zip = await JSZip.loadAsync(file)
      var entries = []
      zip.forEach(function (relPath, entry) {
        if (entry.dir) return
        if (relPath.indexOf('__MACOSX') !== -1) return
        var basename = relPath.split('/').pop()
        if (!basename || basename.charAt(0) === '.') return
        var m = basename.match(/^(.+?)\.(jpe?g|png|webp|gif)$/i)
        if (!m) return
        entries.push({ invId: m[1].trim(), ext: m[2].toLowerCase(), entry: entry, basename: basename })
      })
      if (entries.length === 0) { alert('No image files found in ZIP (jpg/jpeg/png/webp/gif).'); return }

      var invMap = {}
      items.forEach(function (it) {
        if (it.inventory_id) invMap[String(it.inventory_id).toLowerCase()] = it
      })

      var matched = []; var unmatched = []; var seen = {}
      entries.forEach(function (en) {
        var key = en.invId.toLowerCase()
        if (seen[key]) { seen[key].push(en.basename); return }
        seen[key] = [en.basename]
        var it = invMap[key]
        if (it) matched.push(Object.assign({}, en, { item: it }))
        else unmatched.push(en)
      })
      var duplicates = Object.keys(seen).filter(function (k) { return seen[k].length > 1 }).map(function (k) { return { key: k, files: seen[k] } })
      var replacing = matched.filter(function (m) { return m.item.image_path }).length

      setBulkImgModal({ file: file, matched: matched, unmatched: unmatched, duplicates: duplicates, replacing: replacing, total: entries.length })
      setBulkImgProgress(null)
    } catch (err) {
      alert('Failed to read ZIP: ' + (err?.message || err))
    }
  }

  async function runBulkImageImport() {
    if (!bulkImgModal || bulkImgProcessing) return
    setBulkImgProcessing(true)
    var matched = bulkImgModal.matched
    var done = 0; var failed = 0; var failedRows = []
    var CHUNK = 4
    for (var i = 0; i < matched.length; i += CHUNK) {
      var batch = matched.slice(i, i + CHUNK)
      var results = await Promise.all(batch.map(async function (m) {
        try {
          var rawBlob = await m.entry.async('blob')
          var rawFile = new File([rawBlob], m.basename, { type: 'image/jpeg' })
          var compressed = await prepUpload(rawFile, 100)
          var prefix = m.item._source === 'catering_store' ? 'catering' : 'inventory'
          var tableName = m.item._source === 'catering_store' ? 'catering_store_items' : 'inventory_items'
          var path = prefix + '/' + m.item.id + '_' + Date.now() + '.jpg'
          var { error: upErr } = await supabase.storage.from('images').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' })
          if (upErr) throw upErr
          var oldPath = m.item.image_path
          var { error: updErr } = await supabase.from(tableName).update({ image_path: path }).eq('id', m.item.id)
          if (updErr) throw updErr
          if (oldPath && oldPath !== path) { try { await supabase.storage.from('images').remove([oldPath]) } catch (_) {} }
          return { ok: true }
        } catch (err) {
          return { ok: false, invId: m.invId, basename: m.basename, reason: err?.message || 'Upload/update failed' }
        }
      }))
      results.forEach(function (r) { if (r.ok) done++; else { failed++; failedRows.push(r) } })
      setBulkImgProgress({ done: done, failed: failed, total: matched.length, failedRows: failedRows })
    }
    try { await logActivity('IMAGE_BULK_IMPORT', done + ' updated | ' + failed + ' failed | ' + bulkImgModal.unmatched.length + ' unmatched') } catch (_) {}
    setBulkImgProcessing(false)
    loadData()
  }

  async function runImport() {
    if (!importModal || importing) return
    if (importMode === 'update' && !importModal.hasId) { alert('Update mode requires an "id" column in your CSV. Use Export to get a CSV with IDs.'); return }
    setImporting(true)
    var rows = importModal.rows
    var done = 0; var skipped = 0; var skippedRows = []
    var CHUNK = 50
    for (var c = 0; c < rows.length; c++) {
      try {
        var result = await processImportRow(rows[c])
        if (result === true) done++; else { skipped++; skippedRows.push({ row: c + 1, reason: typeof result === 'string' ? result : 'Processing failed', cat: findCol(rows[c], ['category']) || '—', id: findCol(rows[c], ['id', 'inventory id', 'inventory_id']) || '—', name: findCol(rows[c], ['name']) || '—' }) }
      } catch (err) { skipped++; skippedRows.push({ row: c + 1, reason: err?.message || 'Unexpected error', cat: findCol(rows[c], ['category']) || '—', id: findCol(rows[c], ['id', 'inventory id', 'inventory_id']) || '—', name: findCol(rows[c], ['name']) || '—' }) }
      if ((c + 1) % 20 === 0 || c === rows.length - 1) {
        setImportProgress({ done: done, total: rows.length, skipped: skipped, skippedRows: skippedRows })
      }
    }

    try { await logActivity('IMPORT_CSV', importMode.toUpperCase() + ' | ' + done + ' processed, ' + skipped + ' skipped') } catch (_) {}
    setImporting(false)
    loadData()
  }

  async function processImportRow(r) {
    var itemName = findCol(r, ['name']).trim()
    if (!itemName) return false

    var catName = findCol(r, ['category'])
    var subCatName = findCol(r, ['sub-category', 'sub_category', 'subcategory'])
    var brand = findCol(r, ['brand'])
    var packQty = findCol(r, ['pack size qty', 'pack_size_qty'])
    var packUnit = findCol(r, ['pack size unit', 'pack_size_unit'])

    var cat = catName ? categories.find(function (c2) { return c2.name.toLowerCase() === catName.toLowerCase() }) : null
    var catId = cat?.id || null
    var subCat = subCatName ? subCategoriesAll.find(function (sc) { return sc.name.toLowerCase() === subCatName.toLowerCase() && (!catId || sc.category_id === catId) }) : null
    var subCatId = subCat?.id || null

    if (catName && !cat) return 'Category "' + catName + '" not found in masters'
    if (subCatName && !subCat) return 'Sub-category "' + subCatName + '" not found' + (catName ? ' under "' + catName + '"' : '')

    var isCatStore = false
    if (catId) {
      var catRow = categories.find(function (c2) { return c2.id === catId })
      var csSubDept = subDepartments.find(function (sd) { return sd.name === 'Catering Store' })
      if (catRow && csSubDept && catRow.sub_department_id === csSubDept.id) isCatStore = true
    }
    var tableName = isCatStore ? 'catering_store_items' : 'inventory_items'
    var allocTable = isCatStore ? 'cs_venue_allocations' : 'venue_allocations'

    var existing = null
    var invIdVal = findCol(r, ['inventory id', 'inventory_id']).trim()
    var sourceVal = findCol(r, ['source']).trim().toLowerCase()
    var rowId = findCol(r, ['id']).toString().trim()

    // Explicit Source column takes precedence over category-based inference.
    // Prevents id-collision writes to the wrong table (2026-07-30 incident root cause).
    if (sourceVal === 'catering_store' || sourceVal === 'cs' || sourceVal === 'catering store') {
      isCatStore = true; tableName = 'catering_store_items'; allocTable = 'cs_venue_allocations'
    } else if (sourceVal === 'inventory' || sourceVal === 'inventory_items' || sourceVal === 'main') {
      isCatStore = false; tableName = 'inventory_items'; allocTable = 'venue_allocations'
    }

    if (importMode === 'update') {
      // Primary match: inventory_id (globally unique via prefix e.g. CS-*, FLO-*, PRBR-*, GLWA-*).
      // Never falls back to numeric id without an explicit Source — id alone is ambiguous across tables.
      if (invIdVal) {
        var { data: invIdMatch } = await supabase.from(tableName).select('id, qty').eq('inventory_id', invIdVal).limit(1).maybeSingle()
        if (invIdMatch) {
          existing = invIdMatch
        } else {
          var otherTable = isCatStore ? 'inventory_items' : 'catering_store_items'
          var { data: wrongTableMatch } = await supabase.from(otherTable).select('id').eq('inventory_id', invIdVal).limit(1).maybeSingle()
          if (wrongTableMatch) return 'inventory_id "' + invIdVal + '" belongs to ' + otherTable + ', not ' + tableName + '. Fix Source column or use correct sheet.'
          return 'inventory_id "' + invIdVal + '" not found in ' + tableName
        }
      } else if (rowId) {
        if (!sourceVal) return 'Numeric id present but no inventory_id and no Source column. Add "inventory_id" (preferred) or a "Source" column (catering_store / inventory).'
        var { data: idMatch } = await supabase.from(tableName).select('id, qty').eq('id', Number(rowId)).limit(1).maybeSingle()
        if (idMatch) existing = idMatch
        else return 'id "' + rowId + '" not found in ' + tableName + ' (per Source)'
      } else {
        return 'Update mode requires "inventory_id" (recommended) or "id" + "Source" column'
      }
    } else {
      var matchQuery = supabase.from(tableName).select('id, qty').ilike('name', itemName.replace(/%/g, '\\%').replace(/_/g, '\\_'))
      if (catId) matchQuery = matchQuery.eq('category_id', catId)
      if (subCatId) matchQuery = matchQuery.eq('sub_category_id', subCatId)
      if (isCatStore && brand) matchQuery = matchQuery.eq('brand', brand)
      var { data: nameMatch } = await matchQuery.limit(1).maybeSingle()
      existing = nameMatch
    }

    var newQty = Number(findCol(r, ['qty', 'quantity'])) || 0
    var venueCode = findCol(r, ['venue code', 'venue_code', 'venue'])
    var subVenueName = findCol(r, ['sub-venue', 'sub_venue', 'subvenue'])
    var venueQty = Number(findCol(r, ['venue qty', 'venue_qty'])) || newQty

    if (venueCode) {
      var vcCheck = venueCode.split(';').map(function (v) { return v.trim() }).filter(Boolean)
      var svCheck = subVenueName ? subVenueName.split(';').map(function (s) { return s.trim() }) : []
      for (var vci = 0; vci < vcCheck.length; vci++) {
        var matchVen = venues.find(function (v) { return v.code.toLowerCase() === vcCheck[vci].toLowerCase() })
        if (!matchVen) return 'Venue code "' + vcCheck[vci] + '" not found in masters'
        if (svCheck[vci] && svCheck[vci] !== '') {
          var matchSv = subVenues.find(function (s) { return s.name.toLowerCase() === svCheck[vci].toLowerCase() && s.venue_id === matchVen.id })
          if (!matchSv) return 'Sub-venue "' + svCheck[vci] + '" not found under ' + vcCheck[vci]
        }
      }
    }

    var nameHindi = findCol(r, ['name hindi', 'name_hindi'])
    var unit = findCol(r, ['unit'])
    var dept = findCol(r, ['department', 'dept'])
    var type = findCol(r, ['type'])
    var desc = findCol(r, ['description'])
    var rate = findCol(r, ['rate', 'rate (₹)', 'rate_paise'])
    var isAsset = findCol(r, ['is asset', 'is_asset'])
    var dimStr = findCol(r, ['dimensions'])
    var parsedDims = null
    if (dimStr) { parsedDims = dimStr.split(';').map(function (s) { var parts = s.trim().split(':'); if (parts.length < 2) return null; var nv = parts[1].trim().split(' '); return { name: parts[0].trim(), qty: nv[0] || '', unit: nv.slice(1).join(' ') || 'Pieces' } }).filter(Boolean); if (parsedDims.length === 0) parsedDims = null }
    var minOrd = findCol(r, ['min order qty', 'min_order_qty', 'season reorder qty'])
    var reord = findCol(r, ['reorder qty', 'reorder_qty', 'off season reorder qty'])

    if (importMode === 'update') {
      if (!existing) return 'No matching item found (ID: ' + (rowId || 'none') + ')'
      var updatePayload = {}
      if (itemName) updatePayload.name = itemName
      if (nameHindi) updatePayload.name_hindi = nameHindi
      if (catId) updatePayload.category_id = catId
      if (subCatId) updatePayload.sub_category_id = subCatId
      if (unit) updatePayload.unit = unit
      if (dept) updatePayload.department = dept
      if (type) updatePayload.type = type
      if (desc) updatePayload.description = desc
      if (rate) updatePayload.rate_paise = Math.round(Number(rate) * 100)
      if (isAsset) updatePayload.is_asset = isAsset.toLowerCase()
      if (parsedDims) updatePayload.dimensions = parsedDims
      if (newQty > 0) updatePayload.qty = newQty
      if (isCatStore) {
        if (brand) updatePayload.brand = brand
        if (packQty) updatePayload.pack_size_qty = Number(packQty)
        if (packUnit) updatePayload.pack_size_unit = packUnit
        if (minOrd) updatePayload.season_reorder_qty = Number(minOrd)
        if (reord) updatePayload.off_season_reorder_qty = Number(reord)
      } else {
        if (minOrd) updatePayload.min_order_qty = Number(minOrd)
        if (reord) updatePayload.reorder_qty = Number(reord)
      }
      if (Object.keys(updatePayload).length > 0) {
        var { error: updErr } = await supabase.from(tableName).update(updatePayload).eq('id', existing.id)
        if (updErr) return 'DB update failed: ' + updErr.message
      }
      // Update venue allocations if provided
      if (venueCode) {
        var venueCodes = venueCode.split(';').map(function (v) { return v.trim() }).filter(Boolean)
        var venueQtyStr = findCol(r, ['venue qty', 'venue_qty'])
        var venueQtys = venueQtyStr ? venueQtyStr.split(';').map(function (q) { return Number(q.trim()) || 0 }) : []
        var subVenueNames = subVenueName ? subVenueName.split(';').map(function (s) { return s.trim() }) : []

        for (var vi = 0; vi < venueCodes.length; vi++) {
          var vCode = venueCodes[vi]
          var vQty = venueQtys[vi] || 0
          if (!vCode || !vQty) continue
          var venue = venues.find(function (v) { return v.code.toLowerCase() === vCode.toLowerCase() })
          if (!venue) continue
          var subVenueId = null
          if (subVenueNames[vi]) {
            var sv = subVenues.find(function (s) { return s.name.toLowerCase() === subVenueNames[vi].toLowerCase() && s.venue_id === venue.id })
            if (sv) subVenueId = sv.id
          }
          var { data: existAlloc } = await supabase.from(allocTable).select('id, qty').eq('item_id', existing.id).eq('venue_id', venue.id).limit(1).maybeSingle()
          var { data: allAllocs } = await supabase.from(allocTable).select('id, venue_id, qty').eq('item_id', existing.id)
          var otherAllocsTotal = (allAllocs || []).reduce(function (sum, a) {
            return sum + (existAlloc && a.id === existAlloc.id ? 0 : (a.qty || 0))
          }, 0)
          if (!updatePayload.qty) {
            var newTotal = otherAllocsTotal + vQty
            await supabase.from(tableName).update({ qty: newTotal }).eq('id', existing.id)
          }
          if (existAlloc) {
            await supabase.from(allocTable).update({ qty: vQty }).eq('id', existAlloc.id)
          } else {
            var allocPayload = { item_id: existing.id, venue_id: venue.id, qty: vQty }
            if (subVenueId) allocPayload.sub_venue_id = subVenueId
            await supabase.from(allocTable).insert(allocPayload)
          }
        }
      }
      return true
    }

    // ADD mode
    if (existing) {
      var { error: qtyErr } = await supabase.from(tableName).update({ qty: (existing.qty || 0) + newQty }).eq('id', existing.id)
      if (qtyErr) return 'Qty update failed: ' + qtyErr.message
      if (venueCode) {
        var venue = venues.find(function (v) { return v.code.toLowerCase() === venueCode.toLowerCase() })
        if (venue) {
          var { data: existAlloc } = await supabase.from(allocTable).select('id, qty').eq('item_id', existing.id).eq('venue_id', venue.id).limit(1).maybeSingle()
          var subVenueId = null
          if (subVenueName) {
            var sv = subVenues.find(function (s) { return s.name.toLowerCase() === subVenueName.toLowerCase() && s.venue_id === venue.id })
            if (sv) subVenueId = sv.id
          }
          if (existAlloc) {
            await supabase.from(allocTable).update({ qty: existAlloc.qty + venueQty }).eq('id', existAlloc.id)
          } else {
            var allocPayload = { item_id: existing.id, venue_id: venue.id, qty: venueQty }
            if (subVenueId) allocPayload.sub_venue_id = subVenueId
            await supabase.from(allocTable).insert(allocPayload)
          }
        }
      }
      return true
    }

    // Create new
    var payload = { name: itemName, status: 'approved', submitted_by: profile?.id || null, qty: newQty }
    if (catId) payload.category_id = catId
    if (subCatId) payload.sub_category_id = subCatId
    if (nameHindi) payload.name_hindi = nameHindi
    payload.unit = unit || 'Pieces'
    if (dept) payload.department = dept
    payload.type = type || 'Indoor'
    if (desc) payload.description = desc
    if (rate) payload.rate_paise = Math.round(Number(rate) * 100)
    if (isAsset) payload.is_asset = isAsset
    if (parsedDims) payload.dimensions = parsedDims
    if (isCatStore) {
      if (brand) payload.brand = brand
      if (packQty) payload.pack_size_qty = Number(packQty)
      if (packUnit) payload.pack_size_unit = packUnit
      if (minOrd) payload.season_reorder_qty = Number(minOrd)
      if (reord) payload.off_season_reorder_qty = Number(reord)
    } else {
      if (minOrd) payload.min_order_qty = Number(minOrd)
      if (reord) payload.reorder_qty = Number(reord)
    }
    if (!catId) return 'Category required for new items'
    var { data: newItem, error: insErr } = await supabase.from(tableName).insert(payload).select('id').single()
    if (insErr) return 'Insert failed: ' + insErr.message
    if (newItem && venueCode) {
      var venue = venues.find(function (v) { return v.code.toLowerCase() === venueCode.toLowerCase() })
      if (venue) {
        var allocPayload = { item_id: newItem.id, venue_id: venue.id, qty: venueQty }
        if (subVenueName) {
          var sv = subVenues.find(function (s) { return s.name.toLowerCase() === subVenueName.toLowerCase() && s.venue_id === venue.id })
          if (sv) allocPayload.sub_venue_id = sv.id
        }
        await supabase.from(allocTable).insert(allocPayload)
      }
    }
    return true
  }

  // Opens the stock breakdown (components/StockBreakdown) for an item.
  function openStock(item) { setStockItem(item) }

  async function openHolds(item) {
   setHoldItem(item)
   setHoldForm({ hold_from: '', hold_to: '', qty: 1, reason: '' })
   var { data } = await supabase
     .from('maintenance_holds')
     .select('id, hold_from, hold_to, qty, reason, created_at')
     .eq('item_id', item.id)
     .order('hold_from', { ascending: false })
   setHolds(data || [])
 }

 async function addHold() {
   if (!holdForm.hold_from || !holdForm.hold_to || !holdForm.qty) return
   setHoldSaving(true)
   await supabase.from('maintenance_holds').insert({
     item_id: holdItem.id,
     hold_from: holdForm.hold_from,
     hold_to: holdForm.hold_to,
     qty: Number(holdForm.qty),
     reason: holdForm.reason.trim(),
     created_by: profile?.id,
   })
   try { await logActivity('MAINTENANCE_HOLD', holdItem.name + ' | ' + holdForm.qty + '× | ' + holdForm.hold_from + ' to ' + holdForm.hold_to + (holdForm.reason ? ' | ' + holdForm.reason : '')) } catch (_) {}
   setHoldSaving(false)
   openHolds(holdItem)
 }

 async function removeHold(holdId) {
   await supabase.from('maintenance_holds').delete().eq('id', holdId)
   try { await logActivity('MAINTENANCE_RELEASE', holdItem.name + ' | Hold #' + holdId) } catch (_) {}
   openHolds(holdItem)
 }

  var filtered = useMemo(function () {
    var searchLower = search.toLowerCase()
    return items.filter(function (item) {
      var matchSearch = !search ||
        item.name.toLowerCase().includes(searchLower) ||
        (item.inventory_id || '').toLowerCase().includes(searchLower) ||
        (item.profiles?.name || '').toLowerCase().includes(searchLower) ||
        (item.profiles?.email || '').toLowerCase().includes(searchLower) ||
        (item.description || '').toLowerCase().includes(searchLower) ||
        (item.name_hindi || '').toLowerCase().includes(searchLower) ||
        (item.categories?.name || '').toLowerCase().includes(searchLower) ||
        (item.sub_categories?.name || '').toLowerCase().includes(searchLower) ||
        (item.department || '').toLowerCase().includes(searchLower) ||
        (item.brand || '').toLowerCase().includes(searchLower)
      var matchStatus = statusFilter.length === 0 || statusFilter.indexOf(item.status) !== -1
      var matchMasterDept = masterDeptFilter.length === 0 || (function () {
        var sdId = item.categories?.sub_department_id
        if (!sdId) return false
        var sd = subDepartments.find(function (x) { return x.id === sdId })
        return sd && masterDeptFilter.indexOf(String(sd.department_id)) !== -1
      })()
      var matchSubDept = subDeptFilter.length === 0 || (function () {
        var sdCatIds = categories.filter(function (c) { return subDeptFilter.indexOf(String(c.sub_department_id)) !== -1 }).map(function (c) { return c.id })
        return sdCatIds.indexOf(item.category_id) !== -1
      })()
      var matchVenue = venueFilter.length === 0 || (item.venue_allocations || []).some(function (va) { return venueFilter.indexOf(va.venues?.code) !== -1 })
      var matchSubVenue = subVenueFilter.length === 0 || (item.venue_allocations || []).some(function (va) { return subVenueFilter.indexOf(String(va.sub_venue_id)) !== -1 })
      var matchCat = catFilter.length === 0 || catFilter.indexOf(String(item.category_id)) !== -1
      var matchSubCat = subCatFilter.length === 0 || subCatFilter.indexOf(String(item.sub_category_id)) !== -1
      var matchMaterial = materialFilter.length === 0 || materialFilter.indexOf(dimValueOf(item, MATERIAL_RE).toLowerCase()) !== -1
      var matchMenuZone = menuZoneFilter.length === 0 || menuZoneFilter.indexOf(dimValueOf(item, MENU_ZONE_RE).toLowerCase()) !== -1
      return matchSearch && matchMasterDept && matchSubDept && matchStatus && matchVenue && matchCat && matchSubCat && matchSubVenue && matchMaterial && matchMenuZone
    })
  }, [items, search, statusFilter, masterDeptFilter, subDepartments, subDeptFilter, categories, venueFilter, subVenueFilter, catFilter, subCatFilter, materialFilter, menuZoneFilter])

  function handleSort(key) {
    if (sortKey === key) { setSortDir(sortDir === 'asc' ? 'desc' : 'asc') }
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  // The card's product details: the few of an item's dimension fields people
  // look an item up by — Material, Menu zone and Vendor name. (Colour, shape
  // and the vendor number are left off the card; they are still on the item.)
  // Dimensions are per-category fields set in Masters, stored on the item as
  // [{ name, value }] (or { qty, unit } for a measured one), so they are
  // matched by name, forgiving of plural and spelling, rather than by a fixed
  // key. Only fields with something in them are shown.
  var PRODUCT_DETAILS = [
    { label: 'Material', test: /materi/i },
    { label: 'Menu zone', test: /menu\s*zone/i },
    { label: 'Vendor name', test: /vendor\s*name/i },
    // The field is named just "Vendor" in Masters; "Vendor Number" is a
    // different field and stays off the card.
    { label: 'Vendor', test: /^\s*vendors?\s*$/i },
  ]
  var DETAIL_ORDER = ['Material', 'Menu zone', 'Vendor', 'Vendor name']
  function productDetails(item) {
    var dims = Array.isArray(item.dimensions) ? item.dimensions : []
    var found = {}
    dims.forEach(function (d) {
      if (!d || !d.name) return
      var spec = PRODUCT_DETAILS.find(function (p) { return p.test.test(d.name) })
      if (!spec || found[spec.label]) return
      // "Pieces" is the form's placeholder unit, not part of a value: older
      // rows saved a colour or a shape as qty + unit and came out as
      // "Silver Pieces". It is dropped wherever it trails a value.
      var unit = d.unit && String(d.unit).toLowerCase() !== 'pieces' ? d.unit : ''
      var v = d.value != null && String(d.value).trim() !== ''
        ? String(d.value).trim()
        : (d.qty != null && String(d.qty).trim() !== '' ? (d.qty + ' ' + unit).trim() : '')
      v = v.replace(/\s+pieces$/i, '').trim()
      if (v && v.toLowerCase() !== 'pieces') found[spec.label] = v
    })
    return DETAIL_ORDER.filter(function (l) { return found[l] }).map(function (l) { return { label: l, value: found[l] } })
  }

  function sortValue(item, key) {
    if (key === 'name') return (item.name || '').toLowerCase()
    if (key === 'category') return (item.categories?.name || '').toLowerCase()
    if (key === 'masterDept') {
      var sd = subDepartments.find(function (x) { return x.id === item.categories?.sub_department_id })
      var d = sd ? departments.find(function (x) { return x.id === sd.department_id }) : null
      return (d?.name || '').toLowerCase()
    }
    if (key === 'allocDept') return (item.department || '').toLowerCase()
    if (key === 'stock') return Number(item.qty) || 0
    if (key === 'unit') return (item.unit || '').toLowerCase()
    if (key === 'venues') return (item.venue_allocations || []).length
    if (key === 'by') return (item.profiles?.name || '').toLowerCase()
    if (key === 'date') return new Date(item.entry_date || item.created_at || 0).getTime()
    if (key === 'status') return (item.status || '').toLowerCase()
    return ''
  }

  var sorted = useMemo(function () {
    if (!sortKey) return filtered
    return filtered.slice().sort(function (a, b) {
      var va = sortValue(a, sortKey), vb = sortValue(b, sortKey)
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [filtered, sortKey, sortDir, subDepartments, departments])

  function sortArrow(key) { return sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }

  // While the first load is out: the toolbar's shape and a grid of card
  // outlines where the cards will be, so the page is laid out at once.
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading items">
        <div className="h-16 rounded-[20px] bg-white/70 border border-white/80 animate-pulse" />
        <div className="h-5 w-40 rounded-md bg-white/60 animate-pulse" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map(function (i) {
            return (
              <div key={i} className="rounded-2xl bg-white border border-slate-200/80 overflow-hidden">
                <div className="h-56 bg-slate-100 animate-pulse" />
                <div className="p-4 space-y-3">
                  <div className="h-5 w-2/3 rounded bg-slate-100 animate-pulse" />
                  <div className="h-4 w-1/3 rounded bg-slate-100 animate-pulse" />
                  <div className="h-14 rounded-xl bg-slate-50 animate-pulse" />
                  <div className="h-7 w-1/2 rounded-lg bg-slate-100 animate-pulse" />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Pieces of the item card ──
  function allocChips(item, extraCls) {
    // One chip per place, with the total there. An item can carry several
    // allocation rows for the same venue and sub-venue (one per department,
    // say), and they printed as separate chips — "AE 2" beside "AE 20" —
    // when what anyone wants to know is that 22 are at AE.
    var byPlace = {}
    var venueAllocs = []
    ;(item.venue_allocations || []).forEach(function (va) {
      var key = (va.venues?.code || '') + '|' + (va.sub_venue_id || '')
      if (!byPlace[key]) {
        byPlace[key] = { venues: va.venues, sub_venue_id: va.sub_venue_id, qty: 0 }
        venueAllocs.push(byPlace[key])
      }
      byPlace[key].qty += Number(va.qty) || 0
    })
    if (venueAllocs.length === 0) return null
    return (
      <div className={"flex flex-wrap gap-1.5 " + (extraCls || '')}>
        {/* Three parts, read left to right: the venue in a soft slate-navy
            block, the place inside it on white, and how many there in a
            tinted end — so where and how many are each one glance. */}
        {venueAllocs.map(function (va, vi) {
          var svName = va.sub_venue_id ? (subVenues.find(function (sv) { return sv.id === va.sub_venue_id }) || {}).name : null
          return (
            <span key={(va.venues?.code || '') + '-' + vi} title={(va.venues?.name || va.venues?.code || '') + (svName ? ' · ' + svName : '') + ' · ' + va.qty}
              className="inline-flex items-stretch h-7 rounded-lg overflow-hidden border border-[#D8DCE8] bg-white shadow-[0_1px_2px_rgba(59,70,104,0.08)]">
              <span className="inline-flex items-center gap-1 px-2 bg-[#EDEFF5] text-[#333D5E] text-[12px] font-extrabold tracking-[0.02em]">
                <Icon name="mapPin" size={12} className="shrink-0 text-[#8A93B0]" />
                {va.venues?.code}
              </span>
              {svName && (
                <span className="inline-flex items-center px-2.5 text-[12.5px] font-bold text-slate-700 whitespace-nowrap">{svName}</span>
              )}
              <span className="inline-flex items-center px-2.5 border-l border-[#E4E7F0] bg-white text-[13px] font-extrabold text-slate-800 tabular-nums">{va.qty}</span>
            </span>
          )
        })}
      </div>
    )
  }
  function submitterOf(item) {
    var name = item.profiles?.name || ''
    return (
      <div className="flex-1 min-w-[132px] flex items-center gap-2">
        <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-full bg-[#EDEFF5] text-[#333D5E] text-[13px] font-bold inline-flex items-center justify-center">
          {(name.trim()[0] || '?').toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-bold text-gray-900 truncate">{name || '—'}</span>
          <span className="block text-[12.5px] font-medium text-gray-600 whitespace-nowrap">{formatDate(item.entry_date || item.created_at)}</span>
        </span>
      </div>
    )
  }
  // Edit is what a card is opened for, so it is the one filled button;
  // Holds (neutral, darker on hover) and Delete (soft red) are square icon
  // buttons beside it — the
  // same height and corners, so the three read as one set. Delete turns solid
  // red on hover and still asks Yes / No before it does anything.
  // Total stock, left of Edit: how much is on hand and how much of it no
  // venue holds; opens the batch breakdown.
  function stockPillOf(item) {
    var onHand = Number(item.qty) || 0
    var placed = (item.venue_allocations || []).reduce(function (sum, va) { return sum + (Number(va.qty) || 0) }, 0)
    var rest = Math.round((onHand - placed) * 1000) / 1000
    return (
      <button type="button" onClick={function () { openStock(item) }} title="Stock breakdown"
        className={"inline-flex items-center gap-2.5 h-11 pl-1.5 pr-3.5 rounded-xl border text-left transition-colors " +
          (rest > 0 ? "border-amber-300 bg-amber-50 shadow-[0_2px_8px_-3px_rgba(217,119,6,0.35)] hover:bg-amber-100/70" : "border-slate-300 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08)] hover:border-[#8A93B0] hover:bg-[#F6F7FB]")}>
        <span aria-hidden="true" className={"shrink-0 w-8 h-8 rounded-lg inline-flex items-center justify-center text-white " + (rest > 0 ? "bg-amber-500" : "bg-[#3B4668]")}>
          <Icon name="box" size={16} />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[15.5px] font-extrabold text-slate-900 tabular-nums">{onHand} <span className="text-[12px] font-semibold text-slate-600">{item.unit || ''}</span></span>
          {rest > 0
            ? <span className="text-[11.5px] font-bold text-amber-800 tabular-nums">{rest} not allocated</span>
            : <span className="text-[11.5px] font-semibold text-slate-600">View breakdown</span>}
        </span>
      </button>
    )
  }
  function actionsOf(item) {
    return (
      <div className="shrink-0 ml-auto flex items-center gap-1.5">
        {stockPillOf(item)}
        <button type="button" onClick={function () { setEditItem(item) }}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#3B4668] text-white text-[13px] font-semibold shadow-[0_2px_8px_-2px_rgba(59,70,104,0.45)] hover:bg-[#2F3854] transition-colors">
          <Icon name="edit" size={14} />Edit
        </button>
        {item._source !== 'catering_store' && (
          <button type="button" onClick={function () { openHolds(item) }} aria-label="Holds" title="Holds"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.06)] hover:border-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-colors">
            <Icon name="lock" size={15} />
          </button>
        )}
        <button type="button" onClick={function () { setDeleteConfirm(item) }} aria-label="Delete" title="Delete"
          className="w-9 h-9 inline-flex items-center justify-center rounded-lg bg-red-50 border border-red-100 text-red-600 hover:bg-red-600 hover:border-red-600 hover:text-white transition-colors">
          <Icon name="trash" size={15} />
        </button>
      </div>
    )
  }
  // The product details the card is for — Material, Price, Menu
  // zone, Vendor name — as tiles of label over value in one tinted
  // box, two to a row, ruled apart by the box showing through a 1px gap. Only
  // the ones with something in them; an odd last tile takes the full width.
  // Nothing else goes in the box.
  function detailsBox(item) {
    var details = productDetails(item)
    // The price per unit, beside Material — only for those allowed to see
    // costs (the same permission the export's Rate column answers to).
    // Stock value: what the stock on hand is worth, each batch at its own
    // rate (quantity × the item's rate where it has no batches).
    if (canViewCosts) {
      var itemBatchList = batchesByItem[(item._source === 'catering_store' ? 'catering_store' : 'inventory') + '|' + item.id]
      var stockVal = itemBatchList && itemBatchList.length > 0
        ? stockValuePaise(itemBatchList, Number(item.qty) || 0, item.rate_paise)
        : Math.round((Number(item.qty) || 0) * (item.rate_paise || 0))
      if (stockVal > 0) {
        var at = details.findIndex(function (d) { return d.label === 'Material' })
        details.splice(at === -1 ? 0 : at + 1, 0, { label: 'Stock value', value: formatPaise(stockVal) })
      }
    }
    if (details.length === 0) return null
    return (
      <div className="grid grid-cols-2 gap-px rounded-xl overflow-hidden bg-slate-200">
        {details.map(function (d, i) {
          var wide = details.length % 2 === 1 && i === details.length - 1
          var glyph = { Material: 'box', 'Stock value': 'rupee', 'Menu zone': 'utensils', Vendor: 'building', 'Vendor name': 'user' }[d.label] || 'info'
          return (
            <div key={d.label} className={"flex items-center gap-2.5 bg-slate-50 px-3 py-2.5 min-w-0 " + (wide ? "col-span-2" : "")}>
              <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-white border border-slate-200 text-indigo-500 inline-flex items-center justify-center">
                <Icon name={glyph} size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-slate-600 leading-tight">{d.label}</span>
                <span className="block text-[15px] font-extrabold text-slate-900 truncate" title={d.value}>{d.value}</span>
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* The toolbar: search, a Filters button holding every filter —
          category, sub-category, venue, sub-venue, material, menu zone — and Tools — on one white panel so the
          controls stand on something rather than float over the photograph. */}
      {/* relative z-30: backdrop-blur makes this panel a stacking context,
          which traps the dropdowns' z-50 inside it — the Show / Sort pills
          below painted over an open list. Lifting the panel itself puts its
          lists above everything under it. */}
      <div className="relative z-30 flex gap-2 flex-wrap items-center p-2 rounded-[20px] bg-white/80 backdrop-blur-md border border-white/90 shadow-[0_10px_30px_-12px_rgba(40,30,25,0.35)]">
        <div className="group/search relative flex-1 min-w-[240px]">
          <Icon name="search" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within/search:text-[#3B4668] transition-colors pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={function (e) { setSearch(e.target.value); setPage(1) }}
            onKeyDown={function (e) { if (e.key === 'Escape') { if (search) { setSearch(''); setPage(1) } else e.currentTarget.blur() } }}
            placeholder="Search name, ID, description, submitter..."
            className="w-full h-12 pl-11 pr-12 bg-white border border-[#ECE4DC] rounded-2xl text-[15px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(40,30,25,0.04)] focus:outline-none focus:border-[#A9B1CB] focus:ring-4 focus:ring-[#3B4668]/10 transition-[border-color,box-shadow]"
          />
          {/* Clear, while there is something to clear. */}
          {search && (
            <button type="button" onClick={function () { setSearch(''); setPage(1); if (searchRef.current) searchRef.current.focus() }} aria-label="Clear search" title="Clear"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-colors">
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
        {/* No Master Sub-dept dropdown here: the sub-departments are listed
            under Inventory in the sidebar, and a pick there sets this filter.
            Only the admin shell mounts this screen, so the sidebar is always
            beside it. */}
        {(function () {
          var n = catFilter.length + subCatFilter.length + venueFilter.length + subVenueFilter.length + materialFilter.length + menuZoneFilter.length
          var lit = moreFiltersOpen || n > 0
          return (
            <button type="button" onClick={function () { setMoreFiltersOpen(!moreFiltersOpen) }} aria-expanded={moreFiltersOpen}
              className={"inline-flex items-center gap-2 h-12 px-4 text-[14px] font-semibold rounded-2xl border transition-colors " +
                (lit ? "bg-[#EDEFF5] border-[#D8DCE8] text-[#333D5E]" : "bg-white border-[#ECE4DC] text-slate-800 hover:bg-[#FAF6F2] hover:border-[#E0D4C8]")}>
              <Icon name="filter" size={16} />
              Filters
              {n > 0 && <span className="min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-[#3B4668] text-white text-[11.5px] font-bold tabular-nums">{n}</span>}
              <Icon name="chevronDown" size={15} className={"transition-[rotate] duration-200 " + (moreFiltersOpen ? "rotate-180 " : "") + (lit ? "text-[#8A93B0]" : "text-slate-400")} />
            </button>
          )
        })()}
        <button type="button" onClick={function () { setToolsModal(true) }} title="Tools — export, import, bulk images"
          className="inline-flex items-center gap-2 h-12 px-4 text-[14px] font-semibold bg-white border border-[#ECE4DC] rounded-2xl text-slate-800 hover:bg-[#FAF6F2] hover:border-[#E0D4C8] transition-colors">
          <Icon name="wrench" size={16} />Tools
        </button>
      </div>

      {/* The finer filters, in three groups — Category, Location, Details —
          side by side, every field the same height. */}
      {moreFiltersOpen && (function () {
        var cats = categories.filter(function (c) {
          if (subDeptFilter.length > 0) return subDeptFilter.indexOf(String(c.sub_department_id)) !== -1
          return true
        }).map(function (c) { return { label: c.name, value: String(c.id) } })
        var subCats = subCategoriesAll.filter(function (sc) { return catFilter.indexOf(String(sc.category_id)) !== -1 })
          .map(function (sc) { return { label: sc.name, value: String(sc.id) } })
        var vIds = venues.filter(function (v2) { return venueFilter.indexOf(v2.code) !== -1 }).map(function (v2) { return v2.id })
        var subVens = subVenues.filter(function (sv) { return vIds.indexOf(sv.venue_id) !== -1 })
          .map(function (sv) { return { label: sv.name, value: String(sv.id) } })
        // Every option set up in Masters for the field (a category's
        // dimension fields, e.g. its Materials dropdown), plus any value an
        // item carries that is not in those lists — once each whatever its
        // case, A to Z, with how many items have it where any do. With
        // categories picked, only their options; otherwise every category's.
        function valuesOf(re) {
          var count = {}, label = {}
          var scopeCats = catFilter.length > 0
            ? categories.filter(function (c) { return catFilter.indexOf(String(c.id)) !== -1 })
            : categories
          scopeCats.forEach(function (c) {
            ;(Array.isArray(c.dimension_fields) ? c.dimension_fields : []).forEach(function (f) {
              if (!f || !f.name || !re.test(f.name)) return
              ;(f.options || []).forEach(function (o) {
                var v = String(o || '').trim(); if (!v) return
                var k = v.toLowerCase()
                if (!(k in count)) count[k] = 0
                if (!label[k]) label[k] = v
              })
            })
          })
          items.forEach(function (it) {
            var m = dimValueOf(it, re); if (!m) return
            var k = m.toLowerCase()
            count[k] = (count[k] || 0) + 1
            if (!label[k]) label[k] = titleCase(m)
          })
          return Object.keys(count).sort(function (a, b) { return label[a].localeCompare(label[b], 'en', { sensitivity: 'base', numeric: true }) })
            .map(function (k) { return { label: label[k] + (count[k] > 0 ? ' (' + count[k] + ')' : ''), value: k } })
        }
        var mats = valuesOf(MATERIAL_RE)
        var zones = valuesOf(MENU_ZONE_RE)
        var anyFilter = !!(search || statusFilter.length > 0 || subDeptFilter.length > 0 || catFilter.length > 0 || subCatFilter.length > 0 || venueFilter.length > 0 || subVenueFilter.length > 0 || materialFilter.length > 0 || menuZoneFilter.length > 0)
        function disabledBox(text) {
          return (
            <div className="h-11 flex items-center gap-2 px-3.5 rounded-xl border border-dashed border-slate-300 bg-slate-100 text-[13px] font-medium text-slate-500 select-none">
              <Icon name="lock" size={13} className="shrink-0 text-slate-400" />
              {text}
            </div>
          )
        }
        var FL = "block text-[12.5px] font-bold text-slate-800 mb-1.5"
        // One group: an icon and a name over its fields, stacked.
        function group(icon, title, body) {
          return (
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
              <p className="flex items-center gap-2 mb-3 pb-2.5 border-b border-slate-200 text-[12.5px] font-extrabold uppercase tracking-[0.08em] text-slate-900">
                <span className="w-7 h-7 rounded-lg bg-[#3B4668] text-white inline-flex items-center justify-center shadow-[0_2px_6px_-2px_rgba(59,70,104,0.6)]"><Icon name={icon} size={14} /></span>
                {title}
              </p>
              <div className="space-y-3">{body}</div>
            </div>
          )
        }
        return (
          <div className="relative z-20 p-4 rounded-[20px] bg-white/90 backdrop-blur-md border border-white shadow-[0_10px_30px_-12px_rgba(30,35,60,0.3)]">
            <div className="flex items-center justify-between gap-3 mb-3.5">
              <p className="text-[16px] font-extrabold text-slate-900">Filter items</p>
              <button type="button" onClick={resetFilters} disabled={!anyFilter}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold text-red-600 hover:bg-red-50 disabled:text-slate-500 disabled:hover:bg-transparent disabled:cursor-default transition-colors">
                <Icon name="refresh" size={13} />Reset all
              </button>
            </div>
            {/* What it is, where it is, what it is made of — each a group of
                its own. A child field waits, greyed, until its parent has a
                pick. */}
            <div className="grid gap-3 md:grid-cols-3">
              {group('tag', 'Category', (
                <>
                  <div>
                    <label className={FL}>Category</label>
                    <FilterDropdown value={catFilter} placeholder="All Categories" multi
                      onChange={function (v) { setCatFilter(v); setSubCatFilter([]); setPage(1) }} options={cats} />
                  </div>
                  <div>
                    <label className={FL}>Sub-category</label>
                    {catFilter.length > 0
                      ? <FilterDropdown value={subCatFilter} placeholder="All Sub-categories" multi
                          onChange={function (v) { setSubCatFilter(v); setPage(1) }} options={subCats} />
                      : disabledBox('Pick a category first')}
                  </div>
                </>
              ))}
              {group('mapPin', 'Location', (
                <>
                  <div>
                    <label className={FL}>Venue</label>
                    <FilterDropdown value={venueFilter} placeholder="All Venues" multi
                      onChange={function (v) { setVenueFilter(v); setSubVenueFilter([]); setPage(1) }}
                      options={venues.map(function (v) { return { label: v.code + ' — ' + v.name, value: v.code } })} />
                  </div>
                  <div>
                    <label className={FL}>Sub-venue</label>
                    {venueFilter.length > 0
                      ? <FilterDropdown value={subVenueFilter} placeholder="All Sub-venues" multi
                          onChange={function (v) { setSubVenueFilter(v); setPage(1) }} options={subVens} />
                      : disabledBox('Pick a venue first')}
                  </div>
                </>
              ))}
              {group('box', 'Details', (
                <>
                  <div>
                    <label className={FL}>Material</label>
                    {mats.length > 0
                      ? <FilterDropdown value={materialFilter} placeholder="All Materials" multi
                          onChange={function (v) { setMaterialFilter(v); setPage(1) }} options={mats} />
                      : disabledBox('No materials recorded')}
                  </div>
                  <div>
                    <label className={FL}>Menu zone</label>
                    {zones.length > 0
                      ? <FilterDropdown value={menuZoneFilter} placeholder="All Menu zones" multi
                          onChange={function (v) { setMenuZoneFilter(v); setPage(1) }} options={zones} />
                      : disabledBox('No menu zones recorded')}
                  </div>
                </>
              ))}
            </div>
          </div>
        )
      })()}

      {/* The count and Reset on the left, page size and order on the right.
          The Reset test is boolean: written as length || length, an empty
          set evaluated to 0 and React printed the 0 beside the count. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <p className="text-[14px] text-slate-600">
            <span className="font-bold text-slate-900 tabular-nums">{filtered.length}</span> Item{filtered.length !== 1 ? 's' : ''}
          </p>
          {/* Only while the Filters panel is shut: open, it carries its own
              Reset all, and two buttons doing one thing sat a line apart. */}
          {!moreFiltersOpen && (search || statusFilter.length > 0 || subDeptFilter.length > 0 || catFilter.length > 0 || subCatFilter.length > 0 || venueFilter.length > 0 || subVenueFilter.length > 0 || materialFilter.length > 0 || menuZoneFilter.length > 0) && (
            <button type="button" onClick={resetFilters}
              className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-full bg-white border border-slate-200 text-[12.5px] font-semibold text-slate-700 shadow-[0_2px_6px_-2px_rgba(30,35,60,0.18)] hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors">
              <Icon name="refresh" size={13} />Clear filters
            </button>
          )}
        </div>
          <div className="flex items-center gap-2">
            <label className="relative inline-flex items-center gap-1.5 h-9 pl-3 pr-2.5 rounded-xl bg-white border border-slate-200 shadow-[0_2px_8px_-2px_rgba(30,35,60,0.18)] text-[13px] text-slate-500 cursor-pointer hover:border-indigo-300 hover:text-slate-700 transition-colors">
              <Icon name="list" size={14} className="text-indigo-500" />
            <span>Show</span>
              <span className="font-bold text-slate-900">{perPage} / page</span>
              <Icon name="chevronDown" size={14} className="text-slate-500" />
              <select value={perPage} aria-label="Items per page"
                onChange={function (e) { setPerPage(Number(e.target.value)); setPage(1) }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                <option value={24}>24 / page</option>
                <option value={48}>48 / page</option>
                <option value={96}>96 / page</option>
                <option value={240}>240 / page</option>
              </select>
            </label>
            <label className="relative inline-flex items-center gap-1.5 h-9 pl-3 pr-2.5 rounded-xl bg-white border border-slate-200 shadow-[0_2px_8px_-2px_rgba(30,35,60,0.18)] text-[13px] text-slate-500 cursor-pointer hover:border-indigo-300 hover:text-slate-700 transition-colors">
              <Icon name="filter" size={14} className="text-indigo-500" />
            <span>Sort</span>
              <span className="font-bold text-slate-900">
                {({ '': 'Newest added', 'name:asc': 'Name A–Z', 'name:desc': 'Name Z–A', 'category:asc': 'Category', 'date:desc': 'Submitted, newest', 'date:asc': 'Submitted, oldest' })[sortKey ? sortKey + ':' + sortDir : ''] || 'Newest added'}
              </span>
              <Icon name="chevronDown" size={14} className="text-slate-500" />
              <select value={sortKey ? sortKey + ':' + sortDir : ''} aria-label="Sort items"
                onChange={function (e) {
                  var v = e.target.value
                  if (!v) { setSortKey(null); setSortDir('asc') }
                  else { var parts = v.split(':'); setSortKey(parts[0]); setSortDir(parts[1]) }
                  setPage(1)
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                <option value="">Newest added</option>
                <option value="name:asc">Name A–Z</option>
                <option value="name:desc">Name Z–A</option>
                <option value="category:asc">Category</option>
                <option value="date:desc">Submitted, newest</option>
                <option value="date:asc">Submitted, oldest</option>
              </select>
            </label>
          </div>
      </div>

      {/* Three cards to a row, a wide photograph across the top of each
          fitted whole (object-contain — covering cropped the item's edges). */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-gray-400">No items found</div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.slice((page - 1) * perPage, page * perPage).map(function (item) {
            var imgUrl = getImageUrl(item.image_path)
            return (
              <div key={(item._source || 'i') + ':' + item.id}
                className="group flex flex-col bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.06)] will-change-[translate] transition-[translate,box-shadow] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1.5 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.22)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                {/* The photograph as a framed print: whole (nothing of the item
                    cropped), rounded, lifted by a shadow, centred on a plain
                    white mat — no blurred copy of the photo at the sides. Sized to
                    its own content (max-w/max-h, not w-full h-full), so the
                    corners and shadow land on the picture itself rather than on
                    an empty box — which is what left a hard strip before.

                    The lift eases on translate, not transform: Tailwind 4's
                    translate-y utilities set the CSS translate property, so a
                    transition on transform never touched it and the card
                    jumped up while only its shadow eased. */}
                {imgUrl ? (
                  // Hovering the photograph opens the whole of it, large, in a
                  // panel beside the card (see hoverPreview). A click still
                  // opens it full screen.
                  <button type="button" onClick={function () { closePreview(true); setEnlargedImg(imgUrl) }} aria-label={'Enlarge photo of ' + item.name}
                    onMouseEnter={function (e) { armPreview(e.currentTarget, imgUrl, item.name) }}
                    onMouseMove={function (e) { if (!hoverPreview) armPreview(e.currentTarget, imgUrl, item.name) }}
                    onMouseLeave={disarmPreview}
                    className="relative flex items-center justify-center h-56 p-3.5 overflow-hidden bg-white border-b border-slate-100 cursor-zoom-in">
                    <img src={imgUrl} alt="" loading="lazy"
                      className="relative max-w-full max-h-full rounded-xl object-contain ring-1 ring-slate-200/70 shadow-[0_10px_24px_-10px_rgba(15,23,42,0.35)]" />
                  </button>
                ) : (
                  <div className="h-56 bg-[#F6F1EA] flex items-center justify-center text-[#D8CBBB]">
                    <Icon name="gallery" size={40} />
                  </div>
                )}

                <div className="flex-1 flex flex-col gap-3 p-4">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-[18px] font-semibold text-slate-900 leading-snug">{item.name}</p>
                      <span className="shrink-0 mt-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-[12px] font-semibold text-slate-600 font-mono">{item.inventory_id || '—'}</span>
                    </div>
                    {item.name_hindi && <p className="text-[14px] font-normal text-slate-500">{item.name_hindi}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[13px] font-normal text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="tag" size={12} className="text-slate-400" />{item.categories?.name || '—'}
                      </span>
                      {item.sub_categories?.name && (
                        <>
                          <Icon name="chevronRight" size={13} className="text-slate-400" />
                          <span>{item.sub_categories.name}</span>
                        </>
                      )}
                    </div>
                    {item.brand && <p className="text-[13px] text-amber-600 font-semibold">{item.brand}{item.pack_size_qty ? ' · ' + item.pack_size_qty + ' ' + (item.pack_size_unit || '') : ''}</p>}
                  </div>
                  {detailsBox(item)}
                  {(item.venue_allocations || []).length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500">Stored at</p>
                      {allocChips(item)}
                    </div>
                  )}
                </div>

                {/* Wraps instead of squeezing: on a narrow card (or zoomed in)
                    the buttons drop to their own line rather than crushing
                    the name and date into a column of single words. */}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2.5 px-4 py-3 border-t border-slate-100 bg-slate-50/40">
                  {submitterOf(item)}
                  {actionsOf(item)}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {hoverPreview && (function () {
        // Over the photo itself, centred on it and larger than it, so it
        // pops out of its own card rather than landing on the next one. Kept
        // inside the window on every side. pointer-events-none, so it never
        // takes the hover from the photo underneath.
        var SIZE = 440
        var r = hoverPreview.rect
        var vw = window.innerWidth, vh = window.innerHeight
        var left = Math.min(Math.max(8, r.left + r.width / 2 - SIZE / 2), vw - SIZE - 8)
        var top = Math.min(Math.max(8, r.top + r.height / 2 - SIZE / 2), vh - SIZE - 8)
        // It grows out of the photo: the animation starts at the scale that
        // makes the panel the photo's size and from the photo's centre, and
        // shrinks back the same way on the way out.
        var fromScale = Math.min(1, Math.max(0.35, Math.min(r.width, r.height) / SIZE))
        var originX = (r.left + r.width / 2) - left
        var originY = (r.top + r.height / 2) - top
        return createPortal((
          <div aria-hidden="true"
            className={"pointer-events-none fixed z-[9990] rounded-2xl bg-white p-2 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 " +
              (hoverPreview.closing ? "ambria-pop-out" : "ambria-pop-in")}
            style={{ left: left, top: top, width: SIZE, height: SIZE, '--pop-from': fromScale, transformOrigin: originX + 'px ' + originY + 'px' }}>
            <img src={hoverPreview.url} alt="" className="w-full h-full object-contain rounded-xl bg-slate-50" />
          </div>
        ), document.body)
      })()}
      {/* Pagination, on one white bar. A new page starts from the top of
          the list — the window is the scroller — rather than leaving you at
          the bottom of cards you have not seen yet. Only the page buttons
          scroll; a filter change resets the page without moving you. */}
      {(function () {
        var totalPages = Math.ceil(filtered.length / perPage)
        if (totalPages <= 1) return null
        function goPage(p) {
          if (p < 1 || p > totalPages || p === page) return
          setPage(p)
          var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
          window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
        }
        var NAV = "w-9 h-9 inline-flex items-center justify-center rounded-xl text-slate-600 hover:bg-[#EDEFF5] hover:text-[#333D5E] disabled:opacity-30 disabled:pointer-events-none transition-colors"
        return (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3">
            <div className="inline-flex items-center gap-1 p-1.5 rounded-2xl bg-white/90 backdrop-blur-sm border border-white shadow-[0_6px_20px_-10px_rgba(40,30,25,0.3)]">
              <button type="button" onClick={function () { goPage(1) }} disabled={page === 1} aria-label="First page" title="First page" className={NAV}>
                <Icon name="chevronRight" size={15} className="rotate-180 -mr-2" /><Icon name="chevronRight" size={15} className="rotate-180" />
              </button>
              <button type="button" onClick={function () { goPage(page - 1) }} disabled={page === 1} aria-label="Previous page" title="Previous" className={NAV}>
                <Icon name="chevronRight" size={16} className="rotate-180" />
              </button>
              {Array.from({ length: totalPages }, function (_, i) { return i + 1 }).filter(function (p) {
                return p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)
              }).map(function (p, i, arr) {
                var showGap = i > 0 && p - arr[i - 1] > 1
                return (
                  <span key={p} className="inline-flex items-center gap-1">
                    {showGap && <span aria-hidden="true" className="w-6 text-center text-slate-400">…</span>}
                    <button type="button" onClick={function () { goPage(p) }} aria-current={p === page ? 'page' : undefined}
                      className={"min-w-9 h-9 px-2 inline-flex items-center justify-center rounded-xl text-[14px] font-semibold tabular-nums transition-colors " +
                        (p === page ? "bg-[#3B4668] text-white shadow-[0_4px_10px_-4px_rgba(59,70,104,0.6)]" : "text-slate-700 hover:bg-[#EDEFF5] hover:text-[#333D5E]")}>{p}</button>
                  </span>
                )
              })}
              <button type="button" onClick={function () { goPage(page + 1) }} disabled={page === totalPages} aria-label="Next page" title="Next" className={NAV}>
                <Icon name="chevronRight" size={16} />
              </button>
              <button type="button" onClick={function () { goPage(totalPages) }} disabled={page === totalPages} aria-label="Last page" title="Last page" className={NAV}>
                <Icon name="chevronRight" size={15} className="-mr-2" /><Icon name="chevronRight" size={15} />
              </button>
            </div>
            <span className="text-[13px] font-medium text-slate-600">Page <b className="text-slate-900 tabular-nums">{page}</b> of <span className="tabular-nums">{totalPages}</span></span>
          </div>
        )
      })()}
      {stockItem && (
        <StockBreakdown item={stockItem} profile={profile} onClose={function () { setStockItem(null) }} onChanged={loadData} />
      )}

      {/* Delete confirmation: what is about to go, and that it cannot be
          undone, before anything is removed. */}
      <Modal open={!!deleteConfirm} onClose={function () { if (!deleting) setDeleteConfirm(null) }} title="Delete item">
        {deleteConfirm && (function () {
          var it = deleteConfirm
          var img = getImageUrl(it.image_path)
          return (
            <div className="space-y-5">
              <div className="flex items-start gap-3.5">
                <span className="shrink-0 w-11 h-11 rounded-full bg-red-50 text-red-600 inline-flex items-center justify-center ring-4 ring-red-50/60">
                  <Icon name="alert" size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-[16px] font-bold text-slate-900">Delete this item?</p>
                  <p className="mt-1 text-[13.5px] text-slate-600 leading-relaxed">
                    It is removed for good, along with its photo and every venue allocation. This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                {img
                  ? <img src={img} alt="" className="shrink-0 w-12 h-12 rounded-lg object-cover bg-white border border-slate-200" />
                  : <span className="shrink-0 w-12 h-12 rounded-lg bg-white border border-slate-200 inline-flex items-center justify-center text-slate-300"><Icon name="gallery" size={18} /></span>}
                <div className="min-w-0">
                  <p className="text-[14.5px] font-bold text-slate-900 truncate">{it.name}</p>
                  <p className="text-[12px] text-slate-500 font-mono">{it.inventory_id || '—'}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2.5">
                <button type="button" onClick={function () { setDeleteConfirm(null) }} disabled={deleting}
                  className="h-10 px-4 rounded-lg border border-slate-300 bg-white text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                  Cancel
                </button>
                <button type="button" onClick={function () { deleteItem(it) }} disabled={deleting}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-red-600 text-white text-[13.5px] font-bold shadow-[0_4px_14px_-4px_rgba(220,38,38,0.55)] hover:bg-red-700 disabled:opacity-60 transition-colors">
                  <Icon name="trash" size={15} />{deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )
        })()}
      </Modal>
      {/* Edit modal */}
      <Modal open={!!editItem} onClose={function () { setEditItem(null) }} title="Edit Item" wide>
        {editItem && (
          <InventoryForm
            item={editItem}
            profile={profile}
            variant="admin"
            onClose={function () { setEditItem(null) }}
            onSaved={function () { setEditItem(null); loadData() }}
          />
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
      {/* Maintenance hold modal.
          What the item is and how much of it is free, then the form for a new
          hold — the app's date picker for the range (not mm/dd/yyyy), a
          stepper for how many, a reason picked or typed — then the holds on
          it, each marked Active, Upcoming or Ended by today's date. */}
      <Modal open={!!holdItem} onClose={function () { setHoldItem(null) }} title="Maintenance holds">
        {holdItem && (function () {
          var today = new Date(); today.setHours(0, 0, 0, 0)
          function dayOf(d) { var x = new Date(String(d).slice(0, 10) + 'T00:00:00'); return x }
          function fmt(d) { return dayOf(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) }
          var stock = Number(holdItem.qty) || 0
          var heldNow = holds.reduce(function (sum, h) {
            return (dayOf(h.hold_from) <= today && dayOf(h.hold_to) >= today) ? sum + (Number(h.qty) || 0) : sum
          }, 0)
          var imgUrl = getImageUrl(holdItem.image_path)
          var qtyNum = Number(holdForm.qty) || 0
          var rangeBad = holdForm.hold_from && holdForm.hold_to && holdForm.hold_to < holdForm.hold_from
          var canSave = !holdSaving && holdForm.hold_from && holdForm.hold_to && !rangeBad && qtyNum > 0
          function setF(patch) { setHoldForm(function (p) { return Object.assign({}, p, patch) }) }
          var REASONS = ['Repair', 'Painting', 'Polishing', 'Cleaning']
          var LBL = "block text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5"
          return (
            <div className="space-y-4">
              {/* The item */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                {imgUrl
                  ? <img src={imgUrl} alt="" className="shrink-0 w-14 h-14 rounded-lg object-cover bg-white border border-slate-200" />
                  : <span className="shrink-0 w-14 h-14 rounded-lg bg-white border border-slate-200 inline-flex items-center justify-center text-slate-300"><Icon name="gallery" size={20} /></span>}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-slate-900 truncate">{holdItem.name}</p>
                  <p className="text-[12px] text-slate-500 font-mono">{holdItem.inventory_id || '—'}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">In stock</p>
                  <p className="text-[15px] font-extrabold text-slate-900 tabular-nums">{stock} <span className="text-[12px] font-semibold text-slate-500">{holdItem.unit || ''}</span></p>
                  {heldNow > 0 && <p className="text-[11.5px] font-semibold text-amber-700 tabular-nums">{heldNow} on hold today</p>}
                </div>
              </div>

              {/* New hold */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5 shadow-[0_4px_16px_-6px_rgba(30,35,60,0.14)]">
                <p className="inline-flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-[0.08em] text-indigo-700">
                  <span className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 inline-flex items-center justify-center"><Icon name="lock" size={13} /></span>
                  New hold
                </p>
                <div>
                  <label className={LBL}>Hold period</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <EventDatePicker value={holdForm.hold_from} onChange={function (v) { setF({ hold_from: v || '' }) }}
                        collapsible includePast plain neutral placeholder="From" />
                    </div>
                    <Icon name="arrowRight" size={16} strokeWidth={2.6} className="shrink-0 text-slate-500" />
                    <div className="flex-1 min-w-0">
                      <EventDatePicker value={holdForm.hold_to} onChange={function (v) { setF({ hold_to: v || '' }) }}
                        collapsible includePast plain neutral placeholder="To" />
                    </div>
                  </div>
                  {rangeBad && <p className="mt-1.5 text-[12px] font-semibold text-red-600">The end date is before the start date.</p>}
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                  <div>
                    <label className={LBL}>Quantity</label>
                    <div className="inline-flex items-center h-[42px] rounded-lg border border-slate-300 bg-white overflow-hidden">
                      <button type="button" aria-label="Fewer" onClick={function () { setF({ qty: Math.max(1, qtyNum - 1) }) }}
                        className="w-10 h-full inline-flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"><Icon name="minus" size={14} /></button>
                      <input type="number" min="1" value={holdForm.qty} onChange={function (e) { setF({ qty: e.target.value }) }}
                        style={{ fontSize: '16px' }}
                        className="w-14 h-full text-center font-bold text-slate-900 tabular-nums border-x border-slate-200 focus:outline-none" />
                      <button type="button" aria-label="More" onClick={function () { setF({ qty: qtyNum + 1 }) }}
                        className="w-10 h-full inline-flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"><Icon name="plus" size={14} /></button>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <label className={LBL}>Reason</label>
                    <input type="text" value={holdForm.reason} onChange={function (e) { setF({ reason: e.target.value }) }}
                      placeholder="e.g. Repair, painting..." maxLength="200"
                      style={{ fontSize: '16px' }}
                      className="w-full h-[42px] px-3 rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20" />
                  </div>
                </div>
                {/* The common reasons, one tap each, across the full width in
                    four equal parts — in the Reason column alone they wrapped
                    and left one stranded on a second line. */}
                <div className="grid grid-cols-4 gap-2">
                  {REASONS.map(function (r) {
                    var on = holdForm.reason.trim().toLowerCase() === r.toLowerCase()
                    return (
                      <button key={r} type="button" onClick={function () { setF({ reason: r }) }} aria-pressed={on}
                        className={"h-9 rounded-lg border text-[13px] font-semibold transition-colors " +
                          (on ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700")}>
                        {r}
                      </button>
                    )
                  })}
                </div>
                <button type="button" onClick={addHold} disabled={!canSave}
                  className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 text-white text-[14px] font-bold shadow-[0_4px_14px_-4px_rgba(79,70,229,0.55)] hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed transition-colors">
                  <Icon name="lock" size={15} />{holdSaving ? 'Saving…' : 'Add hold'}
                </button>
              </div>

              {/* Holds on this item */}
              <div>
                <p className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
                  Holds{holds.length > 0 ? ' · ' + holds.length : ''}
                </p>
                {holds.length === 0 ? (
                  <div className="flex flex-col items-center gap-1.5 py-6 rounded-xl border border-dashed border-slate-300 text-center">
                    <Icon name="checkCircle" size={22} className="text-emerald-500" />
                    <p className="text-[13.5px] font-semibold text-slate-700">No holds on this item</p>
                    <p className="text-[12px] text-slate-500">All of its stock is free to use.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {holds.map(function (h) {
                      var from = dayOf(h.hold_from), to = dayOf(h.hold_to)
                      var status = to < today ? 'Ended' : (from > today ? 'Upcoming' : 'Active')
                      var days = Math.round((to - from) / 86400000) + 1
                      var tone = status === 'Active' ? 'bg-amber-100 text-amber-800' : status === 'Upcoming' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'
                      return (
                        <div key={h.id} className={"flex items-center gap-3 p-3 rounded-xl border bg-white " + (status === 'Ended' ? "border-slate-200 opacity-70" : "border-slate-200")}>
                          <span className="shrink-0 w-11 h-11 rounded-lg bg-amber-50 border border-amber-200 inline-flex flex-col items-center justify-center leading-none">
                            <span className="text-[15px] font-extrabold text-amber-800 tabular-nums">{h.qty}</span>
                            <span className="text-[9.5px] font-bold uppercase text-amber-600">qty</span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-[14px] font-bold text-slate-900 truncate">{h.reason || 'No reason given'}</p>
                              <span className={"shrink-0 px-1.5 py-0.5 rounded text-[10.5px] font-bold uppercase " + tone}>{status}</span>
                            </div>
                            <p className="text-[12.5px] text-slate-500">
                              {fmt(h.hold_from)} <span className="text-slate-400">→</span> {fmt(h.hold_to)} <span className="text-slate-400">·</span> {days} day{days !== 1 ? 's' : ''}
                            </p>
                          </div>
                          <button type="button" onClick={function () { removeHold(h.id) }}
                            className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Icon name="undo" size={13} />Release
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      </Modal>
     {/* Tools modal — groups Export/Import/Bulk Images/Template behind one button */}
      <Modal open={toolsModal} onClose={function () { setToolsModal(false) }} title="Inventory Tools">
        <div className="space-y-2">
          <button onClick={function () { setToolsModal(false); setExportModal(true) }}
            className="w-full flex items-center gap-3 p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 text-slate-600 inline-flex items-center justify-center"><Icon name="download" size={18} /></span>
            <span>
              <span className="block text-sm font-semibold text-gray-800">Export</span>
              <span className="block text-xs text-gray-500">Download the current filtered list as CSV or PDF</span>
            </span>
          </button>
          <label className="w-full flex items-center gap-3 p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer">
            <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 text-slate-600 inline-flex items-center justify-center"><Icon name="download" size={18} className="rotate-180" /></span>
            <span>
              <span className="block text-sm font-semibold text-gray-800">Import</span>
              <span className="block text-xs text-gray-500">Upload a CSV to bulk add/update items</span>
            </span>
            <input type="file" accept=".csv" className="hidden"
              onChange={function (e) { setToolsModal(false); parseImportFile(e) }} />
          </label>
          <label className="w-full flex items-center gap-3 p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer">
            <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 text-slate-600 inline-flex items-center justify-center"><Icon name="gallery" size={18} /></span>
            <span>
              <span className="block text-sm font-semibold text-gray-800">Bulk Images</span>
              <span className="block text-xs text-gray-500">Upload a .zip of photos matched by inventory ID</span>
            </span>
            <input type="file" accept=".zip,application/zip,application/x-zip-compressed" className="hidden"
              onChange={function (e) { setToolsModal(false); parseBulkImageZip(e) }} />
          </label>
          <button onClick={function () { downloadTemplate(); setToolsModal(false) }}
            className="w-full flex items-center gap-3 p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-100 text-slate-600 inline-flex items-center justify-center"><Icon name="fileText" size={18} /></span>
            <span>
              <span className="block text-sm font-semibold text-gray-800">Template</span>
              <span className="block text-xs text-gray-500">Download a blank CSV with the expected columns</span>
            </span>
          </button>
        </div>
      </Modal>
     {/* Export modal */}
      <Modal open={exportModal} onClose={function () { setExportModal(false) }} title="Export Inventory">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{filtered.length} items will be exported (based on current filters).</p>
          <div className="flex gap-3">
            <button onClick={function () { exportItems(); setExportModal(false) }}
              className="flex-1 py-3 text-sm font-semibold border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              <span className="inline-flex items-center justify-center gap-2"><Icon name="chart" size={16} />Export CSV</span>
            </button>
            <button onClick={function () { exportPdf(); setExportModal(false) }}
              className="flex-1 py-3 text-sm font-semibold border border-indigo-300 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors">
              <span className="inline-flex items-center justify-center gap-2"><Icon name="fileText" size={16} />Export PDF</span>
            </button>
          </div>
          <p className="text-[11px] text-gray-400">CSV includes all columns. PDF excludes By, Date, Status for compact layout.</p>
        </div>
      </Modal>
     {/* Import modal */}
      <Modal open={!!importModal} onClose={function () { if (!importing) { setImportModal(null); setImportProgress(null) } }} title="Import Items">
        {importModal && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-800">{importModal.fileName}</p>
              <p className="text-xs text-gray-500 mt-1">{importModal.rows.length} data rows found</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {importModal.header.slice(0, 10).map(function (h) {
                  return <span key={h} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-mono">{h}</span>
                })}
                {importModal.header.length > 10 && <span className="text-[10px] text-gray-400">+{importModal.header.length - 10} more</span>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Import Mode</label>
              <div className="flex gap-0 bg-white border border-gray-300 rounded-lg overflow-hidden">
                <button type="button" onClick={function () { setImportMode('add') }}
                  className={"flex-1 py-3 text-sm font-medium transition-colors " + (importMode === 'add' ? "bg-green-600 text-white" : "text-gray-500 hover:bg-gray-50")}>
                  <span className="inline-flex items-center justify-center gap-1.5"><Icon name="plus" size={15} />Add Items</span>
                </button>
                <button type="button" onClick={function () { setImportMode('update') }}
                  className={"flex-1 py-3 text-sm font-medium transition-colors " + (importMode === 'update' ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-50")}>
                  <span className="inline-flex items-center justify-center gap-1.5"><Icon name="edit" size={15} />Update Info</span>
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                {importMode === 'add'
                  ? 'Existing items: qty will be added. New items: will be created as approved.'
                  : 'Matches items by ID column. Info fields updated (qty unchanged). Items without matching ID: skipped.'}
              </p>
            </div>

            {/* Preview first 3 rows */}
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Preview (first 3 rows)</p>
              <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                <table className="text-[11px] w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      {importModal.header.slice(0, 8).map(function (h) {
                        return <th key={h} className="px-2 py-1.5 text-left font-bold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {importModal.rows.slice(0, 3).map(function (row, ri) {
                      return (
                        <tr key={ri} className="border-b border-gray-100">
                          {importModal.header.slice(0, 8).map(function (h) {
                            return <td key={h} className="px-2 py-1.5 text-gray-600 whitespace-nowrap max-w-[150px] truncate">{row[h] || '—'}</td>
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Progress */}
            {importProgress && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">Progress</span>
                  <span className="text-gray-500">{importProgress.done + importProgress.skipped} / {importProgress.total}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: Math.round(((importProgress.done + importProgress.skipped) / importProgress.total) * 100) + '%' }} />
                </div>
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  <span className="text-green-600 font-medium">{importProgress.done} processed</span>
                  <span className="text-amber-600 font-medium">{importProgress.skipped} skipped</span>
                </div>
                {importProgress.skippedRows && importProgress.skippedRows.length > 0 && !importing && (
                  <div className="mt-3 max-h-40 overflow-y-auto">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Skipped Items</p>
                      <button onClick={function () {
                        var hdr = ['Row', 'ID', 'Name', 'Category', 'Reason']
                        var csvRows = importProgress.skippedRows.map(function (s) { return [s.row, s.id, s.name, s.cat, s.reason || ''].map(csvEscape).join(',') })
                        var csv = '\uFEFF' + hdr.join(',') + '\n' + csvRows.join('\n')
                        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'skipped_rows_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
                      }} className="inline-flex items-center gap-1 text-[10px] text-indigo-600 font-medium hover:underline"><Icon name="download" size={11} />Download CSV</button>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead><tr className="text-left text-gray-500"><th className="pr-2 py-0.5">Row</th><th className="pr-2 py-0.5">ID</th><th className="pr-2 py-0.5">Name</th><th className="py-0.5">Reason</th></tr></thead>
                      <tbody>
                        {importProgress.skippedRows.map(function (s, i) {
                          return <tr key={i} className="text-gray-600 border-t border-gray-100"><td className="pr-2 py-0.5">{s.row}</td><td className="pr-2 py-0.5 font-mono">{s.id}</td><td className="pr-2 py-0.5">{s.name}</td><td className="py-0.5 text-amber-700">{s.reason}</td></tr>
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-1">
              <button onClick={function () { setImportModal(null); setImportProgress(null) }} disabled={importing}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">Cancel</button>
              <button onClick={importProgress && !importing ? function () { setImportModal(null); setImportProgress(null) } : runImport} disabled={importing}
                className="px-6 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50">
                {importing ? 'Importing...' : importProgress ? 'Done' : 'Start Import'}</button>
            </div>
          </div>
        )}
      </Modal>
      {/* Bulk image import modal */}
      <Modal open={!!bulkImgModal} onClose={function () { if (!bulkImgProcessing) { setBulkImgModal(null); setBulkImgProgress(null) } }} title="Bulk Image Import">
        {bulkImgModal && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-800">{bulkImgModal.file.name}</p>
              <p className="text-xs text-gray-500 mt-1">{bulkImgModal.total} image{bulkImgModal.total !== 1 ? 's' : ''} in ZIP</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-green-700">{bulkImgModal.matched.length}</div>
                <div className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Matched</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-amber-700">{bulkImgModal.replacing}</div>
                <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Replacing</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-red-700">{bulkImgModal.unmatched.length}</div>
                <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Unmatched</div>
              </div>
            </div>
            <p className="text-[11px] text-gray-500">
              Filename must match inventory ID (e.g. <span className="font-mono">CS-994.jpg</span> → item with ID <span className="font-mono">CS-994</span>). Case-insensitive. Auto-compressed to ~100KB. Existing images are replaced.
            </p>
            {bulkImgModal.unmatched.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-amber-700 font-medium">Unmatched files ({bulkImgModal.unmatched.length})</summary>
                <div className="mt-1 bg-amber-50 border border-amber-100 rounded p-2 max-h-32 overflow-y-auto">
                  {bulkImgModal.unmatched.slice(0, 30).map(function (u, i) {
                    return <div key={i} className="font-mono text-[10px] text-amber-800">{u.basename}</div>
                  })}
                  {bulkImgModal.unmatched.length > 30 && <div className="text-[10px] text-amber-600 mt-1">+ {bulkImgModal.unmatched.length - 30} more</div>}
                </div>
              </details>
            )}
            {bulkImgModal.duplicates.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-700 font-medium">Duplicate IDs in ZIP ({bulkImgModal.duplicates.length}) — first wins</summary>
                <div className="mt-1 bg-red-50 border border-red-100 rounded p-2 max-h-32 overflow-y-auto">
                  {bulkImgModal.duplicates.slice(0, 20).map(function (d, i) {
                    return <div key={i} className="font-mono text-[10px] text-red-800">{d.key}: {d.files.join(', ')}</div>
                  })}
                </div>
              </details>
            )}
            {bulkImgProgress && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-700">{bulkImgProgress.done + bulkImgProgress.failed} / {bulkImgProgress.total}</span>
                  <span className="text-gray-500">{bulkImgProgress.done} ok · {bulkImgProgress.failed} failed</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: (bulkImgProgress.total ? (((bulkImgProgress.done + bulkImgProgress.failed) / bulkImgProgress.total) * 100) : 0) + '%' }}></div>
                </div>
                {bulkImgProgress.failedRows && bulkImgProgress.failedRows.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-red-700 font-medium">Failed ({bulkImgProgress.failedRows.length})</summary>
                    <div className="mt-1 max-h-32 overflow-y-auto">
                      {bulkImgProgress.failedRows.slice(0, 20).map(function (f, i) {
                        return <div key={i} className="text-[10px] text-red-800"><span className="font-mono">{f.basename}</span> — {f.reason}</div>
                      })}
                    </div>
                  </details>
                )}
              </div>
            )}
            <div className="flex gap-3 justify-end pt-1">
              <button onClick={function () { setBulkImgModal(null); setBulkImgProgress(null) }} disabled={bulkImgProcessing}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50">
                {bulkImgProgress && !bulkImgProcessing ? 'Close' : 'Cancel'}</button>
              <button onClick={bulkImgProgress && !bulkImgProcessing ? function () { setBulkImgModal(null); setBulkImgProgress(null) } : runBulkImageImport}
                disabled={bulkImgProcessing || bulkImgModal.matched.length === 0}
                className="px-6 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50">
                {bulkImgProcessing ? 'Uploading...' : bulkImgProgress ? 'Done' : 'Upload ' + bulkImgModal.matched.length + ' Image' + (bulkImgModal.matched.length !== 1 ? 's' : '')}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default AdminItems