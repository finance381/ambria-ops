import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate, formatDateTime } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import { hasPerm } from '../../lib/permissions'

// Every real cash/bank movement in the system, from whichever source recorded it:
// money paid out (vendor payments/deductions, salary payments/adjustments, wallet-funded
// expense spend) and money collected in (event collections, extra-plate collections,
// expense refunds). Each source tags its rows with a payment mode (cash/bank) — entries
// with no mode aren't real money movement (e.g. plain point issuances) and are excluded here.
var TYPE_META = {
  vendor_payment:     { label: 'Vendor Payment',           direction: 'out', cls: 'bg-red-50 text-red-700 border-red-200' },
  vendor_deduction:   { label: 'Vendor Deduction',         direction: 'out', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  salary_payment:     { label: 'Salary Payment',           direction: 'out', cls: 'bg-red-50 text-red-700 border-red-200' },
  salary_adjustment:  { label: 'Salary Adjustment',        direction: 'out', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  collection:         { label: 'Event Collection',         direction: 'in',  cls: 'bg-green-50 text-green-700 border-green-200' },
  epc:                { label: 'Extra Plate Collection',   direction: 'in',  cls: 'bg-green-50 text-green-700 border-green-200' },
  expense:            { label: 'Expense (Cash)',           direction: 'out', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  expense_refund:     { label: 'Expense Refund',           direction: 'in',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

function PaymentsLedger({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canView = hasPerm(permsNew, 'finance.payments')

  var [rows, setRows] = useState([])
  var [loading, setLoading] = useState(true)
  var [dateFrom, setDateFrom] = useState(function () { return new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] })
  var [dateTo, setDateTo] = useState(function () { return new Date().toISOString().split('T')[0] })
  var [modeFilter, setModeFilter] = useState('all') // 'all' | 'cash' | 'bank'
  var [dirFilter, setDirFilter] = useState('all') // 'all' | 'in' | 'out'
  var [search, setSearch] = useState('')

  async function load() {
    if (!canView) { setLoading(false); return }
    setLoading(true)

    var [ledgerRes, collectRes, expWalletRes] = await Promise.all([
      supabase
        .from('ledger_entries')
        .select('id, ledger_type, party_id, entry_date, created_at, description, debit_paise, ref_id, ref_type, metadata')
        .in('ledger_type', ['vendor', 'user_salary'])
        .in('ref_type', ['vendor_payment', 'vendor_deduction', 'salary_payment', 'salary_adjustment'])
        .is('deleted_at', null)
        .gte('entry_date', dateFrom)
        .lte('entry_date', dateTo)
        .order('entry_date', { ascending: false })
        .limit(1000),
      supabase
        .from('wallet_transactions')
        .select('id, created_at, amount_paise, description, payment_mode, receipt_no, reference_id, performed_by, status')
        .eq('reference_type', 'collection')
        .not('payment_mode', 'is', null)
        .neq('status', 'cancelled')
        .gte('created_at', dateFrom)
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: false })
        .limit(1000),
      // Wallet-funded expense spend (payment_cash_paise) — the real cash outflow happens
      // the moment the expense is submitted, funded from the submitter's own wallet float.
      supabase
        .from('wallet_transactions')
        .select('id, wallet_id, amount_paise, description, reference_type, created_at')
        .in('reference_type', ['expense', 'expense_refund'])
        .gte('created_at', dateFrom)
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: false })
        .limit(1000),
    ])

    var ledgerRows = (ledgerRes.data || []).filter(function (r) {
      return r.metadata && (r.metadata.mode === 'cash' || r.metadata.mode === 'bank')
    })
    var collectRows = collectRes.data || []
    var expWalletRows = expWalletRes.data || []

    // Resolve vendor / employee party names
    var vendorIds = []
    var profileIds = []
    ledgerRows.forEach(function (r) {
      var list = r.ledger_type === 'vendor' ? vendorIds : profileIds
      if (list.indexOf(r.party_id) === -1) list.push(r.party_id)
    })

    // Expense wallet rows only carry a wallet_id — resolve to the owning user first
    var walletIdsForOwners = []
    expWalletRows.forEach(function (r) { if (walletIdsForOwners.indexOf(r.wallet_id) === -1) walletIdsForOwners.push(r.wallet_id) })
    var collectIds = collectRows.map(function (w) { return w.id })

    var [vRes, walletOwnersRes, epcRes] = await Promise.all([
      vendorIds.length > 0 ? supabase.from('vendors').select('id, name').in('id', vendorIds) : Promise.resolve({ data: [] }),
      walletIdsForOwners.length > 0 ? supabase.from('wallets').select('id, user_id').in('id', walletIdsForOwners) : Promise.resolve({ data: [] }),
      // EPC back-links so collections can be split from plain event collections
      collectIds.length > 0 ? supabase.from('extra_plate_collections').select('id, event_id, wallet_tx_id').in('wallet_tx_id', collectIds) : Promise.resolve({ data: [] }),
    ])
    var vendorNames = {}; (vRes.data || []).forEach(function (v) { vendorNames[v.id] = v.name })
    var walletOwnerMap = {}; (walletOwnersRes.data || []).forEach(function (w) { walletOwnerMap[w.id] = w.user_id })
    var epcByWalletTx = {}; (epcRes.data || []).forEach(function (e) { if (e.wallet_tx_id) epcByWalletTx[e.wallet_tx_id] = e })

    expWalletRows.forEach(function (r) {
      var uid = walletOwnerMap[r.wallet_id]
      if (uid && profileIds.indexOf(uid) === -1) profileIds.push(uid)
    })

    // Resolve event names for collections (plain: reference_id is the event id; EPC: via extra_plate_collections.event_id)
    var eventIds = []
    collectRows.forEach(function (w) {
      var epc = epcByWalletTx[w.id]
      var evId = epc ? epc.event_id : (w.reference_id ? Number(w.reference_id) : null)
      if (evId && eventIds.indexOf(evId) === -1) eventIds.push(evId)
    })

    var [pRes, evRes] = await Promise.all([
      profileIds.length > 0 ? supabase.from('profiles').select('id, name').in('id', profileIds) : Promise.resolve({ data: [] }),
      eventIds.length > 0 ? supabase.from('events').select('id, event_name').in('id', eventIds) : Promise.resolve({ data: [] }),
    ])
    var profileNames = {}; (pRes.data || []).forEach(function (p) { profileNames[p.id] = p.name })
    var eventNames = {}; (evRes.data || []).forEach(function (e) { eventNames[e.id] = e.event_name })

    var combined = []
    ledgerRows.forEach(function (r) {
      var meta = TYPE_META[r.ref_type] || { label: r.ref_type, direction: 'out', cls: 'bg-gray-50 text-gray-700 border-gray-200' }
      var partyName = r.ledger_type === 'vendor' ? (vendorNames[r.party_id] || '—') : (profileNames[r.party_id] || '—')
      combined.push({
        key: 'le:' + r.id,
        date: r.entry_date,
        logged_at: r.created_at,
        direction: meta.direction,
        mode: r.metadata.mode,
        amount_paise: r.debit_paise || 0,
        party_name: partyName,
        description: r.description || '',
        type_label: meta.label,
        type_cls: meta.cls,
      })
    })
    collectRows.forEach(function (w) {
      var epc = epcByWalletTx[w.id]
      var isEpc = !!epc
      var meta = isEpc ? TYPE_META.epc : TYPE_META.collection
      var evId = isEpc ? epc.event_id : (w.reference_id ? Number(w.reference_id) : null)
      var partyName = (evId && eventNames[evId]) || '—'
      combined.push({
        key: 'wt:' + w.id,
        date: w.created_at ? w.created_at.split('T')[0] : '',
        logged_at: w.created_at,
        direction: meta.direction,
        mode: w.payment_mode,
        amount_paise: w.amount_paise || 0,
        party_name: partyName,
        description: w.description || (w.receipt_no ? '#' + w.receipt_no : ''),
        type_label: meta.label,
        type_cls: meta.cls,
      })
    })
    expWalletRows.forEach(function (r) {
      var meta = TYPE_META[r.reference_type]
      var uid = walletOwnerMap[r.wallet_id]
      var partyName = (uid && profileNames[uid]) || '—'
      combined.push({
        key: 'we:' + r.id,
        date: r.created_at ? r.created_at.split('T')[0] : '',
        logged_at: r.created_at,
        direction: meta.direction,
        mode: 'cash',
        amount_paise: r.amount_paise || 0,
        party_name: partyName,
        description: r.description || '',
        type_label: meta.label,
        type_cls: meta.cls,
      })
    })

    combined.sort(function (a, b) { return (b.logged_at || '').localeCompare(a.logged_at || '') })
    setRows(combined)
    setLoading(false)
  }

  useEffect(function () { load() }, [canView, dateFrom, dateTo])
  useRealtime(['ledger_entries', 'wallet_transactions', 'extra_plate_collections', 'wallets'], function () { load() })

  var visible = useMemo(function () {
    var searchLower = search.trim().toLowerCase()
    return rows.filter(function (r) {
      if (modeFilter !== 'all' && r.mode !== modeFilter) return false
      if (dirFilter !== 'all' && r.direction !== dirFilter) return false
      if (searchLower && (r.party_name || '').toLowerCase().indexOf(searchLower) === -1 && (r.description || '').toLowerCase().indexOf(searchLower) === -1) return false
      return true
    })
  }, [rows, modeFilter, dirFilter, search])

  var totals = useMemo(function () {
    var totalIn = 0, totalOut = 0
    visible.forEach(function (r) {
      if (r.direction === 'in') totalIn += r.amount_paise
      else totalOut += r.amount_paise
    })
    return { in: totalIn, out: totalOut, net: totalIn - totalOut }
  }, [visible])

  if (!canView) {
    return <p className="text-gray-400 text-sm text-center py-8">No access</p>
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Cash & Bank Ledger</h2>
        <p className="text-xs text-gray-400">
          {visible.length} transaction{visible.length !== 1 ? 's' : ''} · In {formatPoints(totals.in)} · Out {formatPoints(totals.out)} · Net {formatPoints(totals.net)}
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
        <input type="text" value={search} onChange={function (ev) { setSearch(ev.target.value) }}
          placeholder="Search vendor, employee, event, or description..."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
          style={{ fontSize: '16px' }} />
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={dateFrom} onChange={function (ev) { setDateFrom(ev.target.value) }}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }} />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={dateTo} onChange={function (ev) { setDateTo(ev.target.value) }}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300" style={{ fontSize: '16px' }} />
          <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
            {[['all', 'All'], ['in', 'In'], ['out', 'Out']].map(function (opt) {
              var active = dirFilter === opt[0]
              return (
                <button key={opt[0]} type="button" onClick={function () { setDirFilter(opt[0]) }}
                  className={"px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors " + (active ? "bg-white shadow-sm text-gray-900" : "text-gray-500")}>
                  {opt[1]}
                </button>
              )
            })}
          </div>
          <div className="inline-flex bg-gray-100 rounded-lg p-0.5 ml-auto">
            {[['all', 'All'], ['cash', '💵 Cash'], ['bank', '🏦 Bank']].map(function (opt) {
              var active = modeFilter === opt[0]
              return (
                <button key={opt[0]} type="button" onClick={function () { setModeFilter(opt[0]) }}
                  className={"px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors " + (active ? "bg-white shadow-sm text-gray-900" : "text-gray-500")}>
                  {opt[1]}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-gray-400 text-sm text-center py-8">Loading...</p>
        ) : visible.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No transactions in this range.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {visible.map(function (r) {
              var isIn = r.direction === 'in'
              return (
                <div key={r.key} className="px-4 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.party_name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-gray-500">{formatDate(r.date)}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 border rounded bg-gray-50 text-gray-700 border-gray-200">
                        {r.mode === 'cash' ? '💵 Cash' : '🏦 Bank'}
                      </span>
                      <span className={"text-[10px] font-semibold px-1.5 py-0.5 border rounded " + r.type_cls}>
                        {r.type_label}
                      </span>
                      {r.description && <span className="text-[10px] text-gray-400 truncate">{r.description}</span>}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">Logged {formatDateTime(r.logged_at)}</p>
                  </div>
                  <p className={"text-sm font-bold flex-shrink-0 " + (isIn ? "text-green-700" : "text-gray-900")}>
                    {isIn ? '+' : '-'}{formatPoints(r.amount_paise || 0)}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default PaymentsLedger
