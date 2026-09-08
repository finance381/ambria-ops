import { supabase } from '../../../lib/supabase'
import { formatDate, formatPoints } from '../../../lib/format'

// Read-only audit domain, same reasoning as adapters/expense.jsx — payments are
// already final the instant pay_vendor runs, there's no pending state to review.
async function fetchList(limit) {
  var res = await supabase.from('ledger_entries')
    .select('id, ledger_type, party_id, entry_date, created_at, description, debit_paise, ref_type, metadata')
    .eq('ledger_type', 'vendor')
    .in('ref_type', ['vendor_payment', 'vendor_deduction'])
    .is('deleted_at', null)
    .order('entry_date', { ascending: false })
    .limit(limit || 100)
  if (res.error) throw new Error(res.error.message)

  var rows = res.data || []
  var vendorIds = Array.from(new Set(rows.map(function (r) { return r.party_id }).filter(Boolean)))
  var vendorNames = {}
  if (vendorIds.length > 0) {
    var vRes = await supabase.from('vendors').select('id, name').in('id', vendorIds)
    ;(vRes.data || []).forEach(function (v) { vendorNames[v.id] = v.name })
  }

  var ids = rows.map(function (r) { return r.id })
  var commentCounts = {}
  if (ids.length > 0) {
    var evRes = await supabase.from('review_events').select('source_id').eq('domain', 'vendor_payment').eq('kind', 'comment').in('source_id', ids)
    ;(evRes.data || []).forEach(function (e) { commentCounts[e.source_id] = (commentCounts[e.source_id] || 0) + 1 })
  }

  return rows.map(function (r) {
    return {
      domain: 'vendor_payment',
      source_id: r.id,
      title: r.description || ('Payment #' + r.id),
      amount_paise: r.debit_paise,
      vendor_name: vendorNames[r.party_id] || null,
      primary_tag: r.party_id,
      tags: { vendor_id: r.party_id },
      submitted_by: null,
      submitted_at: r.entry_date || r.created_at,
      venue_id: null,
      status: 'approved',
      priority: 'normal',
      comment_count: commentCounts[r.id] || 0,
      _kind: r.ref_type === 'vendor_deduction' ? 'Deduction' : 'Payment',
    }
  })
}

async function fetchDetail(sourceId) {
  var res = await supabase.from('ledger_entries')
    .select('id, ledger_type, party_id, entry_date, created_at, description, debit_paise, ref_type, metadata')
    .eq('id', sourceId).maybeSingle()
  if (res.error) throw new Error(res.error.message)
  if (!res.data) return null
  var vRes = await supabase.from('vendors').select('name').eq('id', res.data.party_id).maybeSingle()
  return Object.assign({}, res.data, { vendor_name: vRes.data ? vRes.data.name : null })
}

function renderDetailBody(row) {
  if (!row) return null
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Amount</p><p className="text-gray-900 font-bold">{formatPoints(row.debit_paise)}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Vendor</p><p className="text-gray-900">{row.vendor_name || '—'}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Type</p><p className="text-gray-900">{row.ref_type === 'vendor_deduction' ? 'Deduction' : 'Payment'}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Date</p><p className="text-gray-900">{row.entry_date ? formatDate(row.entry_date) : '—'}</p></div>
      </div>
      {row.description && <p className="text-sm text-gray-700">{row.description}</p>}
    </div>
  )
}

function renderListMeta(item) {
  return <span>{item._kind}{item.vendor_name ? ' · ' + item.vendor_name : ''}</span>
}

export default { fetchList: fetchList, fetchDetail: fetchDetail, renderDetailBody: renderDetailBody, renderListMeta: renderListMeta, isReadOnly: true }
