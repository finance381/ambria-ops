import { supabase } from '../../../lib/supabase'
import { formatDate, formatPoints } from '../../../lib/format'

// Read-only audit domain — no review_status, no approve/reject. Not part of
// v_review_queue, so this adapter owns its own list fetch (recent window,
// newest first) instead of the queue-filter shape the 3 workflow domains use.
// Rows are normalized into the same {domain, source_id, title, ...} shape as
// v_review_queue so ReviewCard/etc. can render either kind uniformly.
async function fetchList(limit) {
  var res = await supabase.from('expenses')
    .select('id, description, amount_paise, status, flag_reason, user_id, expense_type_id, expense_sub_type_id, created_at, expense_types(name), expense_sub_types(name), profiles:user_id(name)')
    .order('created_at', { ascending: false })
    .limit(limit || 100)
  if (res.error) throw new Error(res.error.message)

  var ids = (res.data || []).map(function (r) { return r.id })
  var commentCounts = {}
  if (ids.length > 0) {
    var evRes = await supabase.from('review_events').select('source_id').eq('domain', 'expense').eq('kind', 'comment').in('source_id', ids)
    ;(evRes.data || []).forEach(function (e) { commentCounts[e.source_id] = (commentCounts[e.source_id] || 0) + 1 })
  }

  return (res.data || []).map(function (r) {
    return {
      domain: 'expense',
      source_id: r.id,
      title: r.description || ('Expense #' + r.id),
      amount_paise: r.amount_paise,
      vendor_name: null,
      primary_tag: r.expense_type_id,
      tags: { expense_type_id: r.expense_type_id, expense_sub_type_id: r.expense_sub_type_id },
      submitted_by: r.user_id,
      submitted_at: r.created_at,
      venue_id: null,
      status: 'approved',
      priority: 'normal',
      comment_count: commentCounts[r.id] || 0,
      _typeName: r.expense_types ? r.expense_types.name : '',
      _subTypeName: r.expense_sub_types ? r.expense_sub_types.name : '',
      _submitterName: r.profiles ? r.profiles.name : '',
      _flagged: r.status === 'flagged',
    }
  })
}

async function fetchDetail(sourceId) {
  var res = await supabase.from('expenses')
    .select('*, expense_types(name), expense_sub_types(name), profiles:user_id(name, email)')
    .eq('id', sourceId).maybeSingle()
  if (res.error) throw new Error(res.error.message)
  if (!res.data) return null
  var receiptPaths = (res.data.receipt_paths && res.data.receipt_paths.length > 0)
    ? res.data.receipt_paths
    : (res.data.receipt_path ? [res.data.receipt_path] : [])
  var receipts = receiptPaths.map(function (path) {
    return {
      path: path,
      url: supabase.storage.from('receipts').getPublicUrl(path).data?.publicUrl,
      isVoice: /\.(webm|ogg|mp3|wav)$/i.test(path),
    }
  })
  return Object.assign({}, res.data, { _receipts: receipts })
}

function renderDetailBody(row) {
  if (!row) return null
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Amount</p><p className="text-gray-900 font-bold">{formatPoints(row.amount_paise)}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Type</p><p className="text-gray-900">{row.expense_types ? row.expense_types.name : '—'}{row.expense_sub_types ? ' / ' + row.expense_sub_types.name : ''}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Submitted by</p><p className="text-gray-900">{row.profiles ? row.profiles.name : '—'}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Date</p><p className="text-gray-900">{row.created_at ? formatDate(row.created_at) : '—'}</p></div>
      </div>
      {row.description && <p className="text-sm text-gray-700">{row.description}</p>}
      {row._receipts && row._receipts.length > 0 && (
        <div className="space-y-2">
          {row._receipts.map(function (r, i) {
            return r.isVoice ? (
              <audio key={r.path + i} src={r.url} controls className="w-full h-8" />
            ) : (
              <img key={r.path + i} src={r.url} alt="Receipt" className="w-full max-h-64 object-contain rounded-lg border border-gray-200 bg-gray-50" />
            )
          })}
        </div>
      )}
      {row.status === 'flagged' && row.flag_reason && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Flagged: {row.flag_reason}</p>
      )}
    </div>
  )
}

function renderListMeta(item) {
  var bits = [item._typeName || 'Expense']
  if (item._submitterName) bits.push(item._submitterName)
  return <span>{bits.join(' · ')}</span>
}

export default { fetchList: fetchList, fetchDetail: fetchDetail, renderDetailBody: renderDetailBody, renderListMeta: renderListMeta, isReadOnly: true }
