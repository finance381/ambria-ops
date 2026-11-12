import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints, titleCase } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { useRealtime } from '../../lib/useRealtime'
import { hasPerm } from '../../lib/permissions'
import { useExpenseDetailModal } from '../../hooks/useExpenseDetailModal'
import Modal from '../../components/ui/Modal'
import Icon from '../../components/ui/Icon'
import SearchDropdown from '../../components/ui/SearchDropdown'
import InventoryForm from '../inventory/InventoryForm'

var PAGE_SIZE = 20

// Ranks a name match by how early/exact the hit is, so "Water Glass" beats
// "Golgappa Water Dispenser Glass" for a search of "water" (same helper as
// StoreRequisitionForm.jsx's item search).
function matchRank(name, term) {
  var n = name.toLowerCase()
  if (n === term) return 0
  if (n.indexOf(term) === 0) return 1
  var wordStart = n.indexOf(' ' + term)
  if (wordStart !== -1) return 2
  return 3
}

function ItemReceipts({ profile, onCountChange }) {
  var [receipts, setReceipts] = useState([])
  var [loading, setLoading] = useState(true)
  var [hasMore, setHasMore] = useState(false)
  var [loadingMore, setLoadingMore] = useState(false)
  var [activeReceipt, setActiveReceipt] = useState(null)

  // Filters
  var [filtersOpen, setFiltersOpen] = useState(false)
  var [search, setSearch] = useState('')
  var [searchDebounced, setSearchDebounced] = useState('')
  var [submitterFilter, setSubmitterFilter] = useState('')
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [matchState, setMatchState] = useState('') // '' | 'matched' | 'new'
  var [submitterOptions, setSubmitterOptions] = useState([])
  // 'inventory:12' / 'catering_store:5' -> { img, cat, sub } of the matched item
  var [matchImgs, setMatchImgs] = useState({})
  // Category filter: the matched item's category / sub-category. A receipt
  // not yet matched to an item has neither, so it drops out while one is set.
  var [catFilter, setCatFilter] = useState('')
  var [subCatFilter, setSubCatFilter] = useState('')
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])

  // "View expense" from the Receive Item modal — same shared overlay every
  // ledger tab already opens an expense into, not a real new tab (this app
  // has no URL routing to deep-link one open to).
  var isAdmin = hasPerm(profile?.permsNew, 'finance.expenses.approve')
  var { openExpenseDetail, expenseDetailModal } = useExpenseDetailModal(profile, isAdmin, function () { loadReceipts(false) })

  // Debounce search
  useEffect(function () {
    var t = setTimeout(function () { setSearchDebounced(search) }, 300)
    return function () { clearTimeout(t) }
  }, [search])

  // Submitter list — one shot
  useEffect(function () {
    // fn_profile_names, not a direct select -- RLS on profiles only lets a
    // user read their own row, and this filter needs everyone. Not filtered
    // to active=true (the RPC doesn't carry that column) -- a former
    // employee's name staying selectable here is harmless.
    supabase.rpc('fn_profile_names').then(function (res) {
      setSubmitterOptions((res.data || []).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') }))
    })
  }, [])

  // Category lists — one shot
  useEffect(function () {
    Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name'),
    ]).then(function (res) {
      setCategories(res[0].data || [])
      setSubCategories(res[1].data || [])
    })
  }, [])

  // Any expense anywhere in the company touches this table (new submissions,
  // edits, other people's receiving), so this fires constantly — reload
  // silently (no loading flash) so the list doesn't look like it's randomly
  // refreshing while someone's just reading it.
  useRealtime(['expenses'], function () { loadReceipts(false, true) })
  useEffect(function () { loadReceipts(false) }, [searchDebounced, submitterFilter, dateFrom, dateTo, matchState, !!catFilter])

  async function loadReceipts(append, silent) {
    var offset = append ? receipts.length : 0
    if (append) setLoadingMore(true); else if (!silent) setLoading(true)
    var allAtOnce = !!catFilter
    var params = { p_limit: allAtOnce ? 1000 : PAGE_SIZE + 1, p_offset: allAtOnce ? 0 : offset }
    if (searchDebounced) params.p_search = searchDebounced
    if (submitterFilter)  params.p_submitter_id = submitterFilter
    if (dateFrom)         params.p_date_from = dateFrom
    if (dateTo)           params.p_date_to = dateTo
    if (matchState)       params.p_match_state = matchState
    var { data, error } = await supabase.rpc('list_pending_expense_receipts', params)
    if (error) {
      alert('Failed to load pending receipts: ' + error.message)
      setLoading(false); setLoadingMore(false)
      return
    }
    var rows = data || []
    var more = !allAtOnce && rows.length > PAGE_SIZE
    if (more) rows = rows.slice(0, PAGE_SIZE)
    var next = append && !allAtOnce ? receipts.concat(rows) : rows
    setReceipts(next)
    setHasMore(more)
    loadMatchImgs(rows)
    setLoading(false); setLoadingMore(false)
    if (!append && onCountChange) onCountChange(next.length + (more ? 1 : 0))
  }

  // Photos of the items the receipts are matched to — one query per table,
  // only for ids not fetched already.
  async function loadMatchImgs(rows) {
    var ids = { inventory: [], catering_store: [] }
    rows.forEach(function (r) {
      var ir = r.item_receipt || {}
      if (!ir.matched_item_id) return
      var src = ir.matched_source === 'catering_store' ? 'catering_store' : 'inventory'
      var key = src + ':' + ir.matched_item_id
      if (matchImgs[key] === undefined && ids[src].indexOf(ir.matched_item_id) === -1) ids[src].push(ir.matched_item_id)
    })
    if (ids.inventory.length === 0 && ids.catering_store.length === 0) return
    var res = await Promise.all([
      ids.inventory.length ? supabase.from('inventory_items').select('id, image_path, category_id, sub_category_id').in('id', ids.inventory) : Promise.resolve({ data: [] }),
      ids.catering_store.length ? supabase.from('catering_store_items').select('id, image_path, category_id, sub_category_id').in('id', ids.catering_store) : Promise.resolve({ data: [] }),
    ])
    var add = {}
    function info(it) { return { img: itemImgUrl(it.image_path), cat: it.category_id ? String(it.category_id) : '', sub: it.sub_category_id ? String(it.sub_category_id) : '' } }
    ids.inventory.forEach(function (id) { add['inventory:' + id] = { img: '', cat: '', sub: '' } })
    ids.catering_store.forEach(function (id) { add['catering_store:' + id] = { img: '', cat: '', sub: '' } })
    ;(res[0].data || []).forEach(function (it) { add['inventory:' + it.id] = info(it) })
    ;(res[1].data || []).forEach(function (it) { add['catering_store:' + it.id] = info(it) })
    setMatchImgs(function (prev) { return Object.assign({}, prev, add) })
  }

  function matchInfoFor(r) {
    var ir = (r && r.item_receipt) || {}
    if (!ir.matched_item_id) return null
    return matchImgs[(ir.matched_source === 'catering_store' ? 'catering_store' : 'inventory') + ':' + ir.matched_item_id] || null
  }
  function matchImgFor(r) {
    var m = matchInfoFor(r)
    return (m && m.img) || ''
  }

  var visibleReceipts = !catFilter ? receipts : receipts.filter(function (r) {
    var ir = r.item_receipt || {}
    var m = matchInfoFor(r)
    var cat = (m && m.cat) || (ir.matched_category_id ? String(ir.matched_category_id) : '')
    if (cat !== catFilter) return false
    return !subCatFilter || ((m && m.sub) === subCatFilter)
  })
  var subCatOptions = catFilter ? subCategories.filter(function (sc) { return String(sc.category_id) === catFilter }) : []

  function handleReceiveDone() {
    setActiveReceipt(null)
    loadReceipts(false)
  }

  var filterCount = 0
  if (search) filterCount++
  if (submitterFilter) filterCount++
  if (dateFrom) filterCount++
  if (dateTo) filterCount++
  if (matchState) filterCount++
  if (catFilter) filterCount++
  if (subCatFilter) filterCount++
  function resetFilters() {
    setSearch(''); setSubmitterFilter(''); setDateFrom(''); setDateTo(''); setMatchState('')
    setCatFilter(''); setSubCatFilter('')
  }

  return (
    <div className="space-y-3">
      {/* Filter bar: search and the Filters toggle on one line, one height;
          the panel lays its four filters out in a row on a wide screen. */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input type="text" value={search}
              onChange={function (e) { setSearch(e.target.value) }}
              placeholder="Search item, notes, submitter..."
              className="w-full h-11 pl-9 pr-3 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              style={{ fontSize: '16px' }} />
          </div>
          <button type="button" onClick={function () { setFiltersOpen(!filtersOpen) }} aria-expanded={filtersOpen}
            className={"shrink-0 h-11 px-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-xl border transition-colors " +
              (filtersOpen || filterCount > 0 ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50")}>
            <Icon name="filter" size={15} />
            Filters
            {filterCount > 0 && <span className="min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-indigo-600 text-white text-[11px] font-bold tabular-nums">{filterCount}</span>}
            <Icon name="chevronDown" size={15} className={"transition-transform " + (filtersOpen ? "rotate-180" : "")} />
          </button>
          {filterCount > 0 && (
            <button type="button" onClick={resetFilters}
              className="shrink-0 h-11 px-3.5 text-[13px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
              Clear
            </button>
          )}
        </div>
        {filtersOpen && (
          <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] items-end">
              <div className="col-span-2 sm:col-span-1">
                <label className="hidden sm:block text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1.5">Type</label>
                <div className="grid grid-cols-3 w-full sm:inline-grid sm:w-auto h-9 sm:h-10 p-1 rounded-lg bg-slate-100 border border-slate-200">
                  {['', 'matched', 'new'].map(function (s) {
                    var label = s === '' ? 'All' : s === 'matched' ? 'Matched' : 'New item'
                    var on = matchState === s
                    return (
                      <button key={s || 'all'} type="button" onClick={function () { setMatchState(s) }} aria-pressed={on}
                        className={"px-3 rounded-md text-[12.5px] font-semibold whitespace-nowrap transition-colors " +
                          (on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="min-w-0">
                <label className="hidden sm:block text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1.5">Category</label>
                <SearchDropdown noVoice placeholder="All categories"
                  items={categories.map(function (c) { return { label: c.name, value: String(c.id) } })}
                  value={catFilter}
                  onChange={function (v) { setCatFilter(v); setSubCatFilter('') }} />
              </div>
              <div className="min-w-0">
                <label className="hidden sm:block text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1.5">Sub-category</label>
                {catFilter ? (
                  <SearchDropdown noVoice placeholder="All sub-categories"
                    items={subCatOptions.map(function (sc) { return { label: sc.name, value: String(sc.id) } })}
                    value={subCatFilter}
                    onChange={function (v) { setSubCatFilter(v) }} />
                ) : (
                  <div className="flex items-center gap-1.5 h-[42px] px-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-[13px] text-slate-400 select-none">
                    <Icon name="lock" size={12} className="shrink-0" /><span className="truncate">Pick a category first</span>
                  </div>
                )}
              </div>
              <div className="min-w-0 col-span-2 sm:col-span-1">
                <label className="hidden sm:block text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1.5">Submitter</label>
                <select value={submitterFilter}
                  onChange={function (e) { setSubmitterFilter(e.target.value) }}
                  className="w-full h-9 sm:h-10 px-2.5 sm:px-3 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                  style={{ fontSize: '15px' }}>
                  <option value="">All submitters</option>
                  {submitterOptions.map(function (u) {
                    return <option key={u.id} value={u.id}>{u.name || '—'}</option>
                  })}
                </select>
              </div>
              <div className="min-w-0">
                <label className="block text-[10px] sm:text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1 sm:mb-1.5">From</label>
                <input type="date" value={dateFrom} max={dateTo || undefined}
                  onChange={function (e) { setDateFrom(e.target.value) }}
                  className="w-full h-9 sm:h-10 px-2.5 sm:px-3 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                  style={{ fontSize: '14px' }} />
              </div>
              <div className="min-w-0">
                <label className="block text-[10px] sm:text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.06em] mb-1 sm:mb-1.5">To</label>
                <input type="date" value={dateTo} min={dateFrom || undefined}
                  onChange={function (e) { setDateTo(e.target.value) }}
                  className="w-full h-9 sm:h-10 px-2.5 sm:px-3 border border-slate-300 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                  style={{ fontSize: '14px' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {loading && <p className="text-gray-400 text-sm text-center py-8">Loading...</p>}
      {!loading && visibleReceipts.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No pending item receipts{filterCount > 0 ? ' match the filters' : ''}</p>
        </div>
      )}
      {/* Receipts as compact cards, two or three to a row on a wide screen:
          the item and its quantity, who sent it and when, whether it is
          matched, the expense it came on, and the amount with Receive. */}
      {visibleReceipts.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleReceipts.map(function (r) {
            var ir = r.item_receipt || {}
            var matched = !!ir.matched_item_id
            var img = matchImgFor(r)
            return (
              <button key={r.id + '_' + r.receipt_index} type="button" onClick={function () { setActiveReceipt(r) }}
                className="text-left h-full w-full min-w-0 flex flex-col bg-white border border-slate-200 rounded-2xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:border-indigo-300 hover:shadow-md active:bg-slate-50 transition-all">
                <div className="flex items-start gap-3">
                  {/* photo of the inventory item it is matched to */}
                  <span className="group/thumb relative shrink-0 w-11 h-11">
                    <span className="w-full h-full rounded-lg border border-slate-200 bg-slate-50 overflow-hidden inline-flex items-center justify-center">
                      {img
                        ? <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" />
                        : <Icon name="box" size={18} className="text-slate-300" />}
                    </span>
                    {/* hover: a big preview of the photo over the card */}
                    {img && (
                      <span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-50 w-56 h-56 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_16px_40px_-8px_rgba(15,23,42,0.35)] opacity-0 scale-50 origin-top-left transition-all duration-150 group-hover/thumb:opacity-100 group-hover/thumb:scale-100">
                        <img src={img} alt="" className="w-full h-full rounded-lg object-cover" />
                      </span>
                    )}
                  </span>
                  <p className="min-w-0 flex-1 text-[15px] font-bold text-slate-900 leading-snug line-clamp-2">{ir.query || 'Item'}</p>
                  <span className="shrink-0 inline-flex items-center h-7 px-2.5 rounded-lg bg-indigo-50 text-indigo-700 text-[13px] font-bold tabular-nums whitespace-nowrap">
                    {ir.qty} {ir.unit}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-slate-500 flex items-center gap-1.5 min-w-0">
                  <Icon name="user" size={12} className="shrink-0 text-slate-400" />
                  <span className="truncate">{r.submitter_name || '—'}</span>
                  <span className="text-slate-300">·</span>
                  <span className="shrink-0">{formatDate(r.expense_date || r.created_at)}</span>
                </p>

                {/* one line: the match chip, then the expense description
                    taking the rest and shortened with … if it runs long */}
                <div className="mt-2.5 flex items-center gap-1.5 min-w-0">
                  {matched ? (
                    <span className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-bold">
                      <Icon name="check" size={11} strokeWidth={3} />Matched
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center h-6 px-2 rounded-md bg-amber-50 text-amber-700 text-[11px] font-bold">New item</span>
                  )}
                  {r.description && (
                    <span className="min-w-0 inline-flex items-center gap-1 h-6 px-2 rounded-md bg-slate-100 text-slate-600 text-[11px] font-semibold" title={r.description}>
                      <Icon name="receipt" size={11} className="shrink-0 text-slate-400" />
                      <span className="truncate">{r.description}</span>
                    </span>
                  )}
                </div>
                {ir.notes && <p className="mt-2 text-[12px] text-slate-500 line-clamp-2">{ir.notes}</p>}

                {/* pinned to the card's foot so a row of cards lines up */}
                <div className="mt-auto pt-3">
                  <div className="pt-3 flex items-center justify-between gap-2 border-t border-slate-100 -mx-4 px-4">
                    <span className="text-[14px] font-extrabold text-slate-900 tabular-nums">{formatPoints(r.line_amount_paise || r.amount_paise)}</span>
                    <span className="inline-flex items-center gap-0.5 text-[12.5px] font-bold text-indigo-600">Receive<Icon name="chevronRight" size={14} /></span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
      {hasMore && (
        <button onClick={function () { loadReceipts(true) }} disabled={loadingMore}
          className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          {loadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}

      {activeReceipt && (
        <ReceiveModal receipt={activeReceipt} profile={profile}
          onClose={function () { setActiveReceipt(null) }}
          onDone={handleReceiveDone}
          onOpenExpense={openExpenseDetail}
          matchImg={matchImgFor(activeReceipt)} />
      )}
      {expenseDetailModal}
    </div>
  )
}

// Item photos live in the public "images" bucket under image_path, for
// inventory_items and catering_store_items alike.
function itemImgUrl(path) {
  if (!path) return ''
  return supabase.storage.from('images').getPublicUrl(path).data?.publicUrl || ''
}

function ReceiveModal({ receipt, profile, onClose, onDone, onOpenExpense, matchImg }) {
  var ir = receipt.item_receipt || {}
  var [mode, setMode] = useState('match')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  var [matchedId, setMatchedId] = useState(ir.matched_item_id || null)
  var [matchedSource, setMatchedSource] = useState(ir.matched_source || 'inventory')
  var [matchedName, setMatchedName] = useState(ir.matched_item_id ? (ir.query || '') : '')
  var [matchedImg, setMatchedImg] = useState(matchImg || '')
  var [receiveQty, setReceiveQty] = useState(String(ir.qty || ''))
  var [itemQuery, setItemQuery] = useState('')
  var [itemMatches, setItemMatches] = useState([])
  var [itemHlIdx, setItemHlIdx] = useState(-1)
  useEffect(function () { setItemHlIdx(-1) }, [itemMatches])
  var itemSearchTimer = useRef(null)

  var [cancelReason, setCancelReason] = useState('')

  function searchItems(term) {
    if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current)
    if (!term || term.trim().length < 2) { setItemMatches([]); return }
    itemSearchTimer.current = setTimeout(function () {
      var q = term.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
      var termLower = term.trim().toLowerCase()
      Promise.all([
        supabase.from('inventory_items').select('id, name, unit, image_path').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(20),
        supabase.from('catering_store_items').select('id, name, unit, image_path').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(20),
      ]).then(function (results) {
        var inv = (results[0].data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory', img: itemImgUrl(i.image_path) }) })
        var cs = (results[1].data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store', img: itemImgUrl(i.image_path) }) })
        var combined = inv.concat(cs).sort(function (a, b) {
          var ra = matchRank(a.name, termLower), rb = matchRank(b.name, termLower)
          if (ra !== rb) return ra - rb
          return a.name.length - b.name.length
        }).slice(0, 12)
        setItemMatches(combined)
      })
    }, 300)
  }

  function pickMatch(item) {
    setMatchedId(item.id)
    setMatchedSource(item._source)
    setMatchedName(item.name)
    setMatchedImg(item.img || '')
    setItemQuery('')
    setItemMatches([])
  }

  function clearMatch() {
    setMatchedId(null)
    setMatchedSource('inventory')
    setMatchedName('')
    setMatchedImg('')
    setItemQuery('')
  }

  async function confirmReceive() {
    if (saving) return
    setError('')
    if (!matchedId) { setError('Pick an item to match'); return }
    if (!receiveQty || Number(receiveQty) <= 0) { setError('Qty must be > 0'); return }
    setSaving(true)
    var { error: err } = await supabase.rpc('receive_expense_item', {
      p_expense_id: receipt.id,
      p_receipt_index: receipt.receipt_index,
      p_item_id: matchedId == null ? null : Number(matchedId),
      p_qty: Number(receiveQty),
      p_source: matchedSource,
    })
    if (err) { setError(err.message); setSaving(false); return }
    try { await logActivity('EXPENSE_RECEIVE', matchedName + ' | qty ' + receiveQty + ' | exp #' + receipt.id) } catch (_) {}
    setSaving(false)
    onDone()
  }

  async function confirmCancel() {
    if (saving) return
    setError('')
    if (!cancelReason.trim()) { setError('Reason required'); return }
    setSaving(true)
    var { error: err } = await supabase.rpc('cancel_expense_item_receipt', {
      p_expense_id: receipt.id,
      p_receipt_index: receipt.receipt_index,
      p_reason: cancelReason.trim(),
    })
    if (err) { setError(err.message); setSaving(false); return }
    try { await logActivity('EXPENSE_RECEIVE_CANCEL', 'exp #' + receipt.id + ' | ' + cancelReason.trim().slice(0, 60)) } catch (_) {}
    setSaving(false)
    onDone()
  }

  async function handleNewItemSaved(savedItem, tableName) {
    if (saving) return
    setSaving(true)
    var source = tableName === 'catering_store_items' ? 'catering_store' : 'inventory'
    var { error: err } = await supabase.rpc('link_expense_to_new_item', {
      p_expense_id: receipt.id,
      p_receipt_index: receipt.receipt_index,
      p_new_item_id: savedItem.id,
      p_source: source,
    })
    if (err) {
      // Item saved but link failed — flip back to match mode; user can search for the just-created item
      setError('Item created but link failed: ' + err.message + '. Search for it under Match Existing.')
      setMode('match')
      setSaving(false)
      return
    }
    try { await logActivity('EXPENSE_RECEIVE_NEW', savedItem.name + ' | exp #' + receipt.id) } catch (_) {}
    setSaving(false)
    onDone()
  }

  var invFormPrefill = {
    name: ir.query || '',
    qty: ir.qty || '',
    unit: ir.unit || 'Pieces',
    category_id: ir.matched_category_id || null,
    description: ir.notes || '',
  }

  var modalTitle = mode === 'new' ? 'Create New Item' : mode === 'cancel' ? 'Cancel Receipt' : 'Receive Item'

  return (
    <Modal open={true} onClose={onClose} title={modalTitle}>
      <div className="space-y-3 sm:space-y-4">
        {/* The receipt: the item and quantity asked for, who sent it and when,
            the expense it came on. Creating a new item swaps it for a slim
            bar so the form starts near the top. */}
        {mode !== 'new' && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-indigo-500">Item requested</p>
              <p className="mt-0.5 text-[15px] sm:text-[16px] font-bold text-slate-900 leading-snug break-words">{ir.query || '—'}</p>
            </div>
            <span className="shrink-0 inline-flex items-center h-7 sm:h-8 px-2.5 sm:px-3 rounded-lg bg-indigo-50 text-indigo-700 text-[13px] sm:text-[14px] font-bold tabular-nums whitespace-nowrap">
              {ir.qty} {ir.unit}
            </span>
          </div>
          {ir.notes && <p className="mt-1 text-[12.5px] text-slate-500">{ir.notes}</p>}
          {ir.matched_item_id && (
            <p className="mt-2 inline-flex items-center gap-1 h-6 px-2 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-bold">
              <Icon name="check" size={11} strokeWidth={3} /><span className="sm:hidden">Matched by submitter</span><span className="hidden sm:inline">Submitter matched it to an existing item</span>
            </p>
          )}

          <div className="sm:hidden mt-2.5 pt-2.5 border-t border-slate-200 flex items-center justify-between gap-3 text-[12px]">
            <p className="min-w-0 flex items-center gap-1.5 text-slate-500">
              <Icon name="user" size={12} className="shrink-0 text-slate-400" />
              <span className="truncate font-semibold text-slate-700">{receipt.submitter_name || '—'}</span>
              <span className="text-slate-300">·</span>
              <span className="shrink-0">{formatDate(receipt.expense_date || receipt.created_at)}</span>
            </p>
            <p className="shrink-0 font-bold text-slate-900 tabular-nums">{formatPoints(receipt.amount_paise)}</p>
          </div>
          <div className="hidden sm:grid mt-3 pt-3 border-t border-slate-200 grid-cols-3 gap-2 text-[12px]">
            <div className="min-w-0">
              <p className="text-slate-400 font-medium">Submitter</p>
              <p className="font-semibold text-slate-800 truncate" title={receipt.submitter_name || ''}>{receipt.submitter_name || '—'}</p>
            </div>
            <div className="min-w-0">
              <p className="text-slate-400 font-medium">Expense date</p>
              <p className="font-semibold text-slate-800">{formatDate(receipt.expense_date || receipt.created_at)}</p>
            </div>
            <div className="min-w-0 text-right">
              <p className="text-slate-400 font-medium">Amount</p>
              <p className="font-semibold text-slate-800 tabular-nums">{formatPoints(receipt.amount_paise)}</p>
            </div>
          </div>
          {(receipt.description || onOpenExpense) && (
            <div className="mt-2.5 sm:mt-3 flex items-center justify-between gap-2 min-w-0">
              {receipt.description
                ? <span className="min-w-0 inline-flex items-center gap-1 h-6 px-2 rounded-md bg-white border border-slate-200 text-slate-600 text-[11.5px] font-semibold" title={receipt.description}>
                    <Icon name="receipt" size={11} className="shrink-0 text-slate-400" /><span className="truncate">{receipt.description}</span>
                  </span>
                : <span />}
              {onOpenExpense && (
                <button type="button" onClick={function () { onOpenExpense(receipt.id) }}
                  className="shrink-0 inline-flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-lg border border-indigo-200 bg-white text-[12px] font-semibold text-indigo-700 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:bg-indigo-50 hover:border-indigo-300 transition-colors">
                  <Icon name="fileText" size={13} className="text-indigo-500" />
                  View expense
                  <Icon name="chevronRight" size={13} className="text-indigo-400" />
                </button>
              )}
            </div>
          )}
        </div>

        )}

        {/* What to do with it — hidden while creating a new item */}
        {mode !== 'new' && (
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200">
            {[['match', 'Match existing'], ['new', 'Create new'], ['cancel', 'Cancel receipt']].map(function (o) {
              var on = mode === o[0]
              return (
                <button key={o[0]} type="button" onClick={function () { setMode(o[0]); setError('') }} aria-pressed={on}
                  className={"h-8 sm:h-9 rounded-lg text-[12px] sm:text-[12.5px] font-semibold whitespace-nowrap transition-colors " +
                    (on ? (o[0] === 'cancel' ? "bg-red-600 text-white shadow-sm" : "bg-white text-slate-900 shadow-sm")
                      : (o[0] === 'cancel' ? "text-slate-500 hover:text-red-600" : "text-slate-500 hover:text-slate-800"))}>
                  {o[1]}
                </button>
              )
            })}
          </div>
        )}

        {/* Match mode */}
        {mode === 'match' && (
          <div className="space-y-3">
            {matchedId ? (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 sm:p-3">
                {matchedImg ? (
                  <img src={matchedImg} alt="" className="shrink-0 w-12 h-12 rounded-lg border border-emerald-200 bg-white object-cover" />
                ) : (
                  <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white border border-emerald-200 text-emerald-600 hidden sm:inline-flex items-center justify-center">
                    <Icon name="box" size={17} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-emerald-700">Will be added to</p>
                  <p className="text-[14.5px] font-bold text-slate-900 leading-snug break-words">{matchedName}</p>
                  <p className="text-[11.5px] text-slate-500">{matchedSource === 'catering_store' ? 'Catering Store' : 'Inventory'}</p>
                </div>
                <button type="button" onClick={clearMatch}
                  className="shrink-0 h-8 px-3 rounded-lg bg-white border border-slate-200 text-[12px] font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 transition-colors">
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <label className="block text-xs font-medium text-gray-600 mb-1">Search inventory</label>
                <input type="text" value={itemQuery}
                  onChange={function (e) { setItemQuery(e.target.value); searchItems(e.target.value) }}
                  onKeyDown={function (e) {
                    if (itemMatches.length === 0) return
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setItemHlIdx(function (prev) { return Math.min(prev + 1, itemMatches.length - 1) })
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setItemHlIdx(function (prev) { return Math.max(prev - 1, 0) })
                    } else if (e.key === 'Enter') {
                      if (itemHlIdx >= 0 && itemHlIdx < itemMatches.length) {
                        e.preventDefault()
                        pickMatch(itemMatches[itemHlIdx])
                      }
                    } else if (e.key === 'Escape') {
                      setItemMatches([])
                    }
                  }}
                  placeholder="Type item name..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white" style={{ fontSize: '16px' }} />
                {itemMatches.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {itemMatches.map(function (m, mIdx) {
                      return (
                        <button key={m._source + '_' + m.id} type="button"
                          onMouseEnter={function () { setItemHlIdx(mIdx) }}
                          onMouseDown={function (evt) { evt.preventDefault(); pickMatch(m) }}
                          className={'w-full text-left px-3 py-2 border-b border-gray-50 last:border-0 ' + (mIdx === itemHlIdx ? 'bg-indigo-50' : 'hover:bg-indigo-50')}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="shrink-0 w-8 h-8 rounded-md border border-slate-200 bg-slate-50 overflow-hidden inline-flex items-center justify-center">
                              {m.img ? <img src={m.img} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Icon name="box" size={14} className="text-slate-300" />}
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm text-gray-800 font-medium truncate">{m.name}</div>
                              <div className="text-[10px] text-gray-400">{m._source === 'catering_store' ? 'Catering Store' : 'Inventory'}{m.unit ? ' · ' + m.unit : ''}</div>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <label className="text-[12.5px] font-semibold text-slate-700">Qty received <span className="text-red-500">*</span></label>
                <span className="text-[11.5px] text-slate-400">Asked for <span className="font-semibold text-slate-600">{ir.qty} {ir.unit}</span></span>
              </div>
              {/* the unit sits inside the field, behind a divider */}
              <div className="flex h-10 sm:h-11 rounded-xl border border-slate-300 bg-white overflow-hidden focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
                <input type="number" value={receiveQty}
                  onChange={function (e) { setReceiveQty(e.target.value) }}
                  min="0" step="any" aria-label="Quantity received"
                  className="flex-1 min-w-0 px-3 bg-transparent text-slate-900 focus:outline-none" style={{ fontSize: '16px' }} />
                {ir.unit && <span className="shrink-0 inline-flex items-center px-3 bg-slate-50 border-l border-slate-200 text-[13px] font-medium text-slate-600">{ir.unit}</span>}
              </div>
            </div>

            {error && <p className="text-[12.5px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} disabled={saving}
                className="flex-1 h-11 text-sm font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors">
                Close
              </button>
              <button type="button" onClick={confirmReceive} disabled={saving || !matchedId}
                className="flex-[1.6] h-11 inline-flex items-center justify-center gap-1.5 text-sm font-bold text-white bg-indigo-600 rounded-xl shadow-[0_2px_8px_rgba(79,70,229,0.3)] hover:bg-indigo-700 disabled:opacity-40 disabled:shadow-none transition-colors">
                {!saving && <Icon name="check" size={15} strokeWidth={2.6} />}
                {saving ? 'Receiving...' : <span><span className="sm:hidden">Receive to stock</span><span className="hidden sm:inline">Receive &amp; add to stock</span></span>}
              </button>
            </div>
          </div>
        )}

        {/* New mode — renders InventoryForm inline */}
        {mode === 'new' && (
          <div className="space-y-3">
            {/* One slim line: back, the item, its quantity. Saving links the
                receipt to the new item (said on hover, not in a paragraph). */}
            <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-2 py-1.5"
              title="Saving this item links the expense receipt to it">
              <button type="button" onClick={function () { setMode('match'); setError('') }} aria-label="Back to receive"
                className="shrink-0 w-7 h-7 rounded-md bg-white border border-slate-200 inline-flex items-center justify-center text-slate-600 hover:border-slate-400 hover:text-slate-900 transition-colors">
                <Icon name="arrowLeft" size={14} />
              </button>
              <p className="min-w-0 flex-1 text-[13px] text-slate-500 truncate">
                New item: <span className="font-bold text-slate-900">{titleCase(ir.query || '')}</span>
              </p>
              <span className="shrink-0 text-[12.5px] font-bold text-indigo-700 tabular-nums whitespace-nowrap">{ir.qty} {ir.unit}</span>
            </div>
            <InventoryForm
              item={null}
              prefill={invFormPrefill}
              profile={profile}
              onClose={function () { setMode('match'); setError('') }}
              onSaved={handleNewItemSaved}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}

        {/* Cancel mode */}
        {mode === 'cancel' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-red-700 mb-1">Cancel reason <span className="text-red-500">*</span></label>
              <textarea value={cancelReason}
                onChange={function (e) { setCancelReason(e.target.value) }}
                rows={3} maxLength={500} placeholder="e.g. Damaged on arrival, wrong item delivered, expense not really for inventory..."
                className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm focus:outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100 bg-white resize-none" style={{ fontSize: '16px' }} />
              <p className="text-[10px] text-gray-400 mt-0.5">Cancelling only marks the receipt cancelled — the expense itself is untouched.</p>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={function () { setMode('match'); setError('') }} disabled={saving}
                className="flex-1 py-2.5 text-sm font-semibold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
                Back
              </button>
              <button type="button" onClick={confirmCancel} disabled={saving || !cancelReason.trim()}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors">
                {saving ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default ItemReceipts