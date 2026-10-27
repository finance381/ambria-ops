import { useState, useEffect } from 'react'
import { pushBack } from '../../lib/backNav'
import { supabase } from '../../lib/supabase'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import Icon from '../../components/ui/Icon'
import useReviewQueue, { selectionKey, STATUS_BROWSABLE_DOMAINS } from './useReviewQueue'
import useReviewActions from './useReviewActions'
import { DOMAIN_META, DomainIcon, ReviewCard, ReviewDetailSheet, ActionConfirmSheet } from './ReviewComponents.jsx'
import { getAdapter } from './adapters/index.jsx'
import ReviewsHistory from './ReviewsHistory.jsx'

var TAB_ORDER = ['inventory', 'item_receipt', 'expense', 'requisition', 'vendor_payment', 'category', 'sub_category']
var TAB_PERM = {
  inventory: 'review.inventory', item_receipt: 'review.item_receipts', expense: 'review.expenses',
  requisition: 'review.requisitions', vendor_payment: 'review.vendor_payments',
  category: 'review.masters', sub_category: 'review.masters',
}
var AUDIT_DOMAINS = ['expense', 'vendor_payment']
// Inventory has no admin tier any more — the tab is normally dept-head-only,
// gated on role + permission + an actual category assignment rather than a
// flat permission key (see 00058_inventory_single_stage_approval.sql).
// TEMPORARY: the role === 'dept. head' check is dropped for now so an admin
// account can open this tab directly to debug reported bugs in it — put it
// back (`if (!profile || profile.role !== 'dept. head') return false`)
// once that's done; admins otherwise keep full visibility of inventory
// items elsewhere (Inventory > All Items), just not normally in this queue.
function isInventoryDeptHead(profile) {
  if (!profile) return false
  var perms = profile.permsNew || []
  if (!hasPerm(perms, 'review.dept.approve')) return false
  return (profile.category_ids || []).length > 0
}
// Short forms for the mobile bottom tab bar — with 7 domains crammed into one row,
// DOMAIN_META's full label (or its first word) is too wide for domains that are
// either a single hyphenated word ("Sub-categories" won't split on a space) or
// just long ("Requisitions").
var MOBILE_TAB_LABEL = {
  inventory: 'Inventory', item_receipt: 'Item', expense: 'Expenses',
  requisition: 'Reqs', vendor_payment: 'Vendor', category: 'Category', sub_category: 'Sub-cat',
}
// Full filter row (venue/age/tags/search/category/sub-category/department/status) —
// only meaningful for the 3 domains with real tag/venue/status semantics.
var FULL_FILTER_DOMAINS = ['inventory', 'item_receipt', 'requisition']

function applyAgeFilter(items, ageFilter) {
  if (!ageFilter) return items
  if (ageFilter === 'urgent') return items.filter(function (it) { return it.priority === 'urgent' })
  return items.filter(function (it) { return it.priority === 'aging' || it.priority === 'urgent' })
}

// Sub-department lives on the category (categories.sub_department_id), not on
// the item itself — same indirection AdminItems' own "Master Sub-dept" filter
// uses (src/modules/inventory/AdminItems.jsx matchSubDept).
function applySubDeptFilter(items, subDeptFilter, categories) {
  if (!subDeptFilter) return items
  var catIds = categories.filter(function (c) { return String(c.sub_department_id) === subDeptFilter }).map(function (c) { return c.id })
  return items.filter(function (it) { return catIds.indexOf((it.tags || {}).category_id) !== -1 })
}

