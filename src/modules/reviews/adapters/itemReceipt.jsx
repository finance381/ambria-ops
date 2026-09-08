import { supabase } from '../../../lib/supabase'
import { formatDate } from '../../../lib/format'

async function fetchDetail(sourceId) {
  var res = await supabase.from('catering_store_items')
    .select('*, categories(name, code), sub_categories(name), profiles:submitted_by(name, email), dept_approver:dept_approved_by(name, email), reviewer:reviewed_by(name, email), cs_venue_allocations(qty, venues(code, name))')
    .eq('id', sourceId).maybeSingle()
  if (res.error) throw new Error(res.error.message)
  return res.data
}

function renderDetailBody(row) {
  if (!row) return null
  var allocs = row.cs_venue_allocations || []
  return (
    <div className="space-y-3">
      {row.image_path && (
        <img src={row.image_path} alt={row.name} className="w-full max-h-64 object-contain rounded-lg border border-gray-200 bg-gray-50" />
      )}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Category</p><p className="text-gray-900">{row.categories ? row.categories.name : '—'}{row.sub_categories ? ' / ' + row.sub_categories.name : ''}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Qty</p><p className="text-gray-900">{row.qty}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Brand / Pack</p><p className="text-gray-900">{row.brand || '—'} {row.pack_size_qty ? '· ' + row.pack_size_qty + ' ' + (row.pack_size_unit || '') : ''}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Submitted by</p><p className="text-gray-900">{row.profiles ? row.profiles.name : '—'}</p></div>
      </div>
      {allocs.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Venue allocations</p>
          <div className="space-y-1">
            {allocs.map(function (a, i) {
              return <div key={i} className="flex justify-between text-xs text-gray-600"><span>{a.venues ? (a.venues.code + ' — ' + a.venues.name) : '—'}</span><span>{a.qty}</span></div>
            })}
          </div>
        </div>
      )}
      {row.dept_approver && (
        <p className="text-xs text-gray-500">Dept-cleared by {row.dept_approver.name} on {formatDate(row.dept_approved_at)}</p>
      )}
      {row.rejection_reason && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{row.rejection_reason}</p>
      )}
    </div>
  )
}

function renderListMeta(item) {
  var tags = item.tags || {}
  return <span>Catering store item · category #{tags.category_id || '—'}</span>
}

export default { fetchDetail: fetchDetail, renderDetailBody: renderDetailBody, renderListMeta: renderListMeta }
