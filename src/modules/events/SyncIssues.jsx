import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDateTime } from '../../lib/format'
import Icon from '../../components/ui/Icon'
import { appConfirm } from '../../components/ui/AppDialog'

// Rule 6 of LMS_SYNC_SAFETY_PATTERNS.md: a sync needs somewhere a human will
// actually see what happened, not just a console.log that rolls off. One row
// per sync-events run (lms_sync_runs), newest first -- collapsed by default
// since on a healthy day there's nothing here worth a second look, but the
// moment a run comes back with real errors (or the cron stops running
// entirely) it opens itself.
//
// Two gaps a plain "last 15 runs" list would have, both closed below:
// 1. The cron fires every 15 min (sync-events-15min) -- 15 rows is under 4
//    hours, so a 2am failure scrolls off by the time anyone looks. A second
//    query pulls any non-ok run from the last 3 days regardless of rank.
// 2. A dead cron (rotated secret, function timing out before it can even
//    reach logRun) produces NO row at all, which a "did anything fail"
//    check can't see -- so this also flags when the newest run itself is
//    older than a few missed cycles.
var STALE_AFTER_MIN = 45
function SyncRuns() {
  var [runs, setRuns] = useState([])
  var [loading, setLoading] = useState(true)
  var [open, setOpen] = useState(false)
  var [expandedId, setExpandedId] = useState(null)

  useEffect(function () {
    var threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    Promise.all([
      supabase.from('lms_sync_runs').select('*').order('started_at', { ascending: false }).limit(20),
      supabase.from('lms_sync_runs').select('*').neq('status', 'ok').gte('started_at', threeDaysAgo)
        .order('started_at', { ascending: false }).limit(20),
    ]).then(function (res) {
      var byId = {}
      ;(res[0].data || []).concat(res[1].data || []).forEach(function (r) { byId[r.id] = r })
      var merged = Object.keys(byId).map(function (k) { return byId[k] })
        .sort(function (a, b) { return new Date(b.started_at) - new Date(a.started_at) })
      setRuns(merged)
      setLoading(false)
      if (merged.some(function (r) { return r.status !== 'ok' })) setOpen(true)
    })
  }, [])

  if (loading) return null
  var newest = runs[0]
  var isStale = !newest || (Date.now() - new Date(newest.started_at).getTime()) > STALE_AFTER_MIN * 60 * 1000
  var lastBad = runs.find(function (r) { return r.status !== 'ok' })
  var flagged = isStale || !!lastBad

  if (runs.length === 0 && !isStale) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button type="button" onClick={function () { setOpen(!open) }}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <p className="flex items-center gap-2 text-[13.5px] font-bold text-slate-900">
          <Icon name="refresh" size={15} className={flagged ? 'text-rose-500' : 'text-emerald-600'} />
          Recent sync runs
          {isStale && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">No sync in a while</span>}
          {!isStale && lastBad && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Check this</span>}
        </p>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={15} className="text-slate-400" />
      </button>
      {open && (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {isStale && (
            <p className="px-4 py-2.5 text-[12.5px] text-rose-700 bg-rose-50">
              {newest ? 'Last sync was ' + formatDateTime(newest.started_at) + ' -- the scheduled sync runs every 15 minutes, so this is overdue. Check the cron job and the function logs.'
                : 'No sync has ever run. Check the cron job (sync-events-15min) is set up.'}
            </p>
          )}
          {runs.map(function (r) {
            var expanded = expandedId === r.id
            var hasErrors = r.errors && r.errors.length > 0
            return (
              <div key={r.id} className="px-4 py-2.5">
                <button type="button" onClick={function () { setExpandedId(expanded ? null : r.id) }}
                  disabled={!hasErrors}
                  className="w-full flex items-center justify-between gap-3 text-left disabled:cursor-default">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className={'shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ' +
                      (r.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : r.status === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}>
                      {r.status === 'ok' ? 'OK' : r.status === 'error' ? 'Failed' : 'Errors'}
                    </span>
                    <span className="text-[12.5px] text-slate-600">{formatDateTime(r.started_at)}</span>
                    <span className="text-[11px] text-slate-400">{r.trigger_source === 'cron' ? 'scheduled' : 'manual'}</span>
                  </div>
                  <div className="shrink-0 flex items-center gap-3 text-[11.5px] text-slate-500 tabular-nums">
                    {r.total_fetched != null && <span>{r.total_synced}/{r.total_fetched} synced</span>}
                    {!!r.total_stale && <span className="text-amber-700 font-semibold">{r.total_stale} stale</span>}
                    {hasErrors && <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={13} className="text-slate-400" />}
                  </div>
                </button>
                {expanded && hasErrors && (
                  <div className="mt-1.5 ml-1 space-y-1">
                    {r.errors.map(function (e, i) {
                      return <p key={i} className="text-[11.5px] text-rose-600">{e}</p>
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Every contract that went missing from LMS's own list this sync, flagged
// here instead of being auto-hidden -- absence alone can't tell a genuine
// LMS cancellation apart from LMS's own confirmed listing-gap bug (see
// sync-events/index.ts's big comment), so nothing on this list has actually
// been touched yet. Every occurrence triggers a push to
// lms_sync_notification_subscribers, instead of only a console.log nobody
// reads -- which is how contract #00773 sat silently cancelled for 6 days
// under the old all-or-nothing version of this logic.
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
    if (action === 'confirm_cancelled' && !(await appConfirm('Confirm this contract is genuinely cancelled in LMS? This will hide it from the app.'))) return
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
            Contracts that went missing from LMS's own list this sync — still fully visible and working in the app,
            nothing has been hidden. <strong>Dismiss</strong> if this is a known blip (keeps the contract as-is and
            stops future alerts for it). <strong>Confirm Cancelled</strong> only once you've checked in LMS and it
            really is gone — that's the one action that hides it here too.
          </p>
        </div>
      </div>

      <SyncRuns />

      <div className="flex items-start justify-between gap-3 flex-wrap">
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
                    Missing from LMS's list since {formatDate(r.detected_at)}
                    {resolved && (
                      <> · {r.resolution === 'confirm_cancelled' ? 'Confirmed cancelled — hidden' : 'Dismissed — left as-is, no more alerts'} {formatDate(r.resolved_at)}</>
                    )}
                  </p>
                </div>
                {!resolved && (
                  <div className="flex gap-2 shrink-0">
                    <button type="button" disabled={busyId === r.id} onClick={function () { resolve(r.id, 'dismiss') }}
                      className="h-8 px-3 rounded-lg text-[12px] font-bold text-slate-600 border border-slate-200 bg-white hover:border-slate-300 disabled:opacity-50">
                      Dismiss
                    </button>
                    <button type="button" disabled={busyId === r.id} onClick={function () { resolve(r.id, 'confirm_cancelled') }}
                      className="h-8 px-3 rounded-lg text-[12px] font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50">
                      {busyId === r.id ? 'Working...' : 'Confirm Cancelled'}
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
