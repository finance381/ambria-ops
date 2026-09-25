import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { pushBack, unwind } from '../../lib/backNav'
import { generateCollectionReceiptPdf } from '../../lib/pdfReceipt'
import { formatPoints, formatDate, formatDateTime, titleCase } from '../../lib/format'
import EventCalendar from '../../components/ui/EventCalendar'
import { venueColor } from '../../lib/venueColors'
import ImageLightbox from '../../components/ui/ImageLightbox'
import Icon from '../../components/ui/Icon'
import { hasPerm } from '../../lib/permissions'
import { scrollToTopOf } from '../../lib/scrollToTop'
import eventBg from '../../assets/event-bg.webp'
import { useExpenseDetailModal } from '../../hooks/useExpenseDetailModal.jsx'
import { deptOrder, deptCls, deptHex, CARD, FIELD_SEARCH } from '../../lib/ui'
import { avatarTint } from '../../lib/avatarTint'
import { DeptChip } from '../../components/ui/Badge'
import CheckedStamp from '../../components/ui/CheckedStamp'

var ENTRY_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'collection', label: 'Collections' },
  { key: 'lms_advance', label: 'LMS Advances' },
  { key: 'expense', label: 'Expenses' },
]

// The column reads the database's own word for the row — 'lms_advance' — which
// is a column name, not a label. The filter above it already says "LMS
// Advances"; this is the singular of the same thing.
var ENTRY_LABELS = {
  collection: 'Collection',
  lms_advance: 'LMS Advance',
  expense: 'Expense',
  refund: 'Refund',
}
function entryLabel(t) {
  return ENTRY_LABELS[t] || String(t || '').replace(/_/g, ' ')
}

// The five faces of one event. Plates and documents used to be a fifth and a
// sixth filter pill on the transactions table, which is where you would look
// for them last: neither is a transaction, and both answer a question — how
// many extra plates went out, where is the contract PDF — that has nothing to
// do with money moving.
var TABS = [
  // short is the phone's label: five tabs share one row there, about 70px
  // each, and "Transactions" alone needs more than that.
  { key: 'overview',     label: 'Overview',     short: 'Overview', icon: 'info' },
  { key: 'financials',   label: 'Financials',   short: 'Finance',  icon: 'wallet' },
  { key: 'transactions', label: 'Transactions', short: 'Txns',     icon: 'receipt' },
  { key: 'plates',       label: 'Plates',       short: 'Plates',   icon: 'utensils' },
  { key: 'documents',    label: 'Documents',    short: 'Docs',     icon: 'paperclip' },
]

var EVT_COLS = 'id, event_name, function_date, contract_date, venue_name, location, client_name, contact_person, session, catering, department, created_user_name, contract_no, is_tentative, pax, total_plates, complementary_plates, synced_at, pdf_link, ppt_link, agreed_cash_paise, agreed_bank_paise'

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

var SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
var SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function longDate(s) {
  if (!s) return ''
  var d = new Date(String(s).slice(0, 10) + 'T00:00:00')
  if (isNaN(d)) return String(s)
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
}

// Label left, answer right, hairline between — the same fact row the expense
// detail uses, so a reader who has learnt one screen has learnt this one.
// `inCard` marks a row the header card already states.
//
// Seven of these fourteen repeat the card directly above them — the name, the
// client, the venue, the session, the date, the guest count and who created it
// are all on it. On a desktop that is a reference table beside a summary and it
// reads as thorough. On a phone the card is the screen you just scrolled past,
// so it is the same facts twice, one under the other, and the six that are only
// here — the location, the contract date, the contact, the catering, the
// complimentary plates and the last sync — are buried among them.
//
// They stay from sm up, where the width makes the repetition cheap.
function InfoRow({ label, value, inCard }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className={'items-baseline justify-between gap-4 py-2.5 ' + (inCard ? 'hidden sm:flex' : 'flex')}>
      <span className="shrink-0 text-[12px] font-medium text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-semibold text-slate-900">{value}</span>
    </div>
  )
}

function SectionCard({ title, icon, right, children, className }) {
  return (
    <div className={CARD + ' overflow-hidden ' + (className || '')}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
        <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
          {icon && <Icon name={icon} size={13} className="text-slate-400" />}
          {title}
        </p>
        {right}
      </div>
      {children}
    </div>
  )
}

function MoneyTile({ label, value, sub, tone }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={'mt-1.5 font-display text-[21px] font-bold tabular-nums leading-none tracking-[-0.02em] ' + (tone || 'text-slate-900')}
        data-notranslate>{value}</p>
      {sub}
    </div>
  )
}

// Running order comes from lib/ui so this screen cannot drift from the events
// list or the expense picker; the colour rides along inside <DeptChip>.
var _deptOrder = deptOrder
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

// The ground behind the phone screen: a soft photograph of daylight falling
// across a pale wall.
//
// It arrives already out of focus, so it needs no blur of its own and has
// nothing sharp enough in it to compete with a card. The cards stay white and
// the picture is only the light around them.
//
// 100% 100% rather than cover: a fixed box is the viewport, the viewport
// changes height every time the address bar slides, and cover rescales the
// image each time — which reads as the background zooming while you scroll.
// A picture this soft does not show the stretch.
//
// The body takes the colour sampled from the picture's foot, so dragging past
// either end of the page shows more of the same light rather than a seam.
var LEDGER_GROUND = '#E8E1DE'

function EventBackdrop() {
  useEffect(function () {
    var b = document.body
    var h = document.documentElement
    var prevBody = b.style.backgroundColor
    var prevHtml = h.style.backgroundColor
    var prevOver = b.style.overscrollBehaviorY
    b.style.backgroundColor = LEDGER_GROUND
    h.style.backgroundColor = LEDGER_GROUND
    b.style.overscrollBehaviorY = 'none'
    return function () {
      b.style.backgroundColor = prevBody
      h.style.backgroundColor = prevHtml
      b.style.overscrollBehaviorY = prevOver
    }
  }, [])
  return (
    <div aria-hidden="true" className="sm:hidden pointer-events-none fixed inset-0 -z-10"
      style={{
        backgroundColor: LEDGER_GROUND,
        backgroundImage: 'url(' + eventBg + ')',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        minHeight: '100lvh',
      }} />
  )
}

