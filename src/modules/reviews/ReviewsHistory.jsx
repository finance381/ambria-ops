import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { hasPerm } from '../../lib/permissions'
import { DOMAIN_META } from './ReviewComponents.jsx'

var KIND_LABELS = {
  submit: 'Submitted', approve: 'Approved', reject: 'Rejected',
  request_changes: 'Requested changes', comment: 'Commented', delegate: 'Delegated', reopen: 'Reopened',
}

// review_events is polymorphic (domain + source_id, no FK) — there's no single join
// target, so titles are batch-fetched per domain (one query per domain present on the
// current page, not one per row) rather than N+1'd row by row.
var TITLE_TABLE = {
  inventory: { table: 'inventory_items', col: 'name' },
  item_receipt: { table: 'catering_store_items', col: 'name' },
  expense: { table: 'expenses', col: 'description' },
  requisition: { table: 'requisitions', col: 'purpose' },
  vendor_payment: { table: 'ledger_entries', col: 'description' },
}

function ReviewsHistory({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canView = hasPerm(permsNew, 'review.history')

  var [events, setEvents] = useState([])
  var [loading, setLoading] = useState(true)
  var [domainFilter, setDomainFilter] = useState('')
  var [kindFilter, setKindFilter] = useState('')
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [actorNames, setActorNames] = useState({})
  var [titles, setTitles] = useState({})

  useEffect(function () {
    if (canView) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainFilter, kindFilter, dateFrom, dateTo])

  async function load() {
    setLoading(true)
    var q = supabase.from('review_events').select('*').order('created_at', { ascending: false }).limit(300)
    if (domainFilter) q = q.eq('domain', domainFilter)
    if (kindFilter) q = q.eq('kind', kindFilter)
    if (dateFrom) q = q.gte('created_at', dateFrom)
    if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59')
    var res = await q
    var rows = res.data || []
    setEvents(rows)

    var actorIds = Array.from(new Set(rows.map(function (e) { return e.actor_id })))
    if (actorIds.length > 0) {
      var pRes = await supabase.from('profiles').select('id, name').in('id', actorIds)
      var names = {}
      ;(pRes.data || []).forEach(function (p) { names[p.id] = p.name })
      setActorNames(names)
    }

    var byDomain = {}
    rows.forEach(function (e) {
      if (!byDomain[e.domain]) byDomain[e.domain] = []
      if (byDomain[e.domain].indexOf(e.source_id) === -1) byDomain[e.domain].push(e.source_id)
    })
    var titleMap = {}
    await Promise.all(Object.keys(byDomain).map(async function (domain) {
      var cfg = TITLE_TABLE[domain]
      if (!cfg) return
      var tRes = await supabase.from(cfg.table).select('id, ' + cfg.col).in('id', byDomain[domain])
      ;(tRes.data || []).forEach(function (r) { titleMap[domain + ':' + r.id] = r[cfg.col] })
    }))
    setTitles(titleMap)
    setLoading(false)
  }

  if (!canView) return <p className="text-gray-400 text-sm text-center py-12">You don't have access to Review History.</p>

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Review History</h2>
        <p className="text-xs text-gray-400">{events.length} event{events.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={domainFilter} onChange={function (ev) { setDomainFilter(ev.target.value) }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
          <option value="">All domains</option>
          {Object.keys(DOMAIN_META).map(function (d) { return <option key={d} value={d}>{DOMAIN_META[d].label}</option> })}
        </select>
        <select value={kindFilter} onChange={function (ev) { setKindFilter(ev.target.value) }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }}>
          <option value="">All actions</option>
          {Object.keys(KIND_LABELS).map(function (k) { return <option key={k} value={k}>{KIND_LABELS[k]}</option> })}
        </select>
        <input type="date" value={dateFrom} onChange={function (ev) { setDateFrom(ev.target.value) }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }} />
        <input type="date" value={dateTo} onChange={function (ev) { setDateTo(ev.target.value) }}
          className="px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white" style={{ fontSize: '16px' }} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-center text-sm text-gray-400 py-8">Loading...</p>
        ) : events.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">No events</p>
        ) : (
          events.map(function (e) {
            var meta = DOMAIN_META[e.domain] || {}
            var title = titles[e.domain + ':' + e.source_id] || ('#' + e.source_id)
            return (
              <div key={e.id} className="flex items-start gap-3 px-3 py-2.5 border-b border-gray-100 last:border-b-0">
                <i className={"ti " + (meta.icon || 'ti-list') + " text-gray-400 mt-0.5"} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">
                    <span className="font-semibold">{actorNames[e.actor_id] || '—'}</span>{' '}
                    {(KIND_LABELS[e.kind] || e.kind).toLowerCase()}{' '}
                    <span className="text-gray-500">{title}</span>
                  </p>
                  {e.notes && <p className="text-xs text-gray-500 mt-0.5">{e.notes}</p>}
                  <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(e.created_at)} · {meta.label}</p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default ReviewsHistory
