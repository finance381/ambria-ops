import { supabase, getImageUrl } from '../../../lib/supabase'
import { formatDate } from '../../../lib/format'

async function fetchDetail(sourceId) {
  var res = await supabase.from('inventory_items')
    .select('*, categories(name, code), sub_categories(name), profiles:submitted_by(name, email), dept_approver:dept_approved_by(name, email), reviewer:reviewed_by(name, email), venue_allocations(qty, venues(code, name))')
    .eq('id', sourceId).maybeSingle()
  if (res.error) throw new Error(res.error.message)
  return res.data
}

function renderDetailBody(row) {
  if (!row) return null
  var allocs = row.venue_allocations || []
  var imgUrl = getImageUrl(row.image_path)
  return (
    <div className="space-y-3">
      {imgUrl && (
        <img src={imgUrl} alt={row.name} onClick={function () { window.open(imgUrl, '_blank') }}
          className="w-full max-h-64 object-contain rounded-lg border border-gray-200 bg-gray-50 cursor-pointer hover:opacity-90 transition-opacity" />
      )}
      <div>
        <p className="text-sm font-bold text-gray-900">{row.name}</p>
        {row.name_hindi && <p className="text-xs text-gray-500">{row.name_hindi}</p>}
        {row.brand && <p className="text-xs text-amber-600 font-medium">{row.brand}{row.pack_size_qty ? ' · ' + row.pack_size_qty + ' ' + (row.pack_size_unit || '') : ''}</p>}
        <p className="text-[11px] text-gray-400 font-mono">{row.inventory_id || '—'}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Category</p><p className="text-gray-900">{row.categories ? row.categories.name : '—'}{row.sub_categories ? ' / ' + row.sub_categories.name : ''}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Qty</p><p className="text-gray-900">{row.qty} {(row.unit || '').toLowerCase()}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Department</p><p className="text-gray-900">{row.department || '—'}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Submitted by</p><p className="text-gray-900">{row.profiles ? row.profiles.name : '—'}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Submitted</p><p className="text-gray-900">{row.entry_date || row.created_at ? formatDate(row.entry_date || row.created_at) : '—'}</p></div>
        {row.location && <div><p className="text-[10px] font-bold text-gray-400 uppercase">Location</p><p className="text-gray-900">{row.location}</p></div>}
      </div>
      {(row.min_order_qty > 0 || row.reorder_qty > 0) && (
        <p className="text-xs text-gray-400">{row.min_order_qty > 0 ? 'Min order: ' + row.min_order_qty : ''}{row.min_order_qty > 0 && row.reorder_qty > 0 ? ' · ' : ''}{row.reorder_qty > 0 ? 'Reorder at: ' + row.reorder_qty : ''}</p>
      )}
      {row.notes && <p className="text-sm text-gray-500 italic">"{row.notes}"</p>}
      {row.description && <p className="text-sm text-gray-500">{row.description}</p>}
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
  return <span>{tags.department || 'Qty pending'} · category #{tags.category_id || '—'}</span>
}

export default { fetchDetail: fetchDetail, renderDetailBody: renderDetailBody, renderListMeta: renderListMeta, editableTable: 'inventory_items' }
