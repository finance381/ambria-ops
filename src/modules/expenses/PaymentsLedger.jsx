import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate, formatDateTime } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import { hasPerm } from '../../lib/permissions'
import SearchField from '../../components/ui/SearchField'
import Icon from '../../components/ui/Icon'
import EventDatePicker from '../../components/ui/EventDatePicker'
import { CARD } from '../../lib/ui'
import { useExpenseDetailModal } from '../../hooks/useExpenseDetailModal.jsx'
import PaymentProofThumbs from '../../components/ledger/PaymentProofThumbs'
import { getReceiptUrl, isVoiceNotePath } from '../../lib/uploadHelper'

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

// What the name on a row refers to. The chips said the transaction type but
// never what the name beside them was, so "Carpet Sharma" and "WEDDING" —
// a vendor and an event — read as the same kind of thing.
var SOURCE_META = {
  vendor:     { label: 'Vendor',   dot: 'bg-violet-500',  cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  salary:     { label: 'Employee', dot: 'bg-sky-500',     cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  collection: { label: 'Event',    dot: 'bg-emerald-500', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  expense:    { label: 'Staff',    dot: 'bg-amber-500',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
}

// The clock time a row was logged at, for the quiet date line under the
// particulars — not a second "Logged ..." sentence of its own.
// The column heading already says pts. Repeating it on every row is the same
// word three hundred and eighty-nine times, in the one column where the
// figures need to line up.
function pts(paise) {
  return formatPoints(paise).replace(' pts', '')
}

function timeOf(ts) {
  if (!ts) return ''
  var d = new Date(ts)
  if (isNaN(d)) return ''
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
}

var SORTS = [
  { k: 'date_desc', label: 'Date (Newest)' },
  { k: 'date_asc',  label: 'Date (Oldest)' },
  { k: 'amt_desc',  label: 'Amount (High)' },
  { k: 'amt_asc',   label: 'Amount (Low)' },
]

function PaymentsLedger({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var canView = hasPerm(permsNew, 'finance.payments')
  var isAdmin = hasPerm(permsNew, 'admin.dashboard')

  var [rows, setRows] = useState([])
  var [loading, setLoading] = useState(true)
  var [dateFrom, setDateFrom] = useState(function () { return new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] })
  var [dateTo, setDateTo] = useState(function () { return new Date().toISOString().split('T')[0] })
  var [modeFilter, setModeFilter] = useState('all') // 'all' | 'cash' | 'bank'
  var [dirFilter, setDirFilter] = useState('all') // 'all' | 'in' | 'out'
  var [search, setSearch] = useState('')
  var [typeFilter, setTypeFilter] = useState('')
  var [sortKey, setSortKey] = useState('date_desc')
  var [showMore, setShowMore] = useState(false)
  var [page, setPage] = useState(1)
  var [detailTarget, setDetailTarget] = useState(null) // { row, event, collectorName, loading } — vendor/salary/collection rows
  var [enlargedImg, setEnlargedImg] = useState(null)
  var { openExpenseDetail, expenseDetailModal } = useExpenseDetailModal(profile, isAdmin, function () { load() })

  async function load() {
    if (!canView) { setLoading(false); return }
    setLoading(true)

    var [ledgerRes, collectRes, expWalletRes] = await Promise.all([
      supabase
        .from('ledger_entries')
        .select('id, ledger_type, party_id, entry_date, created_at, description, debit_paise, ref_id, ref_type, metadata, created_by')
        .in('ledger_type', ['vendor', 'user_salary'])
        .in('ref_type', ['vendor_payment', 'vendor_deduction', 'salary_payment', 'salary_adjustment'])
        .is('deleted_at', null)
        .gte('entry_date', dateFrom)
        .lte('entry_date', dateTo)
        .order('entry_date', { ascending: false })
        .limit(1000),
      supabase
        .from('wallet_transactions')
        .select('id, created_at, amount_paise, description, payment_mode, receipt_no, reference_id, performed_by, status, received_image_path')
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
        .select('id, wallet_id, amount_paise, description, reference_type, reference_id, created_at')
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
      // Who keyed the row in, which is a different person from whoever it
      // was paid to — the column that used to be blank for every vendor and
      // salary line.
      if (r.created_by && profileIds.indexOf(r.created_by) === -1) profileIds.push(r.created_by)
    })

    // Expense wallet rows only carry a wallet_id — resolve to the owning user first
    var walletIdsForOwners = []
    expWalletRows.forEach(function (r) { if (walletIdsForOwners.indexOf(r.wallet_id) === -1) walletIdsForOwners.push(r.wallet_id) })
    var collectIds = collectRows.map(function (w) { return w.id })

    var [vRes, walletOwnersRes, epcRes] = await Promise.all([
      vendorIds.length > 0 ? supabase.from('vendors').select('id, name').in('id', vendorIds) : Promise.resolve({ data: [] }),
      walletIdsForOwners.length > 0 ? supabase.from('wallets').select('id, user_id').in('id', walletIdsForOwners) : Promise.resolve({ data: [] }),
      // EPC back-links so collections can be split from plain event collections
      collectIds.length > 0 ? supabase.from('extra_plate_collections').select('id, event_id, wallet_tx_id, extras_charged, plates_returned, discount_paise').in('wallet_tx_id', collectIds) : Promise.resolve({ data: [] }),
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
      if (w.performed_by && profileIds.indexOf(w.performed_by) === -1) profileIds.push(w.performed_by)
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
        source: r.ledger_type === 'vendor' ? 'vendor' : 'salary',
        date: r.entry_date,
        logged_at: r.created_at,
        direction: meta.direction,
        mode: r.metadata.mode,
        amount_paise: r.debit_paise || 0,
        party_name: partyName,
        description: r.description || '',
        type_label: meta.label,
        type_cls: meta.cls,
        recorded_by: (r.created_by && profileNames[r.created_by]) || '',
        _metadata: r.metadata,
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
        source: 'collection',
        date: w.created_at ? w.created_at.split('T')[0] : '',
        logged_at: w.created_at,
        direction: meta.direction,
        mode: w.payment_mode,
        amount_paise: w.amount_paise || 0,
        party_name: partyName,
        collector_name: (w.performed_by && profileNames[w.performed_by]) || '',
        recorded_by: (w.performed_by && profileNames[w.performed_by]) || '',
        description: w.description || (w.receipt_no ? '#' + w.receipt_no : ''),
        type_label: meta.label,
        type_cls: meta.cls,
        _eventId: evId,
        _isEpc: isEpc,
        _epc: epc || null,
        _receiptNo: w.receipt_no,
        _performedBy: w.performed_by,
        _imgUrl: getReceiptUrl(w.received_image_path),
        _imgIsVoice: isVoiceNotePath(w.received_image_path),
      })
    })
    expWalletRows.forEach(function (r) {
      var meta = TYPE_META[r.reference_type]
      var uid = walletOwnerMap[r.wallet_id]
      var partyName = (uid && profileNames[uid]) || '—'
      combined.push({
        key: 'we:' + r.id,
        source: 'expense',
        // The wallet this came out of belongs to whoever spent it, so the
        // party and the recorder are the same person here.
        recorded_by: partyName === '—' ? '' : partyName,
        date: r.created_at ? r.created_at.split('T')[0] : '',
        logged_at: r.created_at,
        direction: meta.direction,
        mode: 'cash',
        amount_paise: r.amount_paise || 0,
        party_name: partyName,
        description: r.description || '',
        type_label: meta.label,
        type_cls: meta.cls,
        _expenseId: r.reference_id,
      })
    })

    combined.sort(function (a, b) { return (b.logged_at || '').localeCompare(a.logged_at || '') })
    setRows(combined)
    setLoading(false)
  }

  useEffect(function () { load() }, [canView, dateFrom, dateTo])
  useRealtime(['ledger_entries', 'wallet_transactions', 'extra_plate_collections', 'wallets'], function () { load() })

  function openRow(r) {
    if (r.source === 'expense') { openExpenseDetail(Number(r._expenseId)); return }
    setDetailTarget({ row: r, event: null, collectorName: '', loading: r.source === 'collection' })
    if (r.source === 'collection' && (r._eventId || r._performedBy)) {
      Promise.all([
        r._eventId
          ? supabase.from('events').select('id, contract_no, event_name, client_name, function_date, venue_name').eq('id', r._eventId).maybeSingle()
          : Promise.resolve({ data: null }),
        r._performedBy
          ? supabase.from('profiles').select('name').eq('id', r._performedBy).maybeSingle()
          : Promise.resolve({ data: null }),
      ]).then(function (res) {
        setDetailTarget({ row: r, event: res[0].data || null, collectorName: (res[1].data && res[1].data.name) || '', loading: false })
      })
    }
  }

  function closeDetail() { setDetailTarget(null) }

  var visible = useMemo(function () {
    var q = search.trim().toLowerCase()
    var out = rows.filter(function (r) {
      if (modeFilter !== 'all' && r.mode !== modeFilter) return false
      if (dirFilter !== 'all' && r.direction !== dirFilter) return false
      if (typeFilter && r.type_label !== typeFilter) return false
      if (q) {
        // The collector and the type are on the row, so they are worth
        // searching: "who took this" is a question people actually ask of
        // this screen, and it used to match nothing.
        var hay = [r.party_name, r.description, r.collector_name, r.recorded_by, r.type_label].join(' ').toLowerCase()
        if (hay.indexOf(q) === -1) return false
      }
      return true
    })
    out.sort(function (a, b) {
      if (sortKey === 'amt_desc') return (b.amount_paise || 0) - (a.amount_paise || 0)
      if (sortKey === 'amt_asc') return (a.amount_paise || 0) - (b.amount_paise || 0)
      var d = (a.logged_at || '').localeCompare(b.logged_at || '')
      return sortKey === 'date_asc' ? d : -d
    })
    return out
  }, [rows, modeFilter, dirFilter, typeFilter, search, sortKey])

  // Every type present in the range, so the filter cannot offer one that
  // returns nothing — and how many rows are behind each, so pressing one is a
  // decision rather than a guess. Commonest first: the long tail of types this
  // business barely uses should not sit above the two it lives on.
  var typesPresent = useMemo(function () {
    var byLabel = {}
    rows.forEach(function (r) {
      if (!r.type_label) return
      byLabel[r.type_label] = (byLabel[r.type_label] || 0) + 1
    })
    return Object.keys(byLabel)
      .map(function (k) { return { label: k, count: byLabel[k] } })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label) })
  }, [rows])

  // Any narrowing makes the page you were on meaningless.
  useEffect(function () { setPage(1) }, [modeFilter, dirFilter, typeFilter, search, sortKey, dateFrom, dateTo])

  var PAGE_SIZE = 25
  var pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  var pageNow = Math.min(page, pageCount)
  var pageRows = visible.slice((pageNow - 1) * PAGE_SIZE, pageNow * PAGE_SIZE)
  var firstShown = visible.length === 0 ? 0 : (pageNow - 1) * PAGE_SIZE + 1
  var lastShown = Math.min(pageNow * PAGE_SIZE, visible.length)

  // 1 … 4 5 6 … 65, never sixty-five buttons.
  var pageButtons = []
  for (var pi = 1; pi <= pageCount; pi++) {
    if (pi === 1 || pi === pageCount || (pi >= pageNow - 1 && pi <= pageNow + 1)) pageButtons.push(pi)
    else if (pageButtons[pageButtons.length - 1] !== '…') pageButtons.push('…')
  }

  var quickActive = modeFilter === 'all' && dirFilter === 'all' && !typeFilter

  function exportCsv() {
    function esc(v) {
      var t = String(v == null ? '' : v)
      if (t.indexOf(',') !== -1 || t.indexOf('"') !== -1 || t.indexOf('\n') !== -1) return '"' + t.replace(/"/g, '""') + '"'
      return t
    }
    var head = ['Date', 'Logged', 'Type', 'Party', 'Party kind', 'Mode', 'Direction', 'Points', 'Recorded by', 'Description']
    // Points as a number: a spreadsheet cannot add up "80,000 pts".
    var body = visible.map(function (r) {
      return [
        formatDate(r.date), formatDateTime(r.logged_at), r.type_label, r.party_name,
        (SOURCE_META[r.source] || {}).label || r.source, r.mode, r.direction === 'in' ? 'In' : 'Out',
        (r.direction === 'in' ? 1 : -1) * ((r.amount_paise || 0) / 100),
        r.recorded_by || r.collector_name || '', r.description || '',
      ].map(esc).join(',')
    })
    var csv = head.join(',') + '\n' + body.join('\n') + '\n'
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = 'cash-bank-' + dateFrom + '-to-' + dateTo + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

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

  var QUICK = [
    { k: 'all',    label: 'All',     on: quickActive,              run: function () { setModeFilter('all'); setDirFilter('all'); setTypeFilter('') }, tone: 'indigo' },
    { k: 'cash',   label: 'Cash',    on: modeFilter === 'cash',    run: function () { setModeFilter(modeFilter === 'cash' ? 'all' : 'cash') }, tone: 'amber' },
    { k: 'bank',   label: 'Bank',    on: modeFilter === 'bank',    run: function () { setModeFilter(modeFilter === 'bank' ? 'all' : 'bank') }, tone: 'sky' },
    { k: 'in',     label: 'Income',  on: dirFilter === 'in',       run: function () { setDirFilter(dirFilter === 'in' ? 'all' : 'in') }, tone: 'emerald' },
    { k: 'out',    label: 'Expense', on: dirFilter === 'out',      run: function () { setDirFilter(dirFilter === 'out' ? 'all' : 'out') }, tone: 'rose' },
  ]
  // Resting, every pill is the same grey: the strip is a row of options, and
  // five colours sitting there unpressed would each be claiming something is
  // already in force. The colour is the answer to pressing one. Cash and Bank
  // used to fill grey even pressed — the two that say what kind of money this
  // is were the only two that could not say it in colour.
  var QUICK_TONE = {
    indigo:  'border-indigo-300 bg-indigo-50 text-indigo-700',
    amber:   'border-amber-300 bg-amber-50 text-amber-800',
    sky:     'border-sky-300 bg-sky-50 text-sky-800',
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    rose:    'border-rose-300 bg-rose-50 text-rose-700',
  }

  return (
    <div className="@container space-y-3">
      <div className={CARD + ' px-4 py-3 overflow-hidden'}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-slate-500">Date Range</span>
            {/* The app's own picker. <input type="date"> renders mm/dd/yyyy in
                US order whatever the locale, which next to "08 Dec 2025"
                everywhere else on the screen is the one that looks wrong. */}
            <div className="w-[136px]">
              <EventDatePicker value={dateFrom} onChange={function (v) { if (v) setDateFrom(v) }}
                collapsible includePast plain neutral placeholder="From" />
            </div>
            <Icon name="arrowRight" size={14} className="shrink-0 text-slate-400" />
            <div className="w-[136px]">
              <EventDatePicker value={dateTo} onChange={function (v) { if (v) setDateTo(v) }}
                collapsible includePast plain neutral placeholder="To" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-slate-500">Quick Filters</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK.map(function (q) {
                return (
                  <button key={q.k} type="button" onClick={q.run} aria-pressed={q.on}
                    className={'h-8 px-3 rounded-full border text-[12px] font-bold transition-colors ' +
                      (q.on ? QUICK_TONE[q.tone] : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
                    {q.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Search is the control people reach for most on this screen, so
                it does not live one press deep behind More Filters. */}
            <SearchField value={search} onChange={function (v) { setSearch(v) }}
              placeholder="Search transactions..." className="w-[220px] @3xl:w-[260px]" />
            <button type="button" onClick={function () { setShowMore(!showMore) }} aria-pressed={showMore}
              className={'h-9 px-3 inline-flex items-center gap-1.5 rounded-xl border text-[12.5px] font-bold transition-colors ' +
                (showMore || typeFilter
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
              <Icon name="filter" size={14} />
              More Filters
              <Icon name={showMore ? 'chevronUp' : 'chevronDown'} size={13} />
            </button>
            <button type="button" onClick={exportCsv} disabled={visible.length === 0}
              title="Export everything shown, in the order it is shown"
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-xl text-[12.5px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-indigo-600 transition-all">
              <Icon name="download" size={14} />
              Export
            </button>
          </div>
        </div>

        {showMore && (
          /* A drawer on its own ground under the toolbar. Search left it for
             the row above, so what is behind the button is the one thing that
             needs the room: every type in the range, with its count. */
          <div className="mt-3 -mx-4 -mb-3 px-4 py-3.5 border-t border-slate-200 bg-slate-50/70">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Transaction type</p>
              {typeFilter && (
                <button type="button" onClick={function () { setTypeFilter('') }}
                  className="text-[11.5px] font-bold text-rose-600 hover:text-rose-700 transition-colors">
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={function () { setTypeFilter('') }} aria-pressed={typeFilter === ''}
                className={'h-8 px-3 rounded-lg border text-[12px] font-bold transition-colors ' +
                  (typeFilter === '' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}>
                Any
              </button>
              {typesPresent.map(function (t) {
                var on = typeFilter === t.label
                return (
                  <button key={t.label} type="button" aria-pressed={on}
                    onClick={function () { setTypeFilter(on ? '' : t.label) }}
                    className={'h-8 pl-3 pr-2 inline-flex items-center gap-2 rounded-lg border text-[12px] font-bold transition-colors ' +
                      (on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}>
                    {t.label}
                    <span data-notranslate className={'px-1.5 rounded-md text-[11px] tabular-nums ' +
                      (on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>{t.count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className={CARD + ' overflow-hidden'}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold text-slate-900">
              Showing <span data-notranslate className="tabular-nums">{visible.length}</span> transaction{visible.length === 1 ? '' : 's'}
            </p>
            <p className="text-[12px] font-semibold text-slate-400" data-notranslate>
              from {formatDate(dateFrom)} to {formatDate(dateTo)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* What the range came to, which is the reason anyone opens a
                ledger over a date range in the first place. Three loose grey
                chips read as three unrelated numbers; in and out are the two
                halves of one sum and net is what they come to, so they are one
                object divided by rules, each half tinted the way its column of
                amounts already is. */}
            <div className="inline-flex items-stretch rounded-xl border border-slate-200 overflow-hidden">
              {[{ l: 'In', v: totals.in, bg: 'bg-emerald-50/70', lc: 'text-emerald-600', c: 'text-emerald-700' },
                { l: 'Out', v: totals.out, bg: 'bg-rose-50/70', lc: 'text-rose-600', c: 'text-rose-700' },
                { l: 'Net', v: totals.net, bg: 'bg-slate-50', lc: 'text-slate-500', c: totals.net < 0 ? 'text-rose-700' : 'text-slate-900' }].map(function (t, ti) {
                return (
                  <span key={t.l} className="flex items-stretch">
                    {ti > 0 && <span aria-hidden="true" className="w-px bg-slate-200" />}
                    <span className={'inline-flex items-baseline gap-1.5 px-3 py-1.5 ' + t.bg}>
                      <span className={'text-[11px] font-bold uppercase tracking-[0.08em] ' + t.lc}>{t.l}</span>
                      <span data-notranslate className={'text-[13px] font-bold tabular-nums ' + t.c}>{formatPoints(t.v)}</span>
                    </span>
                  </span>
                )
              })}
            </div>
            <div className="relative">
              <select value={sortKey} onChange={function (ev) { setSortKey(ev.target.value) }}
                aria-label="Sort transactions"
                className="h-9 pl-8 pr-7 rounded-xl border border-slate-300 bg-white text-[12.5px] font-bold text-slate-700 appearance-none focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 hover:bg-slate-50 transition-colors">
                {SORTS.map(function (o) { return <option key={o.k} value={o.k}>{o.label}</option> })}
              </select>
              {/* A funnel is the control beside this one. This is a sort. */}
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon name="sort" size={13} /></span>
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon name="chevronDown" size={13} /></span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-4 space-y-2.5">
            {[0, 1, 2, 3, 4].map(function (i) { return <div key={i} className="ambria-skeleton h-[56px] rounded-xl" /> })}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Icon name="banknote" size={26} className="mx-auto text-slate-300" />
            <p className="mt-2 text-[13px] font-bold text-slate-600">No transactions in this range</p>
            <p className="mt-0.5 text-[12px] font-medium text-slate-400">Widen the dates, or clear the quick filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto ambria-thin-scroll">
            {/* Pinning every column but one made that one the drain: on a
                1600px panel the particulars held seven hundred pixels of
                nothing after a six-word line, while the chips beside it sat
                jammed against their own edges. Proportions instead, so the
                slack is shared out and every column's spare space reads as
                padding rather than as a hole in one of them. */}
            <table className="w-full min-w-[960px] table-fixed">
              <colgroup>
                <col className="w-[3%]" />
                <col className="w-[36%]" />
                <col className="w-[20%]" />
                <col className="w-[9%]" />
                <col className="w-[16%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-50 border-y border-slate-200">
                <tr>
                  <th className="px-3 py-2.5"><span className="sr-only">Direction</span></th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 whitespace-nowrap">Particulars</th>
                  {['Type', 'Mode', 'Added by'].map(function (h, hi) {
                    return (
                      <th key={h}
                        className={'px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 whitespace-nowrap ' +
                          (hi === 0 ? 'border-l border-slate-200' : '')}>{h}</th>
                    )
                  })}
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 whitespace-nowrap">Amount (pts)</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(function (r) {
                  var isIn = r.direction === 'in'
                  var src = SOURCE_META[r.source] || { label: r.source, dot: 'bg-slate-400', cls: 'bg-slate-50 text-slate-700 border-slate-200' }
                  var who = r.recorded_by || r.collector_name || ''
                  return (
                    <tr key={r.key} onClick={function () { openRow(r) }}
                      className="border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-indigo-50/40 transition-colors">

                      {/* Which way the money went, before you have read a word
                          of the row. The sign on the amount says the same thing
                          at the far end of a wide line, which is a long way to
                          carry one character. */}
                      <td className="px-3 py-2.5 align-top">
                        <span className={'w-7 h-7 rounded-full inline-flex items-center justify-center ' +
                          (isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600')}
                          title={isIn ? 'Money in' : 'Money out'}>
                          <Icon name="arrowRight" size={14} className={isIn ? 'rotate-90' : '-rotate-90'} />
                        </span>
                      </td>

                      <td className="px-3 py-2.5 align-top">
                        {/* Particulars takes every pixel the fixed columns
                            leave, which on a wide panel is a line that runs
                            out of words long before it runs out of column.
                            Capped, the slack becomes the gutter before the
                            chips rather than a hole inside the sentence. */}
                        <div className="min-w-0">
                          <p className="font-display text-[13px] font-bold text-slate-900 leading-snug break-words">{r.party_name}</p>
                          {r.description && (
                            <p className="mt-0.5 text-[12px] text-slate-500 leading-snug break-words">{r.description}</p>
                          )}
                          {/* A ledger without a date on the row is a list of
                              amounts. With the column gone it says it here,
                              quietly, under the thing it dates. */}
                          <p className="mt-0.5 text-[11px] text-slate-400" data-notranslate>
                            {formatDate(r.date)}{timeOf(r.logged_at) ? ' · ' + timeOf(r.logged_at) : ''}
                          </p>
                        </div>
                      </td>

                      <td className="px-3 py-2.5 align-top border-l border-slate-100">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* The type chip says what happened; this one says
                              what the name in the row before it refers to.
                              "Carpet Sharma" and "WEDDING" were reading as the
                              same kind of thing. */}
                          <span className={'inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md border text-[11px] font-bold ' + src.cls}>
                            <span aria-hidden="true" className={'w-1.5 h-1.5 rounded-full ' + src.dot} />
                            {src.label}
                          </span>
                          <span className={'inline-flex items-center h-[22px] px-2 rounded-md border text-[11px] font-bold ' + r.type_cls}>
                            {r.type_label}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-2.5 align-top">
                        <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md border border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600">
                          <Icon name={r.mode === 'cash' ? 'banknote' : 'bank'} size={11} className="text-slate-400" />
                          {r.mode === 'cash' ? 'Cash' : 'Bank'}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 align-top">
                        {/* Every name at one weight. Dimming the ones that
                            repeat the party — a wallet-funded expense is spent
                            and recorded by the same person — made two thirds of
                            the column look disabled, and a column you read
                            straight down cannot be half faded. */}
                        {who
                          ? <span className="block min-w-0 text-[12px] font-bold text-slate-700 truncate">{who}</span>
                          : <span className="text-[12px] text-slate-300">—</span>}
                      </td>

                      <td className="px-3 py-2.5 align-top text-right whitespace-nowrap">
                        <span data-notranslate className={'text-[14px] font-bold tabular-nums ' + (isIn ? 'text-emerald-700' : 'text-rose-700')}>
                          {isIn ? '+ ' : '− '}{pts(r.amount_paise || 0)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-200 bg-slate-50/60">
            <p className="text-[12px] font-semibold text-slate-500" data-notranslate>
              Showing {firstShown}–{lastShown} of {visible.length} transaction{visible.length === 1 ? '' : 's'}
            </p>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" disabled={pageNow === 1} onClick={function () { setPage(pageNow - 1) }}
                  aria-label="Previous page"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <Icon name="chevronRight" size={14} className="rotate-180" />
                </button>
                {pageButtons.map(function (b, i) {
                  if (b === '…') return <span key={'g' + i} className="px-1 text-[12px] font-bold text-slate-300">…</span>
                  return (
                    <button key={b} type="button" onClick={function () { setPage(b) }}
                      className={'min-w-8 h-8 px-2 rounded-lg text-[12px] font-bold tabular-nums transition-colors ' +
                        (b === pageNow ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100')}
                      data-notranslate>{b}</button>
                  )
                })}
                <button type="button" disabled={pageNow === pageCount} onClick={function () { setPage(pageNow + 1) }}
                  aria-label="Next page"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <Icon name="chevronRight" size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {detailTarget && (function () {
        var r = detailTarget.row
        var meta = r._metadata || {}
        return createPortal((
          <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={closeDetail}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
              onClick={function (ev) { ev.stopPropagation() }}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-bold text-gray-900">{r.type_label}</h3>
                <button onClick={closeDetail} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <p className={"text-2xl font-bold " + (r.direction === 'in' ? "text-green-700" : "text-gray-900")}>
                {r.direction === 'in' ? '+' : '-'}{formatPoints(r.amount_paise || 0)}
              </p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Party</span><span className="font-medium text-gray-800">{r.party_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-medium text-gray-800">{formatDate(r.date)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Mode</span><span className="font-medium text-gray-800">{r.mode === 'cash' ? 'Cash' : 'Bank'}</span></div>
                {r.description && (
                  <div className="flex justify-between gap-3"><span className="text-gray-500 flex-shrink-0">Description</span><span className="font-medium text-gray-800 text-right">{r.description}</span></div>
                )}
                {meta.reason && (
                  <div className="flex justify-between gap-3"><span className="text-gray-500 flex-shrink-0">Reason</span><span className="font-medium text-gray-800 text-right">{meta.reason}</span></div>
                )}
                {meta.salary_month && (
                  <div className="flex justify-between"><span className="text-gray-500">Salary month</span><span className="font-medium text-gray-800">{meta.salary_month}</span></div>
                )}
                {r.source === 'collection' && r._receiptNo && (
                  <div className="flex justify-between"><span className="text-gray-500">Receipt #</span><span className="font-medium text-gray-800">{r._receiptNo}</span></div>
                )}
                {r.source === 'collection' && (
                  <div className="flex justify-between"><span className="text-gray-500">Collected by</span><span className="font-medium text-gray-800">{detailTarget.loading ? '…' : (detailTarget.collectorName || '—')}</span></div>
                )}
                {r.source === 'collection' && r._isEpc && r._epc && (
                  <div className="flex justify-between"><span className="text-gray-500">Extra plates</span><span className="font-medium text-gray-800">{r._epc.extras_charged}</span></div>
                )}
                {r.source === 'collection' && detailTarget.event && (
                  <>
                    <div className="flex justify-between"><span className="text-gray-500">Contract #</span><span className="font-medium text-gray-800">{detailTarget.event.contract_no || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-medium text-gray-800">{detailTarget.event.client_name || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Function date</span><span className="font-medium text-gray-800">{formatDate(detailTarget.event.function_date)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Venue</span><span className="font-medium text-gray-800">{detailTarget.event.venue_name || '—'}</span></div>
                  </>
                )}
              </div>
              {(meta.payment_images || meta.deduction_image) && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Proof</p>
                  <PaymentProofThumbs meta={meta} />
                </div>
              )}
              {r.source === 'collection' && r._imgUrl && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Receipt {r._imgIsVoice ? '(voice note)' : 'Image'}</p>
                  {r._imgIsVoice ? (
                    <audio src={r._imgUrl} controls className="w-full h-8" />
                  ) : (
                    <img src={r._imgUrl} alt="receipt"
                      onClick={function (ev) { ev.stopPropagation(); setEnlargedImg(r._imgUrl) }}
                      className="w-full max-h-64 object-contain rounded border border-gray-200 cursor-zoom-in bg-gray-50" />
                  )}
                </div>
              )}
              <p className="text-[10px] text-gray-400 pt-1">Logged {formatDateTime(r.logged_at)}</p>
            </div>
          </div>
        ), document.body)
      })()}

      {enlargedImg && createPortal((
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-4" onClick={function () { setEnlargedImg(null) }}>
          <img src={enlargedImg} alt="" className="max-w-full max-h-[80vh] rounded-lg" />
        </div>
      ), document.body)}

      {expenseDetailModal}
    </div>
  )
}

export default PaymentsLedger
