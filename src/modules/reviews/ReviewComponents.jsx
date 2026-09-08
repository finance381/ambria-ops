import { useState, useEffect } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { hasPerm } from '../../lib/permissions'
import Modal from '../../components/ui/Modal'
import InventoryForm from '../inventory/InventoryForm'
import { getAdapter } from './adapters/index.jsx'
import useReviewActions from './useReviewActions'

var DOMAIN_META = {
  inventory:      { label: 'Inventory',       icon: 'ti-box' },
  item_receipt:   { label: 'Item Receipts',   icon: 'ti-truck-delivery' },
  expense:        { label: 'Expenses',        icon: 'ti-receipt' },
  requisition:    { label: 'Requisitions',    icon: 'ti-clipboard-list' },
  vendor_payment: { label: 'Vendor Payments', icon: 'ti-credit-card' },
  category:       { label: 'Categories',      icon: 'ti-folder' },
  sub_category:   { label: 'Sub-categories',  icon: 'ti-folders' },
}

var PRIORITY_CLS = {
  aging: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700',
}

var KIND_LABELS = {
  submit: 'submitted', approve: 'approved', reject: 'rejected',
  request_changes: 'requested changes', comment: 'commented', delegate: 'delegated', reopen: 'reopened',
}

var ACTION_LABELS = { approve: 'Approve', reject: 'Reject', request_changes: 'Request Changes', reopen: 'Reopen' }
var ACTION_NEEDS_NOTES = { reject: true, request_changes: true }
// Full lifecycle (dept tier, request-changes, reopen) — categories/sub-categories
// don't have a dept tier or a persistent rejected state (reject hard-deletes them).
var WORKFLOW_DOMAINS = ['inventory', 'item_receipt', 'requisition']
var APPROVABLE_DOMAINS = ['inventory', 'item_receipt', 'requisition', 'category', 'sub_category']
var EDITABLE_DOMAINS = ['inventory', 'item_receipt']
var EDIT_SOURCE_TABLE = { inventory: 'inventory', item_receipt: 'catering_store' }

// ---- PriorityPill ----
function PriorityPill({ priority }) {
  if (!priority || priority === 'normal') return null
  return <span className={"text-[9px] font-bold uppercase px-1.5 py-0.5 rounded " + (PRIORITY_CLS[priority] || '')}>{priority}</span>
}

// ---- DomainIcon ----
function DomainIcon({ domain, className }) {
  var meta = DOMAIN_META[domain] || {}
  return <i className={"ti " + (meta.icon || 'ti-list') + " " + (className || '')} aria-hidden="true" />
}

