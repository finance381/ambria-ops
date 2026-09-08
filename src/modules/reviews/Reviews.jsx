import { useState, useEffect } from 'react'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import useReviewQueue, { selectionKey } from './useReviewQueue'
import useReviewActions from './useReviewActions'
import { DOMAIN_META, DomainIcon, ReviewCard, ReviewDetailSheet, ActionConfirmSheet } from './ReviewComponents.jsx'
import { getAdapter } from './adapters/index.jsx'

var TAB_ORDER = ['inventory', 'item_receipt', 'expense', 'requisition', 'vendor_payment']
var TAB_PERM = {
  inventory: 'review.inventory', item_receipt: 'review.item_receipts', expense: 'review.expenses',
  requisition: 'review.requisitions', vendor_payment: 'review.vendor_payments',
}
var AUDIT_DOMAINS = ['expense', 'vendor_payment']

function applyAgeFilter(items, ageFilter) {
  if (!ageFilter) return items
  if (ageFilter === 'urgent') return items.filter(function (it) { return it.priority === 'urgent' })
  return items.filter(function (it) { return it.priority === 'aging' || it.priority === 'urgent' })
}

function Reviews({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var visibleTabs = TAB_ORDER.filter(function (d) { return hasPerm(permsNew, TAB_PERM[d]) })
  var canBulk = hasPerm(permsNew, 'review.bulk')

  var refData = useReferenceData()
  var [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true)
  useEffect(function () {
    function onResize() { setIsDesktop(window.innerWidth >= 768) }
    window.addEventListener('resize', onResize)
    return function () { window.removeEventListener('resize', onResize) }
  }, [])

  var queueApi = useReviewQueue(profile)
  var [selectMode, setSelectMode] = useState(false)
  var [openItem, setOpenItem] = useState(null)
  var [bulkConfirm, setBulkConfirm] = useState(null) // 'approve' | 'reject'
  var [ageFilter, setAgeFilter] = useState('')
  var [auditItems, setAuditItems] = useState([])
  var [auditLoading, setAuditLoading] = useState(false)
  var bulkActions = useReviewActions(null)

  var isAuditDomain = AUDIT_DOMAINS.indexOf(queueApi.domain) !== -1

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
    if (isAuditDomain) loadAudit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueApi.domain])

  var displayItems = isAuditDomain ? auditItems : applyAgeFilter(queueApi.items, ageFilter)
  var displayLoading = isAuditDomain ? auditLoading : queueApi.pending.loading
  var totalCount = visibleTabs.reduce(function (s, d) { return s + (queueApi.counts[d] || 0) }, 0)

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

  if (visibleTabs.length === 0) {
    return <p className="text-gray-400 text-sm text-center py-12">You don't have access to any review domain.</p>
  }

  var filterRow = (
    <div className="flex flex-wrap items-center gap-2">
      {!isAuditDomain && (
        <>
          <select value={queueApi.venueFilter} onChange={function (ev) { queueApi.setVenueFilter(ev.target.value) }}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
            <option value="">All venues</option>
            {(refData.venues || []).map(function (v) { return <option key={v.id} value={v.id}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
          </select>
          <select value={ageFilter} onChange={function (ev) { setAgeFilter(ev.target.value) }}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
            <option value="">Any age</option>
            <option value="aging">Aging+</option>
            <option value="urgent">Urgent only</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={queueApi.myTagsOnly} onChange={function (ev) { queueApi.setMyTagsOnly(ev.target.checked) }} />
            My tags only
          </label>
        </>
      )}
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
      {openItem && <ReviewDetailSheet item={openItem} onClose={function () { setOpenItem(null) }} onActioned={handleActioned} isMobile={!isDesktop} />}
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
          {canBulk && !isAuditDomain && (
            <button onClick={function () { setSelectMode(!selectMode); queueApi.clearSelection() }}
              className={"px-3 py-1.5 text-xs font-bold rounded-lg " + (selectMode ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700")}>
              {selectMode ? 'Cancel Select' : 'Select'}
            </button>
          )}
        </div>

        <div className="flex gap-1.5 border-b border-gray-200">
          {visibleTabs.map(function (d) {
            var meta = DOMAIN_META[d]
            var active = queueApi.domain === d
            return (
              <button key={d} onClick={function () { queueApi.setDomain(d) }}
                className={"px-3 py-2 text-sm font-semibold flex items-center gap-1.5 border-b-2 transition-colors " + (active ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500 hover:text-gray-700")}>
                <DomainIcon domain={d} /> {meta.label}
                {queueApi.counts[d] > 0 && <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-1.5">{queueApi.counts[d]}</span>}
              </button>
            )
          })}
        </div>

        {filterRow}
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
              {!isAuditDomain && (
                <label className="flex items-center gap-1 text-[10px] text-gray-500">
                  <input type="checkbox" checked={queueApi.myTagsOnly} onChange={function (ev) { queueApi.setMyTagsOnly(ev.target.checked) }} /> mine
                </label>
              )}
              {canBulk && !isAuditDomain && (
                <button onClick={function () { setSelectMode(true) }} className="text-xs font-bold text-indigo-600">Select</button>
              )}
            </div>
          </>
        )}
      </div>

      {!isAuditDomain && !selectMode && (
        <div className="flex gap-2 px-0.5">
          <select value={queueApi.venueFilter} onChange={function (ev) { queueApi.setVenueFilter(ev.target.value) }}
            className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
            <option value="">All venues</option>
            {(refData.venues || []).map(function (v) { return <option key={v.id} value={v.id}>{v.code ? v.code + ' — ' + v.name : v.name}</option> })}
          </select>
          <select value={ageFilter} onChange={function (ev) { setAgeFilter(ev.target.value) }}
            className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
            <option value="">Any age</option>
            <option value="aging">Aging+</option>
            <option value="urgent">Urgent only</option>
          </select>
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
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {visibleTabs.map(function (d) {
            var meta = DOMAIN_META[d]
            var active = queueApi.domain === d
            var count = queueApi.counts[d] || 0
            return (
              <button key={d} onClick={function () { queueApi.setDomain(d) }}
                className={"flex-1 flex flex-col items-center py-2 relative " + (active ? "text-indigo-600" : "text-gray-400")}>
                <DomainIcon domain={d} className="text-[18px]" />
                <span className="text-[9px] font-semibold mt-0.5">{meta.label.split(' ')[0]}</span>
                {count > 0 && (
                  <span className="absolute top-1 right-[calc(50%-18px)] bg-red-500 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">{count > 9 ? '9+' : count}</span>
                )}
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
