import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate, formatDateTime } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import { scrollToTopOf } from '../../lib/scrollToTop'
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
// The ledger chip palette, given as exact values rather than picked off a
// scale: a very light ground, a mid-tone hairline, and a dark word the icon
// takes its colour from. Six were specified; Vendor, Employee and the
// unknown-kind fallback needed one each, built the same way.
var TONE = {
  amber:  'bg-[#FFF7E6] border-[#FFD166] text-[#D97706]',
  violet: 'bg-[#F3EEFF] border-[#B9A3FF] text-[#6D3DF5]',
  green:  'bg-[#E6F7F1] border-[#34D399] text-[#065F46]',
  mint:   'bg-[#F0FDF4] border-[#86EFAC] text-[#16A34A]',
  red:    'bg-[#FDEEEE] border-[#FCA5A5] text-[#DC2626]',
  blue:   'bg-[#EEF4FF] border-[#93C5FD] text-[#2563EB]',
  teal:   'bg-[#EAF8FA] border-[#7DD3DC] text-[#0E7490]',
  plum:   'bg-[#FDF0FA] border-[#EFA8E0] text-[#A21CAF]',
  slate:  'bg-[#F5F7FA] border-[#CBD5E1] text-[#475569]',
}

// One shape for every chip: a pill, its own ground, and an icon that belongs
// to the word rather than sitting grey beside it.
var CHIP = 'inline-flex items-center gap-1.5 h-[24px] px-2.5 rounded-full border text-[11px] font-bold '
var CHIP_NEUTRAL = TONE.slate

// Where the money sat, said the same way in the filter that asks for it and
// the chip that answers.
var MODE_META = {
  cash: { label: 'Cash', icon: 'banknote', tone: TONE.mint },
  bank: { label: 'Bank', icon: 'bank', tone: TONE.blue },
}

var TYPE_META = {
  vendor_payment:     { label: 'Vendor Payment',         direction: 'out', icon: 'creditCard', tone: TONE.red },
  vendor_deduction:   { label: 'Vendor Deduction',       direction: 'out', icon: 'minus',      tone: TONE.amber },
  salary_payment:     { label: 'Salary Payment',         direction: 'out', icon: 'wallet',     tone: TONE.red },
  salary_adjustment:  { label: 'Salary Adjustment',      direction: 'out', icon: 'minus',      tone: TONE.amber },
  collection:         { label: 'Event Collection',       direction: 'in',  icon: 'rupee',      tone: TONE.green },
  epc:                { label: 'Extra Plate Collection', direction: 'in',  icon: 'utensils',   tone: TONE.green },
  expense:            { label: 'Expense (Cash)',         direction: 'out', icon: 'receipt',    tone: TONE.red },
  expense_refund:     { label: 'Expense Refund',         direction: 'in',  icon: 'undo',       tone: TONE.green },
}