function Reviews({ profile, inAdmin }) {
  var permsNew = (profile && profile.permsNew) || []
  // On a phone, History is a step on the app's back stack: the header's
  // arrow and a swipe come back to the inbox, and the page needs no Back of
  // its own. The admin console has no arrow and keeps the button.
  function openHistory() {
    if (!inAdmin) pushBack(function () { setView('inbox') })
    setView('history')
  }
  var visibleTabs = TAB_ORDER.filter(function (d) {
    if (d === 'inventory') return isInventoryDeptHead(profile)
    return hasPerm(permsNew, TAB_PERM[d])
  })
  var canBulk = hasPerm(permsNew, 'review.bulk')
  var canSeeHistory = hasPerm(permsNew, 'review.history')
  var [view, setView] = useState('inbox') // 'inbox' | 'history'

  var refData = useReferenceData()
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [departments, setDepartments] = useState([])
  var [subVenues, setSubVenues] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [subDeptFilter, setSubDeptFilter] = useState('')
  useEffect(function () {
    Promise.all([
      supabase.from('categories').select('id, name, sub_department_id').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name'),
      supabase.from('departments').select('id, name').eq('active', true).order('name'),
      supabase.from('sub_venues').select('id, name, venue_id').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, name, department_id').eq('active', true).order('name'),
    ]).then(function (res) {
      setCategories(res[0].data || [])
      setSubCategories(res[1].data || [])
      setDepartments(res[2].data || [])
      setSubVenues(res[3].data || [])
      setSubDepartments(res[4].data || [])
    })
  }, [])

  var [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true)
  useEffect(function () {
    function onResize() { setIsDesktop(window.innerWidth >= 768) }
    window.addEventListener('resize', onResize)
    return function () { window.removeEventListener('resize', onResize) }
  }, [])

  var queueApi = useReviewQueue(profile)
  var subVenueOptions = subVenues.filter(function (sv) {
    return !queueApi.venueFilter || String(sv.venue_id) === String(queueApi.venueFilter)
  })
  var [selectMode, setSelectMode] = useState(false)
  var [openItem, setOpenItem] = useState(null)
  var [bulkConfirm, setBulkConfirm] = useState(null) // 'approve' | 'reject'
  var [ageFilter, setAgeFilter] = useState('')
  var [auditItems, setAuditItems] = useState([])
  var [auditLoading, setAuditLoading] = useState(false)
  var bulkActions = useReviewActions(null)

  var isAuditDomain = AUDIT_DOMAINS.indexOf(queueApi.domain) !== -1
  var showFullFilters = FULL_FILTER_DOMAINS.indexOf(queueApi.domain) !== -1
  var showStatusFilter = STATUS_BROWSABLE_DOMAINS.indexOf(queueApi.domain) !== -1

  useEffect(function () {
    if (visibleTabs.length > 0 && visibleTabs.indexOf(queueApi.domain) === -1) {
      queueApi.setDomain(visibleTabs[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadAudit() {
    var adapter = getAdapter(queueApi.domain)
    if (!adapter || !adapter.fetchList) return
    setAuditLoading(true)
    adapter.fetchList(100).then(function (rows) { setAuditItems(rows); setAuditLoading(false) })
      .catch(function () { setAuditItems([]); setAuditLoading(false) })
  }

  useEffect(function () {
    setSelectMode(false)
    setAgeFilter('')
    setSubDeptFilter('')
    if (isAuditDomain) loadAudit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueApi.domain])

  var displayItems = isAuditDomain ? auditItems : applySubDeptFilter(applyAgeFilter(queueApi.items, ageFilter), subDeptFilter, categories)
  var displayLoading = isAuditDomain ? auditLoading : queueApi.pending.loading
  var totalCount = visibleTabs.reduce(function (s, d) { return s + (queueApi.counts[d] || 0) }, 0)

  var subCategoryOptions = subCategories.filter(function (sc) {
    return !queueApi.categoryFilter || String(sc.category_id) === queueApi.categoryFilter
  })

  function handleToggleSelect(item) { queueApi.toggleSelect(item) }
  function handleOpen(item) { if (!selectMode) setOpenItem(item) }
  function handleActioned() {
    setOpenItem(null)
    queueApi.refresh()
  }

  async function runBulk(kind, notes) {
    var ids = displayItems
      .filter(function (it) { return queueApi.selection.has(selectionKey(it)) })
      .map(function (it) { return it.source_id })
    if (ids.length === 0) { setBulkConfirm(null); return }
    if (kind === 'approve') await bulkActions.bulkApprove(queueApi.domain, ids, notes || null)
    else await bulkActions.bulkReject(queueApi.domain, ids, notes)
    setBulkConfirm(null)
    setSelectMode(false)
    queueApi.clearSelection()
    queueApi.refresh()
  }

  if (view === 'history') {
    return (
      <div className="space-y-3">
        {inAdmin && <button onClick={function () { setView('inbox') }} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors">← Back to Reviews</button>}
        <ReviewsHistory profile={profile} />
      </div>
    )
  }

  if (visibleTabs.length === 0) {
    return <p className="text-gray-400 text-sm text-center py-12">You don't have access to any review domain.</p>
  }

  var filterRow = (
    <div className="flex flex-wrap items-center gap-2">
      {showFullFilters && (
        <>
          <input type="text" value={queueApi.search} onChange={function (ev) { queueApi.setSearch(ev.target.value) }}
            placeholder="Search item, submitter..."
            className="min-w-[180px] px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }} />
          <select value={queueApi.departmentFilter} onChange={function (ev) { queueApi.setDepartmentFilter(ev.target.value) }}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
            <option value="">All departments</option>
            {departments.map(function (d) { return <option key={d.id} value={d.name}>{d.name}</option> })}
          </select>
          <select value={queueApi.categoryFilter} onChange={function (ev) { queueApi.setCategoryFilter(ev.target.value); queueApi.setSubCategoryFilter('') }}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
            <option value="">All categories</option>
            {categories.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
          </select>
          <select value={queueApi.subCategoryFilter} onChange={function (ev) { queueApi.setSubCategoryFilter(ev.target.value) }}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
            <option value="">All sub-categories</option>
            {subCategoryOptions.map(function (sc) { return <option key={sc.id} value={String(sc.id)}>{sc.name}</option> })}
          </select>
          <select value={queueApi.venueFilter} onChange={function (ev) { queueApi.setVenueFilter(ev.target.value) }}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
            <option value="">All venues</option>
            {(refData.venues || []).map(function (v) { return <option key={v.id} value={v.id}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
          </select>
          <select value={queueApi.subVenueFilter} onChange={function (ev) { queueApi.setSubVenueFilter(ev.target.value) }}
            disabled={subVenueOptions.length === 0}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white disabled:opacity-50" style={{ fontSize: '16px' }}>
            <option value="">All sub-venues</option>
            {subVenueOptions.map(function (sv) { return <option key={sv.id} value={String(sv.id)}>{sv.name}</option> })}
          </select>
          <select value={ageFilter} onChange={function (ev) { setAgeFilter(ev.target.value) }}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
            <option value="">Any age</option>
            <option value="aging">Aging+</option>
            <option value="urgent">Urgent only</option>
          </select>
          {showStatusFilter && (
            <select value={queueApi.statusFilter} onChange={function (ev) { queueApi.setStatusFilter(ev.target.value) }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="approved">Approved</option>
            </select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={queueApi.myTagsOnly} onChange={function (ev) { queueApi.setMyTagsOnly(ev.target.checked) }} />
            My tags only
          </label>
        </>
      )}
    </div>
  )

  // Inventory-only grouped "Filter items" card, matching AdminItems' own
  // filter-panel look (src/modules/inventory/AdminItems.jsx ~line 1420-1507):
  // Category/Sub-category, Venue/Sub-venue and a Details group, each a card
  // with an icon badge, a child field locked until its parent is picked.
  // No flat department dropdown here — on this tab the department is already
  // implied by the viewer's own dept-head scope, so Sub-department (via
  // categories.sub_department_id, same indirection AdminItems uses for its
  // "Master Sub-dept" filter) takes its place instead.
  var invFL = "block text-[12.5px] font-bold text-slate-800 mb-1.5"
  var invSelectCls = "w-full h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-[14px] font-medium text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
  function invDisabledBox(text) {
    return (
      <div className="h-11 flex items-center gap-2 px-3.5 rounded-xl border border-dashed border-slate-300 bg-slate-100 text-[13px] font-medium text-slate-500 select-none">
        <Icon name="lock" size={13} className="shrink-0 text-slate-400" />
        {text}
      </div>
    )
  }
  function invFilterGroup(icon, title, body) {
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
  var anyInventoryFilterActive = !!(queueApi.categoryFilter || queueApi.subCategoryFilter || queueApi.venueFilter || queueApi.subVenueFilter || subDeptFilter || ageFilter || (showStatusFilter && queueApi.statusFilter !== 'pending'))
  function resetInventoryFilters() {
    queueApi.setCategoryFilter(''); queueApi.setSubCategoryFilter('')
    queueApi.setVenueFilter(''); queueApi.setSubVenueFilter('')
    setSubDeptFilter('')
    setAgeFilter('')
    if (showStatusFilter) queueApi.setStatusFilter('pending')
  }
  var inventoryFilterRow = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={queueApi.search} onChange={function (ev) { queueApi.setSearch(ev.target.value) }}
          placeholder="Search item, submitter..."
          className="min-w-[220px] flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white" style={{ fontSize: '16px' }} />
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={queueApi.myTagsOnly} onChange={function (ev) { queueApi.setMyTagsOnly(ev.target.checked) }} />
          My tags only
        </label>
      </div>
      <div className="p-4 rounded-[20px] bg-white border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3.5">
          <p className="text-[16px] font-extrabold text-slate-900">Filter items</p>
          <button type="button" onClick={resetInventoryFilters} disabled={!anyInventoryFilterActive}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold text-red-600 hover:bg-red-50 disabled:text-slate-400 disabled:hover:bg-transparent disabled:cursor-default transition-colors">
            <Icon name="refresh" size={13} />Reset all
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {invFilterGroup('tag', 'Category', (
            <>
              <div>
                <label className={invFL}>Category</label>
                <select value={queueApi.categoryFilter} onChange={function (ev) { queueApi.setCategoryFilter(ev.target.value); queueApi.setSubCategoryFilter('') }} className={invSelectCls}>
                  <option value="">All Categories</option>
                  {categories.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
                </select>
              </div>
              <div>
                <label className={invFL}>Sub-category</label>
                {queueApi.categoryFilter
                  ? <select value={queueApi.subCategoryFilter} onChange={function (ev) { queueApi.setSubCategoryFilter(ev.target.value) }} className={invSelectCls}>
                      <option value="">All Sub-categories</option>
                      {subCategoryOptions.map(function (sc) { return <option key={sc.id} value={String(sc.id)}>{sc.name}</option> })}
                    </select>
                  : invDisabledBox('Pick a category first')}
              </div>
            </>
          ))}
          {invFilterGroup('mapPin', 'Location', (
            <>
              <div>
                <label className={invFL}>Venue</label>
                <select value={queueApi.venueFilter} onChange={function (ev) { queueApi.setVenueFilter(ev.target.value) }} className={invSelectCls}>
                  <option value="">All Venues</option>
                  {(refData.venues || []).map(function (v) { return <option key={v.id} value={v.id}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
                </select>
              </div>
              <div>
                <label className={invFL}>Sub-venue</label>
                {queueApi.venueFilter
                  ? <select value={queueApi.subVenueFilter} onChange={function (ev) { queueApi.setSubVenueFilter(ev.target.value) }} className={invSelectCls}>
                      <option value="">All Sub-venues</option>
                      {subVenueOptions.map(function (sv) { return <option key={sv.id} value={String(sv.id)}>{sv.name}</option> })}
                    </select>
                  : invDisabledBox('Pick a venue first')}
              </div>
            </>
          ))}
          {invFilterGroup('box', 'Details', (
            <>
              <div>
                <label className={invFL}>Sub-department</label>
                <select value={subDeptFilter} onChange={function (ev) { setSubDeptFilter(ev.target.value) }} className={invSelectCls}>
                  <option value="">All Sub-departments</option>
                  {subDepartments.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
                </select>
              </div>
              <div>
                <label className={invFL}>Age</label>
                <select value={ageFilter} onChange={function (ev) { setAgeFilter(ev.target.value) }} className={invSelectCls}>
                  <option value="">Any age</option>
                  <option value="aging">Aging+</option>
                  <option value="urgent">Urgent only</option>
                </select>
              </div>
              {showStatusFilter && (
                <div>
                  <label className={invFL}>Status</label>
                  <select value={queueApi.statusFilter} onChange={function (ev) { queueApi.setStatusFilter(ev.target.value) }} className={invSelectCls}>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                    <option value="approved">Approved</option>
                  </select>
                </div>
              )}
            </>
          ))}
        </div>
      </div>
    </div>
  )

  var listBody = (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {displayLoading ? (
        <p className="text-center text-sm text-gray-400 py-8">Loading...</p>
      ) : displayItems.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">Nothing here</p>
      ) : (
        displayItems.map(function (item) {
          var key = selectionKey(item)
          return (
            <ReviewCard key={key} item={item} onOpen={handleOpen} onToggleSelect={handleToggleSelect}
              selected={queueApi.selection.has(key)} selectMode={selectMode} />
          )
        })
      )}
    </div>
  )

  var detailAndConfirm = (
    <>
      {openItem && (
        <ReviewDetailSheet item={openItem} onClose={function () { setOpenItem(null) }} onActioned={handleActioned}
          isMobile={!isDesktop} profile={profile} />
      )}
      {bulkConfirm && (
        <ActionConfirmSheet action={bulkConfirm} item={null} saving={bulkActions.saving}
          onCancel={function () { setBulkConfirm(null) }}
          onConfirm={function (notes) { runBulk(bulkConfirm, notes) }} />
      )}
    </>
  )

  if (isDesktop) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Reviews</h2>
            <p className="text-xs text-gray-400">{totalCount} pending across {visibleTabs.length} domain{visibleTabs.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex gap-2">
            {canSeeHistory && (
              <button onClick={openHistory} className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg">History</button>
            )}
            {canBulk && !isAuditDomain && (
              <button onClick={function () { setSelectMode(!selectMode); queueApi.clearSelection() }}
                className={"px-3 py-1.5 text-xs font-bold rounded-lg " + (selectMode ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700")}>
                {selectMode ? 'Cancel Select' : 'Select'}
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-1.5 border-b border-gray-200 overflow-x-auto">
          {visibleTabs.map(function (d) {
            var meta = DOMAIN_META[d]
            var active = queueApi.domain === d
            return (
              <button key={d} onClick={function () { queueApi.setDomain(d) }}
                className={"px-3 py-2 text-sm font-semibold flex items-center gap-1.5 border-b-2 transition-colors whitespace-nowrap " + (active ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500 hover:text-gray-700")}>
                <DomainIcon domain={d} /> {meta.label}
                {queueApi.counts[d] > 0 && <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-1.5">{queueApi.counts[d]}</span>}
              </button>
            )
          })}
        </div>

        {showFullFilters && (queueApi.domain === 'inventory' ? inventoryFilterRow : filterRow)}
        {listBody}

        {selectMode && queueApi.selection.size > 0 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-full px-4 py-2.5 flex items-center gap-3 shadow-xl z-40">
            <span className="text-sm">{queueApi.selection.size} selected</span>
            <button onClick={function () { setBulkConfirm('reject') }} className="text-sm font-bold text-red-300">Reject all</button>
            <button onClick={function () { setBulkConfirm('approve') }} className="text-sm font-bold text-emerald-300">Approve all</button>
            <button onClick={function () { setSelectMode(false); queueApi.clearSelection() }} className="text-sm text-gray-400">Cancel</button>
          </div>
        )}

        {detailAndConfirm}
      </div>
    )
  }

  // ═══ MOBILE — Concept B: bottom tab bar ═══
  return (
    <div className="space-y-2 pb-20">
      <div className="sticky top-0 bg-gray-50/95 backdrop-blur z-30 -mx-4 px-4 py-2 border-b border-gray-100 flex items-center justify-between">
        {selectMode ? (
          <>
            <button onClick={function () { setSelectMode(false); queueApi.clearSelection() }} className="text-sm text-gray-500">✕ Cancel</button>
            <span className="text-sm font-bold text-gray-900">{queueApi.selection.size} selected</span>
            <span className="w-12" />
          </>
        ) : (
          <>
            <div>
              <p className="text-sm font-bold text-gray-900">{DOMAIN_META[queueApi.domain] ? DOMAIN_META[queueApi.domain].label : ''}</p>
              <p className="text-[10px] text-gray-400">{displayItems.length} item{displayItems.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              {showFullFilters && (
                <label className="flex items-center gap-1 text-[10px] text-gray-500">
                  <input type="checkbox" checked={queueApi.myTagsOnly} onChange={function (ev) { queueApi.setMyTagsOnly(ev.target.checked) }} /> mine
                </label>
              )}
              {canSeeHistory && (
                <button onClick={openHistory} className="text-xs font-bold text-gray-500">History</button>
              )}
              {canBulk && !isAuditDomain && (
                <button onClick={function () { setSelectMode(true) }} className="text-xs font-bold text-indigo-600">Select</button>
              )}
            </div>
          </>
        )}
      </div>

      {showFullFilters && !selectMode && (
        <div className="space-y-1.5 px-0.5">
          <input type="text" value={queueApi.search} onChange={function (ev) { queueApi.setSearch(ev.target.value) }}
            placeholder="Search item, submitter..."
            className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }} />
          <div className="flex gap-2">
            <select value={queueApi.categoryFilter} onChange={function (ev) { queueApi.setCategoryFilter(ev.target.value); queueApi.setSubCategoryFilter('') }}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
              <option value="">All categories</option>
              {categories.map(function (c) { return <option key={c.id} value={String(c.id)}>{c.name}</option> })}
            </select>
            <select value={queueApi.venueFilter} onChange={function (ev) { queueApi.setVenueFilter(ev.target.value) }}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
              <option value="">All venues</option>
              {(refData.venues || []).map(function (v) { return <option key={v.id} value={v.id}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
            </select>
          </div>
          {queueApi.domain === 'inventory' && (
            <select value={subDeptFilter} onChange={function (ev) { setSubDeptFilter(ev.target.value) }}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
              <option value="">All sub-departments</option>
              {subDepartments.map(function (sd) { return <option key={sd.id} value={String(sd.id)}>{sd.name}</option> })}
            </select>
          )}
          <div className="flex gap-2">
            <select value={ageFilter} onChange={function (ev) { setAgeFilter(ev.target.value) }}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
              <option value="">Any age</option>
              <option value="aging">Aging+</option>
              <option value="urgent">Urgent only</option>
            </select>
            {showStatusFilter && (
              <select value={queueApi.statusFilter} onChange={function (ev) { queueApi.setStatusFilter(ev.target.value) }}
                className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
                <option value="approved">Approved</option>
              </select>
            )}
          </div>
        </div>
      )}

      {listBody}

      {selectMode ? (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-2 z-40" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <button onClick={function () { setBulkConfirm('reject') }} disabled={queueApi.selection.size === 0}
            className="flex-1 py-2.5 text-sm font-bold text-red-600 bg-red-50 rounded-lg disabled:opacity-50">Reject all</button>
          <button onClick={function () { setBulkConfirm('approve') }} disabled={queueApi.selection.size === 0}
            className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">Approve all</button>
        </div>
      ) : (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-40 overflow-x-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {visibleTabs.map(function (d) {
            var meta = DOMAIN_META[d]
            var active = queueApi.domain === d
            var count = queueApi.counts[d] || 0
            return (
              <button key={d} onClick={function () { queueApi.setDomain(d) }}
                className={"flex-1 flex flex-col items-center py-2 min-w-[44px] " + (active ? "text-indigo-600" : "text-gray-400")}>
                <span className="relative inline-block">
                  <DomainIcon domain={d} className="text-[18px]" />
                  {count > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[14px] h-3.5 px-0.5 flex items-center justify-center">{count > 9 ? '9+' : count}</span>
                  )}
                </span>
                <span className="text-[10px] font-semibold mt-0.5 whitespace-nowrap">{MOBILE_TAB_LABEL[d] || meta.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {detailAndConfirm}
    </div>
  )
}

export default Reviews
