import { supabase } from '../../../lib/supabase'
import { titleCase } from '../../../lib/format'

async function fetchDetail(sourceId) {
  var res = await supabase.from('categories')
    .select('*, profiles:added_by(name, email)')
    .eq('id', sourceId).maybeSingle()
  if (res.error) throw new Error(res.error.message)
  return res.data
}

function renderDetailBody(row) {
  if (!row) return null
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase">Proposed category name</p>
        <p className="text-base font-bold text-gray-900">{titleCase(row.name)}</p>
      </div>
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase">Submitted by</p>
        <p className="text-sm text-gray-900">{row.profiles ? row.profiles.name : '—'}</p>
        {row.profiles && row.profiles.email && <p className="text-xs text-gray-400">{row.profiles.email}</p>}
      </div>
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        Rejecting this permanently deletes the pending entry — there's no persistent "rejected" state for category names.
      </p>
    </div>
  )
}

function renderListMeta() {
  return <span>New category name</span>
}

export default { fetchDetail: fetchDetail, renderDetailBody: renderDetailBody, renderListMeta: renderListMeta }