// What the name on a row refers to. The chips said the transaction type but
// never what the name beside them was, so "Carpet Sharma" and "WEDDING" —
// a vendor and an event — read as the same kind of thing.
var SOURCE_META = {
  vendor:     { label: 'Vendor',   icon: 'building', tone: TONE.teal },
  salary:     { label: 'Employee', icon: 'idCard',   tone: TONE.plum },
  collection: { label: 'Event',    icon: 'calendar', tone: TONE.violet },
  expense:    { label: 'Staff',    icon: 'user',     tone: TONE.amber },
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
  var [showMore, setShowMore] = useState(false)
  var [page, setPage] = useState(1)
  var listRef = useRef(null)
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
        // Was a .filter() on the result: every row came over the wire and the
        // ones without a cash or bank mode were dropped here. `->>` on a null
        // metadata is null, and `in` excludes nulls, so the set is unchanged.
        .in('metadata->>mode', ['cash', 'bank'])
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

    var ledgerRows = ledgerRes.data || []
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

    // Expense wallet rows only carry a wallet_id — the owning user, and that
    // user's name, come back with the wallet rather than in a wave of their own.
    var walletIdsForOwners = []
    expWalletRows.forEach(function (r) { if (walletIdsForOwners.indexOf(r.wallet_id) === -1) walletIdsForOwners.push(r.wallet_id) })
    var collectIds = collectRows.map(function (w) { return w.id })

    // Every collection's own reference_id, before we know which of them are
    // plate collections. For a plate collection it is the collection's id and
    // not an event's, so a few of these fetch an event nobody reads — the
    // lookup below still takes the event from the plate collection. That is
    // the price of not waiting a whole round trip to find out which is which.
    collectRows.forEach(function (w) {
      if (w.performed_by && profileIds.indexOf(w.performed_by) === -1) profileIds.push(w.performed_by)
    })
    var candidateEventIds = []
    collectRows.forEach(function (w) {
      var n = w.reference_id ? Number(w.reference_id) : null
      if (n && !isNaN(n) && candidateEventIds.indexOf(n) === -1) candidateEventIds.push(n)
    })

    // One wave, not two. The wallet carries its owner's name and the plate
    // collection carries its event's, so neither needs a follow-up query.
    var [vRes, walletOwnersRes, epcRes, pRes, evRes] = await Promise.all([
      vendorIds.length > 0 ? supabase.from('vendors').select('id, name').in('id', vendorIds) : Promise.resolve({ data: [] }),
      walletIdsForOwners.length > 0 ? supabase.from('wallets').select('id, user_id, profiles(id, name)').in('id', walletIdsForOwners) : Promise.resolve({ data: [] }),
      // EPC back-links so collections can be split from plain event collections
      collectIds.length > 0 ? supabase.from('extra_plate_collections').select('id, event_id, wallet_tx_id, extras_charged, plates_returned, discount_paise, events(id, event_name)').in('wallet_tx_id', collectIds) : Promise.resolve({ data: [] }),
      profileIds.length > 0 ? supabase.from('profiles').select('id, name').in('id', profileIds) : Promise.resolve({ data: [] }),
      candidateEventIds.length > 0 ? supabase.from('events').select('id, event_name').in('id', candidateEventIds) : Promise.resolve({ data: [] }),
    ])

    var vendorNames = {}; (vRes.data || []).forEach(function (v) { vendorNames[v.id] = v.name })
    var profileNames = {}; (pRes.data || []).forEach(function (p) { profileNames[p.id] = p.name })
    var eventNames = {}; (evRes.data || []).forEach(function (e) { eventNames[e.id] = e.event_name })

    var walletOwnerMap = {}
    ;(walletOwnersRes.data || []).forEach(function (w) {
      walletOwnerMap[w.id] = w.user_id
      // The embedded profile is the same row the old follow-up query fetched.
      if (w.profiles && w.profiles.id && profileNames[w.profiles.id] == null) profileNames[w.profiles.id] = w.profiles.name
    })

    var epcByWalletTx = {}
    ;(epcRes.data || []).forEach(function (e) {
      if (e.wallet_tx_id) epcByWalletTx[e.wallet_tx_id] = e
      if (e.events && e.events.id && eventNames[e.events.id] == null) eventNames[e.events.id] = e.events.event_name
    })

    var combined = []
    ledgerRows.forEach(function (r) {
      var meta = TYPE_META[r.ref_type] || { label: r.ref_type, direction: 'out', tone: CHIP_NEUTRAL, icon: null }
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
        type_tone: meta.tone || CHIP_NEUTRAL,
        type_icon: meta.icon || null,
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
        type_tone: meta.tone || CHIP_NEUTRAL,
        type_icon: meta.icon || null,
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
        type_tone: meta.tone || CHIP_NEUTRAL,
        type_icon: meta.icon || null,
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
    // Newest first, always. A ledger is read from the last thing that
    // happened backwards, and the four orders behind the dropdown were three
    // nobody chose and the one it already had.
    out.sort(function (a, b) { return (b.logged_at || '').localeCompare(a.logged_at || '') })
    return out
  }, [rows, modeFilter, dirFilter, typeFilter, search])

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
  useEffect(function () { setPage(1) }, [modeFilter, dirFilter, typeFilter, search, dateFrom, dateTo])

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

  // Paging takes you to the top of the new page. Pressing Next at the foot of
  // twenty-five rows otherwise leaves you at the foot of the next twenty-five,
  // reading upwards from the end of something you never saw the start of.
  function goPage(n) {
    setPage(n)
    scrollToTopOf(listRef.current)
  }

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

  // Five pills in one row read as five of the same thing, one of which you
  // pick. They are three things: a reset, a pair asking where the money sat,
  // and a pair asking which way it moved — and the two pairs are independent,
  // so Cash and Income can be on together. Grouped behind rules, the row says
  // that without a sentence explaining it.
  var QUICK_GROUPS = [
    [{ k: 'all',  label: 'All',     on: quickActive,           run: function () { setModeFilter('all'); setDirFilter('all'); setTypeFilter('') }, tone: 'indigo' }],
    [{ k: 'cash', label: 'Cash',    on: modeFilter === 'cash', run: function () { setModeFilter(modeFilter === 'cash' ? 'all' : 'cash') }, tone: 'green' },
     { k: 'bank', label: 'Bank',    on: modeFilter === 'bank', run: function () { setModeFilter(modeFilter === 'bank' ? 'all' : 'bank') }, tone: 'blue' }],
    [{ k: 'in',   label: 'Income',  on: dirFilter === 'in',    run: function () { setDirFilter(dirFilter === 'in' ? 'all' : 'in') }, tone: 'emerald' },
     { k: 'out',  label: 'Expense', on: dirFilter === 'out',   run: function () { setDirFilter(dirFilter === 'out' ? 'all' : 'out') }, tone: 'rose' }],
  ]
  // Pressed colours the writing and the outline around it — a hairline and a
  // word, not a filled shape. A fill put a block of colour into a toolbar of
  // white controls, loud out of proportion to a filter being on; an outline is
  // the same statement at the weight the thing deserves. Resting, every pill
  // is grey: five colours sitting there unpressed would each be claiming
  // something is already in force.
  var QUICK_TONE = {
    indigo:  'border-indigo-400 text-indigo-600',
    green:   'border-[#86EFAC] text-[#16A34A]',
    blue:    'border-[#93C5FD] text-[#2563EB]',
    emerald: 'border-emerald-400 text-emerald-600',
    rose:    'border-rose-400 text-rose-600',
  }

  return (
    <div className="@container space-y-3">
      <div className={CARD + ' px-4 py-3 overflow-hidden'}>
        {/* One row on anything wide enough to hold it. It still wraps on a
            phone, where three controls side by side would each be too narrow
            to use. */}
        <div className="flex flex-wrap @3xl:flex-nowrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[12px] font-bold text-slate-500 whitespace-nowrap">Date Range</span>
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

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[12px] font-bold text-slate-500 whitespace-nowrap">Quick Filters</span>
            <div className="flex flex-wrap @3xl:flex-nowrap items-center gap-2.5">
              {QUICK_GROUPS.map(function (group, gi) {
                return (
                  <div key={gi} className="flex items-center gap-2.5">
                    {gi > 0 && <span aria-hidden="true" className="w-px h-5 bg-slate-200" />}
                    <div className="flex items-center gap-1.5">
                      {group.map(function (q) {
                        return (
                          <button key={q.k} type="button" onClick={q.run} aria-pressed={q.on}
                            className={'h-8 px-3 rounded-full border bg-white text-[12px] font-bold transition-colors hover:bg-slate-50 ' +
                              (q.on ? QUICK_TONE[q.tone] : 'border-slate-300 text-slate-600 hover:text-slate-900')}>
                            {q.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            {/* Search is the control people reach for most on this screen, so
                it does not live one press deep behind More Filters. */}
            <SearchField value={search} onChange={function (v) { setSearch(v) }}
              placeholder="Search transactions..." className="w-[180px] @3xl:w-[220px]" />
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
              title="Export everything the filters have left, in the order it is shown"
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

      <div ref={listRef} className={CARD + ' overflow-hidden scroll-mt-4'}>
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
                  var src = SOURCE_META[r.source] || { label: r.source, icon: 'wallet', tone: CHIP_NEUTRAL }
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
                          {/* Staff, Vendor, Event and Employee are four
                              different widths, so the chip after them started
                              at a different place on every row and the column
                              read as a ragged edge. The first chip is floored
                              at the width of the longest of the four. */}
                          <span className={CHIP + 'min-w-[104px] ' + src.tone}>
                            <Icon name={src.icon} size={12} className="shrink-0" />
                            {src.label}
                          </span>
                          <span className={CHIP + r.type_tone}>
                            {r.type_icon && <Icon name={r.type_icon} size={12} className="shrink-0" />}
                            {r.type_label}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-2.5 align-top">
                        {(function () {
                          var m = MODE_META[r.mode] || { label: r.mode || '\u2014', icon: 'wallet', tone: CHIP_NEUTRAL }
                          return (
                            <span className={CHIP + m.tone}>
                              <Icon name={m.icon} size={12} className="shrink-0" />
                              {m.label}
                            </span>
                          )
                        })()}
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
                <button type="button" disabled={pageNow === 1} onClick={function () { goPage(pageNow - 1) }}
                  aria-label="Previous page"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <Icon name="chevronRight" size={14} className="rotate-180" />
                </button>
                {pageButtons.map(function (b, i) {
                  if (b === '…') return <span key={'g' + i} className="px-1 text-[12px] font-bold text-slate-300">…</span>
                  return (
                    <button key={b} type="button" onClick={function () { goPage(b) }}
                      className={'min-w-8 h-8 px-2 rounded-lg text-[12px] font-bold tabular-nums transition-colors ' +
                        (b === pageNow ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100')}
                      data-notranslate>{b}</button>
                  )
                })}
                <button type="button" disabled={pageNow === pageCount} onClick={function () { goPage(pageNow + 1) }}
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
