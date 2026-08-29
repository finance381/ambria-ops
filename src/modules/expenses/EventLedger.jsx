import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate } from '../../lib/format'
import EventDatePicker from '../../components/ui/EventDatePicker'

var ENTRY_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'collection', label: 'Collections' },
  { key: 'lms_advance', label: 'LMS Advances' },
  { key: 'expense', label: 'Expenses' },
  { key: 'plates', label: 'Plates' },
]

var EVT_COLS = 'id, event_name, function_date, venue_name, client_name, session, department, created_user_name, contract_no, agreed_cash_paise, agreed_bank_paise'

function _deptOrder(d) {
  if (d === 'Venue') return 0
  if (d === 'Decor') return 1
  if (d === 'Catering') return 2
  if (d === 'Entertainment') return 3
  return 9
}
function _deptCls(d) {
  if (d === 'Venue') return 'bg-blue-100 text-blue-700'
  if (d === 'Decor') return 'bg-purple-100 text-purple-700'
  if (d === 'Catering') return 'bg-amber-100 text-amber-700'
  if (d === 'Entertainment') return 'bg-pink-100 text-pink-700'
  return 'bg-gray-100 text-gray-600'
}
function _groupKey(f) {
  return (f.client_name || '') + '|' + (f.function_date || '') + '|' + (f.venue_name || '') + '|' + (f.session || '')
}
function _buildGroups(rows) {
  var byKey = {}
  for (var i = 0; i < rows.length; i++) {
    var k = _groupKey(rows[i])
    if (!byKey[k]) byKey[k] = []
    byKey[k].push(rows[i])
  }
  var out = []
  Object.keys(byKey).forEach(function (k) {
    var contracts = byKey[k].slice().sort(function (a, b) { return _deptOrder(a.department) - _deptOrder(b.department) })
    var primary = contracts[0]
    out.push({
      key: k,
      contracts: contracts,
      event_ids: contracts.map(function (c) { return c.id }),
      event_name: primary.event_name,
      client_name: primary.client_name,
      venue_name: primary.venue_name,
      session: primary.session,
      function_date: primary.function_date
    })
  })
  return out
}

