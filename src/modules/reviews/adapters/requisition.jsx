import { supabase } from '../../../lib/supabase'
import { formatDate, formatPoints } from '../../../lib/format'

async function fetchDetail(sourceId) {
  var res = await supabase.from('requisitions')
    .select('*, events(event_name), expense_types(name), expense_sub_types(name), categories(name), sub_departments(name), profiles:requested_by(name, email), dept_approver:dept_approved_by(name, email), reviewer:reviewed_by(name, email)')
    .eq('id', sourceId).maybeSingle()
  if (res.error) throw new Error(res.error.message)
  return res.data
}

function renderDetailBody(row) {
  if (!row) return null
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-900">{row.purpose}</p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Department</p><p className="text-gray-900">{row.department}{row.sub_departments ? ' / ' + row.sub_departments.name : ''}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Urgency</p><p className="text-gray-900 capitalize">{row.urgency}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Requested by</p><p className="text-gray-900">{row.profiles ? row.profiles.name : '—'}</p></div>
        <div><p className="text-[10px] font-bold text-gray-400 uppercase">Needed by</p><p className="text-gray-900">{row.needed_by ? formatDate(row.needed_by) : '—'}</p></div>
        {row.req_type === 'expense' && (
          <>
            <div><p className="text-[10px] font-bold text-gray-400 uppercase">Expense type</p><p className="text-gray-900">{row.expense_types ? row.expense_types.name : '—'}{row.expense_sub_types ? ' / ' + row.expense_sub_types.name : ''}</p></div>
            <div><p className="text-[10px] font-bold text-gray-400 uppercase">Amount</p><p className="text-gray-900">{formatPoints(row.expense_amount_paise)}</p></div>
          </>
        )}
        {row.events && (
          <div className="col-span-2"><p className="text-[10px] font-bold text-gray-400 uppercase">Function</p><p className="text-gray-900">{row.events.event_name}</p></div>
        )}
      </div>
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
  var bits = [tags.department || '—']
  if (item.amount_paise) bits.push(formatPoints(item.amount_paise))
  return <span>{bits.join(' · ')}</span>
}

export default { fetchDetail: fetchDetail, renderDetailBody: renderDetailBody, renderListMeta: renderListMeta }