function EventLedger(props) {
  var profile = props && props.profile
  // The hub passes this and the screen ignored it. The photographed ground
  // and its accent are for the phone screen only, so the admin console keeps the plain page it shares
  // with its seven neighbours.
  var inAdmin = !!(props && props.inAdmin)
  var isAdmin = hasPerm(profile?.permsNew, 'finance.ledgers.event')
  var isSysAdmin = hasPerm(profile?.permsNew, 'admin.dashboard')
  var canMarkChecked = hasPerm(profile?.permsNew, 'finance.wallet.mark_checked')
  // The five tabs measure 598px and a 390px phone gives 358, so on a phone
  // two of them were always off the end of a scrolling row, and Documents and
  // Plates were not missing so much as invisible. There each tab takes an
  // equal fifth instead, icon over a short label, and all five are on screen.
  // From sm up the row has the room and keeps its labels; the edge fades
  // below still cover the widths where it scrolls.
  var tabScrollRef = useRef(null)
  var [tabEdges, setTabEdges] = useState({ left: false, right: false })
  var [checkingExpId, setCheckingExpId] = useState(null)
  var [checkingTxnId, setCheckingTxnId] = useState(null)
  var [printingDocId, setPrintingDocId] = useState(null)
  var [collDetail, setCollDetail] = useState(null)
  var [currentEventIds, setCurrentEventIds] = useState([])
  var { openExpenseDetail, expenseDetailModal } = useExpenseDetailModal(profile, isAdmin, function () { loadEntries(currentEventIds) }, props && props.onNavigateToExpenses)
  var propEventId = props && props.eventId ? String(props.eventId) : null
  var [date, setDate] = useState('')
  var [functions, setFunctions] = useState([])
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
  var [tab, setTab] = useState('overview')
  // Agreed Cash shown ×10. Display only, and gone on reload.
  var [cashX10, setCashX10] = useState(false)
  // The transactions tab keeps its own view state: what is typed in it, how
  // it is narrowed, which way the dates run and which page it is on. All of
  // it is per-event, so selecting another event resets it rather than
  // carrying one event's search onto the next.
  var [txnSearch, setTxnSearch] = useState('')
  var [txnSort, setTxnSort] = useState('desc')
  var [txnDir, setTxnDir] = useState('')
  var [txnMode, setTxnMode] = useState('')
  var [txnCheck, setTxnCheck] = useState('')
  var [showTxnFilter, setShowTxnFilter] = useState(false)
  var [txnPage, setTxnPage] = useState(1)
  var txnListRef = useRef(null)
  var [lightbox, setLightbox] = useState(null)
  var _now = new Date()
  var [monthYear, setMonthYear] = useState(_now.getFullYear())
  var [monthMonth, setMonthMonth] = useState(_now.getMonth())
  var [monthRows, setMonthRows] = useState([])
  var [monthLoading, setMonthLoading] = useState(true)
  var [showPastDays, setShowPastDays] = useState(false)

  // One read per month, not one per month plus one per date. A month of
  // events is a few dozen rows, and holding them means the calendar's dots,
  // the list beside it and the answer to "what is on the 21st" all come from
  // the same set — no second round trip when a day is pressed, and no way
  // for the dots and the list to disagree.
  //
  // The late response loses: flicking through months faster than the network
  // answers would otherwise paint an older month over the one on screen.
  useEffect(function () {
    if (propEventId) return
    var alive = true
    setMonthLoading(true)
    var start = isoDate(new Date(monthYear, monthMonth, 1))
    var end = isoDate(new Date(monthYear, monthMonth + 1, 0))
    supabase.from('events')
      .select(EVT_COLS)
      .gte('function_date', start)
      .lte('function_date', end)
      .is('merged_into_id', null)
      .order('event_name')
      .then(function (res) {
        if (!alive) return
        setMonthRows(res.data || [])
        setMonthLoading(false)
      })
    return function () { alive = false }
  }, [monthYear, monthMonth, propEventId])

  function pickDate(dateStr) {
    setDate(dateStr)
    setEventId('')
    setEventDetail(null)
    setBalance(null)
    setBalancesByContract({})
    setEntries([])
    setPlateEvents([])
  }

  // Month, day, event: three steps deep, and each one going in is a step on
  // the app's back stack. So the header's back arrow — and a phone's swipe —
  // walk back out one level at a time instead of leaving the ledger from
  // wherever you were standing, and the screen needs no Back button of its
  // own on a phone.
  //
  // backDepth counts the steps this screen has put on the stack, so a control
  // that jumps several levels (Change date, Whole month) can unwind exactly
  // those and leave no stale step behind to eat a later back press.
  var backDepth = useRef(0)
  function pushLedgerBack(fn) {
    backDepth.current += 1
    pushBack(function () { backDepth.current -= 1; fn() })
  }
  function backTo(level) {
    var n = backDepth.current - level
    if (n > 0) unwind(n)
  }
  // Only the first step into a level is a step: picking another date while a
  // date is already open changes the day, it does not go deeper.
  function stepIntoDate(d) {
    if (!date && d) pushLedgerBack(function () { pickDate('') })
    pickDate(d)
  }
  function stepIntoGroup(g) {
    if (!eventId) pushLedgerBack(function () { selectGroup(null) })
    selectGroup(g)
  }

  function selectGroup(g) {
    if (!g) {
      setEventId(''); setEventDetail(null); setBalance(null); setBalancesByContract({}); setEntries([]); setPlateEvents([]); setCurrentEventIds([])
      return
    }
    setTab('overview')
    setFilter('all')
    resetTxnView()
    setEventId(String(g.event_ids[0]))  // legacy anchor: any contract in this group
    setEventDetail(g.contracts[0])
    setCurrentEventIds(g.event_ids)
    loadBalance(g.event_ids)
    loadEntries(g.event_ids)
    loadPlateEvents(g.event_ids)
    // The row you pressed was halfway down the day's list, and the page keeps
    // that scroll when the detail replaces it — so the event opened on its
    // middle. It starts at its own top, on the frame after it has rendered.
    window.requestAnimationFrame(function () { window.scrollTo(0, 0) })
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
    var { data, error } = await supabase.rpc('fn_event_group_balance', { p_event_ids: ids.map(function (id) { return Number(id) }) })
    var agg = { pending_cash_paise: 0, pending_bank_paise: 0, agreed_cash_paise: 0, agreed_bank_paise: 0, collected_cash_paise: 0, collected_bank_paise: 0, spent_paise: 0 }
    var byId = {}
    var any = false
    if (!error && data) {
      data.forEach(function (row) {
        any = true
        byId[row.event_id] = row
        Object.keys(agg).forEach(function (k) { agg[k] += Number(row[k] || 0) })
      })
    }
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
    // Expense-linked entries carry their own user-entered date (expenses.expense_date),
    // distinct from created_at (when the ledger row was actually logged).
    var expIds = []
    rows.forEach(function (r) {
      if (r.entry_type === 'expense' && r.reference_id && /^[0-9]+$/.test(String(r.reference_id))) {
        var eid = Number(r.reference_id)
        if (expIds.indexOf(eid) === -1) expIds.push(eid)
      }
    })
    var expenseDateById = {}
    var expenseCheckById = {}
    if (expIds.length > 0) {
      var { data: expRows } = await supabase.from('expenses').select('id, expense_date, checked_by, checked_at').in('id', expIds)
      ;(expRows || []).forEach(function (e) {
        expenseDateById[e.id] = e.expense_date
        expenseCheckById[e.id] = { checked_by: e.checked_by, checked_at: e.checked_at }
      })
    }
    // Collection entries carry a wallet_transactions.id in reference_id — that
    // row is what actually holds the receipt image, mode and checked flag.
    var collTxnIds = []
    rows.forEach(function (r) {
      if (r.entry_type === 'collection' && r.reference_id && collTxnIds.indexOf(r.reference_id) === -1) collTxnIds.push(r.reference_id)
    })
    var wtById = {}
    if (collTxnIds.length > 0) {
      var { data: wtRows } = await supabase.from('wallet_transactions')
        .select('id, amount_paise, payment_mode, receipt_no, status, performed_by, received_image_path, checked_by, checked_at')
        .in('id', collTxnIds)
      ;(wtRows || []).forEach(function (w) {
        wtById[w.id] = w
        if (w.performed_by && creatorIds.indexOf(w.performed_by) === -1) creatorIds.push(w.performed_by)
      })
    }
    var nameById = {}
    if (creatorIds.length > 0) {
      var { data: profRows } = await supabase.from('profiles').select('id, name').in('id', creatorIds)
      ;(profRows || []).forEach(function (p) { nameById[p.id] = p.name || null })
    }
    rows = rows.map(function (r) {
      r._creatorName = nameById[r.created_by] || null
      r._entryDate = r.entry_type === 'expense' ? (expenseDateById[Number(r.reference_id)] || null) : null
      var chk = r.entry_type === 'expense' ? expenseCheckById[Number(r.reference_id)] : null
      r._checkedBy = chk ? chk.checked_by : null
      r._checkedAt = chk ? chk.checked_at : null
      var wt = r.entry_type === 'collection' ? wtById[r.reference_id] : null
      if (wt) {
        r._wt = wt
        r._collectorName = nameById[wt.performed_by] || null
      }
      return r
    })
    setEntries(rows)
    setEntriesLoading(false)
  }

  async function toggleExpenseCheck(expenseId) {
    if (checkingExpId) return
    setCheckingExpId(expenseId)
    var { data, error } = await supabase.rpc('fn_toggle_expense_check', { p_expense_id: expenseId })
    setCheckingExpId(null)
    if (error) { alert('Could not update: ' + error.message); return }
    var nowChecked = !!data
    setEntries(function (prev) { return prev.map(function (r) {
      if (r.entry_type !== 'expense' || Number(r.reference_id) !== expenseId) return r
      return Object.assign({}, r, {
        _checkedBy: nowChecked ? profile.id : null,
        _checkedAt: nowChecked ? new Date().toISOString() : null,
      })
    }) })
  }

  async function toggleCollectionCheck(txnId) {
    if (checkingTxnId) return
    setCheckingTxnId(txnId)
    var { data, error } = await supabase.rpc('fn_toggle_wallet_check', { p_transaction_id: txnId })
    setCheckingTxnId(null)
    if (error) { alert('Could not update: ' + error.message); return }
    var nowChecked = !!data
    setEntries(function (prev) { return prev.map(function (r) {
      if (r.entry_type !== 'collection' || r.reference_id !== txnId) return r
      var wt = Object.assign({}, r._wt, { checked_by: nowChecked ? profile.id : null, checked_at: nowChecked ? new Date().toISOString() : null })
      return Object.assign({}, r, { _wt: wt })
    }) })
    setCollDetail(function (prev) {
      if (!prev || prev.row.reference_id !== txnId) return prev
      var wt = Object.assign({}, prev.row._wt, { checked_by: nowChecked ? profile.id : null, checked_at: nowChecked ? new Date().toISOString() : null })
      return Object.assign({}, prev, { row: Object.assign({}, prev.row, { _wt: wt }) })
    })
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
        .select('id, event_id, extras_charged, plates_returned, rate_paise, total_paise, discount_paise, payment_mode, payment_sub_mode, receipt_path, notes, status, cancelled_reason, cancelled_at, created_at, collected_by')
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

  function badgeClass(entryType, direction) {
    if (direction === 'in') return 'bg-emerald-100 text-emerald-800'
    if (direction === 'out') return 'bg-rose-100 text-rose-800'
    return 'bg-slate-100 text-slate-700'
  }

  var pendCashP = balance ? Number(balance.pending_cash_paise || 0) : 0
  var pendBankP = balance ? Number(balance.pending_bank_paise || 0) : 0
  var agrCashP = balance ? Number(balance.agreed_cash_paise || 0) : 0
  var agrBankP = balance ? Number(balance.agreed_bank_paise || 0) : 0
  var colCashP = balance ? Number(balance.collected_cash_paise || 0) : 0
  var colBankP = balance ? Number(balance.collected_bank_paise || 0) : 0
  var spentP = balance ? Number(balance.spent_paise || 0) : 0

  // Outside the embedded mode the day's rows are a slice of the month that
  // is already in hand.
  var dateRows = propEventId
    ? functions
    : (date ? monthRows.filter(function (r) { return String(r.function_date || '').slice(0, 10) === date }) : [])
  var _groups = _buildGroups(dateRows)
  var selectedGroup = eventId
    ? _groups.find(function (g) { return g.event_ids.map(String).indexOf(String(eventId)) !== -1 })
    : null
  var contractByEventId = {}
  if (selectedGroup) selectedGroup.contracts.forEach(function (c) { contractByEventId[c.id] = c })
  var contracts = selectedGroup ? selectedGroup.contracts : (eventDetail ? [eventDetail] : [])
  var multiContract = contracts.length > 1

  // The receipts this event has issued: one for every collection taken
  // against it and one for every extra-plates collection, each printable as
  // the same Receive Receipt the wallet prints, and each with the photo taken
  // at the time where there is one.
  //
  // The LMS contract PDF used to lead this list. It is a file the booking
  // arrived with, not something this screen issued, and it stays one tap away
  // on the event card. Cancelled rows issue nothing, so they are left out.
  var documents = []
  function receiptPhoto(path) {
    return path ? (supabase.storage.from('receipts').getPublicUrl(path).data?.publicUrl || null) : null
  }
  entries.forEach(function (e) {
    var wt = e._wt
    if (e.entry_type !== 'collection' || !wt || wt.status === 'cancelled') return
    documents.push({
      id: 'coll-' + e.id, kind: 'receipt', icon: 'receipt',
      label: 'Collection receipt',
      sub: formatPoints(wt.amount_paise) + ' · ' + formatDate(e.created_at) + (wt.receipt_no ? ' · #' + wt.receipt_no : ''),
      photo: receiptPhoto(wt.received_image_path),
      eventId: e.event_id, collectorId: wt.performed_by,
      pdf: { receiptNo: wt.receipt_no, paymentMode: wt.payment_mode, amountRupees: wt.amount_paise, description: e.description, createdAt: e.created_at },
    })
  })
  plateEvents.forEach(function (p) {
    if (p._kind !== 'collection' || p.status === 'cancelled' || !(p.total_paise > 0)) return
    var disc = p.discount_paise || 0
    var net = p.total_paise - disc
    documents.push({
      id: 'plates-' + p.id, kind: 'receipt', icon: 'utensils',
      label: 'Extra plates receipt',
      sub: formatPoints(net) + ' · ' + formatDate(p.created_at) + ' · ' + p.extras_charged + ' plates',
      photo: receiptPhoto(p.receipt_path),
      eventId: p.event_id, collectorId: p.collected_by,
      // Extra-plate collections have no receipt series of their own, so the
      // number is the row's, prefixed so it cannot be mistaken for one.
      pdf: {
        receiptNo: 'EP-' + p.id, paymentMode: p.payment_mode, amountRupees: net, discountPaise: disc,
        description: p.extras_charged + ' extra plates × ' + formatPoints(p.rate_paise) + (p.notes ? ' — ' + p.notes : ''),
        createdAt: p.created_at,
      },
    })
  })
  contracts.forEach(function (c) {
    if (c.ppt_link) documents.push({ id: 'ppt-' + c.id, kind: 'link', label: 'Presentation', sub: c.department || '', href: c.ppt_link })
  })

  // The contract, the collector's name and their signature are not on the
  // rows in hand, so they are gathered at the moment of printing — the same
  // three things the wallet's own Print Receipt looks up.
  async function printReceipt(d) {
    if (printingDocId) return
    setPrintingDocId(d.id)
    try {
      var c = contractByEventId[d.eventId] || eventDetail || {}
      var receivedByName = ''
      var signatureUrl = null
      if (d.collectorId) {
        var { data: pr } = await supabase.from('profiles').select('name, signature_path').eq('id', d.collectorId).maybeSingle()
        if (pr) {
          receivedByName = pr.name || ''
          if (pr.signature_path) {
            var { data: signed } = await supabase.storage.from('images').createSignedUrl(pr.signature_path, 300)
            signatureUrl = signed?.signedUrl || null
          }
        }
      }
      await generateCollectionReceiptPdf(Object.assign({}, d.pdf, {
        contractNo: c.contract_no || null,
        clientName: c.client_name || '',
        eventDate: c.function_date || '',
        dealBy: c.created_user_name || '',
        receivedByName: receivedByName,
        signatureUrl: signatureUrl,
      }))
    } catch (e) { alert('Receipt generation failed: ' + e.message) }
    setPrintingDocId(null)
  }

  // Dots for the grid, days for the list. Both are the same rows read the
  // same way, so a day cannot carry a dot the list has no entry for.
  var monthByDate = {}
  monthRows.forEach(function (r) {
    var d = String(r.function_date || '').slice(0, 10)
    if (!d) return
    if (!monthByDate[d]) monthByDate[d] = { count: 0, venues: [], rows: [] }
    monthByDate[d].count += 1
    monthByDate[d].rows.push(r)
    var v = r.venue_name || 'Other'
    if (monthByDate[d].venues.indexOf(v) === -1) monthByDate[d].venues.push(v)
  })
  var monthDays = Object.keys(monthByDate).sort()
  // The list opens on what is still to come. Reading it is planning — what
  // is on tonight, what is on this week — and a month that starts on the 1st
  // spends its top half on days that have already happened. The earlier days
  // are one press away rather than gone, and a month entirely in the past
  // shows all of itself, because "from today" would leave it empty.
  var todayIso = isoDate(new Date())
  var pastDays = monthDays.filter(function (d) { return d < todayIso })
  var aheadDays = monthDays.filter(function (d) { return d >= todayIso })
  var listedDays = (showPastDays || aheadDays.length === 0) ? monthDays : aheadDays
  var monthVenues = []
  monthRows.forEach(function (r) {
    if (r.venue_name && monthVenues.indexOf(r.venue_name) === -1) monthVenues.push(r.venue_name)
  })

  var tabCounts = { transactions: entries.length, plates: plateEvents.length, documents: documents.length }

  function resetTxnView() {
    setTxnSearch(''); setTxnDir(''); setTxnMode(''); setTxnCheck('')
    setTxnSort('desc'); setShowTxnFilter(false)
    setTxnPage(1)
  }

  // Who put the row there. A collection was taken by whoever holds the wallet,
  // which is not always whoever logged the ledger line, so the collector wins
  // when there is one.
  function rowPerson(e) { return e._collectorName || e._creatorName || '' }
  function rowDate(e) { return e._entryDate || e.created_at }
  // null, not false, for the rows finance never checks — an LMS advance has no
  // check to be missing, so it should not answer an "unchecked" filter.
  function rowChecked(e) {
    if (e.entry_type === 'expense') return !!e._checkedBy
    if (e.entry_type === 'collection' && e._wt) return !!e._wt.checked_by
    return null
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '—'
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase()
  }

  var txnModes = []
  entries.forEach(function (e) {
    if (e.payment_mode && txnModes.indexOf(e.payment_mode) === -1) txnModes.push(e.payment_mode)
  })
  // The entry type counts too, now that it lives in the panel with the rest.
  // A filter you cannot see unless you open a panel has to be announced on the
  // thing that opens it, or the list is narrowed and nothing on the screen says
  // by what.
  var txnFilterCount = (filter !== 'all' ? 1 : 0) + (txnDir ? 1 : 0) + (txnMode ? 1 : 0) + (txnCheck ? 1 : 0)

  // The filter panel's four sections, written once.
  //
  // They had drifted into four shapes: one full-width 2x2, two content-width
  // rows and one that wrapped. Down a narrow panel that reads as four unrelated
  // controls rather than one set of choices, because nothing lines up with
  // anything — every row starts at the left and ends wherever its longest label
  // happens to.
  //
  // Columns on a phone, so every option is the same width and the panel has one
  // edge down each side. A row from sm, where there is width to let them sit at
  // their own size.
  //
  // Three across when there are three, two otherwise — so a set of three is one
  // line rather than two and a gap. Measured: a 390px phone leaves 334 inside
  // the panel, three cells come to 107 each, and the widest label in either
  // three-option set is "Unchecked" at 92.
  function txnFilterRow(n) {
    return 'grid gap-1.5 sm:flex sm:flex-wrap ' + (n === 3 ? 'grid-cols-3' : 'grid-cols-2')
  }
  var TXN_FILTER_LABEL = 'text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 mb-1.5'
  function txnPillCls(on, dead) {
    return 'inline-flex items-center justify-center gap-1.5 h-9 px-2.5 rounded-lg text-[12px] font-bold border transition-colors ' +
      (on
        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
        : dead
          ? 'border-slate-200 bg-white text-slate-400 cursor-default'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
  }

  function visibleEntries() {
    var q = txnSearch.trim().toLowerCase()
    var out = entries.filter(function (e) {
      if (filter !== 'all' && e.entry_type !== filter) return false
      if (txnDir && e.direction !== txnDir) return false
      if (txnMode && (e.payment_mode || '') !== txnMode) return false
      if (txnCheck) {
        var c = rowChecked(e)
        if (txnCheck === 'checked' && c !== true) return false
        if (txnCheck === 'unchecked' && c !== false) return false
      }
      if (q) {
        var hay = [e.description, e.payment_mode, entryLabel(e.entry_type), rowPerson(e),
          formatPoints(e.amount_paise), formatDate(rowDate(e))].join(' ').toLowerCase()
        if (hay.indexOf(q) === -1) return false
      }
      return true
    })
    out.sort(function (a, b) {
      var d = new Date(rowDate(a)) - new Date(rowDate(b))
      return txnSort === 'asc' ? d : -d
    })
    return out
  }

  // Paging takes you to the top of the new page. Pressing Next at the foot of
  // twenty-five rows otherwise leaves you at the foot of the next twenty-five.
  function goTxnPage(n) {
    setTxnPage(n)
    scrollToTopOf(txnListRef.current)
  }

  var TXN_PAGE_SIZE = 25


  function exportCsv(rows) {
    function esc(v) {
      var t = String(v == null ? '' : v)
      if (t.indexOf(',') !== -1 || t.indexOf('"') !== -1 || t.indexOf('\n') !== -1) return '"' + t.replace(/"/g, '""') + '"'
      return t
    }
    var head = ['Date', 'Logged', 'Type', 'Mode', 'In', 'Out', 'Description', 'Added By', 'Checked']
    // Points, not a formatted string: a spreadsheet cannot add up "90,000 pts".
    var body = rows.map(function (e) {
      var c = rowChecked(e)
      return [
        formatDate(rowDate(e)),
        formatDateTime(e.created_at),
        entryLabel(e.entry_type),
        e.payment_mode || '',
        e.direction === 'in' ? (e.amount_paise || 0) / 100 : '',
        e.direction === 'out' ? (e.amount_paise || 0) / 100 : '',
        e.description || '',
        rowPerson(e),
        c === null ? '' : (c ? 'Yes' : 'No'),
      ].map(esc).join(',')
    })
    var csv = head.join(',') + '\n' + body.join('\n') + '\n'
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    var stem = (eventDetail && eventDetail.event_name ? eventDetail.event_name : 'event').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
    a.href = url
    a.download = stem + '-transactions-' + (eventDetail && eventDetail.function_date ? String(eventDetail.function_date).slice(0, 10) : 'all') + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function openRow(e) {
    if (e.entry_type === 'expense' && e.reference_id) openExpenseDetail(Number(e.reference_id))
    else if (e.entry_type === 'collection' && e._wt) setCollDetail({ row: e })
  }

  function renderEntriesTable(rows) {
    if (entriesLoading) return <p className="text-[13px] text-slate-400 p-5 text-center">Loading entries…</p>
    if (entries.length === 0) return <p className="text-[13px] text-slate-400 p-8 text-center">No entries</p>
    if (rows.length === 0) {
      return (
        <div className="px-4 py-12 text-center">
          <Icon name="search" size={24} className="mx-auto text-slate-300" />
          <p className="mt-2 text-[13px] font-semibold text-slate-500">Nothing matches</p>
          <p className="mt-0.5 text-[12px] text-slate-400">Clear the search or the filters to see the rest.</p>
        </div>
      )
    }
    return (
      <>
      {/* A card each on a phone, the table from sm up.
          The table is 960px wide and a phone gives 358, so it scrolled — and
          what you could see of a transaction was its date and its type. Reading
          one meant dragging sideways and back, and comparing two meant doing
          that twice. The same seven columns become four lines: what and when,
          how much, what it was for, and who logged it. */}
      <div className="sm:hidden divide-y divide-slate-100">
        {rows.map(function (e) {
          var isExpRow = e.entry_type === 'expense' && !!e.reference_id
          var isCollRow = e.entry_type === 'collection' && !!e._wt
          var isClickable = isExpRow || isCollRow
          var person = rowPerson(e)
          var on = isExpRow ? e._checkedBy : (isCollRow ? e._wt.checked_by : null)
          return (
            <div key={e.id} onClick={function () { openRow(e) }}
              className={'px-4 py-3 ' + (isClickable ? 'cursor-pointer active:bg-indigo-50/60' : '')}>
              <div className="flex items-start justify-between gap-3">
                <span className={'shrink-0 inline-flex items-center h-[22px] px-2 rounded-md text-[11px] font-bold ' + badgeClass(e.entry_type, e.direction)}>
                  {entryLabel(e.entry_type)}
                </span>
                {/* One figure, coloured by direction. In and Out were two
                    columns because a table needs them aligned; a card has one
                    amount and the colour already says which way it went. */}
                <span data-notranslate className={'shrink-0 text-[15px] font-bold tabular-nums ' +
                  (e.direction === 'in' ? 'text-emerald-700' : 'text-rose-700')}>
                  {(e.direction === 'in' ? '+' : '−') + formatPoints(e.amount_paise)}
                </span>
              </div>

              {e.description && (
                <p className="mt-1.5 text-[13px] text-slate-700 leading-snug">{e.description}</p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-slate-500">
                <span data-notranslate className="font-semibold text-slate-600 whitespace-nowrap">{formatDate(rowDate(e))}</span>
                {e.payment_mode && <span className="whitespace-nowrap">{titleCase(e.payment_mode)}</span>}
                {multiContract && contractByEventId[e.event_id] && contractByEventId[e.event_id].department && (
                  <DeptChip name={contractByEventId[e.event_id].department} />
                )}
                {person && <span className="whitespace-nowrap">{person}</span>}
              </div>

              {(isExpRow || isCollRow) && (canMarkChecked || on) && (
                <span className="mt-2 flex" onClick={function (ev) { ev.stopPropagation() }}>
                  <CheckedStamp
                    variant="stamp"
                    checked={!!on}
                    checkedAt={isExpRow ? e._checkedAt : e._wt.checked_at}
                    canToggle={canMarkChecked}
                    canUncheck={on === profile?.id || isSysAdmin}
                    busy={isExpRow ? checkingExpId === Number(e.reference_id) : checkingTxnId === e.reference_id}
                    onToggle={function () {
                      if (isExpRow) toggleExpenseCheck(Number(e.reference_id))
                      else toggleCollectionCheck(e.reference_id)
                    }}
                  />
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="hidden sm:block overflow-x-auto ambria-thin-scroll">
        {/* Left to itself the browser splits the table by content, and the
            short columns — a date, a chip, a word, two figures — each took a
            share of a very wide panel, putting a hand's width of nothing
            between "cash" and the figure it belongs to while the description,
            the one column that wants room, was squeezed against the right
            edge. Everything but the description is pinned to what it needs. */}
        <table className="w-full min-w-[960px]">
          <colgroup>
            <col style={{ width: '150px' }} />
            <col style={{ width: '176px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '112px' }} />
            <col style={{ width: '112px' }} />
            <col />
            <col style={{ width: '204px' }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2.5 text-left">
                <button type="button" onClick={function () { setTxnSort(txnSort === 'desc' ? 'asc' : 'desc') }}
                  title={txnSort === 'desc' ? 'Newest first — press for oldest' : 'Oldest first — press for newest'}
                  className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 hover:text-slate-900 transition-colors">
                  Date
                  <Icon name={txnSort === 'desc' ? 'chevronDown' : 'chevronUp'} size={12} className="text-slate-400" />
                </button>
              </th>
              {['Type', 'Mode'].map(function (h) {
                return <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 whitespace-nowrap">{h}</th>
              })}
              {['In', 'Out'].map(function (h) {
                return <th key={h} className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 whitespace-nowrap">{h}</th>
              })}
              <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 whitespace-nowrap">Description</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 whitespace-nowrap border-l border-slate-200">Added By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(function (e) {
              var isExpRow = e.entry_type === 'expense' && !!e.reference_id
              var isCollRow = e.entry_type === 'collection' && !!e._wt
              var isClickable = isExpRow || isCollRow
              var person = rowPerson(e)
              return (
                <tr key={e.id}
                  onClick={function () { openRow(e) }}
                  className={'border-b border-slate-100 last:border-b-0 transition-colors ' +
                    (isClickable ? 'cursor-pointer hover:bg-indigo-50/40' : '')}>
                  <td className="px-3 py-2.5 align-top whitespace-nowrap" data-notranslate>
                    <div className="text-[13px] font-semibold text-slate-700">{formatDate(rowDate(e))}</div>
                    <div className="text-[11px] text-slate-400">Logged {formatDateTime(e.created_at)}</div>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex items-center gap-1.5">
                      <span className={'shrink-0 inline-flex items-center h-[22px] px-2 rounded-md text-[11px] font-bold ' + badgeClass(e.entry_type, e.direction)}>
                        {entryLabel(e.entry_type)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-top text-[13px] text-slate-600 whitespace-nowrap">{e.payment_mode ? titleCase(e.payment_mode) : '—'}</td>
                  <td className="px-3 py-2.5 align-top text-right text-[13px] font-bold tabular-nums whitespace-nowrap" data-notranslate>
                    {e.direction === 'in'
                      ? <span className="text-emerald-700">{formatPoints(e.amount_paise)}</span>
                      : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-3 py-2.5 align-top text-right whitespace-nowrap">
                    <span data-notranslate className="block text-[13px] font-bold tabular-nums">
                      {e.direction === 'out'
                        ? <span className="text-rose-700">{formatPoints(e.amount_paise)}</span>
                        : <span className="text-slate-200">—</span>}
                    </span>
                    {/* The verdict sits with the figure it is a verdict on. In
                        the Type cell it was a chip among chips. */}
                    {(function () {
                      var on = isExpRow ? e._checkedBy : (isCollRow ? e._wt.checked_by : null)
                      if (!isExpRow && !isCollRow) return null
                      if (!canMarkChecked && !on) return null
                      return (
                        <span className="mt-1 flex justify-end" onClick={function (ev) { ev.stopPropagation() }}>
                          <CheckedStamp
                            variant="stamp"
                            checked={!!on}
                            checkedAt={isExpRow ? e._checkedAt : e._wt.checked_at}
                            canToggle={canMarkChecked}
                            canUncheck={on === profile?.id || isSysAdmin}
                            busy={isExpRow ? checkingExpId === Number(e.reference_id) : checkingTxnId === e.reference_id}
                            onToggle={function () {
                              if (isExpRow) toggleExpenseCheck(Number(e.reference_id))
                              else toggleCollectionCheck(e.reference_id)
                            }}
                          />
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex items-start gap-2">
                      {multiContract && contractByEventId[e.event_id] && contractByEventId[e.event_id].department && (
                        <span className="shrink-0 mt-px"><DeptChip name={contractByEventId[e.event_id].department} /></span>
                      )}
                      <p className="min-w-0 max-w-[620px] text-[13px] text-slate-700 leading-snug">{e.description || '—'}</p>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-top border-l border-slate-100">
                    {person ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="min-w-0 text-right">
                          <span className="block text-[12px] font-semibold text-slate-700 truncate">{person}</span>
                          <span className="block text-[11px] text-slate-400" data-notranslate>{formatDate(e.created_at)}</span>
                        </span>
                        <span className={'shrink-0 w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-bold ' + avatarTint(person)}
                          data-notranslate>{initials(person)}</span>
                      </div>
                    ) : <span className="block text-right text-[12px] text-slate-400">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </>
    )
  }
  function renderPlatesTable() {
    if (platesLoading) return <p className="text-[13px] text-slate-400 p-5 text-center">Loading plate history…</p>
    if (plateEvents.length === 0) return <p className="text-[13px] text-slate-400 p-8 text-center">No plate activity for this event</p>
    return (
      <div className="overflow-x-auto ambria-thin-scroll">
        {/* Same reasoning as the entries table: six short columns and one that
            wants the room, so only Notes is left to take what is left. */}
        <table className="w-full min-w-[880px]">
          <colgroup>
            <col style={{ width: '120px' }} />
            <col style={{ width: '150px' }} />
            <col style={{ width: '86px' }} />
            <col style={{ width: '96px' }} />
            <col style={{ width: '92px' }} />
            <col style={{ width: '112px' }} />
            <col style={{ width: '132px' }} />
            <col />
          </colgroup>
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Date', 'Type'].map(function (h) {
                return <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{h}</th>
              })}
              {['Plates', 'Returned', 'Charged', 'Amount'].map(function (h) {
                return <th key={h} className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{h}</th>
              })}
              {['Mode', 'Notes'].map(function (h) {
                return <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{h}</th>
              })}
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
                : isWaste ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
              var modeLabel = !isIssue && p.payment_mode
                ? p.payment_mode + (p.payment_sub_mode ? ' · ' + p.payment_sub_mode : '')
                : '—'
              return (
                <tr key={p._kind + '-' + p.id} className={'border-b border-slate-100 last:border-b-0 ' + (isCancelled ? 'opacity-40 line-through' : '')}>
                  <td className="px-3 py-2.5 text-[12px] text-slate-600 whitespace-nowrap" data-notranslate>{formatDate(p.created_at)}</td>
                  <td className="px-3 py-2.5">
                    <span className={'inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ' + typeClass}>
                      {typeLabel}{isCancelled ? ' · Cancelled' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-slate-800" data-notranslate>{isIssue ? p.plates_count : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-amber-700" data-notranslate>{!isIssue && (p.plates_returned || 0) > 0 ? p.plates_returned : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-slate-800" data-notranslate>{!isIssue && (p.extras_charged || 0) > 0 ? p.extras_charged : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-[13px] font-semibold tabular-nums text-emerald-700" data-notranslate>{!isIssue && (p.total_paise || 0) > 0 ? formatPoints(p.total_paise) : '—'}</td>
                  <td className="px-3 py-2.5 text-[12px] text-slate-700">{modeLabel}</td>
                  <td className="px-3 py-2.5 text-[12px] text-slate-600">{p.notes || (isCancelled && p.cancelled_reason ? '(' + p.cancelled_reason + ')' : '—')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  function syncTabEdges() {
    var el = tabScrollRef.current
    if (!el) return
    var left = el.scrollLeft > 2
    var right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    // Compared before setting: this runs on every scroll event, and setting
    // state to the value it already holds re-renders the whole detail view.
    setTabEdges(function (prev) {
      return (prev.left === left && prev.right === right) ? prev : { left: left, right: right }
    })
  }

  // After the tab row is on the screen, and again whenever the window changes
  // width — a phone turned sideways can fit all five, and then there is nothing
  // to fade.
  useEffect(function () {
    syncTabEdges()
    window.addEventListener('resize', syncTabEdges)
    return function () { window.removeEventListener('resize', syncTabEdges) }
  }, [eventDetail, tab])

  var detailView = eventDetail && (
    <div className="space-y-4">
      {/* Back to Events is the admin console's alone. On a phone the
          header's own arrow now walks back one step at a time, and a second
          Back under it said the same thing twice. */}
      {!propEventId && (
        <div className={'flex items-center gap-3 ' + (inAdmin ? 'justify-between' : 'justify-end')}>
          {inAdmin && (
            <button type="button" onClick={function () { backTo(1) }}
              className="ambria-day-pill inline-flex items-center gap-1.5 h-9 px-3 -ml-1 rounded-xl text-[13px] font-bold text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 transition-colors">
              <Icon name="arrowLeft" size={15} />
              Back to Events
            </button>
          )}
          <button type="button" onClick={function () { backTo(0) }}
            className="ambria-day-pill inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            <Icon name="calendar" size={14} />
            Change date
          </button>
        </div>
      )}

      {/* A rail, a heading and a row of facts — not four lines down one side.
          The date is what an event is filed under, so it leaves the text
          entirely and becomes the block you read first; the facts that used to
          be stacked sit on one line divided by rules, which is what a rule is
          for. */}
      {/* The phone card, to the supplied design: the date on a line of its own
          with the status opposite it, the name across the full width, then the
          four facts as a labelled 2x2.

          Labels are what the desktop card never had. Unlabelled, a venue and a
          person are two names with two glyphs, and "Dinner" beside a clock
          could be a time — the words cost one small grey line each and the
          tiles stop needing to be guessed at.

          The desktop card below is untouched. It keeps the date rail, which
          works at that width and does not here. */}
      <div className={CARD + ' sm:hidden p-4'}>
        {(function () {
          var raw = eventDetail.function_date || eventDetail.contract_date
          var d = raw ? new Date(String(raw).slice(0, 10) + 'T00:00:00') : null
          return (
            <div className="flex items-center justify-between gap-3">
              {d && !isNaN(d) ? (
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span className="shrink-0 w-8 h-8 rounded-[10px] bg-indigo-50 text-indigo-600 inline-flex items-center justify-center">
                    <Icon name="calendar" size={16} className="block" />
                  </span>
                  <span data-notranslate className="text-[14px] font-bold text-indigo-700 whitespace-nowrap">
                    {d.getDate() + ' ' + SHORT_MONTHS[d.getMonth()] + ' ' + d.getFullYear()}
                  </span>
                  <span aria-hidden="true" className="w-px h-4 bg-slate-200" />
                  <span data-notranslate className="text-[13px] font-semibold text-slate-500">{SHORT_DAYS[d.getDay()]}</span>
                </span>
              ) : <span />}
            </div>
          )
        })()}

        <h2 className="mt-3 font-display text-[23px] font-bold text-slate-900 leading-tight tracking-[-0.02em]">
          {eventDetail.event_name || 'Event'}
          {eventDetail.client_name ? ' — ' + eventDetail.client_name : ''}
        </h2>

        {/* One row under the name: what this event is filed as, and the one
            thing on the card you can open.

            The contract numbers used to lead this row and are gone from the
            header: they still show on each contract in the Contracts section
            and on the PDF's own label, which is where anyone needing one
            looks. The department stays beside the PDF it files. */}
        {(function () {
          var depts = contracts.filter(function (c) { return c.department })
          var withPdf = contracts.filter(function (c) { return c.pdf_link })[0]
          if (depts.length === 0 && !withPdf) return null
          return (
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                {/* Neutral chips with the department's colour as a dot. Three
                    filled pastels side by side — blue, purple, pink — fought
                    the screen's maroon and each other; the dot keeps each
                    department recognisable without painting the whole chip. */}
                {depts.map(function (c) {
                  return (
                    <span key={'d' + c.id}
                      className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white text-[12px] font-semibold text-slate-700">
                      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: deptHex(c.department) }} />
                      {c.department}
                    </span>
                  )
                })}
              </div>
              {withPdf && (
                <a href={withPdf.pdf_link} target="_blank" rel="noopener noreferrer"
                  title="Open the LMS contract PDF" aria-label="Open the LMS contract PDF"
                  className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 active:bg-slate-50 transition-colors">
                  <Icon name="fileText" size={16} className="block" />
                </a>
              )}
            </div>
          )
        })()}

        {(function () {
          var facts = []
          if (eventDetail.venue_name) facts.push({ k: 'venue', icon: 'mapPin', label: 'Venue', text: eventDetail.venue_name })
          if (eventDetail.session) facts.push({ k: 'session', icon: 'utensils', label: 'Session', text: eventDetail.session })
          var heads = eventDetail.pax > 0 ? eventDetail.pax : (eventDetail.total_plates > 0 ? eventDetail.total_plates : 0)
          if (heads > 0) {
            facts.push({
              k: 'heads', icon: 'users',
              label: eventDetail.pax > 0 ? 'Guests' : 'Plates',
              text: heads + (eventDetail.pax > 0 ? ' Guests' : ' Plates'),
            })
          }
          // "Created By", not "Client". The client is in the title beside the
          // event's name; this is the person who entered it.
          if (eventDetail.created_user_name) facts.push({ k: 'by', icon: 'user', label: 'Created By', text: eventDetail.created_user_name })
          if (facts.length === 0) return null
          return (
            <div className="mt-4 grid grid-cols-2 gap-y-4">
              {facts.map(function (f, i) {
                return (
                  <div key={f.k} className={'flex items-center gap-2.5 min-w-0 ' + (i % 2 === 1 ? 'border-l border-slate-100 pl-3' : 'pr-3')}>
                    {/* The bare outline, no tinted square behind it: four
                        filled tiles in a grid read as four buttons. */}
                    <span className="shrink-0 w-6 text-indigo-600 inline-flex items-center justify-center">
                      <Icon name={f.icon} size={19} className="block" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11.5px] text-slate-500 leading-tight">{f.label}</span>
                      <span className="block text-[13.5px] font-bold text-slate-900 leading-tight truncate">{f.text}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })()}

      </div>

      <div className={CARD + ' hidden sm:block overflow-hidden'}>
        <div className="flex items-stretch">
          {(function () {
            var raw = eventDetail.function_date || eventDetail.contract_date
            var d = raw ? new Date(String(raw).slice(0, 10) + 'T00:00:00') : null
            if (!d || isNaN(d)) return null
            return (
              <div className="shrink-0 w-[92px] flex flex-col items-center justify-center gap-0.5 bg-slate-50 border-r border-slate-200 px-3 py-4">
                <p data-notranslate className="font-display text-[30px] font-bold text-slate-900 leading-none tracking-[-0.02em] tabular-nums">
                  {d.getDate()}
                </p>
                <p data-notranslate className="text-[12px] font-bold uppercase tracking-[0.08em] text-indigo-600">
                  {SHORT_MONTHS[d.getMonth()]}
                </p>
                <p data-notranslate className="text-[11px] font-semibold text-slate-400 tabular-nums">
                  {d.getFullYear()} · {SHORT_DAYS[d.getDay()]}
                </p>
              </div>
            )
          })()}

          <div className="min-w-0 flex-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-4 @3xl:px-5">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h2 className="min-w-0 font-display text-[21px] font-bold text-slate-900 leading-tight tracking-[-0.015em]">
                  {eventDetail.event_name || 'Event'}
                  {eventDetail.client_name ? ' — ' + eventDetail.client_name : ''}
                </h2>
              </div>

              {/* One line of facts, divided by rules. Stacked, each of these
                  took a row of a very wide card to say two words. */}
              {(function () {
                var facts = []
                if (eventDetail.venue_name) facts.push({ k: 'venue', icon: 'mapPin', text: eventDetail.venue_name })
                if (eventDetail.session) facts.push({ k: 'session', icon: 'clock', text: eventDetail.session })
                var heads = eventDetail.pax > 0 ? eventDetail.pax : (eventDetail.total_plates > 0 ? eventDetail.total_plates : 0)
                if (heads > 0) {
                  facts.push({
                    k: 'heads', icon: 'users',
                    text: heads + (eventDetail.pax > 0 ? ' Guests' : ' Plates'),
                  })
                }
                if (eventDetail.created_user_name) facts.push({ k: 'by', icon: 'user', text: eventDetail.created_user_name })
                if (facts.length === 0) return null
                return (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {facts.map(function (f, i) {
                      return (
                        <span key={f.k} className="flex items-center gap-3">
                          {i > 0 && <span aria-hidden="true" className="w-px h-4 bg-slate-200" />}
                          {/* nowrap: the row may wrap between facts, but a
                              venue called "Ambria Restro" breaking into
                              "Ambria" and "Restro" reads as two facts. */}
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 whitespace-nowrap">
                            <Icon name={f.icon} size={14} className="shrink-0 text-slate-400" />
                            <span>{f.text}</span>
                          </span>
                        </span>
                      )
                    })}
                  </div>
                )
              })()}

              {/* The departments are the one thing on this card a reader scans
                  for rather than reads, so they get the size a target wants
                  and their own line under the sentence they qualify. */}
              <div className="flex flex-wrap items-center gap-1.5">
                {contracts.map(function (c) {
                  if (!c.department) return null
                  return (
                    <span key={c.id}
                      className={'h-7 px-3 inline-flex items-center rounded-full border text-[12px] font-bold ' + deptCls(c.department)}>
                      {c.department}
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-3">
              {/* The mockup puts an edit and an overflow menu here. Nothing on
                  this screen edits an event — they arrive from LMS — so the
                  slot carries the one thing it can actually open. */}
              {(function () {
                var withPdf = contracts.filter(function (c) { return c.pdf_link })[0]
                if (!withPdf) return null
                return (
                  <>
                    <span aria-hidden="true" className="w-px h-6 bg-slate-200" />
                    <a href={withPdf.pdf_link} target="_blank" rel="noopener noreferrer"
                      title="Open the LMS contract PDF" aria-label="Open the LMS contract PDF"
                      className="w-9 h-9 inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 transition-colors">
                      <Icon name="fileText" size={16} />
                    </a>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* The fades are the affordance, not decoration: one appears only on a
          side that has something hidden behind it, so an edge with a fade means
          there is more that way and an edge without one means there is not. */}
      <div className="ambria-day-tabbar relative border-b border-slate-200">
      <div ref={tabScrollRef} onScroll={syncTabEdges}
        className="flex sm:gap-1 overflow-x-auto no-scrollbar scroll-smooth">
        {TABS.map(function (t) {
          var active = tab === t.key
          var count = tabCounts[t.key]
          return (
            <button key={t.key} type="button" aria-pressed={active}
              onClick={function (ev) {
                setTab(t.key)
                // A tab half off the end stays half off the end after you press
                // it, which reads as the press not having landed.
                if (ev.currentTarget && ev.currentTarget.scrollIntoView) {
                  ev.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
                }
              }}
              className={'relative flex-1 min-w-0 inline-flex flex-col items-center justify-center gap-1 px-1 h-14 text-[11px] font-bold transition-colors ' +
                'sm:flex-none sm:shrink-0 sm:flex-row sm:gap-2 sm:px-3.5 sm:h-10 sm:text-[13px] ' +
                (active ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-900')}>
              <Icon name={t.icon} size={16} className="sm:w-3.5 sm:h-3.5" />
              <span className="truncate max-w-full sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
              {/* Desktop only. On a phone the five tabs share one row and a
                  badge on each icon was clutter the tab itself answers. */}
              {count !== undefined && count > 0 && (
                <span data-notranslate className={'hidden sm:inline px-1.5 py-0.5 rounded-md text-[11px] font-bold tabular-nums leading-none ' +
                  (active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500')}>{count}</span>
              )}
              {active && <span aria-hidden="true" className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-indigo-600" />}
            </button>
          )
        })}
      </div>
        {tabEdges.left && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent" />
        )}
        {tabEdges.right && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" />
        )}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 @3xl:grid-cols-12">
          <SectionCard title="Event Information" icon="info" className="@3xl:col-span-7">
            <div className="px-4 divide-y divide-slate-100">
              <InfoRow inCard label="Function" value={eventDetail.event_name} />
              <InfoRow inCard label="Client" value={eventDetail.client_name} />
              <InfoRow inCard label="Venue" value={eventDetail.venue_name} />
              <InfoRow label="Location" value={eventDetail.location} />
              <InfoRow inCard label="Session" value={eventDetail.session} />
              <InfoRow inCard label="Event Date" value={eventDetail.function_date ? longDate(eventDetail.function_date) : null} />
              <InfoRow label="Contract Date" value={eventDetail.contract_date ? longDate(eventDetail.contract_date) : null} />
              <InfoRow label="Contact" value={eventDetail.contact_person} />
              <InfoRow label="Catering" value={eventDetail.catering} />
              {/* Pax is the head count the card prints; plates is not, unless
                  there is no pax to print instead — so plates stays. */}
              <InfoRow inCard label="Pax" value={eventDetail.pax > 0 ? eventDetail.pax : null} />
              <InfoRow label="Plates" value={eventDetail.total_plates > 0 ? eventDetail.total_plates : null} />
              <InfoRow label="Complimentary" value={eventDetail.complementary_plates > 0 ? eventDetail.complementary_plates : null} />
              <InfoRow inCard label="Created By" value={eventDetail.created_user_name} />
              <InfoRow label="Last Synced" value={eventDetail.synced_at ? formatDateTime(eventDetail.synced_at) : null} />
            </div>
          </SectionCard>

          <SectionCard title={'Contracts (' + contracts.length + ')'} icon="fileText" className="@3xl:col-span-5">
            <div className="divide-y divide-slate-100">
              {contracts.map(function (c) {
                var b = balancesByContract[c.id] || {}
                var pend = Number(b.pending_cash_paise || 0) + Number(b.pending_bank_paise || 0)
                return (
                  <div key={c.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <DeptChip name={c.department} />
                      {balance && (
                        <span className={'text-[12px] font-bold tabular-nums ' + (pend > 0 ? 'text-rose-600' : 'text-emerald-600')} data-notranslate>
                          {pend > 0 ? formatPoints(pend) + ' due' : 'Settled'}
                        </span>
                      )}
                    </div>
                    {c.created_user_name && (
                      <p className="text-[12px] text-slate-500">by {c.created_user_name}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </SectionCard>
        </div>
      )}

      {tab === 'financials' && (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-2 @3xl:grid-cols-4">
            <MoneyTile
              label={<>Agreed Cash<button type="button" aria-hidden="true" tabIndex={-1}
                onClick={function () { setCashX10(function (v) { return !v }) }}
                className="ml-1.5 inline-block w-2.5 h-2.5 align-middle rounded-full bg-slate-200 opacity-25" /></>}
              value={balanceLoading ? '—' : formatPoints(cashX10 ? agrCashP * 10 : agrCashP)}
              sub={
                <div className="mt-2 space-y-0.5">
                  <p className="text-[12px] text-slate-500 tabular-nums" data-notranslate>Collected {formatPoints(colCashP)}</p>
                  <p className={'text-[12px] font-bold tabular-nums ' + (pendCashP > 0 ? 'text-rose-600' : 'text-emerald-600')} data-notranslate>
                    Pending {formatPoints(pendCashP)}
                  </p>
                </div>
              } />
            <MoneyTile label="Agreed Bank" value={balanceLoading ? '—' : formatPoints(agrBankP)}
              sub={
                <div className="mt-2 space-y-0.5">
                  <p className="text-[12px] text-slate-500 tabular-nums" data-notranslate>Collected {formatPoints(colBankP)}</p>
                  <p className={'text-[12px] font-bold tabular-nums ' + (pendBankP > 0 ? 'text-rose-600' : 'text-emerald-600')} data-notranslate>
                    Pending {formatPoints(pendBankP)}
                  </p>
                </div>
              } />
            <MoneyTile label="Total Collected" tone="text-emerald-700" value={balanceLoading ? '—' : formatPoints(colCashP + colBankP)}
              sub={<p className="mt-2 text-[12px] text-slate-500">Cash and bank together</p>} />
            <MoneyTile label="Total Spent" tone="text-rose-700" value={balanceLoading ? '—' : formatPoints(spentP)}
              sub={<p className="mt-2 text-[12px] text-slate-500">Expenses booked to this event</p>} />
          </div>

          {multiContract && (
            <SectionCard title="Per-Contract Breakdown" icon="chart">
              {/* A phone gets one block per contract rather than the table.
                  Seven columns in 358px scrolled sideways and put the one
                  number anyone opens this for — what is still pending — off
                  the edge. Here each contract is three rows by two columns,
                  cash beside bank, and nothing is out of sight. */}
              <div className="sm:hidden divide-y divide-slate-100">
                {contracts.map(function (c) {
                  var b = balancesByContract[c.id] || {}
                  var pcash = Number(b.pending_cash_paise || 0)
                  var pbank = Number(b.pending_bank_paise || 0)
                  var rows = [
                    { k: 'Agreed', cash: Number(b.agreed_cash_paise || 0), bank: Number(b.agreed_bank_paise || 0), cls: 'text-slate-800' },
                    { k: 'Collected', cash: Number(b.collected_cash_paise || 0), bank: Number(b.collected_bank_paise || 0), cls: 'text-slate-600' },
                  ]
                  return (
                    <div key={c.id} className="px-4 py-3.5">
                      {/* Fixed tracks, not auto: auto sized each block's
                          columns to its own numbers, so Cash and Bank stood
                          in a different place under every contract and the
                          blocks could not be read down the page together.

                          The department heads the label column, level with
                          the Cash and Bank titles — on a row of its own above
                          them it left the width over the numbers empty. */}
                      <div className="grid grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 items-baseline">
                        <span className="min-w-0 self-end">
                          <span className="flex items-center gap-1.5 min-w-0 text-[13px] font-bold text-slate-900">
                            <span aria-hidden="true" className="shrink-0 w-2 h-2 rounded-full" style={{ background: deptHex(c.department) }} />
                            <span className="truncate">{c.department || 'Contract'}</span>
                          </span>
                          {c.created_user_name && <span className="block pl-3.5 truncate text-[11px] text-slate-400">by {c.created_user_name}</span>}
                        </span>
                        <span className="self-end text-right text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Cash</span>
                        <span className="self-end text-right text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Bank</span>
                        <span aria-hidden="true" className="col-span-3 h-px bg-slate-100" />
                        {rows.map(function (r) {
                          return [
                            <span key={r.k} className="text-[13px] text-slate-500">{r.k}</span>,
                            <span key={r.k + 'c'} className={'text-right text-[13px] tabular-nums truncate ' + r.cls} data-notranslate>{formatPoints(r.cash)}</span>,
                            <span key={r.k + 'b'} className={'text-right text-[13px] tabular-nums truncate ' + r.cls} data-notranslate>{formatPoints(r.bank)}</span>,
                          ]
                        })}
                        <span aria-hidden="true" className="col-span-3 h-px bg-slate-100" />
                        <span className="text-[13px] font-bold text-slate-800">Pending</span>
                        <span className={'text-right text-[14px] font-bold tabular-nums truncate ' + (pcash > 0 ? 'text-rose-600' : 'text-emerald-600')} data-notranslate>{formatPoints(pcash)}</span>
                        <span className={'text-right text-[14px] font-bold tabular-nums truncate ' + (pbank > 0 ? 'text-rose-600' : 'text-emerald-600')} data-notranslate>{formatPoints(pbank)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="hidden sm:block overflow-x-auto ambria-thin-scroll">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Contract</th>
                      {['Agreed Cash', 'Coll. Cash', 'Pend. Cash', 'Agreed Bank', 'Coll. Bank', 'Pend. Bank'].map(function (h) {
                        return <th key={h} className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 whitespace-nowrap">{h}</th>
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.map(function (c) {
                      var b = balancesByContract[c.id] || {}
                      var pcash = Number(b.pending_cash_paise || 0)
                      var pbank = Number(b.pending_bank_paise || 0)
                      return (
                        <tr key={c.id} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <DeptChip name={c.department} />
                              {c.created_user_name && <span className="text-[11px] text-slate-400">by {c.created_user_name}</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-slate-800" data-notranslate>{formatPoints(Number(b.agreed_cash_paise || 0))}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-slate-600" data-notranslate>{formatPoints(Number(b.collected_cash_paise || 0))}</td>
                          <td className={'px-3 py-2.5 text-right text-[13px] font-bold tabular-nums ' + (pcash > 0 ? 'text-rose-600' : 'text-emerald-600')} data-notranslate>{formatPoints(pcash)}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-slate-800" data-notranslate>{formatPoints(Number(b.agreed_bank_paise || 0))}</td>
                          <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-slate-600" data-notranslate>{formatPoints(Number(b.collected_bank_paise || 0))}</td>
                          <td className={'px-3 py-2.5 text-right text-[13px] font-bold tabular-nums ' + (pbank > 0 ? 'text-rose-600' : 'text-emerald-600')} data-notranslate>{formatPoints(pbank)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {tab === 'transactions' && (function () {
        var vis = visibleEntries()
        var pages = Math.max(1, Math.ceil(vis.length / TXN_PAGE_SIZE))
        var page = Math.min(txnPage, pages)
        var from = vis.length === 0 ? 0 : (page - 1) * TXN_PAGE_SIZE + 1
        var to = Math.min(page * TXN_PAGE_SIZE, vis.length)
        var pageRows = vis.slice((page - 1) * TXN_PAGE_SIZE, page * TXN_PAGE_SIZE)
        return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* The search takes what is left of the row rather than a fixed
                220: at 220 the three controls came to 422 against the 358 a
                phone has, and Export sat over the edge. */}
            <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
              <div className="relative flex-1 min-w-0 sm:flex-none sm:w-[220px] @3xl:w-[260px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <Icon name="search" size={15} />
                </span>
                <input type="search" value={txnSearch} placeholder="Search transactions..."
                  onChange={function (ev) { setTxnSearch(ev.target.value); setTxnPage(1) }}
                  className={FIELD_SEARCH} />
              </div>
              <button type="button" onClick={function () { setShowTxnFilter(!showTxnFilter) }} aria-pressed={showTxnFilter}
                className={'inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-[13px] font-bold border transition-colors ' +
                  (txnFilterCount > 0 || showTxnFilter
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
                <Icon name="filter" size={14} />
                Filter
                {txnFilterCount > 0 && (
                  <span data-notranslate className="px-1.5 rounded-md bg-indigo-600 text-white text-[11px] tabular-nums">{txnFilterCount}</span>
                )}
              </button>
              <button type="button" onClick={function () { exportCsv(vis) }} disabled={vis.length === 0}
                title="Export everything shown, in the order it is shown"
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-indigo-600 transition-all">
                <Icon name="download" size={14} />
                {/* The word goes on a phone and the glyph carries it. A
                    download arrow is not ambiguous, and the alternative was
                    the button sitting off the screen. */}
                <span className="hidden sm:inline">Export</span>
              </button>
            </div>
          </div>

          {showTxnFilter && (
            <div className={CARD + ' p-3 grid gap-3 @3xl:grid-cols-3'}>
              {/* The type pills were a row of their own above the search, four
                  buttons taking a line of the screen to say which of them was
                  on — and three of them were usually off. They are a filter
                  like the three below, so they sit with them, and the count on
                  the Filter button says when one is set. */}
              <div className="@3xl:col-span-3">
                <p className={TXN_FILTER_LABEL}>Type</p>
                <div className={txnFilterRow(ENTRY_TYPES.length)}>
                  {ENTRY_TYPES.map(function (t) {
                    var active = filter === t.key
                    var n = t.key === 'all' ? entries.length : entries.filter(function (e) { return e.entry_type === t.key }).length
                    // A pill that filters to nothing is a dead end — it can only
                    // ever produce "nothing matches". It still shows, because a
                    // zero is an answer, but it stops inviting the press.
                    var empty = n === 0 && t.key !== 'all'
                    return (
                      <button key={t.key} type="button" aria-pressed={active} disabled={empty}
                        onClick={function () { setFilter(t.key); setTxnPage(1) }}
                        className={txnPillCls(active, empty)}>
                        {t.label}
                        <span data-notranslate className={active ? 'text-indigo-400' : 'text-slate-400'}>{n}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className={TXN_FILTER_LABEL}>Direction</p>
                <div className={txnFilterRow(3)}>
                  {[{ k: '', l: 'Any' }, { k: 'in', l: 'Money in' }, { k: 'out', l: 'Money out' }].map(function (o) {
                    return (
                      <button key={o.k || 'any'} type="button"
                        onClick={function () { setTxnDir(o.k); setTxnPage(1) }}
                        className={txnPillCls(txnDir === o.k, false)}>
                        {o.l}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className={TXN_FILTER_LABEL}>Mode</p>
                <div className={txnFilterRow(txnModes.length + 1)}>
                  <button type="button" onClick={function () { setTxnMode(''); setTxnPage(1) }}
                    className={txnPillCls(txnMode === '', false)}>Any</button>
                  {txnModes.map(function (m) {
                    return (
                      <button key={m} type="button" onClick={function () { setTxnMode(m); setTxnPage(1) }}
                        className={txnPillCls(txnMode === m, false)}>{titleCase(m)}</button>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className={TXN_FILTER_LABEL}>Finance check</p>
                <div className={txnFilterRow(3)}>
                  {[{ k: '', l: 'Any' }, { k: 'checked', l: 'Checked' }, { k: 'unchecked', l: 'Unchecked' }].map(function (o) {
                    return (
                      <button key={o.k || 'any'} type="button"
                        onClick={function () { setTxnCheck(o.k); setTxnPage(1) }}
                        className={txnPillCls(txnCheck === o.k, false)}>
                        {o.l}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Clear sat inside the Finance check row on an ml-auto, which
                  made it the fourth option in a set of three. It undoes all
                  four sections, so it belongs under all four. */}
              {txnFilterCount > 0 && (
                <div className="@3xl:col-span-3">
                  <button type="button"
                    onClick={function () { setFilter('all'); setTxnDir(''); setTxnMode(''); setTxnCheck(''); setTxnPage(1) }}
                    className="w-full sm:w-auto h-9 px-3 inline-flex items-center justify-center rounded-lg text-[12px] font-bold text-rose-600 border border-rose-200 hover:bg-rose-50 transition-colors">
                    Clear <span data-notranslate className="ml-1">{txnFilterCount}</span> filter{txnFilterCount === 1 ? '' : 's'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div ref={txnListRef} className={CARD + ' overflow-hidden scroll-mt-4'}>
            {renderEntriesTable(pageRows)}
            {vis.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-200 bg-slate-50/60">
                <p className="text-[12px] text-slate-500" data-notranslate>
                  Showing {from}–{to} of {vis.length} transaction{vis.length === 1 ? '' : 's'}
                </p>
                {pages > 1 && (
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={page === 1} onClick={function () { goTxnPage(page - 1) }}
                      aria-label="Previous page"
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                      <Icon name="chevronRight" size={14} className="rotate-180" />
                    </button>
                    {Array.from({ length: pages }, function (_u, i) { return i + 1 }).map(function (n) {
                      return (
                        <button key={n} type="button" onClick={function () { goTxnPage(n) }}
                          className={'min-w-8 h-8 px-2 rounded-lg text-[12px] font-bold tabular-nums transition-colors ' +
                            (n === page ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100')}
                          data-notranslate>{n}</button>
                      )
                    })}
                    <button type="button" disabled={page === pages} onClick={function () { goTxnPage(page + 1) }}
                      aria-label="Next page"
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                      <Icon name="chevronRight" size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )
      })()}
      {tab === 'plates' && <div className={CARD + ' overflow-hidden'}>{renderPlatesTable()}</div>}

      {tab === 'documents' && (
        <div className={CARD + ' overflow-hidden'}>
          {documents.length === 0 ? (
            <p className="text-[13px] text-slate-400 p-8 text-center">No receipts on this event yet</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {documents.map(function (d) {
                if (d.kind === 'link') {
                  return (
                    <a key={d.id} href={d.href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                      <Icon name="fileText" size={18} className="shrink-0 text-indigo-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold text-slate-900 truncate">{d.label}</span>
                        <span className="block text-[12px] text-slate-500 truncate">{d.sub}</span>
                      </span>
                      <Icon name="chevronRight" size={16} className="shrink-0 text-slate-300" />
                    </a>
                  )
                }
                var busy = printingDocId === d.id
                return (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <Icon name={d.icon} size={18} className="shrink-0 text-indigo-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold text-slate-900 truncate">{d.label}</span>
                      <span className="block text-[12px] text-slate-500 truncate" data-notranslate>{d.sub}</span>
                    </span>
                    {d.photo && (
                      <button type="button" onClick={function () { setLightbox({ url: d.photo, label: d.label, sub: d.sub }) }}
                        aria-label={'View photo — ' + d.label}
                        className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors">
                        <Icon name="gallery" size={16} />
                      </button>
                    )}
                    <button type="button" onClick={function () { printReceipt(d) }} disabled={!!printingDocId}
                      className="shrink-0 h-9 px-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 text-white text-[12px] font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      <Icon name="fileText" size={14} />
                      {busy ? 'PDF…' : 'PDF'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className={'@container ' + (inAdmin ? '' : 'ambria-event-day')}>
      {!inAdmin && <EventBackdrop />}
      {!propEventId && !eventId && (
        // The calendar is a fixed 400 wide and the panel beside it takes what
        // is left. On its own, centred, the calendar left most of a 1600px
        // page empty and said nothing about the month it was showing — you
        // had to press a day to learn whether it was worth pressing.
        <div className="flex flex-col @3xl:flex-row gap-4 items-start">
          <div className="w-full @3xl:w-[400px] @3xl:shrink-0">
            <EventCalendar value={date} onChange={stepIntoDate}
              year={monthYear} month={monthMonth}
              onMonthChange={function (y, m) {
                setMonthYear(y); setMonthMonth(m)
                setShowPastDays(false)
                // Paging away from the month a selected date lives in would
                // leave "Events on 21 September" beside October's grid, and
                // then empty it as the new month arrived. Browsing months is
                // a step back, so it takes you back to the month list.
                if (date) {
                  var d = new Date(date + 'T00:00:00')
                  if (d.getFullYear() !== y || d.getMonth() !== m) backTo(0)
                }
              }}
              byDate={monthByDate} loading={monthLoading} total={monthRows.length}
              venues={monthVenues} />
          </div>

          <div className="w-full min-w-0 @3xl:flex-1">
            {!date && (
              <div className={CARD + ' overflow-hidden'}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">This month</p>
                    <p className="font-display text-[17px] font-bold text-slate-900 tracking-[-0.01em]" data-notranslate>
                      {MONTHS[monthMonth] + ' ' + monthYear}
                    </p>
                  </div>
                  {!monthLoading && monthRows.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      {[{ n: monthRows.length, l: 'events' }, { n: monthDays.length, l: 'days' }, { n: monthVenues.length, l: 'venues' }].map(function (st) {
                        return (
                          <span key={st.l} className="inline-flex items-baseline gap-1 h-7 px-2.5 rounded-lg bg-slate-100 text-slate-600 text-[12px] font-bold">
                            <span data-notranslate className="tabular-nums text-slate-900">{st.n}</span>
                            <span className="font-semibold text-slate-500">{st.l}</span>
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>

                {monthLoading && (
                  <div className="p-4 space-y-2.5">
                    {[0, 1, 2, 3].map(function (i) {
                      return <div key={i} className="ambria-skeleton h-[72px] rounded-xl" />
                    })}
                  </div>
                )}

                {!monthLoading && monthDays.length === 0 && (
                  <div className="px-4 py-16 text-center">
                    <Icon name="calendar" size={26} className="mx-auto text-slate-300" />
                    <p className="mt-2 text-[13px] font-bold text-slate-600">Nothing booked this month</p>
                    <p className="mt-0.5 text-[13px] font-medium text-slate-400">Use the arrows above the grid to look at another one.</p>
                  </div>
                )}

                {/* Scrolls inside itself from sm up only. On a phone a box scrolling
                    inside the page traps the finger — overscroll-contain stops the
                    page taking over at the list's end — so there the list grows to
                    its full length and the page is the one thing that scrolls. */}
                {!monthLoading && listedDays.length > 0 && (
                  <div className="ambria-day-tiles divide-y divide-slate-100 sm:max-h-[min(72vh,660px)] sm:overflow-y-auto ambria-thin-scroll sm:overscroll-contain">
                    {pastDays.length > 0 && aheadDays.length > 0 && (
                      <button type="button" onClick={function () { setShowPastDays(!showPastDays) }}
                        className="w-full px-4 py-2 flex items-center justify-center gap-1.5 text-[12px] font-bold text-slate-500 hover:text-indigo-700 hover:bg-indigo-50/40 transition-colors">
                        <Icon name={showPastDays ? 'chevronUp' : 'chevronDown'} size={13} />
                        {showPastDays
                          ? 'Hide earlier days'
                          : (<span><span data-notranslate>{pastDays.length}</span> earlier {pastDays.length === 1 ? 'day' : 'days'} this month</span>)}
                      </button>
                    )}
                    {listedDays.map(function (d) {
                      var info = monthByDate[d]
                      var when = new Date(d + 'T00:00:00')
                      var isToday = d === isoDate(new Date())
                      var groups = _buildGroups(info.rows)
                      return (
                        // One function on the day goes straight to it.
                        // The day screen in between listed a single row
                        // and its only purpose was to be pressed, so it
                        // asked which event on a date that has one.
                        //
                        // pickDate first, then selectGroup: pickDate
                        // clears the open event and selectGroup sets it,
                        // and React batches both into one render, so the
                        // detail is what lands. It still sets the date, so
                        // Back goes to that day rather than the month.
                        //
                        // groups.length, not the count beside the row:
                        // that counts contracts, and one function can have
                        // several. A date reading 3 can still be one event.
                        <button key={d} type="button"
                          onClick={function () {
                            stepIntoDate(d)
                            if (groups.length === 1) stepIntoGroup(groups[0])
                          }}
                          className="group w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-indigo-50/40 transition-colors">
                          {/* The date reads as one block — a number under its
                              weekday — so the eye finds the day it wants down
                              a column rather than inside a sentence. */}
                          <span className={'shrink-0 w-12 text-center rounded-xl py-1.5 ' +
                            (isToday ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600')}>
                            <span data-notranslate className="block font-display text-[19px] font-bold leading-none tracking-[-0.01em] tabular-nums">{when.getDate()}</span>
                            <span className={'block mt-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ' + (isToday ? 'text-white/80' : 'text-slate-500')}>
                              {SHORT_DAYS[when.getDay()]}
                            </span>
                          </span>

                          <span className="min-w-0 flex-1 space-y-1">
                            {groups.slice(0, 3).map(function (g) {
                              return (
                                // Name above venue, not beside it. Side by
                                // side on a phone the venue kept its width
                                // and the name was cut to "GET TOG…", which
                                // is the half of the row you came to read.
                                <span key={g.key} className="block min-w-0">
                                  <span className="block text-[13px] font-bold text-slate-900 leading-snug break-words">
                                    {g.event_name || 'Event'}{g.client_name ? ' — ' + g.client_name : ''}
                                  </span>
                                  {g.venue_name && (
                                    <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500">
                                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: venueColor(g.venue_name) }} />
                                      {g.venue_name}
                                    </span>
                                  )}
                                </span>
                              )
                            })}
                            {groups.length > 3 && (
                              <span className="block text-[12px] font-semibold text-indigo-600" data-notranslate>
                                +{groups.length - 3} more
                              </span>
                            )}
                          </span>

                          <span data-notranslate className="shrink-0 h-6 px-2 inline-flex items-center rounded-lg bg-slate-100 text-slate-600 text-[11px] font-bold tabular-nums group-hover:bg-indigo-100 group-hover:text-indigo-700 transition-colors">
                            {info.count}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {date && (
              <div className={CARD + ' overflow-hidden'}>
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Events on</p>
                    <p className="font-display text-[17px] font-bold text-slate-900 tracking-[-0.01em] truncate" data-notranslate>{longDate(date)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!monthLoading && (
                      <span data-notranslate className="h-7 px-2.5 inline-flex items-center rounded-lg bg-indigo-50 text-indigo-700 text-[12px] font-bold tabular-nums">
                        {_groups.length} {_groups.length === 1 ? 'Event' : 'Events'}
                      </span>
                    )}
                    <button type="button" onClick={function () { backTo(0) }}
                      className="h-7 px-2.5 rounded-lg text-[12px] font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                      Whole month
                    </button>
                  </div>
                </div>

                {monthLoading && (
                  <div className="p-4 space-y-2.5">
                    {[0, 1, 2].map(function (i) {
                      return <div key={i} className="ambria-skeleton h-[74px] rounded-xl" />
                    })}
                  </div>
                )}

                {!monthLoading && _groups.length === 0 && (
                  <div className="px-4 py-14 text-center">
                    <Icon name="calendar" size={26} className="mx-auto text-slate-300" />
                    <p className="mt-2 text-[13px] font-bold text-slate-600">No functions on this date</p>
                    <p className="mt-0.5 text-[13px] font-medium text-slate-400">Pick another day on the calendar.</p>
                  </div>
                )}

                {!monthLoading && _groups.length > 0 && (
                  <div className="ambria-day-tiles divide-y divide-slate-100 sm:max-h-[min(72vh,660px)] sm:overflow-y-auto ambria-thin-scroll sm:overscroll-contain">
                    {_groups.map(function (g) {
                      var creators = []
                      g.contracts.forEach(function (c) {
                        if (c.created_user_name && creators.indexOf(c.created_user_name) === -1) creators.push(c.created_user_name)
                      })
                      var numbers = g.contracts.filter(function (c) { return c.contract_no })
                      return (
                        <button key={g.key} type="button" onClick={function () { stepIntoGroup(g) }}
                          className="group w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-indigo-50/40 transition-colors">
                          <span className="min-w-0 flex-1 space-y-1.5">
                            <span className="block font-display text-[15px] font-bold text-slate-900 leading-snug truncate">
                              {g.event_name || 'Event'}{g.client_name ? ' — ' + g.client_name : ''}
                            </span>
                            {(g.venue_name || g.session) && (
                              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500">
                                <Icon name="mapPin" size={12} className="shrink-0 text-slate-400" />
                                <span className="min-w-0 truncate">
                                  {g.venue_name || ''}{g.venue_name && g.session ? ' · ' : ''}{g.session || ''}
                                </span>
                              </span>
                            )}
                            <span className="flex flex-wrap items-center gap-1.5">
                              {g.contracts.map(function (c) { return <DeptChip key={c.id} name={c.department} /> })}
                            </span>
                            {(numbers.length > 0 || creators.length > 0) && (
                              <span className="block text-[12px] font-semibold text-slate-400 truncate" data-notranslate>
                                {numbers.map(function (c) { return '#' + c.contract_no }).join(' ')}
                                {numbers.length > 0 && creators.length > 0 ? ' · ' : ''}
                                {creators.length > 0 ? 'by ' + creators.join(', ') : ''}
                              </span>
                            )}
                          </span>
                          <Icon name="chevronRight" size={16}
                            className="shrink-0 mt-1 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Opened from the Events screen, this mounts with an id and nothing
          else — the event itself is still a round trip away. Without this the
          panel is blank for that beat, which reads as "nothing here". */}
      {eventId && !eventDetail && (
        <div className="space-y-4">
          <div className="ambria-skeleton h-[104px] rounded-2xl" />
          <div className="ambria-skeleton h-10 rounded-xl" />
          <div className="ambria-skeleton h-[220px] rounded-2xl" />
        </div>
      )}
      {eventId && detailView}

      {expenseDetailModal}
      {lightbox && (
        <ImageLightbox url={lightbox.url} alt={lightbox.label} onClose={function () { setLightbox(null) }} />
      )}
      {collDetail && (function () {
        var r = collDetail.row
        var wt = r._wt
        var isCancelled = wt.status === 'cancelled'
        var imgUrl = wt.received_image_path
          ? supabase.storage.from('receipts').getPublicUrl(wt.received_image_path).data?.publicUrl
          : null
        var contract = contractByEventId[r.event_id]
        return (
          <div className="fixed inset-0 z-[9998] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={function () { setCollDetail(null) }}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto ambria-thin-scroll overscroll-contain"
              onClick={function (ev) { ev.stopPropagation() }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="inline-flex items-center gap-2 font-display text-[17px] font-bold text-slate-900 tracking-[-0.01em]">
                    <Icon name="wallet" size={16} className="shrink-0 text-indigo-500" />
                    Event Collection
                  </h3>
                  {eventDetail && (
                    <p className="mt-1 text-[13px] text-slate-500 leading-snug">
                      {eventDetail.event_name}{eventDetail.client_name ? ' · ' + eventDetail.client_name : ''}
                      {contract && contract.department ? ' · ' + contract.department : ''}
                    </p>
                  )}
                </div>
                {isCancelled && <span className="shrink-0 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-rose-100 text-rose-700">Cancelled</span>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Amount</div>
                  <div className="text-[15px] font-bold text-slate-900 tabular-nums" data-notranslate>{formatPoints(wt.amount_paise)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Mode</div>
                  <div className="text-[15px] font-bold text-slate-900">{wt.payment_mode || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Collected by</div>
                  <div className="text-[15px] font-bold text-slate-900">{r._collectorName || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Date</div>
                  <div className="text-[15px] font-bold text-slate-900" data-notranslate>{formatDateTime(r.created_at)}</div>
                </div>
                {wt.receipt_no && (
                  <div className="col-span-2">
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Receipt No.</div>
                    <div className="text-[15px] font-bold text-slate-900" data-notranslate>{wt.receipt_no}</div>
                  </div>
                )}
              </div>
              {imgUrl && (
                <button type="button" onClick={function () { setLightbox({ url: imgUrl, label: 'Collection receipt' }) }}
                  className="block w-full rounded-xl border border-slate-200 overflow-hidden hover:border-indigo-300 transition-colors">
                  <img src={imgUrl} alt="Receipt" className="w-full" />
                </button>
              )}
              {(wt.checked_by || canMarkChecked) && (
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <span className="text-[12px] font-semibold text-slate-500">Finance check</span>
                  <CheckedStamp
                    variant="stamp"
                    checked={!!wt.checked_by}
                    checkedAt={wt.checked_at}
                    canToggle={canMarkChecked}
                    canUncheck={wt.checked_by === profile?.id || isSysAdmin}
                    busy={checkingTxnId === r.reference_id}
                    onToggle={function () { toggleCollectionCheck(r.reference_id) }}
                  />
                </div>
              )}
              <button type="button" onClick={function () { setCollDetail(null) }}
                className="w-full h-11 rounded-xl text-[13px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors">
                Close
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default EventLedger