function EventLedger(props) {
  var propEventId = props && props.eventId ? String(props.eventId) : null
  var [date, setDate] = useState('')
  var [functions, setFunctions] = useState([])
  var [functionsLoading, setFunctionsLoading] = useState(false)
  var [eventId, setEventId] = useState(propEventId || '')
  var [eventDetail, setEventDetail] = useState(null)
  var [balance, setBalance] = useState(null)
  var [balanceLoading, setBalanceLoading] = useState(false)
  var [entries, setEntries] = useState([])
  var [entriesLoading, setEntriesLoading] = useState(false)
  var [plateEvents, setPlateEvents] = useState([])
  var [platesLoading, setPlatesLoading] = useState(false)
  var [filter, setFilter] = useState('all')
  var [balancesByContract, setBalancesByContract] = useState({})

  async function loadFunctions(dateStr) {
    setDate(dateStr)
    setEventId('')
    setEventDetail(null)
    setBalance(null)
    setBalancesByContract({})
    setEntries([])
    setPlateEvents([])
    if (!dateStr) { setFunctions([]); return }
    setFunctionsLoading(true)
    var { data } = await supabase.from('events')
      .select(EVT_COLS)
      .eq('function_date', dateStr)
      .order('event_name')
    var rows = data || []
    setFunctions(rows)
    setFunctionsLoading(false)
    var groups = _buildGroups(rows)
    if (groups.length === 1) selectGroup(groups[0])
  }

  function selectGroup(g) {
    if (!g) {
      setEventId(''); setEventDetail(null); setBalance(null); setBalancesByContract({}); setEntries([]); setPlateEvents([])
      return
    }
    setEventId(String(g.event_ids[0]))  // legacy anchor: any contract in this group
    setEventDetail(g.contracts[0])
    loadBalance(g.event_ids)
    loadEntries(g.event_ids)
    loadPlateEvents(g.event_ids)
  }

  useEffect(function () {
    if (!propEventId) return
    ;(async function () {
      var primaryRes = await supabase.from('events')
        .select(EVT_COLS)
        .eq('id', Number(propEventId)).maybeSingle()
      if (!primaryRes.data) return
      var primary = primaryRes.data
      var sameDate = await supabase.from('events')
        .select(EVT_COLS)
        .eq('function_date', primary.function_date)
      var pool = (sameDate.data || []).filter(function (r) { return _groupKey(r) === _groupKey(primary) })
      if (pool.length === 0) pool = [primary]
      setFunctions(pool)
      var group = _buildGroups(pool)[0]
      selectGroup(group)
    })()
  }, [propEventId])

  async function loadBalance(ids) {
    if (!ids || ids.length === 0) { setBalance(null); setBalancesByContract({}); return }
    setBalanceLoading(true)
    var results = await Promise.all(ids.map(function (id) {
      return supabase.rpc('fn_event_balance', { p_event_id: Number(id) })
    }))
    var agg = { pending_cash_paise: 0, pending_bank_paise: 0, agreed_cash_paise: 0, agreed_bank_paise: 0, collected_cash_paise: 0, collected_bank_paise: 0, spent_paise: 0 }
    var byId = {}
    var any = false
    results.forEach(function (r, idx) {
      if (r.error || !r.data || r.data.length === 0) return
      any = true
      var row = r.data[0]
      byId[ids[idx]] = row
      Object.keys(agg).forEach(function (k) { agg[k] += Number(row[k] || 0) })
    })
    setBalance(any ? agg : null)
    setBalancesByContract(byId)
    setBalanceLoading(false)
  }

  async function loadEntries(ids) {
    if (!ids || ids.length === 0) { setEntries([]); return }
    setEntriesLoading(true)
    var { data } = await supabase.from('event_ledger')
      .select('id, entry_type, direction, payment_mode, amount_paise, reference_type, reference_id, description, created_by, created_at, event_id')
      .in('event_id', ids.map(Number))
      .order('created_at', { ascending: false })
    var rows = data || []
    var creatorIds = []
    rows.forEach(function (r) { if (r.created_by && creatorIds.indexOf(r.created_by) === -1) creatorIds.push(r.created_by) })
    var nameById = {}
    if (creatorIds.length > 0) {
      var { data: profRows } = await supabase.from('profiles').select('id, name').in('id', creatorIds)
      ;(profRows || []).forEach(function (p) { nameById[p.id] = p.name || null })
    }
    rows = rows.map(function (r) { r._creatorName = nameById[r.created_by] || null; return r })
    setEntries(rows)
    setEntriesLoading(false)
  }

  async function loadPlateEvents(ids) {
    if (!ids || ids.length === 0) { setPlateEvents([]); return }
    setPlatesLoading(true)
    var numIds = ids.map(Number)
    var [iRes, cRes] = await Promise.all([
      supabase.from('extra_plate_issues')
        .select('id, plates_count, notes, status, cancelled_reason, cancelled_at, created_at, issued_by')
        .in('event_id', numIds)
        .order('created_at', { ascending: false }),
      supabase.from('extra_plate_collections')
        .select('id, extras_charged, plates_returned, rate_paise, total_paise, discount_paise, payment_mode, payment_sub_mode, notes, status, cancelled_reason, cancelled_at, created_at, collected_by')
        .in('event_id', numIds)
        .order('created_at', { ascending: false })
    ])
    var issues = (iRes.data || []).map(function (r) { return Object.assign({}, r, { _kind: 'issue' }) })
    var collections = (cRes.data || []).map(function (r) { return Object.assign({}, r, { _kind: 'collection' }) })
    var merged = issues.concat(collections).sort(function (a, b) {
      return new Date(b.created_at) - new Date(a.created_at)
    })
    setPlateEvents(merged)
    setPlatesLoading(false)
  }

  function filteredEntries() {
    if (filter === 'all') return entries
    return entries.filter(function (e) { return e.entry_type === filter })
  }

  function badgeClass(entryType, direction) {
    if (direction === 'in') return 'bg-green-100 text-green-800'
    if (direction === 'out') return 'bg-red-100 text-red-800'
    return 'bg-gray-100 text-gray-700'
  }

  var pendCashP = balance ? Number(balance.pending_cash_paise || 0) : 0
  var pendBankP = balance ? Number(balance.pending_bank_paise || 0) : 0
  var agrCashP = balance ? Number(balance.agreed_cash_paise || 0) : 0
  var agrBankP = balance ? Number(balance.agreed_bank_paise || 0) : 0
  var colCashP = balance ? Number(balance.collected_cash_paise || 0) : 0
  var colBankP = balance ? Number(balance.collected_bank_paise || 0) : 0
  var spentP = balance ? Number(balance.spent_paise || 0) : 0

  var _groups = _buildGroups(functions)
  var selectedGroup = eventId
    ? _groups.find(function (g) { return g.event_ids.map(String).indexOf(String(eventId)) !== -1 })
    : null
  var contractByEventId = {}
  if (selectedGroup) selectedGroup.contracts.forEach(function (c) { contractByEventId[c.id] = c })
  var multiContract = !!(selectedGroup && selectedGroup.contracts.length > 1)

  return (
    <div>
      {!propEventId && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <EventDatePicker label="Event Date" value={date} onChange={loadFunctions} includePast />
        {date && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Function</label>
            {functionsLoading && <p className="text-xs text-gray-400">Loading...</p>}
            {!functionsLoading && functions.length === 0 && <p className="text-xs text-gray-400">No functions on this date</p>}
            {functions.length > 0 && (function () {
              var groups = _buildGroups(functions)
              return (
                <div className="space-y-2">
                  {groups.map(function (g) {
                    var selected = g.event_ids.map(String).indexOf(String(eventId)) !== -1
                    return (
                      <button key={g.key} type="button" onClick={function () { selectGroup(g) }}
                        className={"w-full text-left rounded-lg border p-3 transition-colors " +
                          (selected ? "border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-200"
                                    : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/20")}>
                        <div className="text-sm font-semibold text-gray-900">
                          {g.event_name}{g.client_name && <span> — {g.client_name}</span>}
                        </div>
                        {(g.venue_name || g.session) && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {g.venue_name || ''}{g.venue_name && g.session ? ' · ' : ''}{g.session || ''}
                          </div>
                        )}
                        <div className="mt-2 space-y-1">
                          {g.contracts.map(function (c) {
                            return (
                              <div key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                                {c.department && <span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full " + _deptCls(c.department)}>{c.department}</span>}
                                {c.contract_no && <span className="text-gray-500 font-mono">#{c.contract_no}</span>}
                                {c.created_user_name && <span className="text-gray-400">· by {c.created_user_name}</span>}
                              </div>
                            )
                          })}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}
      </div>
      )}

      {eventDetail && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div><span className="text-gray-500">Event:</span> <span className="font-semibold">{eventDetail.event_name}</span></div>
            {eventDetail.client_name && <div><span className="text-gray-500">Client:</span> {eventDetail.client_name}</div>}
            {eventDetail.venue_name && <div><span className="text-gray-500">Venue:</span> {eventDetail.venue_name}</div>}
            {eventDetail.session && <div><span className="text-gray-500">Session:</span> {eventDetail.session}</div>}
          </div>
        </div>
      )}

      {eventId && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Agreed Cash</div>
            <div className="text-lg font-semibold">{balanceLoading ? '—' : formatPoints(agrCashP)}</div>
            <div className="text-xs text-gray-500 mt-1">Collected {formatPoints(colCashP)}</div>
            <div className={"text-xs font-semibold " + (pendCashP > 0 ? "text-red-600" : "text-green-600")}>
              Pending {formatPoints(pendCashP)}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Agreed Bank</div>
            <div className="text-lg font-semibold">{balanceLoading ? '—' : formatPoints(agrBankP)}</div>
            <div className="text-xs text-gray-500 mt-1">Collected {formatPoints(colBankP)}</div>
            <div className={"text-xs font-semibold " + (pendBankP > 0 ? "text-red-600" : "text-green-600")}>
              Pending {formatPoints(pendBankP)}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Total Collected</div>
            <div className="text-lg font-semibold text-green-700">{balanceLoading ? '—' : formatPoints(colCashP + colBankP)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Total Spent</div>
            <div className="text-lg font-semibold text-red-700">{balanceLoading ? '—' : formatPoints(spentP)}</div>
          </div>
        </div>
      )}

      {eventId && multiContract && (
        <div className="mb-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 text-[11px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">Per-Contract Breakdown</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 uppercase">Contract</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600 uppercase">Agreed Cash</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600 uppercase">Coll. Cash</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600 uppercase">Pend. Cash</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600 uppercase">Agreed Bank</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600 uppercase">Coll. Bank</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600 uppercase">Pend. Bank</th>
                </tr>
              </thead>
              <tbody>
                {selectedGroup.contracts.map(function (c) {
                  var b = balancesByContract[c.id] || {}
                  var pcash = Number(b.pending_cash_paise || 0)
                  var pbank = Number(b.pending_bank_paise || 0)
                  return (
                    <tr key={c.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {c.department && <span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full " + _deptCls(c.department)}>{c.department}</span>}
                          {c.contract_no && <span className="text-gray-500 font-mono">#{c.contract_no}</span>}
                          {c.created_user_name && <span className="text-[11px] text-gray-400">· by {c.created_user_name}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{formatPoints(Number(b.agreed_cash_paise || 0))}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-600">{formatPoints(Number(b.collected_cash_paise || 0))}</td>
                      <td className={"px-3 py-2 text-right font-mono font-semibold " + (pcash > 0 ? "text-red-600" : "text-green-600")}>{formatPoints(pcash)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatPoints(Number(b.agreed_bank_paise || 0))}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-600">{formatPoints(Number(b.collected_bank_paise || 0))}</td>
                      <td className={"px-3 py-2 text-right font-mono font-semibold " + (pbank > 0 ? "text-red-600" : "text-green-600")}>{formatPoints(pbank)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {eventId && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ENTRY_TYPES.map(function (t) {
            var active = filter === t.key
            return (
              <button key={t.key} onClick={function () { setFilter(t.key) }}
                className={"px-3 py-1.5 rounded-full text-xs font-semibold transition-colors " +
                  (active ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
                {t.label}
              </button>
            )
          })}
        </div>
      )}

      {eventId && filter === 'plates' && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {platesLoading ? (
            <p className="text-xs text-gray-400 p-4">Loading plate history...</p>
          ) : plateEvents.length === 0 ? (
            <p className="text-sm text-gray-400 p-4 text-center">No plate activity for this event</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Plates</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Returned</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Charged</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Amount</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Mode</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {plateEvents.map(function (p) {
                    var isIssue = p._kind === 'issue'
                    var isCancelled = p.status === 'cancelled'
                    var isWaste = !isIssue && (p.extras_charged === 0 || p.total_paise === 0) && (p.plates_returned || 0) > 0
                    var typeLabel = isIssue ? 'Issue' : (isWaste ? 'Waste' : 'Collection')
                    var typeClass = isIssue
                      ? 'bg-blue-100 text-blue-700'
                      : isWaste ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                    var modeLabel = !isIssue && p.payment_mode
                      ? p.payment_mode + (p.payment_sub_mode ? ' · ' + p.payment_sub_mode : '')
                      : '—'
                    return (
                      <tr key={p._kind + '-' + p.id} className={"border-b border-gray-100 last:border-b-0 " + (isCancelled ? "opacity-40 line-through" : "")}>
                        <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{formatDate(p.created_at)}</td>
                        <td className="px-3 py-2">
                          <span className={"inline-block px-2 py-0.5 rounded text-xs font-medium " + typeClass}>
                            {typeLabel}{isCancelled ? ' · Cancelled' : ''}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-gray-800">{isIssue ? p.plates_count : '—'}</td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-amber-700">{!isIssue && (p.plates_returned || 0) > 0 ? p.plates_returned : '—'}</td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-gray-800">{!isIssue && (p.extras_charged || 0) > 0 ? p.extras_charged : '—'}</td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-green-700">{!isIssue && (p.total_paise || 0) > 0 ? formatPoints(p.total_paise) : '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{modeLabel}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{p.notes || (isCancelled && p.cancelled_reason ? '(' + p.cancelled_reason + ')' : '—')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {eventId && filter !== 'plates' && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {entriesLoading ? (
            <p className="text-xs text-gray-400 p-4">Loading entries...</p>
          ) : filteredEntries().length === 0 ? (
            <p className="text-sm text-gray-400 p-4 text-center">No entries</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Mode</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">In</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Out</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries().map(function (e) {
                    return (
                      <tr key={e.id} className="border-b border-gray-100 last:border-b-0">
                        <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{formatDate(e.created_at)}</td>
                        <td className="px-3 py-2">
                          <span className={"inline-block px-2 py-0.5 rounded text-xs font-medium " + badgeClass(e.entry_type, e.direction)}>
                            {e.entry_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">{e.payment_mode || '—'}</td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-green-700">
                          {e.direction === 'in' ? formatPoints(e.amount_paise) : ''}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-mono text-red-700">
                          {e.direction === 'out' ? formatPoints(e.amount_paise) : ''}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700">
                          {multiContract && contractByEventId[e.event_id] && contractByEventId[e.event_id].department && (
                            <span className={"inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full mr-2 " + _deptCls(contractByEventId[e.event_id].department)}>
                              {contractByEventId[e.event_id].department}
                            </span>
                          )}
                          {e.description || '—'}
                          {e._creatorName && <div className="text-[10px] text-gray-400 mt-0.5">by {e._creatorName}</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default EventLedger