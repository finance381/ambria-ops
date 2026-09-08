import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'

// Every action funnels through one saving flag — only one review action is ever
// in flight from a detail sheet at a time, so a single guard is enough and keeps
// every handler symmetric. Activity log details are deliberately just
// "domain #id" — no item name, amount, or other financial/PII content.
function useReviewActions(onDone) {
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  async function callRpc(name, args, activityAction, activityDetail) {
    if (saving) return null
    setSaving(true)
    setError('')
    var res = await supabase.rpc(name, args)
    setSaving(false)
    if (res.error) {
      setError(res.error.message)
      throw new Error(res.error.message)
    }
    try { await logActivity(activityAction, activityDetail) } catch (_) {}
    if (onDone) onDone()
    return res.data
  }

  async function approve(domain, sourceId, notes) {
    return callRpc('rpc_review_approve', { p_domain: domain, p_source_id: sourceId, p_notes: notes || null },
      'review_approve', domain + ' #' + sourceId)
  }

  async function reject(domain, sourceId, notes) {
    if (!notes || !notes.trim()) throw new Error('Notes are required to reject')
    return callRpc('rpc_review_reject', { p_domain: domain, p_source_id: sourceId, p_notes: notes },
      'review_reject', domain + ' #' + sourceId)
  }

  async function requestChanges(domain, sourceId, notes) {
    if (!notes || !notes.trim()) throw new Error('Notes are required to request changes')
    return callRpc('rpc_review_request_changes', { p_domain: domain, p_source_id: sourceId, p_notes: notes },
      'review_request_changes', domain + ' #' + sourceId)
  }

  async function comment(domain, sourceId, notes) {
    if (!notes || !notes.trim()) throw new Error('A comment is required')
    return callRpc('rpc_review_comment', { p_domain: domain, p_source_id: sourceId, p_notes: notes },
      'review_comment', domain + ' #' + sourceId)
  }

  async function reopen(domain, sourceId, notes) {
    return callRpc('rpc_review_reopen', { p_domain: domain, p_source_id: sourceId, p_notes: notes || null },
      'review_reopen', domain + ' #' + sourceId)
  }

  async function bulkApprove(domain, sourceIds, notes) {
    return callRpc('rpc_review_bulk_approve', { p_domain: domain, p_source_ids: sourceIds, p_notes: notes || null },
      'review_bulk_approve', domain + ' x' + sourceIds.length)
  }

  async function bulkReject(domain, sourceIds, notes) {
    if (!notes || !notes.trim()) throw new Error('Notes are required to reject')
    return callRpc('rpc_review_bulk_reject', { p_domain: domain, p_source_ids: sourceIds, p_notes: notes },
      'review_bulk_reject', domain + ' x' + sourceIds.length)
  }

  return {
    approve: approve, reject: reject, requestChanges: requestChanges, comment: comment, reopen: reopen,
    bulkApprove: bulkApprove, bulkReject: bulkReject,
    saving: saving, error: error, setError: setError,
  }
}

export default useReviewActions