// ---- ReviewCard ----
// Same markup renders as a desktop table row (wrapped in a bordered list container
// by the caller) and a mobile stacked card — the row itself doesn't know which.
function ReviewCard({ item, onOpen, onToggleSelect, selected, selectMode }) {
  var adapter = getAdapter(item.domain)
  var imgUrl = getImageUrl((item.tags || {}).image_path)
  function handleClick() {
    if (selectMode) { onToggleSelect(item); return }
    onOpen(item)
  }
  return (
    <div onClick={handleClick}
      className={"flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-indigo-50/30 " + (selected ? "bg-indigo-50" : "")}>
      {selectMode && (
        <input type="checkbox" checked={!!selected} onChange={function () { onToggleSelect(item) }}
          onClick={function (ev) { ev.stopPropagation() }} className="w-4 h-4 shrink-0" />
      )}
      {imgUrl ? (
        <img src={imgUrl} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0 border border-gray-200 bg-gray-50" />
      ) : (
        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 shrink-0">
          <DomainIcon domain={item.domain} className="text-[15px]" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{item.title || ('#' + item.source_id)}</p>
        <p className="text-xs text-gray-500 truncate">{adapter ? adapter.renderListMeta(item) : null}</p>
      </div>
      {item.amount_paise != null && (
        <p className="text-sm font-mono text-gray-700 shrink-0">{formatPoints(item.amount_paise)}</p>
      )}
      {item.comment_count > 0 && (
        <span className="text-[10px] text-gray-400 shrink-0">💬 {item.comment_count}</span>
      )}
      <PriorityPill priority={item.priority} />
      <i className="ti ti-chevron-right text-gray-300 shrink-0" aria-hidden="true" />
    </div>
  )
}

// ---- ReviewTimeline ----
function ReviewTimeline({ domain, sourceId }) {
  var [events, setEvents] = useState([])
  var [actorNames, setActorNames] = useState({})
  var [loading, setLoading] = useState(true)

  useEffect(function () {
    var cancelled = false
    setLoading(true)
    supabase.from('review_events').select('*').eq('domain', domain).eq('source_id', sourceId).order('created_at', { ascending: true })
      .then(function (res) {
        if (cancelled) return
        var rows = res.data || []
        setEvents(rows)
        var ids = Array.from(new Set(rows.map(function (e) { return e.actor_id })))
        if (ids.length === 0) { setLoading(false); return }
        supabase.from('profiles').select('id, name').in('id', ids).then(function (r2) {
          if (cancelled) return
          var names = {}
          ;(r2.data || []).forEach(function (p) { names[p.id] = p.name })
          setActorNames(names)
          setLoading(false)
        })
      })
    return function () { cancelled = true }
  }, [domain, sourceId])

  if (loading) return <p className="text-xs text-gray-400 py-2">Loading timeline...</p>
  if (events.length === 0) return <p className="text-xs text-gray-400 py-2">No activity yet</p>

  return (
    <div className="space-y-2">
      {events.map(function (e) {
        var name = actorNames[e.actor_id] || '—'
        var initials = name.split(' ').filter(Boolean).map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase() || '?'
        return (
          <div key={e.id} className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-bold flex items-center justify-center shrink-0">{initials}</div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-700"><span className="font-semibold">{name}</span> {KIND_LABELS[e.kind] || e.kind}</p>
              {e.notes && <p className="text-xs text-gray-500 mt-0.5">{e.notes}</p>}
              <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(e.created_at)}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- CommentComposer ----
function CommentComposer({ domain, sourceId, onPost }) {
  var [text, setText] = useState('')
  var actions = useReviewActions(null)

  async function post() {
    if (actions.saving || !text.trim()) return
    try {
      await actions.comment(domain, sourceId, text.trim())
      setText('')
      if (onPost) onPost()
    } catch (err) { /* actions.error already holds the message for display below */ }
  }

  return (
    <div className="space-y-1.5">
      <textarea value={text} onChange={function (ev) { setText(ev.target.value) }}
        placeholder="Add a comment..." rows={2}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none" style={{ fontSize: '16px' }} />
      {actions.error && <p className="text-xs text-red-600">{actions.error}</p>}
      <button onClick={post} disabled={actions.saving || !text.trim()}
        className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">
        {actions.saving ? 'Posting...' : 'Post'}
      </button>
    </div>
  )
}

// ---- ActionConfirmSheet ----
function ActionConfirmSheet({ action, item, onConfirm, onCancel, saving }) {
  var [notes, setNotes] = useState('')
  var needsNotes = !!ACTION_NEEDS_NOTES[action]

  function confirm() {
    if (needsNotes && !notes.trim()) return
    onConfirm(notes.trim())
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0" onClick={onCancel}>
      <div className="bg-white rounded-xl w-full max-w-sm p-4 space-y-3" onClick={function (ev) { ev.stopPropagation() }}>
        <p className="text-sm font-bold text-gray-900">{ACTION_LABELS[action] || action}{item ? ' — ' + (item.title || ('#' + item.source_id)) : ''}</p>
        {needsNotes && (
          <textarea value={notes} onChange={function (ev) { setNotes(ev.target.value) }}
            placeholder="Reason (required)" rows={3} autoFocus
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none" style={{ fontSize: '16px' }} />
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2 text-sm font-bold text-gray-600 bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={confirm} disabled={saving || (needsNotes && !notes.trim())}
            className="flex-1 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">
            {saving ? 'Working...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- ReviewDetailSheet ----
// Force-detail-before-approve lives here: this is the ONLY place approve/reject/
// request_changes/reopen buttons render — list rows never carry action buttons.
function ReviewDetailSheet({ item, onClose, onActioned, isMobile, profile }) {
  var adapter = getAdapter(item.domain)
  var permsNew = (profile && profile.permsNew) || []
  var [detail, setDetail] = useState(null)
  var [loading, setLoading] = useState(true)
  var [confirmAction, setConfirmAction] = useState(null)
  var [editingOpen, setEditingOpen] = useState(false)
  var [timelineKey, setTimelineKey] = useState(0)
  var actions = useReviewActions(function () { if (onActioned) onActioned() })

  var canApproveReject = APPROVABLE_DOMAINS.indexOf(item.domain) !== -1
  var canRequestChanges = WORKFLOW_DOMAINS.indexOf(item.domain) !== -1 && (item.status === 'pending' || item.status === 'changes_requested')
  var canEdit = EDITABLE_DOMAINS.indexOf(item.domain) !== -1
  var canReopen = WORKFLOW_DOMAINS.indexOf(item.domain) !== -1 && (item.status === 'rejected' || item.status === 'approved') && hasPerm(permsNew, 'review.reopen')

  function loadDetail(cancelledRef) {
    setLoading(true)
    adapter.fetchDetail(item.source_id).then(function (row) {
      if (cancelledRef && cancelledRef.current) return
      setDetail(row); setLoading(false)
    }).catch(function () { if (!cancelledRef || !cancelledRef.current) setLoading(false) })
  }

  useEffect(function () {
    var cancelledRef = { current: false }
    loadDetail(cancelledRef)
    return function () { cancelledRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.domain, item.source_id])

  async function runAction(kind, notes) {
    try {
      if (kind === 'approve') await actions.approve(item.domain, item.source_id, notes || null)
      else if (kind === 'reject') await actions.reject(item.domain, item.source_id, notes)
      else if (kind === 'request_changes') await actions.requestChanges(item.domain, item.source_id, notes)
      else if (kind === 'reopen') await actions.reopen(item.domain, item.source_id, notes || null)
      setConfirmAction(null)
      onClose()
    } catch (err) {
      // Dismiss the confirm overlay on failure too — otherwise it covers the
      // actions.error message rendered in the detail body underneath it.
      setConfirmAction(null)
    }
  }

  function handleCommentPosted() {
    setTimelineKey(function (k) { return k + 1 })
  }

  return (
    <div className={"fixed inset-0 z-[60] bg-white flex flex-col " + (isMobile ? "" : "sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[480px] sm:shadow-2xl sm:border-l sm:border-gray-200")}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <button onClick={onClose} className="text-sm text-indigo-600 font-medium">← Back</button>
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <DomainIcon domain={item.domain} /> {DOMAIN_META[item.domain] ? DOMAIN_META[item.domain].label : item.domain}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-base font-bold text-gray-900">{item.title || ('#' + item.source_id)}</p>
            <PriorityPill priority={item.priority} />
          </div>
          <div className="flex gap-2 shrink-0">
            {canEdit && (
              <button onClick={function () { setEditingOpen(true) }}
                className="px-2.5 py-1 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">✎ Edit</button>
            )}
            {canReopen && (
              <button onClick={function () { setConfirmAction('reopen') }}
                className="px-2.5 py-1 text-xs font-bold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">↺ Reopen</button>
            )}
          </div>
        </div>
        {loading ? <p className="text-sm text-gray-400">Loading...</p> : (adapter ? adapter.renderDetailBody(detail) : null)}
        {actions.error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actions.error}</p>}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Activity</p>
          <ReviewTimeline key={timelineKey} domain={item.domain} sourceId={item.source_id} />
        </div>
        <CommentComposer domain={item.domain} sourceId={item.source_id} onPost={handleCommentPosted} />
      </div>
      {canApproveReject && (
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3 flex gap-2 shrink-0">
          <button onClick={function () { setConfirmAction('reject') }} className="flex-1 py-2.5 text-sm font-bold text-red-600 bg-red-50 rounded-lg">Reject</button>
          {canRequestChanges && (
            <button onClick={function () { setConfirmAction('request_changes') }} className="flex-1 py-2.5 text-sm font-bold text-amber-700 bg-amber-50 rounded-lg">Request Changes</button>
          )}
          <button onClick={function () { setConfirmAction('approve') }} className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg">Approve</button>
        </div>
      )}
      {confirmAction && (
        <ActionConfirmSheet action={confirmAction} item={item} saving={actions.saving}
          onCancel={function () { setConfirmAction(null) }}
          onConfirm={function (notes) { runAction(confirmAction, notes) }} />
      )}
      {canEdit && (
        <Modal open={editingOpen} onClose={function () { setEditingOpen(false) }} title={'Edit: ' + (item.title || '')} wide>
          {editingOpen && detail && (
            <InventoryForm
              item={Object.assign({}, detail, { _source: EDIT_SOURCE_TABLE[item.domain] })}
              profile={profile}
              onClose={function () { setEditingOpen(false) }}
              onSaved={function () { setEditingOpen(false); loadDetail(); if (onActioned) onActioned() }}
            />
          )}
        </Modal>
      )}
    </div>
  )
}

export {
  DOMAIN_META, WORKFLOW_DOMAINS, APPROVABLE_DOMAINS, EDITABLE_DOMAINS,
  PriorityPill, DomainIcon, ReviewCard, ReviewTimeline, CommentComposer, ActionConfirmSheet, ReviewDetailSheet,
}
