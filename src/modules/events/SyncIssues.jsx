import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import Icon from '../../components/ui/Icon'
import { appConfirm } from '../../components/ui/AppDialog'

// Every contract the stale sweep in sync-events/index.ts has auto-cancelled
// because LMS's own list endpoint stopped returning it -- a confirmed
// LMS-side gap (see that file's big comment), not a defect in our sync.
// This screen is the "make sure it doesn't silently cost a week before
// anyone notices" fix: every occurrence lands here and triggers a push to
// lms_sync_notification_subscribers, instead of only a console.log nobody
// reads.
function SyncIssues() {
  var [rows, setRows] = useState([])
  var [loading, setLoading] = useState(true)
  var [showResolved, setShowResolved] = useState(false)
  var [busyId, setBusyId] = useState(null)
  var [error, setError] = useState('')

  function load() {
    setLoading(true); setError('')
    var q = supabase.from('lms_sync_anomalies').select('*').order('detected_at', { ascending: false }).limit(200)
    if (!showResolved) q = q.is('resolved_at', null)
    q.then(function (res) {
      if (res.error) { setError(res.error.message); setLoading(false); return }
      setRows(res.data || [])
      setLoading(false)
    })
  }

  useEffect(function () {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved])

  async function resolve(id, action) {
    if (busyId) return
    if (action === 'dismiss' && !(await appConfirm('Mark this as a genuine LMS cancellation (not a sync gap)? This will NOT restore the contract.'))) return
    setBusyId(id)
    var res = await supabase.rpc('fn_resolve_lms_sync_anomaly', { p_id: id, p_action: action })
    setBusyId(null)
    if (res.error) { setError(res.error.message); return }
    load()
  }

  var unresolvedCount = rows.filter(function (r) { return !r.resolved_at }).length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-[18px] font-extrabold text-gray-900 flex items-center gap-2">
            Sync Issues
            {unresolvedCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-bold">{unresolvedCount}</span>
            )}
          </h2>
          <p className="text-[12.5px] text-gray-500 mt-0.5 max-w-2xl">
            Contracts auto-cancelled by the sync job because LMS's own list stopped returning them, even though
            they're still live in LMS. <strong>Restore &amp; exempt</strong> if this looks like that known gap —
            it brings the contract back and stops future syncs from re-cancelling it. <strong>Dismiss</strong> only
            if you've checked and the contract really was cancelled in LMS.
          </p>
        </div>
        <button type="button" onClick={function () { setShowResolved(!showResolved) }}
          className={'shrink-0 h-9 px-3.5 rounded-xl text-[12.5px] font-bold border transition-colors ' +
            (showResolved ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300')}>
          {showResolved ? 'Showing all' : 'Showing unresolved'}
        </button>
      </div>

      {error && <p className="text-[12.5px] text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
      {loading && <p className="text-[12.5px] text-gray-400 text-center py-8">Loading...</p>}

      {!loading && rows.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Icon name="checkDouble" size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-[13px]">{showResolved ? 'Nothing logged yet' : 'No unresolved sync issues — nothing dropped out recently'}</p>
        </div>
      )}

      <div className="space-y-2">
        {rows.map(function (r) {
          var resolved = !!r.resolved_at
          return (
            <div key={r.id} className={'rounded-xl border p-3.5 ' + (resolved ? 'border-slate-100 bg-slate-50' : 'border-amber-200 bg-amber-50/50')}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[13.5px] text-slate-900">{r.client_name || 'Unknown client'}</span>
                    {r.contract_no && <span className="text-[11.5px] font-mono text-slate-500">#{r.contract_no}</span>}
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{r.department}</span>
                  </div>
                  <p className="text-[11.5px] text-slate-500 mt-0.5">
                    {r.venue_name ? r.venue_name + ' · ' : ''}{r.function_date ? formatDate(r.function_date) : ''}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Dropped out {formatDate(r.detected_at)}
                    {resolved && (
                      <> · {r.resolution === 'restored' ? 'Restored & exempted' : 'Dismissed (confirmed cancelled)'} {formatDate(r.resolved_at)}</>
                    )}
                  </p>
                </div>
                {!resolved && (
                  <div className="flex gap-2 shrink-0">
                    <button type="button" disabled={busyId === r.id} onClick={function () { resolve(r.id, 'dismiss') }}
                      className="h-8 px-3 rounded-lg text-[12px] font-bold text-slate-600 border border-slate-200 bg-white hover:border-slate-300 disabled:opacity-50">
                      Dismiss
                    </button>
                    <button type="button" disabled={busyId === r.id} onClick={function () { resolve(r.id, 'restore') }}
                      className="h-8 px-3 rounded-lg text-[12px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                      {busyId === r.id ? 'Working...' : 'Restore & exempt'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default SyncIssues
