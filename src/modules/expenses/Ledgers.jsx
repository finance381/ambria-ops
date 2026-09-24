import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate, formatDateTime } from '../../lib/format'
import { pushBack } from '../../lib/backNav'
import { registerPdfFont } from '../../lib/pdfFont'
import { openOrSharePdf } from '../../lib/pdfOutput'
import { plainParticularsLines, plainDateLines, makeStatementCellHooks } from '../../lib/pdfStatementTable'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { useExpenseDetailModal } from '../../hooks/useExpenseDetailModal.jsx'
import SearchField from '../../components/ui/SearchField'
import Icon, { glyphForLabel } from '../../components/ui/Icon'
import ledgerBg from '../../assets/ledger-bg.webp'
import CheckedStamp from '../../components/ui/CheckedStamp'

var STATUS_LABELS = { recorded: 'Recorded', flagged: 'Resubmit', acknowledged: 'Acknowledged', deducted: 'Deducted' }

// One template for the header and all three levels of row. It was written out
// four times, which is four chances for a column to stop lining up with its own
// heading.
//
// The money columns have to hold the figure AND its unit, which is what they
// were last sized without: "1,08,919.65" is about 95px at 12.5px in tabular
// figures, and the unit slot and its gap add another 38. At 104px the content
// was wider than its own track, so it overflowed into the column beside it and
// pushed Net Total off the end of the row.
// Six columns want 764px before the department name gets anything, which is
// more than twice a phone. Scrolling them sideways worked but made the table
// the one thing on the page you had to drag — so below sm it is two columns,
// the name and the net total, and the three it is made of go on a line under
// the name instead. The drill-down into type and sub-type still opens.
var COLS = 'grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1fr)_140px_140px_140px_150px_44px] gap-2'
var COL_SM = 'hidden sm:flex'
// For cells that are only text: sm:flex would make them flex containers and
// text-right would stop reaching the text inside them.
var COL_SM_TXT = 'hidden sm:block'

// A figure in the colour of its own meaning: settled, waiting, credited, and
// the answer. The colour is on the number and nowhere else — a filled pill
// behind every figure turns four columns into a wall of tinted blocks, and the
// only part that differs between them, the number, then has to compete with
// its own background to be read.
// The figure and its unit in two columns, not one string.
//
// "pts" after every number is the same three characters on every row, and
// baked into the string it was pushing each figure left by however wide its
// own number happened to be — so the units ran in a ragged line down the
// column and the numbers ended wherever that left them.
//
// The unit gets a fixed slot at the right of the cell and the number ranges
// right against it. Both edges are then straight: every "pts" starts on one
// line, every figure ends on another.
//
// The unit takes the figure's colour — it belongs to that number, and in grey
// it read as page furniture that happened to sit in the column. It stays a size
// down and a weight down, so the pair still resolves to the figure first.
function Money({ paise, tone, bold, dashWhenZero, cls }) {
  var dash = paise == null || (dashWhenZero && !paise)
  var colour = dash ? 'text-slate-300' : tone
  return (
    /* Ranged right, with the heading above it ranged the same way. Centring put
       each figure under the middle of its own title but left the column itself
       ragged on both sides — and a money column is read down, not across, so
       the edge the figures share matters more than the one they share with the
       word above them. */
    <span className={(cls || 'flex') + " items-baseline justify-end gap-2 whitespace-nowrap"} data-notranslate>
      <span className={"text-[12.5px] tabular-nums " + (bold ? "font-bold " : "font-semibold ") + colour}>
        {dash ? '—' : formatPointsPlain(paise)}
      </span>
      {/* No fixed slot. It is the same three characters in every cell, so its
          width is already constant — reserving more than it needs just left a
          gap between it and the cell's right edge, which the headings above run
          all the way to. Ending where they end is what lines the two up. */}
      <span className={"shrink-0 text-[11.5px] font-medium " + colour}>pts</span>
    </span>
  )
}

// formatPoints without its unit, since Money prints that separately.
function formatPointsPlain(paise) {
  var neg = paise < 0
  var abs = Math.abs(paise)
  var whole = Math.floor(abs / 100)
  var frac = abs % 100
  return (neg ? '−' : '') + whole.toLocaleString('en-IN') +
    (frac ? '.' + String(frac).padStart(2, '0') : '')
}

var TONES = {
  committed: 'text-emerald-700',
  pending:   'text-amber-700',
  credit:    'text-rose-700',
  total:     'text-slate-900',
}

// The per-row export. Three of them, one per level.
//
// Neutral, like the two in the toolbar. Opening a PDF is not destructive, and
// a column of red down the right-hand edge of a table reads as a column of
// warnings — which was the loudest thing on a screen whose job is figures.
// Both of these sit in the same box — a width and a right margin the heading
// and the button agree on — so the column has one edge instead of the heading
// keeping its own padding and the button its own margin.
// Back to the artwork as it was first converted: the whole picture at blur
// radius 10, not the flat strip of floor at radius 25 scaled six times up the
// screen. The wall-and-floor edge inside it comes back with it — that is the
// trade for keeping the composition and the lighter blur.
//
// A flat tone, not a gradient continuing the artwork's last row.
//
// That technique suits the wallet and the vendor ledger because their
// pictures end on something calm. This one ends on foliage at the left, so
// continuing it drew that dark olive — #75715F at the 0% stop — down the
// whole page below the image, which was a band across the foot.
//
// The value is the average of the image's own last rows, so a sliver of it
// continues the picture rather than interrupting it.
var LEDGER_BG_FOOT = '#C6B9A8'

// The ground behind the phone ledger. The artwork covers the whole screen
// rather than sitting at the top with a colour under it.
//
// Height is 100lvh, not 100% of a fixed box. The wallet's backdrop avoids
// cover for a reason its own comment records: a fixed element is as tall as
// the viewport, the viewport changes height every time the address bar slides
// away, and cover rescales the image each time — which reads as the
// background zooming while you scroll. lvh is the height with the browser
// chrome retracted and does not move, so the image is sized once.
//
// The flat tone stays behind it for the moment before the file lands, and for
// the sliver below 100lvh when the bar is showing.
//
// Nothing on the desktop. This is one tab of eight in the hub, and a ground
// on one of them would make it look like a different section.
function LedgerBackdrop({ inAdmin }) {
  // The backdrop is fixed, so it stops at the edge of the viewport — and
  // dragging past the end of the page shows what is behind it, which is the
  // body's own canvas colour. That is the white band at the foot. The body
  // takes the artwork's tone while this screen is up and gives it back on the
  // way out, so overscrolling reveals more of the same ground rather than a
  // different page.
  useEffect(function () {
    if (inAdmin) return
    var b = document.body
    var prevBg = b.style.backgroundColor
    var prevOver = b.style.overscrollBehaviorY
    b.style.backgroundColor = LEDGER_BG_FOOT
    // Colouring the body stopped the band being white, but a flat strip under
    // a blurred photograph still reads as the page ending twice. none takes
    // the rubber-band away, so there is nothing past the end to reveal.
    b.style.overscrollBehaviorY = 'none'
    return function () {
      b.style.backgroundColor = prevBg
      b.style.overscrollBehaviorY = prevOver
    }
  }, [inAdmin])

  if (inAdmin) return null
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ backgroundColor: LEDGER_BG_FOOT }}>
      {/* inset-0 and 100% 100%: the image is drawn to exactly this box,
          whatever the box measures. cover kept its own proportions and so
          left the flat tone showing wherever the two did not agree, which is
          the line across the foot — and the tone could never match the
          picture everywhere, because the picture is not one colour.
          Stretched, there is nothing for it to meet.

          Distortion is the price and it is not visible here: the file is
          blurred, so there is no edge left in it whose proportions a reader
          could check. That is also why rescaling as the address bar slides
          does not show — the wallet's backdrop avoids cover for that reason,
          but its artwork has detail to see moving and this one has none. */}
      <div className="absolute inset-0"
        style={{
          backgroundColor: LEDGER_BG_FOOT,
          backgroundImage: 'url(' + ledgerBg + ')',
          backgroundSize: '100% 100%',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }} />

      {/* The heading sits straight on the photograph, and under it the ground
          runs from luminance 82 to 242 — a swing of 160. The letters were
          never the problem; a serif this fine loses its hairlines wherever
          the ground happens to go dark, so the word breaks up in patches
          rather than reading evenly.

          A wash of the artwork's own light tone mixes toward one value, and
          mixing toward one value is what closes a spread: at 0.72 the 160
          becomes about 45. It fades out before the first card, so there is no
          edge anywhere for it to read as a band — which is what an opaque
          strip across the top would have been. */}
      <div className="absolute inset-x-0 top-0 h-[34%] sm:hidden"
        style={{ backgroundImage: 'linear-gradient(to bottom, rgba(240,234,218,0.72) 0%, rgba(240,234,218,0.55) 34%, rgba(240,234,218,0) 100%)' }} />
    </div>
  )
}

var SELECT_FIELD = 'h-11 pl-9 pr-8 w-full bg-white border border-slate-200 rounded-xl text-[12.5px] text-slate-700 appearance-none hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150'

var EXPORT_COL = 'shrink-0 w-[74px] mr-3'
var PDF_BTN = EXPORT_COL + ' self-center h-7 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-[11.5px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40 transition-all duration-150'
var STATUS_COLORS = {
  recorded: 'bg-amber-100 text-amber-700',
  flagged: 'bg-orange-100 text-orange-700',
  acknowledged: 'bg-green-100 text-green-700',
  deducted: 'bg-indigo-100 text-indigo-700',
}
var PAGE_SIZE = 50

var SUB_MODE_LABEL = { upi: 'UPI', bank_transfer: 'Bank Transfer', cheque: 'Cheque', paytm_card_machine: 'Paytm Card', hdfc_card_machine: 'HDFC Card' }

function _paymentLabel(mode, subMode) {
  if (!mode) return '—'
  if (mode === 'cash') return 'Cash'
  return 'Bank' + (subMode ? ' · ' + (SUB_MODE_LABEL[subMode] || subMode) : '')
}

var SOURCE_BADGES = {
  allocation: { label: 'Allocation', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  auto_default: { label: 'No alloc', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  cost_transfer: { label: 'Transfer', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
}

function fmtISO(d) { return d.toISOString().split('T')[0] }

function getPresetRange(preset) {
  var d = new Date()
  if (preset === 'month') return { from: fmtISO(new Date(d.getFullYear(), d.getMonth(), 1)), to: fmtISO(d) }
  if (preset === 'lastMonth') return { from: fmtISO(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: fmtISO(new Date(d.getFullYear(), d.getMonth(), 0)) }
  if (preset === 'ytd') return { from: fmtISO(new Date(d.getFullYear(), 0, 1)), to: fmtISO(d) }
  return null
}

function Ledgers({ profile, onNavigateToExpenses, inAdmin }) {
  var isAdmin = hasPerm(profile?.permsNew, 'finance.ledgers.expense')
  var isSysAdmin = hasPerm(profile?.permsNew, 'admin.dashboard')
  var canMarkChecked = hasPerm(profile?.permsNew, 'finance.wallet.mark_checked')
  var [checkingExpId, setCheckingExpId] = useState(null)
  var scopeDeptIds = isAdmin ? null : (profile?.event_dept_ids || [])
  var hasScope = !isAdmin && scopeDeptIds && scopeDeptIds.length > 0
  var { openExpenseDetail, expenseDetailModal } = useExpenseDetailModal(profile, isAdmin, function () { loadDrill(false) }, onNavigateToExpenses)

  // Date state
  var [datePreset, setDatePreset] = useState('month')
  var [dateFrom, setDateFrom] = useState(function () { return getPresetRange('month').from })
  var [dateTo, setDateTo] = useState(function () { return getPresetRange('month').to })

  // Filters
  var [search, setSearch] = useState('')
  var [searchDeb, setSearchDeb] = useState('')
  var [userFilter, setUserFilter] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [statusFilter, setStatusFilter] = useState('')
  var [pendingOnly, setPendingOnly] = useState(false)
  // The three dropdowns and the toggle go behind a button. Out on the bar they
  // were four controls reading "All …" taking most of the row to say that
  // nothing was narrowed — the same trade the vendor and inventory ledgers
  // already made. The button carries the count, so a closed panel still says
  // how many are on; otherwise hiding them hides the fact that the list is not
  // showing everything.
  var [filtersOpen, setFiltersOpen] = useState(false)
  var [pdfBusy, setPdfBusy] = useState(false)

  // Master maps
  var [deptMap, setDeptMap] = useState({})
  var [userMap, setUserMap] = useState({})
  var [users, setUsers] = useState([])
  var refData = useReferenceData()
  var typeMap = useMemo(function () {
    var m = {}; refData.expenseTypes.forEach(function (t) { m[t.id] = t.name }); return m
  }, [refData.expenseTypes])
  var subTypeMap = useMemo(function () {
    var m = {}; refData.expenseSubTypes.forEach(function (s) { m[s.id] = s.name }); return m
  }, [refData.expenseSubTypes])
  var venueMap = useMemo(function () {
    var m = {}; refData.venues.forEach(function (v) { m[v.id] = v.name || v.code }); return m
  }, [refData.venues])
  var venues = useMemo(function () {
    return refData.venues.slice().sort(function (a, b) { return (a.name || a.code || '').localeCompare(b.name || b.code || '') })
  }, [refData.venues])

  // List state
  var [deptGroups, setDeptGroups] = useState([])
  var [totals, setTotals] = useState({ total: 0, pending: 0, committed: 0, credit: 0, allocs: 0 })
  var [loading, setLoading] = useState(false)
  var [collapsedDepts, setCollapsedDepts] = useState({})
  var [collapsedTypes, setCollapsedTypes] = useState({})
  var collapseInitializedRef = useRef(false)
  // The filter block is sticky, so a row scrolled to the top of the window
  // lands underneath it. Its height is not a constant — the toolbar wraps on a
  // narrow window and the custom-range fields appear and disappear — so it is
  // measured at the moment it is needed rather than written down anywhere.
  var stickyRef = useRef(null)
  var [deptDelta, setDeptDelta] = useState({})
  var allocSnapshot = useRef({})
  var isFirstLoad = useRef(true)

  // Drill state
  var [drillGroup, setDrillGroup] = useState(null)
  var [drillRows, setDrillRows] = useState([])
  var [drillOffset, setDrillOffset] = useState(0)
  var [drillHasMore, setDrillHasMore] = useState(false)
  var [drillLoading, setDrillLoading] = useState(false)
  var [drillUserFilter, setDrillUserFilter] = useState('')
  var [drillStatusFilter, setDrillStatusFilter] = useState('')
  var [drillVenueFilter, setDrillVenueFilter] = useState('')

  var reloadTimer = useRef(null)

  useEffect(function () { loadMaps() }, [])

  useEffect(function () {
    var t = setTimeout(function () { setSearchDeb(search) }, 300)
    return function () { clearTimeout(t) }
  }, [search])

  useEffect(function () {
    isFirstLoad.current = true
    loadLedger()
  }, [dateFrom, dateTo, userFilter, venueFilter, statusFilter, (scopeDeptIds || []).join(',')])

  useEffect(function () {
    if (drillGroup) { setDrillOffset(0); loadDrill(false) }
  }, [drillGroup, drillUserFilter, drillStatusFilter, drillVenueFilter, dateFrom, dateTo])

  useEffect(function () {
    function schedule() {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(function () {
        loadLedger()
        if (drillGroup) { setDrillOffset(0); loadDrill(false) }
      }, 800)
    }
    var channel = supabase.channel('ledgers-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_allocations' }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'expenses' }, schedule)
      .subscribe()
    return function () {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      supabase.removeChannel(channel)
    }
  }, [dateFrom, dateTo, userFilter, venueFilter, statusFilter, drillGroup])

  async function loadMaps() {
    var res = await Promise.all([
      supabase.from('departments').select('id, name'),
      supabase.from('profiles').select('id, name'),
    ])
    var dm = {}; (res[0].data || []).forEach(function (d) { dm[d.id] = d.name })
    var um = {}; (res[1].data || []).forEach(function (u) { um[u.id] = u.name })
    setDeptMap(dm); setUserMap(um)
    setUsers((res[1].data || []).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') }))
  }

  async function loadLedger() {
    setLoading(true)
    var statusIn = statusFilter ? [statusFilter] : ['recorded', 'flagged', 'acknowledged', 'deducted']
    var rows = []; var from = 0; var pageSize = 1000
    while (true) {
      var q = supabase.from('v_ledger')
        .select('department_id, expense_type_id, expense_sub_type_id, amount_paise, pending_paise, committed_paise')
        .in('status', statusIn)
        .gte('expense_date', dateFrom)
        .lte('expense_date', dateTo)
        .range(from, from + pageSize - 1)
      if (hasScope) q = q.in('department_id', scopeDeptIds)
      if (userFilter) q = q.eq('user_id', userFilter)
      if (venueFilter) q = q.eq('venue_id', Number(venueFilter))
      var page = await q
      if (page.error) { alert('Load failed: ' + page.error.message); setLoading(false); return }
      var chunk = page.data || []
      rows = rows.concat(chunk)
      if (chunk.length < pageSize) break
      from += pageSize
      if (from > 50000) break
    }

    var byDept = {}
    var total = 0, pending = 0, committed = 0, credit = 0
    rows.forEach(function (r) {
      var deptKey = r.department_id != null ? String(r.department_id) : '__unassigned__'
      var typeKey = r.expense_type_id != null ? String(r.expense_type_id) : '__untyped__'
      var subKey = r.expense_sub_type_id != null ? String(r.expense_sub_type_id) : '__no_sub__'
      // Cost-transfer-out rows come through with a negative amount_paise (see v_ledger) —
      // those are credits against this dept/type/sub-type, not debits. Everything else
      // (real expense allocations + cost-transfer-in) is a debit, split acknowledged/pending.
      var isCredit = (r.amount_paise || 0) < 0
      if (!byDept[deptKey]) {
        byDept[deptKey] = { key: deptKey, deptId: r.department_id, total: 0, pending: 0, committed: 0, credit: 0, allocs: 0, typeMap: {} }
      }
      var g = byDept[deptKey]
      g.total += r.amount_paise || 0
      if (isCredit) { g.credit += -(r.amount_paise || 0) } else { g.pending += r.pending_paise || 0; g.committed += r.committed_paise || 0 }
      g.allocs += 1
      if (!g.typeMap[typeKey]) {
        g.typeMap[typeKey] = { typeKey: typeKey, typeId: r.expense_type_id, total: 0, pending: 0, committed: 0, credit: 0, allocs: 0, subMap: {} }
      }
      var t = g.typeMap[typeKey]
      t.total += r.amount_paise || 0
      if (isCredit) { t.credit += -(r.amount_paise || 0) } else { t.pending += r.pending_paise || 0; t.committed += r.committed_paise || 0 }
      t.allocs += 1
      if (!t.subMap[subKey]) {
        t.subMap[subKey] = { typeId: r.expense_type_id, subTypeId: r.expense_sub_type_id, total: 0, pending: 0, committed: 0, credit: 0, allocs: 0 }
      }
      var s = t.subMap[subKey]
      s.total += r.amount_paise || 0
      if (isCredit) { s.credit += -(r.amount_paise || 0) } else { s.pending += r.pending_paise || 0; s.committed += r.committed_paise || 0 }
      s.allocs += 1
      total += r.amount_paise || 0
      if (isCredit) { credit += -(r.amount_paise || 0) } else { pending += r.pending_paise || 0; committed += r.committed_paise || 0 }
    })
    var groups = Object.values(byDept).map(function (g) {
      var typeGroups = Object.values(g.typeMap).map(function (t) {
        var subRows = Object.values(t.subMap).sort(function (a, b) { return b.total - a.total })
        return { typeKey: t.typeKey, typeId: t.typeId, total: t.total, pending: t.pending, committed: t.committed, credit: t.credit, allocs: t.allocs, subRows: subRows }
      }).sort(function (a, b) { return b.total - a.total })
      return { key: g.key, deptId: g.deptId, total: g.total, pending: g.pending, committed: g.committed, credit: g.credit, allocs: g.allocs, typeGroups: typeGroups }
    })
    groups.sort(function (a, b) { return b.total - a.total })

    // Delta tracking
    var newDeltas = {}
    if (isFirstLoad.current) {
      var snap = {}
      groups.forEach(function (g) { snap[g.key] = g.allocs })
      allocSnapshot.current = snap
      isFirstLoad.current = false
    } else {
      groups.forEach(function (g) {
        var prev = allocSnapshot.current[g.key] || 0
        if (g.allocs > prev) newDeltas[g.key] = g.allocs - prev
      })
    }
    setDeptDelta(newDeltas)
    setDeptGroups(groups)
    setTotals({ total: total, pending: pending, committed: committed, credit: credit, allocs: rows.length })
    // On first load only, default all dept groups to collapsed.
    if (!collapseInitializedRef.current && groups.length > 0) {
      var allDeptCollapsed = {}
      var allTypeCollapsed = {}
      groups.forEach(function (g) {
        allDeptCollapsed[g.key] = true
        g.typeGroups.forEach(function (t) { allTypeCollapsed[g.key + '|' + t.typeKey] = true })
      })
      setCollapsedDepts(allDeptCollapsed)
      setCollapsedTypes(allTypeCollapsed)
      collapseInitializedRef.current = true
    }
    setLoading(false)
  }

  // Fetch individual alloc rows enriched with vendor + payment info. Used by PDF exports.
  // filter: { deptId?, typeId?, subTypeId? } — nulls treated as .is('...', null); undefined = no constraint on that col.
  async function fetchAllocDetail(filter) {
    var statusIn = statusFilter ? [statusFilter] : ['recorded', 'flagged', 'acknowledged', 'deducted']
    var rows = []; var from = 0; var pageSize = 1000
    while (true) {
      var q = supabase.from('v_ledger')
        .select('allocation_id, expense_id, department_id, expense_type_id, expense_sub_type_id, user_id, venue_id, amount_paise, pending_paise, committed_paise, remarks, expense_date, description, status, created_at, source')
        .in('status', statusIn)
        .gte('expense_date', dateFrom)
        .lte('expense_date', dateTo)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1)
      if (hasScope) q = q.in('department_id', scopeDeptIds)
      if (userFilter) q = q.eq('user_id', userFilter)
      if (venueFilter) q = q.eq('venue_id', Number(venueFilter))
      if (filter) {
        if (filter.deptId !== undefined) { if (filter.deptId === null) q = q.is('department_id', null); else q = q.eq('department_id', filter.deptId) }
        if (filter.typeId !== undefined) { if (filter.typeId === null) q = q.is('expense_type_id', null); else q = q.eq('expense_type_id', filter.typeId) }
        if (filter.subTypeId !== undefined) { if (filter.subTypeId === null) q = q.is('expense_sub_type_id', null); else q = q.eq('expense_sub_type_id', filter.subTypeId) }
      }
      var page = await q
      if (page.error) throw new Error(page.error.message)
      var chunk = page.data || []
      rows = rows.concat(chunk)
      if (chunk.length < pageSize) break
      from += pageSize
      if (from > 50000) break
    }
    if (pendingOnly) rows = rows.filter(function (r) { return (r.pending_paise || 0) > 0 })

    // Batch-fetch expenses meta (vendor_id, payment_mode, payment_sub_mode) for each expense_id
    var expenseIds = {}
    rows.forEach(function (r) { if (r.expense_id != null) expenseIds[r.expense_id] = true })
    var eIdList = Object.keys(expenseIds).map(Number)
    var expMap = {}
    var CHUNK = 500
    for (var i = 0; i < eIdList.length; i += CHUNK) {
      var eChunk = eIdList.slice(i, i + CHUNK)
      var eRes = await supabase.from('expenses').select('id, vendor_id, payment_mode, payment_sub_mode').in('id', eChunk)
      ;(eRes.data || []).forEach(function (e) { expMap[e.id] = e })
    }
    // Batch-fetch vendor names
    var vendorIds = {}
    Object.values(expMap).forEach(function (e) { if (e.vendor_id != null) vendorIds[e.vendor_id] = true })
    var vIdList = Object.keys(vendorIds).map(Number)
    var vMap = {}
    for (var j = 0; j < vIdList.length; j += CHUNK) {
      var vChunk = vIdList.slice(j, j + CHUNK)
      var vRes = await supabase.from('vendors').select('id, name').in('id', vChunk)
      ;(vRes.data || []).forEach(function (v) { vMap[v.id] = v.name })
    }
    // Merge
    return rows.map(function (r) {
      var e = expMap[r.expense_id] || {}
      return Object.assign({}, r, {
        _vendorName: e.vendor_id ? (vMap[e.vendor_id] || ('#' + e.vendor_id)) : '—',
        _paymentMode: e.payment_mode || null,
        _paymentSubMode: e.payment_sub_mode || null,
      })
    })
  }

  async function loadDrill(append) {
    if (!drillGroup) return
    setDrillLoading(true)
    var offset = append ? drillOffset : 0
    var q = supabase.from('v_ledger')
      .select('allocation_id, expense_id, user_id, venue_id, amount_paise, remarks, expense_date, description, status, created_at, source')
      .in('status', ['recorded', 'flagged', 'acknowledged', 'deducted'])
      .gte('expense_date', dateFrom)
      .lte('expense_date', dateTo)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE)
    if (drillGroup.deptId) q = q.eq('department_id', drillGroup.deptId)
    else q = q.is('department_id', null)
    if (drillGroup.typeId) q = q.eq('expense_type_id', drillGroup.typeId)
    else q = q.is('expense_type_id', null)
    if (drillGroup.subTypeId) q = q.eq('expense_sub_type_id', drillGroup.subTypeId)
    else q = q.is('expense_sub_type_id', null)
    if (drillUserFilter) q = q.eq('user_id', drillUserFilter)
    if (drillStatusFilter) q = q.eq('status', drillStatusFilter)
    if (drillVenueFilter) q = q.eq('venue_id', Number(drillVenueFilter))

    var { data, error } = await q
    if (error) { alert('Drill load failed: ' + error.message); setDrillLoading(false); return }
    var rows = data || []
    var hasMore = rows.length > PAGE_SIZE
    if (hasMore) rows = rows.slice(0, PAGE_SIZE)

    // v_ledger doesn't expose expenses.checked_by/checked_at either — same
    // follow-up pattern as the metadata fetch below, kept separate since this
    // one always runs (not gated on the sub-type having extra fields).
    if (rows.length > 0) {
      var checkIds = Array.from(new Set(rows.map(function (r) { return r.expense_id }).filter(function (v) { return v != null })))
      var checkRes = await supabase.from('expenses').select('id, checked_by, checked_at').in('id', checkIds)
      var checkMap = {}
      ;(checkRes.data || []).forEach(function (e) { checkMap[e.id] = e })
      rows = rows.map(function (r) {
        var c = checkMap[r.expense_id]
        return Object.assign({}, r, { _checkedBy: c ? c.checked_by : null, _checkedAt: c ? c.checked_at : null })
      })
    }

    // Enrich with this sub-type's custom field values (e.g. which employee a
    // salary-type expense was paid to) — v_ledger doesn't expose expenses.metadata.
    var subType = drillGroup.subTypeId ? refData.expenseSubTypes.find(function (s) { return s.id === drillGroup.subTypeId }) : null
    var extraFields = (subType && subType.extra_fields) || []
    if (extraFields.length > 0 && rows.length > 0) {
      var eIds = Array.from(new Set(rows.map(function (r) { return r.expense_id }).filter(function (v) { return v != null })))
      var metaRes = await supabase.from('expenses').select('id, metadata').in('id', eIds)
      var metaMap = {}
      ;(metaRes.data || []).forEach(function (e) { metaMap[e.id] = e.metadata || {} })

      // job_departments/venues are already preloaded in refData; vendors aren't.
      var vendorLookupFields = extraFields.filter(function (f) { return f.type === 'lookup' && f.source === 'vendors' })
      var vendorMap = {}
      if (vendorLookupFields.length > 0) {
        var vendorIds = new Set()
        rows.forEach(function (r) {
          var meta = metaMap[r.expense_id] || {}
          vendorLookupFields.forEach(function (f) { if (meta[f.key]) vendorIds.add(meta[f.key]) })
        })
        if (vendorIds.size > 0) {
          var vRes = await supabase.from('vendors').select('id, name').in('id', Array.from(vendorIds))
          ;(vRes.data || []).forEach(function (v) { vendorMap[v.id] = v.name })
        }
      }

      var resolveField = function (field, rawValue) {
        if (rawValue == null || rawValue === '') return null
        if (field.type === 'lookup') {
          if (field.source === 'job_departments') {
            var emp = refData.employees.find(function (e) { return String(e.id) === String(rawValue) })
            return emp ? emp.full_name : ('#' + rawValue)
          }
          if (field.source === 'venues') {
            var ven = refData.venues.find(function (v) { return String(v.id) === String(rawValue) })
            return ven ? (ven.name || ven.code) : ('#' + rawValue)
          }
          if (field.source === 'vendors') return vendorMap[rawValue] || ('#' + rawValue)
        }
        var str = String(rawValue)
        // A plain ISO day, and nothing else: a value that merely starts with
        // one — a reference, a code — is left exactly as it was entered.
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
          var d = formatDate(str)
          if (d) return d
        }
        return str
      }

      rows = rows.map(function (r) {
        var meta = metaMap[r.expense_id] || {}
        var chips = extraFields.map(function (f) {
          var resolved = resolveField(f, meta[f.key])
          return resolved ? { label: f.label, value: resolved } : null
        }).filter(Boolean)
        return Object.assign({}, r, { _fieldChips: chips })
      })
    }

    if (append) setDrillRows(function (prev) { return prev.concat(rows) })
    else setDrillRows(rows)
    setDrillHasMore(hasMore)
    setDrillOffset(offset + rows.length)
    setDrillLoading(false)
  }

  async function toggleExpenseCheck(expenseId) {
    if (checkingExpId) return
    setCheckingExpId(expenseId)
    var { data, error } = await supabase.rpc('fn_toggle_expense_check', { p_expense_id: expenseId })
    setCheckingExpId(null)
    if (error) { alert('Could not update: ' + error.message); return }
    var nowChecked = !!data
    setDrillRows(function (prev) { return prev.map(function (r) {
      if (r.expense_id !== expenseId) return r
      return Object.assign({}, r, {
        _checkedBy: nowChecked ? profile.id : null,
        _checkedAt: nowChecked ? new Date().toISOString() : null,
      })
    }) })
  }

  function openRow(g, r) {
    var deptName = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
    var typeName = r.typeId ? (typeMap[r.typeId] || 'Untyped') : 'Untyped'
    var subTypeName = r.subTypeId ? (subTypeMap[r.subTypeId] || '—') : '—'
    pushBack(function () { setDrillGroup(null); setDrillRows([]); setDrillOffset(0); setDrillUserFilter(''); setDrillStatusFilter(''); setDrillVenueFilter('') })
    setDrillGroup({
      deptId: g.deptId, typeId: r.typeId, subTypeId: r.subTypeId,
      deptName: deptName, typeName: typeName, subTypeName: subTypeName,
      total: r.total, pending: r.pending, committed: r.committed
    })
  }

  function closeDrill() {
    setDrillGroup(null); setDrillRows([]); setDrillOffset(0)
    setDrillUserFilter(''); setDrillStatusFilter(''); setDrillVenueFilter('')
  }

  // Opening a department brings it to the top of the window.
  //
  // A department a few rows down opens downwards, so everything it just
  // revealed is below the fold — you press it and then go looking for what you
  // pressed it for. Moving the row up puts its contents on the screen that
  // asked for them.
  //
  // Only on the way open: collapsing already brings the rows below it up, and
  // scrolling then would move the page under somebody who was reading it.
  function toggleDept(deptKey, currentAllocs, rowEl) {
    var opening = !!collapsedDepts[deptKey]
    setCollapsedDepts(function (prev) {
      var next = Object.assign({}, prev)
      next[deptKey] = !prev[deptKey]
      return next
    })
    if (opening && rowEl) {
      // scroll-margin-top and scrollIntoView, rather than working out a target
      // and calling scrollTo. Two things are pinned above this row — the
      // shell's bar and this screen's filter block — and only one of them is a
      // number this component can measure. Handing the browser a calc that
      // names the other lets it resolve both, and find the right scroller while
      // it is at it.
      var sticky = stickyRef.current ? stickyRef.current.offsetHeight : 0
      rowEl.style.scrollMarginTop = 'calc(var(--app-header-h, 0px) + ' + (sticky + 8) + 'px)'
      rowEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    allocSnapshot.current[deptKey] = currentAllocs
    setDeptDelta(function (prev) {
      var next = Object.assign({}, prev)
      delete next[deptKey]
      return next
    })
  }

  function toggleType(deptKey, typeKey) {
    var key = deptKey + '|' + typeKey
    setCollapsedTypes(function (prev) {
      var next = Object.assign({}, prev)
      next[key] = !prev[key]
      return next
    })
  }

  function applyPreset(preset) {
    setDatePreset(preset)
    if (preset === 'custom') return
    var r = getPresetRange(preset)
    if (r) { setDateFrom(r.from); setDateTo(r.to) }
  }

  function exportListCSV() {
    if (!deptGroups.length) return
    function esc(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    var lines = ['Department,Type,Sub-Type,Net Total (pts),Debits Acknowledged (pts),Debits Pending (pts),Credit (pts),Allocations']
    deptGroups.forEach(function (g) {
      var d = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
      lines.push(esc(d) + ' (subtotal),,,' + (g.total / 100) + ',' + (g.committed / 100) + ',' + (g.pending / 100) + ',' + (g.credit / 100) + ',' + g.allocs)
      g.typeGroups.forEach(function (t) {
        var tn = t.typeId ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
        lines.push(esc(d) + ',' + esc(tn) + ' (subtotal),,' + (t.total / 100) + ',' + (t.committed / 100) + ',' + (t.pending / 100) + ',' + (t.credit / 100) + ',' + t.allocs)
        t.subRows.forEach(function (r) {
          var s = r.subTypeId ? (subTypeMap[r.subTypeId] || '—') : '—'
          lines.push(esc(d) + ',' + esc(tn) + ',' + esc(s) + ',' + (r.total / 100) + ',' + (r.committed / 100) + ',' + (r.pending / 100) + ',' + (r.credit / 100) + ',' + r.allocs)
        })
      })
    })
    var csv = '\uFEFF' + lines.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ledgers_' + dateFrom + '_' + dateTo + '.csv'; a.click()
  }

  // Shared PDF setup: creates doc, prints header + filter line. Returns { doc, FONT, pageW, pageH, startY, autoTable }.
  async function _pdfSetup(title) {
    var jsPDFmod = await import('jspdf')
    var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
    var autoTableMod = await import('jspdf-autotable')
    var autoTable = autoTableMod.default || autoTableMod
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    var pageW = doc.internal.pageSize.getWidth()
    var pageH = doc.internal.pageSize.getHeight()
    var fontOk = await registerPdfFont(doc)
    var FONT = fontOk ? 'NotoSans' : 'helvetica'
    doc.setFont(FONT, 'bold'); doc.setFontSize(13)
    doc.text(title, 14, 14)
    doc.setFont(FONT, 'normal'); doc.setFontSize(8)
    doc.text('Generated: ' + new Date().toLocaleString('en-IN'), pageW - 14, 14, { align: 'right' })
    var fParts = []
    if (dateFrom || dateTo) fParts.push('Period: ' + (dateFrom || '…') + ' to ' + (dateTo || '…'))
    if (userFilter) { var u = users.find(function (x) { return String(x.id) === String(userFilter) }); fParts.push('User: ' + (u ? u.name : userFilter)) }
    if (venueFilter) { var v = venues.find(function (x) { return String(x.id) === String(venueFilter) }); fParts.push('Venue: ' + (v ? (v.name || v.code) : venueFilter)) }
    if (statusFilter) fParts.push('Status: ' + statusFilter)
    if (pendingOnly) fParts.push('Pending only')
    if (searchDeb) fParts.push('Search: "' + searchDeb + '"')
    doc.setFontSize(7); doc.setTextColor(80)
    doc.text(fParts.length ? 'Filters: ' + fParts.join('  ·  ') : 'Filters: none', 14, 19, { maxWidth: pageW - 28 })
    doc.setTextColor(0)
    return { doc: doc, FONT: FONT, pageW: pageW, pageH: pageH, startY: fParts.length ? 24 : 22, autoTable: autoTable }
  }

  function _fmtPts(paise) { return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) }

  // Renders one alloc-detail table section starting at nextY. Returns new Y after the table.
  function _renderAllocSection(ctx, title, allocs) {
    var doc = ctx.doc, FONT = ctx.FONT, autoTable = ctx.autoTable, pageW = ctx.pageW, pageH = ctx.pageH
    var subCommitted = 0, subPending = 0, subTotal = 0
    var dateMeta = []
    var particularsMeta = []
    var body = allocs.map(function (a) {
      subCommitted += (a.committed_paise || 0); subPending += (a.pending_paise || 0); subTotal += (a.amount_paise || 0)
      var uName = userMap[a.user_id] || '—'
      var vName = venueMap[a.venue_id] || '—'

      var pLines = [{ kind: 'desc', text: a.description || a.remarks || '—' }]
      var chipParts = []
      if (a._vendorName && a._vendorName !== '—') chipParts.push('Vendor: ' + a._vendorName)
      var payLabel = _paymentLabel(a._paymentMode, a._paymentSubMode)
      if (payLabel !== '—') chipParts.push(payLabel)
      if (chipParts.length) pLines.push({ kind: 'chip', text: chipParts.join('   ·   ') })
      if (a.status && a.status !== 'recorded') pLines.push({ kind: 'status', text: STATUS_LABELS[a.status] || a.status })
      particularsMeta.push(pLines)

      var dm = { top: a.expense_date ? formatDate(a.expense_date) : '—', bottom: a.created_at ? formatDateTime(a.created_at) : '' }
      dateMeta.push(dm)

      return [
        plainDateLines(dm, 'Logged '),
        uName,
        vName,
        plainParticularsLines(pLines).join('\n'),
        { content: _fmtPts(a.committed_paise || 0), styles: { halign: 'right', textColor: [20, 100, 60] } },
        { content: _fmtPts(a.pending_paise || 0), styles: { halign: 'right', textColor: [140, 90, 20] } },
        { content: _fmtPts(a.amount_paise || 0), styles: { halign: 'right', fontStyle: 'bold' } },
      ]
    })
    body.push([
      { content: 'Subtotal (' + allocs.length + ')', colSpan: 4, styles: { fontStyle: 'bold', fillColor: [235, 240, 250] } },
      { content: _fmtPts(subCommitted), styles: { fontStyle: 'bold', fillColor: [235, 240, 250], halign: 'right', textColor: [20, 100, 60] } },
      { content: _fmtPts(subPending), styles: { fontStyle: 'bold', fillColor: [235, 240, 250], halign: 'right', textColor: [140, 90, 20] } },
      { content: _fmtPts(subTotal), styles: { fontStyle: 'bold', fillColor: [235, 240, 250], halign: 'right' } },
    ])
    doc.setFont(FONT, 'bold'); doc.setFontSize(10); doc.setTextColor(30, 30, 90)
    doc.text(title, 14, ctx.startY)
    doc.setTextColor(0)
    var statementHooks = makeStatementCellHooks(doc, FONT, {
      dateCol: 0, particularsCol: 3, dateMeta: dateMeta, particularsMeta: particularsMeta,
      topLabel: 'EXPENSE', bottomLabel: 'LOGGED',
    })
    autoTable(doc, {
      startY: ctx.startY + 3,
      // columnStyles' halign only ever reaches body cells (jspdf-autotable applies it
      // exclusively to sectionName === 'body'), so Committed/Pending/Total need their
      // own per-cell halign here to land over the right-aligned figures below.
      head: [['Date', 'User', 'Venue', 'Particulars',
        { content: 'Committed', styles: { halign: 'right' } },
        { content: 'Pending', styles: { halign: 'right' } },
        { content: 'Total', styles: { halign: 'right' } }]],
      body: body,
      styles: { font: FONT, fontSize: 7, cellPadding: 1.2, overflow: 'linebreak', valign: 'top' },
      headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 26, fontSize: 6.3 }, 1: { cellWidth: 22 }, 2: { cellWidth: 18 }, 3: { cellWidth: 'auto' },
        4: { cellWidth: 18, halign: 'right' }, 5: { cellWidth: 18, halign: 'right' }, 6: { cellWidth: 20, halign: 'right' },
      },
      margin: { left: 10, right: 10 },
      didParseCell: statementHooks.didParseCell,
      willDrawCell: statementHooks.willDrawCell,
      didDrawCell: statementHooks.didDrawCell,
      didDrawPage: function () {
        doc.setFontSize(6); doc.setTextColor(120)
        doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 14, pageH - 5, { align: 'right' })
        doc.setTextColor(0)
      },
    })
    ctx.startY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : ctx.startY) + 8
  }

  async function exportListPDF() {
    if (pdfBusy) return
    var groups = visibleGroups
    if (!groups.length) return
    setPdfBusy(true)
    try {
      var ctx = await _pdfSetup('Expense Ledger — Detailed')
      var allocs = await fetchAllocDetail(null)
      if (allocs.length === 0) {
        ctx.doc.setFontSize(10); ctx.doc.text('No allocations in range.', 14, ctx.startY + 6)
      } else {
        // Group by dept > type > sub-type in memory
        var tree = {}
        allocs.forEach(function (a) {
          var dKey = a.department_id != null ? String(a.department_id) : '__u'
          var tKey = a.expense_type_id != null ? String(a.expense_type_id) : '__u'
          var sKey = a.expense_sub_type_id != null ? String(a.expense_sub_type_id) : '__u'
          if (!tree[dKey]) tree[dKey] = { deptId: a.department_id, types: {} }
          if (!tree[dKey].types[tKey]) tree[dKey].types[tKey] = { typeId: a.expense_type_id, subs: {} }
          if (!tree[dKey].types[tKey].subs[sKey]) tree[dKey].types[tKey].subs[sKey] = { subTypeId: a.expense_sub_type_id, rows: [] }
          tree[dKey].types[tKey].subs[sKey].rows.push(a)
        })
        Object.values(tree).forEach(function (d) {
          var dName = d.deptId != null ? (deptMap[d.deptId] || 'Unassigned') : 'Unallocated'
          Object.values(d.types).forEach(function (t) {
            var tName = t.typeId != null ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
            Object.values(t.subs).forEach(function (s) {
              var sName = s.subTypeId != null ? (subTypeMap[s.subTypeId] || '—') : '—'
              _renderAllocSection(ctx, dName + ' → ' + tName + ' → ' + sName, s.rows)
            })
          })
        })
      }
      await openOrSharePdf(ctx.doc, 'ledger_detailed_' + dateFrom + '_' + dateTo + '.pdf')
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  // Level auto-inferred: pass deptId alone for dept-level, deptId+typeId for type-level, all three for sub-type level.
  async function exportScopedPDF(deptId, typeId, subTypeId) {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      var dName = deptId != null ? (deptMap[deptId] || 'Unassigned') : 'Unallocated'
      var tName = typeId != null ? (typeMap[typeId] || 'Untyped') : null
      var sName = subTypeId != null ? (subTypeMap[subTypeId] || '—') : null
      var level, titleLabel, fileTag
      if (sName != null) { level = 'sub'; titleLabel = 'Sub-Type Ledger — ' + sName; fileTag = sName }
      else if (tName != null) { level = 'type'; titleLabel = 'Expense Type Ledger — ' + tName; fileTag = tName }
      else { level = 'dept'; titleLabel = 'Department Ledger — ' + dName; fileTag = dName }
      var ctx = await _pdfSetup(titleLabel)
      var filter = { deptId: deptId != null ? deptId : null }
      if (typeId !== undefined) filter.typeId = typeId != null ? typeId : null
      if (subTypeId !== undefined) filter.subTypeId = subTypeId != null ? subTypeId : null
      var allocs = await fetchAllocDetail(filter)
      if (allocs.length === 0) {
        ctx.doc.setFontSize(10); ctx.doc.text('No allocations in this scope for the current filter.', 14, ctx.startY + 6)
      } else if (level === 'sub') {
        _renderAllocSection(ctx, dName + ' → ' + tName + ' → ' + sName, allocs)
      } else if (level === 'type') {
        // Group by sub-type
        var subMap = {}
        allocs.forEach(function (a) {
          var k = a.expense_sub_type_id != null ? String(a.expense_sub_type_id) : '__u'
          if (!subMap[k]) subMap[k] = { subTypeId: a.expense_sub_type_id, rows: [] }
          subMap[k].rows.push(a)
        })
        Object.values(subMap).forEach(function (s) {
          var sn = s.subTypeId != null ? (subTypeMap[s.subTypeId] || '—') : '—'
          _renderAllocSection(ctx, dName + ' → ' + tName + ' → ' + sn, s.rows)
        })
      } else {
        // Dept level: group by type → sub-type
        var typeMap2 = {}
        allocs.forEach(function (a) {
          var tk = a.expense_type_id != null ? String(a.expense_type_id) : '__u'
          var sk = a.expense_sub_type_id != null ? String(a.expense_sub_type_id) : '__u'
          if (!typeMap2[tk]) typeMap2[tk] = { typeId: a.expense_type_id, subs: {} }
          if (!typeMap2[tk].subs[sk]) typeMap2[tk].subs[sk] = { subTypeId: a.expense_sub_type_id, rows: [] }
          typeMap2[tk].subs[sk].rows.push(a)
        })
        Object.values(typeMap2).forEach(function (t) {
          var tn = t.typeId != null ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
          Object.values(t.subs).forEach(function (s) {
            var sn = s.subTypeId != null ? (subTypeMap[s.subTypeId] || '—') : '—'
            _renderAllocSection(ctx, dName + ' → ' + tn + ' → ' + sn, s.rows)
          })
        })
      }
      await openOrSharePdf(ctx.doc, 'ledger_' + fileTag.replace(/[^a-z0-9]+/gi, '_') + '_' + dateFrom + '_' + dateTo + '.pdf')
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  // Client-side filter: search + pendingOnly (nested dept -> type -> sub-type)
  var visibleGroups = deptGroups.map(function (g) {
    var deptName = g.deptId ? (deptMap[g.deptId] || 'Unassigned') : 'Unallocated'
    var q = searchDeb.toLowerCase()
    var deptMatch = !q || deptName.toLowerCase().indexOf(q) !== -1
    if (pendingOnly && g.pending === 0) return null
    var filteredTypes = g.typeGroups.map(function (t) {
      var tn = t.typeId ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
      var typeMatch = deptMatch || (q && tn.toLowerCase().indexOf(q) !== -1)
      var subRows = t.subRows.filter(function (r) {
        if (pendingOnly && r.pending === 0) return false
        if (!q) return true
        if (typeMatch) return true
        var sn = r.subTypeId ? (subTypeMap[r.subTypeId] || '') : ''
        return sn.toLowerCase().indexOf(q) !== -1
      })
      if (pendingOnly && t.pending === 0 && subRows.length === 0) return null
      if (q && !typeMatch && subRows.length === 0) return null
      return Object.assign({}, t, { subRows: subRows, typeName: tn })
    }).filter(Boolean)
    if (q && !deptMatch && filteredTypes.length === 0) return null
    return Object.assign({}, g, { typeGroups: filteredTypes, deptName: deptName })
  }).filter(Boolean)

  // The chosen column, applied at every level of the tree.
  //
  // Sorting only the departments would leave the types and sub-types inside
  // them in whatever order they arrived, so ordering by Pending would put the
  // biggest department first and then bury its biggest type somewhere in the
  // middle — which is not what anybody clicking that heading is asking for.
  //
  // The name differs per level: a department has one, a type has one, a
  // sub-type has one, and they are three different fields.
  // ─── DRILL VIEW ───
  if (drillGroup) {
    // Whether this list needs a column for the stamp at all.
    var anyDrillChecked = drillRows.some(function (r) { return !!r._checkedBy })
    return (
      <div className="space-y-4">
        <LedgerBackdrop inAdmin={inAdmin} />
        <div>
          <button type="button" onClick={closeDrill}
            className="inline-flex items-center gap-1.5 h-8 -ml-2 px-2 mb-1 rounded-lg text-[13px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors">
            <Icon name="arrowLeft" size={15} />
            Back to Ledgers
          </button>
          <h2 className="font-display text-[19px] font-bold text-slate-900 leading-tight">{drillGroup.deptName}</h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500">{drillGroup.typeName} › {drillGroup.subTypeName}</p>
        </div>

        {/* Three readings of one sub-type, so they get one shape — the same one
            the four figures at the top of the ledger take. The card stays white
            and the colour sits on the glyph and the number: a filled card puts
            the tint behind the only part that differs between the three, which
            is the figure. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
          <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4 sm:py-3.5 rounded-2xl border bg-white/80 backdrop-blur-xl sm:bg-white border-white/60 sm:border-slate-200">
            <span className="shrink-0 w-8 h-8 sm:w-11 sm:h-11 rounded-xl inline-flex items-center justify-center bg-indigo-100 text-indigo-600">
              <Icon name="chart" size={20} />
            </span>
            <div className="min-w-0 flex-1 flex items-baseline justify-between gap-2 sm:block">
              <p className="text-[12.5px] font-medium text-slate-500 leading-none">Total</p>
              <p className="sm:mt-2 text-[19px] font-extrabold text-indigo-700 tabular-nums leading-none whitespace-nowrap" data-notranslate>{formatPoints(drillGroup.total)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4 sm:py-3.5 rounded-2xl border bg-white/80 backdrop-blur-xl sm:bg-white border-white/60 sm:border-slate-200">
            <span className="shrink-0 w-8 h-8 sm:w-11 sm:h-11 rounded-xl inline-flex items-center justify-center bg-emerald-100 text-emerald-600">
              <Icon name="checkCircle" size={20} />
            </span>
            <div className="min-w-0 flex-1 flex items-baseline justify-between gap-2 sm:block">
              <p className="text-[12.5px] font-medium text-slate-500 leading-none">Committed</p>
              <p className="sm:mt-2 text-[19px] font-extrabold text-emerald-700 tabular-nums leading-none whitespace-nowrap" data-notranslate>{formatPoints(drillGroup.committed)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4 sm:py-3.5 rounded-2xl border bg-white/80 backdrop-blur-xl sm:bg-white border-white/60 sm:border-slate-200">
            <span className="shrink-0 w-8 h-8 sm:w-11 sm:h-11 rounded-xl inline-flex items-center justify-center bg-amber-100 text-amber-600">
              <Icon name="clock" size={20} />
            </span>
            <div className="min-w-0 flex-1 flex items-baseline justify-between gap-2 sm:block">
              <p className="text-[12.5px] font-medium text-slate-500 leading-none">Pending</p>
              <p className="sm:mt-2 text-[19px] font-extrabold text-amber-700 tabular-nums leading-none whitespace-nowrap" data-notranslate>{formatPoints(drillGroup.pending)}</p>
            </div>
          </div>
        </div>

        {/* One row of controls at the size of the controls on the screen behind
            this one, rather than three native selects at full height. */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="contents">
            <div className="relative flex-1 min-w-[100px]">
            <select value={drillUserFilter} onChange={function (e) { setDrillUserFilter(e.target.value) }}
              aria-label="Filter by user"
              className="h-11 pl-2 pr-7 bg-white border border-slate-200 rounded-xl text-[12.5px] text-slate-700 appearance-none hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 w-full min-w-[100px]" style={{ fontSize: '16px' }}>
              <option value="">All Users</option>
              {users.map(function (u) { return <option key={u.id} value={u.id}>{u.name}</option> })}
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="chevronDown" size={14} />
            </span>
            </div>
            <div className="relative flex-1 min-w-[100px]">
            <select value={drillStatusFilter} onChange={function (e) { setDrillStatusFilter(e.target.value) }}
              aria-label="Filter by status"
              className="h-11 pl-2 pr-7 bg-white border border-slate-200 rounded-xl text-[12.5px] text-slate-700 appearance-none hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 w-full min-w-[100px]" style={{ fontSize: '16px' }}>
              <option value="">All Status</option>
              <option value="recorded">Recorded</option>
              <option value="flagged">Resubmit</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="deducted">Deducted</option>
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="chevronDown" size={14} />
            </span>
            </div>
            <div className="relative flex-1 min-w-[100px]">
            <select value={drillVenueFilter} onChange={function (e) { setDrillVenueFilter(e.target.value) }}
              aria-label="Filter by venue"
              className="h-11 pl-2 pr-7 bg-white border border-slate-200 rounded-xl text-[12.5px] text-slate-700 appearance-none hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 w-full min-w-[100px]" style={{ fontSize: '16px' }}>
              <option value="">All Venues</option>
              {venues.map(function (v) { return <option key={v.id} value={v.id}>{v.code ? (v.code + ' — ' + v.name) : v.name}</option> })}
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="chevronDown" size={14} />
            </span>
            </div>
          </div>
        </div>

        {drillLoading && drillRows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">Loading...</p>
        ) : drillRows.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">No allocations in range</p>
        ) : (
          <div className="space-y-2">
            {/* The stamp gets a column, not a place in the queue. Rendered only
                on the rows that have one, it widened those rows' right-hand
                cluster and pushed their rule left, so down a list the rules and
                the amounts beside them came out ragged.

                The column exists when any row in the list is checked, and is
                empty on the rows that are not — so every rule lands on the same
                x. When nothing is checked there is no column to reserve. */}
            {drillRows.map(function (r) {
              // The row hands over what it is already showing, so the overlay
              // opens on it rather than on a spinner. amount_paise is this
              // allocation's share rather than the expense's total, so it is
              // deliberately not passed — a figure that changes under you a
              // moment after it appears is worse than one that arrives late.
              return (
                <div key={r.allocation_id}
                  onClick={function () {
                    openExpenseDetail(r.expense_id, {
                      description: r.description,
                      expense_date: r.expense_date,
                      status: r.status,
                      user_id: r.user_id,
                      created_at: r.created_at,
                    })
                  }}
                  className="group bg-white/80 backdrop-blur-xl sm:bg-white border border-white/60 sm:border-slate-200 rounded-2xl px-4 py-3.5 cursor-pointer hover:border-indigo-300 hover:shadow-[0_4px_14px_rgba(79,70,229,0.08)] transition-all duration-150">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      {/* What it was, first. The date and who logged it led the
                          row and the description came second, so the line you
                          read to know what you are looking at was the one line
                          that was not at the top. */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* basis-full: both chips are shrink-0, so in a flex
                            row the description was the only thing that could
                            give — and it gave everything, down to "m…". It
                            takes the line and the chips wrap under it. */}
                        <p className="basis-full sm:basis-auto sm:min-w-0 sm:truncate text-[14px] font-semibold text-slate-900 leading-snug">{r.description || '—'}</p>
                        <span className={"shrink-0 text-[10.5px] px-2 py-0.5 rounded-md font-bold " + (STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600')}>
                          {STATUS_LABELS[r.status] || r.status}
                        </span>
                        {(function () {
                          var sb = SOURCE_BADGES[r.source] || SOURCE_BADGES.allocation
                          return (
                            <span className={"shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-semibold " + sb.cls}>
                              {sb.label}
                            </span>
                          )
                        })()}
                      </div>
                      {r.remarks && <p className="mt-1 text-[12px] italic text-slate-500">"{r.remarks}"</p>}
                      {r.venue_id && <p className="mt-1 text-[11.5px] text-slate-500">Venue: <span className="font-semibold text-slate-700">{venueMap[r.venue_id] || '—'}</span></p>}
                      {r._fieldChips && r._fieldChips.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2.5">
                          {r._fieldChips.map(function (c, i) {
                            // The label and the value were side by side in a
                            // pill, so a two-word value wrapped inside it and
                            // the pill grew into a box twice the height of its
                            // neighbour. Stacked, the value gets the pill's
                            // width and the row of them stays one height.
                            //
                            // Weight, not colour. Indigo on the value made
                            // every chip look like a link to somewhere, and a
                            // row of them a row of links; the label is already
                            // the quiet half of the pair.
                            return (
                              <span key={i} className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
                                <Icon name={glyphForLabel(c.label)} size={13} className="shrink-0 text-slate-400" />
                                <span className="min-w-0">
                                  <span className="block text-[10.5px] text-slate-500 leading-tight">{c.label}</span>
                                  <span className="block text-[11.5px] font-bold text-slate-800 leading-tight">{c.value}</span>
                                </span>
                              </span>
                            )
                          })}
                        </div>
                      )}
                      {/* When and who, under everything that says what. A glyph
                          apiece and a rule between them, rather than three kinds
                          of fact in one grey string separated by middots. */}
                      {/* Each fact carries its own value in the darker grey,
                          the way the vendor ledger's footer does. It was one
                          flat slate-400 with slate-300 glyphs and weight only
                          on the name at the end, so two of the three facts read
                          as background and the third as the only thing said. */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-slate-500">
                        <span className="inline-flex items-center whitespace-nowrap">
                          <Icon name="calendar" size={13} className="shrink-0 mr-1.5 text-slate-400" />
                          <span className="font-semibold text-slate-700">{formatDate(r.expense_date)}</span>
                        </span>
                        <span aria-hidden="true" className="hidden sm:block w-px h-3.5 bg-slate-200" />
                        <span className="inline-flex items-center whitespace-nowrap">
                          <Icon name="clock" size={13} className="shrink-0 mr-1.5 text-slate-400" />
                          <span className="font-semibold text-slate-700">{formatDateTime(r.created_at)}</span>
                        </span>
                        <span aria-hidden="true" className="hidden sm:block w-px h-3.5 bg-slate-200" />
                        <span className="inline-flex items-center whitespace-nowrap">
                          <Icon name="user" size={13} className="shrink-0 mr-1.5 text-slate-400" />
                          <span className="font-semibold text-slate-700">{userMap[r.user_id] || '—'}</span>
                        </span>
                      </div>
                    </div>
                    {/* The figure gets a panel and a rule of its own. It was a
                        bold number floating at the end of a paragraph, which is
                        the one thing on this row you scan a column of. */}
                    {/* Side by side, the stamp's 128px slot and the figure's
                        124px panel wanted 280 of a 298px card and everything
                        to their left was crushed — which is also how the stamp
                        ended up over the Event Date chip. On a phone they
                        stack, the verdict above the figure it is a verdict on,
                        and the rule between them goes because there are no
                        longer two columns for it to separate. */}
                    <div className="shrink-0 self-center flex flex-col sm:flex-row items-center sm:items-stretch gap-2 sm:gap-4">
                      <span aria-hidden="true" className="hidden sm:block w-px self-stretch bg-slate-200" />
                      {/* Right of the rule is what this row came to, and
                          whether it has been checked is a verdict on that
                          rather than another label beside the description — so
                          the prompt to mark one sits here too, in the slot the
                          stamp will occupy, rather than up among the status
                          chips where it read as one more label. Nothing is
                          drawn for someone who cannot mark a row. */}
                      {(anyDrillChecked || canMarkChecked) && (
                        <span className="shrink-0 sm:w-[128px] self-center flex items-center justify-center"
                          onClick={function (ev) { ev.stopPropagation() }}>
                          {r._checkedBy ? (
                            <CheckedStamp
                              variant="stamp"
                              checked
                              checkedAt={r._checkedAt}
                              canToggle={canMarkChecked}
                              canUncheck={r._checkedBy === profile?.id || isSysAdmin}
                              busy={checkingExpId === r.expense_id}
                              onToggle={function () { toggleExpenseCheck(r.expense_id) }}
                            />
                          ) : (
                            <CheckedStamp
                              checked={false}
                              canToggle={canMarkChecked}
                              busy={checkingExpId === r.expense_id}
                              onToggle={function () { toggleExpenseCheck(r.expense_id) }}
                            />
                          )}
                        </span>
                      )}
                      {/* min-w for the same reason as the vendor ledger's: a
                          panel sized to its own figure puts the rule beside it
                          in a different place on every row. */}
                      <div className="min-w-[124px] px-4 py-2.5 text-center sm:text-right">
                        <p className="text-[11.5px] font-medium text-slate-500 leading-none">Amount</p>
                        <p className="mt-1.5 inline-block px-2.5 py-1 rounded-lg bg-emerald-50 text-[17px] font-extrabold text-slate-900 tabular-nums leading-none" data-notranslate>{formatPoints(r.amount_paise)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {drillHasMore && (
              <button onClick={function () { loadDrill(true) }} disabled={drillLoading}
                className="w-full py-2 text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                {drillLoading ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
        {expenseDetailModal}
      </div>
    )
  }

  function PresetChip(props) {
    var active = datePreset === props.k
    return (
      /* One group, so the four read as one choice. An unpicked one leans
         towards the white pill it would become rather than only darkening its
         text; the picked one does not answer the pointer, because pressing it
         again does nothing. */
      <button type="button" onClick={function () { applyPreset(props.k) }} aria-pressed={active}
        className={"h-9 px-1.5 sm:px-4 text-[11.5px] sm:text-[12.5px] font-bold rounded-lg whitespace-nowrap transition-all duration-150 " +
          (active
            ? "bg-white text-indigo-700 shadow-[0_1px_3px_rgba(15,23,42,0.10)]"
            : "text-slate-500 hover:text-slate-900 hover:bg-white/70")}>
        {props.label}
      </button>
    )
  }

  var ledgerFilterCount = (userFilter ? 1 : 0) + (venueFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) + (pendingOnly ? 1 : 0)

  // ─── LIST VIEW ───
  return (
    <div className="space-y-3">
      <LedgerBackdrop inAdmin={inAdmin} />
      {/* Already above the block that pins, so it scrolls away with the page
          rather than taking toolbar height on every screen. The allocation
          count reads here and not in the card below, where it would be the
          same number twice. */}
      {/* The two exports ride up here. The heading had the row's whole right
          half empty and they had a line of their own under the toolbar —
          169px of buttons against the 185 this leaves on a 390px phone, so
          the heading block keeps what it needs and its subtitle truncates
          before anything else does. */}
      <div className="px-0.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-[26px] sm:text-[23px] font-bold text-slate-900 tracking-[-0.005em]">Ledgers</h2>
          <p className="mt-0.5 text-[12.5px] font-semibold text-slate-600 whitespace-nowrap">
            <span className="hidden sm:inline">
              Live financial tracker
              <span aria-hidden="true" className="mx-1.5 text-slate-300">·</span>
            </span>
            <span data-notranslate>{(totals.allocs || 0).toLocaleString('en-IN')}</span> allocation{totals.allocs === 1 ? '' : 's'}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
        {/* Both of these do the same harmless thing, so they look the same.
              Green and red on a pair of downloads read as a verdict on the file,
              when the only difference is the format the word already names. */}
          <button type="button" onClick={exportListCSV} disabled={!deptGroups.length}
            className="h-11 px-4 inline-flex items-center gap-2 text-[12.5px] font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 transition-all duration-150">
            <Icon name="download" size={14} className="text-slate-400" />
            CSV
          </button>
          <button type="button" onClick={exportListPDF} disabled={!visibleGroups.length || pdfBusy}
            className="h-11 px-4 inline-flex items-center gap-2 text-[12.5px] font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 transition-all duration-150">
            <Icon name={pdfBusy ? 'refresh' : 'fileText'} size={14} className="text-slate-400" />
            {pdfBusy ? 'Generating…' : 'PDF'}
          </button>
        </div>
      </div>

      {/* top-0 put this underneath the shell's own sticky bar rather than below
          it — both were pinned to the top of the window and the shell's is the
          one in front, so the first rows of this block were behind it the whole
          time you were scrolled. --app-header-h is what the shell publishes for
          exactly this.

          And it only pins from sm. On a desktop this is a toolbar and keeping
          it in reach while the table scrolls under it is the point. On a phone
          the same block is the headline card, the three figures, the period
          chips, the search, two dropdowns, the toggle and both exports — most
          of the screen — so pinning it left a sliver of table moving under a
          wall that would not move. */}
      <div ref={stickyRef} className="sm:sticky z-10 sm:bg-gray-50 pt-1 pb-3 border-b border-transparent sm:border-gray-200 space-y-2"
        style={{ top: 'var(--app-header-h, 0px)' }}>
        {/* Left-aligned, and the figure given the size of the thing it is. A
            9px label centred over a 16px number made four cards you had to lean
            in to read; ranged left they also line up with everything below
            them. */}
        {/* The colour sits on the figure and on a glyph, not across the whole
            card. Four filled panels shouted four different colours at a glance,
            and the only part that differs between them — the number — had to
            compete with its own background to be read. Same shape as the
            wallet ledger uses for its four, so the two screens match. */}
        {/* On the phone the four split: the net total is the figure the
            screen exists to report, so it goes on the dark on its own, and
            the three it is made of sit under it. On the desktop they stay
            four equal cards in a row, which is what a row seven columns wide
            is for. */}
        {!inAdmin ? (
          <>
            {/* Warm, not navy. #1B2C4F came from the vendor ledger, where the
                ground is a cool blue-white and it belongs; on this cream it
                read as a card from another screen. This is the artwork's own
                hue — 32 degrees, the same as its average — taken down to a
                dark. The shadow warms with it. */}
            <div className="rounded-3xl p-3.5 shadow-[0_8px_28px_rgba(60,44,28,0.30)]" style={{ backgroundColor: '#31281D' }}>
              <span className="flex items-center gap-3">
                <span className="shrink-0 w-10 h-10 rounded-xl bg-white/10 text-indigo-200 inline-flex items-center justify-center">
                  <Icon name="chart" size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-bold uppercase tracking-[0.1em] text-slate-400">Net Total</span>
                  <span data-notranslate className="block mt-1 font-display text-[26px] font-extrabold text-white tabular-nums leading-none tracking-[-0.02em]">
                    {formatPoints(totals.total)}
                  </span>
                </span>
              </span>

              {/* Inset into the same dark rather than sitting in a card of
                  their own underneath it. These three are what the figure
                  above is made of, and two cards said they were two separate
                  things — which is also how the vendor ledger sets its cash
                  and bank, so the two screens agree.

                  A dot, not a glyph in a disc: the disc was 32px of a 242px
                  row, and the widest of these lines already wants 182. */}
              {/* Across from 400px, not 380. A column has to hold the wider
                  of its two lines plus its padding: the figure is 98px and
                  "Debits Pending" with its dot is 96, so 114 each and 346 for
                  the three — which is a 400px viewport once the page and the
                  card have taken theirs. At 380 the label was cut to "Debits
                  Pen…" and the last two figures ran into each other.

                  Below that they stack, one to a line, which always fits. A
                  rule rather than a panel: they are part of the figure above,
                  not a box under it. */}
              <span className="mt-3 pt-3 border-t border-white/10 grid grid-cols-1 min-[400px]:grid-cols-3 gap-y-1.5 min-[400px]:gap-x-2 min-[400px]:divide-x divide-white/10">
                {[{ label: 'Acknowledged', value: totals.committed, dot: 'bg-emerald-400' },
                  { label: 'Debits Pending', value: totals.pending, dot: 'bg-amber-400' },
                  { label: 'Total Credits', value: totals.credit, dot: 'bg-rose-400' }].map(function (c, i) {
                  return (
                    <span key={c.label} className={'min-w-0 flex items-center justify-between gap-2 min-[400px]:block ' +
                      (i === 0 ? 'min-[400px]:pr-2' : i === 1 ? 'min-[400px]:px-2' : 'min-[400px]:pl-2')}>
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span aria-hidden="true" className={'shrink-0 w-1.5 h-1.5 rounded-full ' + c.dot} />
                        <span className="text-[11.5px] font-medium text-slate-400 truncate">{c.label}</span>
                      </span>
                      <span data-notranslate className="shrink-0 min-[400px]:block min-[400px]:mt-1 text-[13px] font-bold text-white tabular-nums whitespace-nowrap">
                        {formatPoints(c.value)}
                      </span>
                    </span>
                  )
                })}
              </span>
            </div>
          </>
        ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl">
            <span className="shrink-0 w-9 h-9 rounded-lg inline-flex items-center justify-center bg-emerald-50 text-emerald-600">
              <Icon name="checkCircle" size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-500 leading-none">Debits Acknowledged</p>
              <p className="mt-1.5 text-[17px] font-bold text-emerald-700 tabular-nums leading-none" data-notranslate>{formatPoints(totals.committed)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl">
            <span className="shrink-0 w-9 h-9 rounded-lg inline-flex items-center justify-center bg-amber-50 text-amber-600">
              <Icon name="clock" size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-500 leading-none">Debits Pending</p>
              <p className="mt-1.5 text-[17px] font-bold text-amber-700 tabular-nums leading-none" data-notranslate>{formatPoints(totals.pending)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl">
            <span className="shrink-0 w-9 h-9 rounded-lg inline-flex items-center justify-center bg-rose-50 text-rose-600">
              <Icon name="banknote" size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-500 leading-none">Total Credits</p>
              <p className="mt-1.5 text-[17px] font-bold text-rose-700 tabular-nums leading-none" data-notranslate>{formatPoints(totals.credit)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl">
            <span className="shrink-0 w-9 h-9 rounded-lg inline-flex items-center justify-center bg-indigo-50 text-indigo-600">
              <Icon name="chart" size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-500 leading-none">Net Total</p>
              <p className="mt-1.5 text-[17px] font-bold text-slate-900 tabular-nums leading-none" data-notranslate>{formatPoints(totals.total)}</p>
            </div>
          </div>
        </div>
        )}

        {/* One row: the period, what to look in it for, and what to take away
            with you. These were three separate rows of controls at three
            different sizes, and then two. flex-wrap rather than a fixed track,
            so the line breaks where the window makes it break instead of
            where a breakpoint guessed it would. */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* One line from 360px, which is every phone but the smallest.
              At 11.5px and px-1.5 the widest chip — "This month" — is 75px,
              and four across a 360px screen get 79 each. A 320px screen only
              gives 69, so there it falls back to two by two rather than
              pushing the page wider than itself, which is what four across
              at full size was doing. */}
          <div className="w-full sm:w-auto grid grid-cols-2 min-[360px]:grid-cols-4 sm:flex items-center gap-1 p-1 bg-slate-100 rounded-xl [&>*]:w-full sm:[&>*]:w-auto">
            <PresetChip k="month" label="This month" />
            <PresetChip k="lastMonth" label="Last month" />
            <PresetChip k="ytd" label="YTD" />
            <PresetChip k="custom" label="Custom" />
          </div>
          {datePreset === 'custom' && (
            <>
              <input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value) }}
                className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-[12.5px] text-slate-700 hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 flex-1 min-w-[130px]" style={{ fontSize: '16px' }} />
              <input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value) }}
                className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-[12.5px] text-slate-700 hover:border-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-[border-color,box-shadow] duration-150 flex-1 min-w-[130px]" style={{ fontSize: '16px' }} />
            </>
          )}
          {/* The placeholder measures 238px at 16px, so the field wants 286
              to hold it whole once the magnifier and the right pad are paid
              for — 240 never did, and this said otherwise.

              What 240 did do was push the Filters button onto its own line.
              A 360px screen leaves 328 inside px-4; 240 + 10 + 98 is 348, so
              the row broke there while a 390px screen's 358 just took it.
              200 is the floor now: the pair costs 308 and fits, and flex-1
              still hands the field the 318 it actually gets, which is more
              than the 286 the placeholder needs. Below 360 the placeholder
              clips instead of the button leaving the row — a cut word is
              easier to read past than a control that moved. */}
          <div className="flex-1 min-w-[200px] sm:min-w-[240px]">
            <SearchField
              value={search}
              onChange={function (v) { setSearch(v) }}
              placeholder="Search dept / type / sub-type..."
              className="w-full"
            />
          </div>
          {/* Beside the search, not instead of it: the search is the one you
              reach for without thinking, the rest is a narrowing you do
              occasionally. */}
          <button type="button" onClick={function () { setFiltersOpen(!filtersOpen) }}
            aria-expanded={filtersOpen}
            className={"h-11 px-4 inline-flex items-center gap-2 text-[12.5px] font-bold rounded-xl border transition-colors " +
              (filtersOpen || ledgerFilterCount > 0
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300")}>
            <Icon name="filter" size={15} />
            Filters
            {ledgerFilterCount > 0 && (
              <span data-notranslate className="min-w-[18px] px-1.5 rounded-md bg-indigo-600 text-white text-[10.5px] font-bold tabular-nums">
                {ledgerFilterCount}
              </span>
            )}
          </button>
        </div>

        {filtersOpen && (
          <div className="rounded-2xl border border-white/60 sm:border-slate-200 bg-white/80 backdrop-blur-xl sm:bg-white p-3.5">
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Narrow the list</p>
              {ledgerFilterCount > 0 && (
                <button type="button"
                  onClick={function () { setUserFilter(''); setVenueFilter(''); setStatusFilter(''); setPendingOnly(false) }}
                  className="text-[11.5px] font-bold text-rose-600 hover:text-rose-700 transition-colors">
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
          {/* A native select cannot hold a glyph, so the glyph is placed over
              it and the text is indented past it. appearance-none takes the
              platform arrow with it, which is why one is drawn on the right —
              the two of them at once was a chevron beside a chevron. */}
          <div className="relative flex-1 min-w-[150px]">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="users" size={15} />
            </span>
            <select value={userFilter} onChange={function (e) { setUserFilter(e.target.value) }}
              aria-label="Filter by user"
              className={SELECT_FIELD} style={{ fontSize: '16px' }}>
              <option value="">All users</option>
              {users.map(function (u) { return <option key={u.id} value={u.id}>{u.name}</option> })}
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="chevronDown" size={14} />
            </span>
          </div>
          {/* A native select cannot hold a glyph, so the glyph is placed over
              it and the text is indented past it. appearance-none takes the
              platform arrow with it, which is why one is drawn on the right —
              the two of them at once was a chevron beside a chevron. */}
          <div className="relative flex-1 min-w-[150px]">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="mapPin" size={15} />
            </span>
            <select value={venueFilter} onChange={function (e) { setVenueFilter(e.target.value) }}
              aria-label="Filter by venue"
              className={SELECT_FIELD} style={{ fontSize: '16px' }}>
              <option value="">All venues</option>
              {venues.map(function (v) { return <option key={v.id} value={v.id}>{v.code ? (v.code + ' — ' + v.name) : v.name}</option> })}
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="chevronDown" size={14} />
            </span>
          </div>
          {/* A native select cannot hold a glyph, so the glyph is placed over
              it and the text is indented past it. appearance-none takes the
              platform arrow with it, which is why one is drawn on the right —
              the two of them at once was a chevron beside a chevron. */}
          <div className="relative flex-1 min-w-[150px]">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="filter" size={15} />
            </span>
            <select value={statusFilter} onChange={function (e) { setStatusFilter(e.target.value) }}
              aria-label="Filter by status"
              className={SELECT_FIELD} style={{ fontSize: '16px' }}>
              <option value="">All status</option>
              <option value="recorded">Recorded</option>
              <option value="flagged">Resubmit</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="deducted">Deducted</option>
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="chevronDown" size={14} />
            </span>
          </div>
          <button type="button" onClick={function () { setPendingOnly(!pendingOnly) }} aria-pressed={pendingOnly}
            className={"h-11 px-3.5 inline-flex items-center gap-2 text-[12.5px] font-bold rounded-xl border transition-all duration-150 " +
              (pendingOnly
                ? "bg-indigo-50 border-indigo-300 text-indigo-800"
                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900")}>
            {/* A switch, so its state is visible without having to remember
                what the unpressed colour looked like.

                Indigo, not amber. Amber is what this page says about money that
                is pending — the figure, the column, the card. On a filter it was
                saying the same colour about something else entirely: that the
                filter is on, which everything else here says in indigo. */}
            <span aria-hidden="true" className={"w-8 h-[18px] rounded-full p-0.5 transition-colors " + (pendingOnly ? "bg-indigo-600" : "bg-slate-300")}>
              <span className={"block w-[14px] h-[14px] rounded-full bg-white transition-transform " + (pendingOnly ? "translate-x-[14px]" : "")} />
            </span>
            Pending only
          </button>
            </div>
          </div>
        )}
      </div>

      {loading && deptGroups.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">Loading ledger...</p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-8">No matches in this range</p>
      ) : (
        <div className="bg-white/80 backdrop-blur-xl sm:bg-white border border-white/60 sm:border-slate-200 rounded-2xl overflow-hidden">
          {/* One table, not a stack of cards. Every department used to carry its
              own border and its own rounded corners, so four departments were
              four objects with four sets of columns that only happened to line
              up with each other.

              The department name takes the 1fr that is left after everything
              else, and everything else is fixed: 614px of columns, 40 of gaps,
              24 of padding and the 86px export column — 764 before the name
              gets anything. On a 298px phone that left it nothing, so the name
              vanished and the three figures landed on top of each other.

              940 rather than the 700 I first tried, because 700 still left the
              name 46px — the same nothing, just inside a scroller. At 940 it
              has 176. Below that width the panel scrolls sideways, the way the
              inventory ledger's does; squeezing six columns onto a phone would
              make all six unreadable, and they are what carry the drill-down
              from department to type to sub-type. */}
          <div className="flex items-stretch bg-slate-50/60 sm:bg-slate-50 border-b border-slate-200/70 sm:border-slate-200">
            <div className={"flex-1 " + COLS + " px-3 py-2.5"}>
              {/* Headings, not controls. */}
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Department / Type</span>
              <span className={COL_SM_TXT + " text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right"}>Acknowledged</span>
              <span className={"text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right"}>Pending</span>
              <span className={COL_SM_TXT + " text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right"}>Credit</span>
              <span className={COL_SM_TXT + " text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right"}>Net Total</span>
              <span className={COL_SM_TXT + " text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] text-right"}>#</span>
            </div>
            <span className={"hidden sm:block " + EXPORT_COL + " py-2.5 text-center text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]"}>Export</span>
          </div>
          {visibleGroups.map(function (g) {
            var deptCollapsed = collapsedDepts[g.key]
            var delta = deptDelta[g.key] || 0
            return (
              <div key={g.key} data-dept-row className="border-t border-slate-100 first:border-t-0">
                <div className="flex items-stretch hover:bg-slate-50 transition-colors">
                  <button onClick={function (ev) { toggleDept(g.key, g.allocs, ev.currentTarget.closest('[data-dept-row]')) }}
                    className={"flex-1 " + COLS + " items-center px-3 py-2 text-left"}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                      {/* A drawn chevron that turns, not two different characters.
                          ▸ and ▾ are different glyphs at different widths, so the
                          label beside them shifted a pixel on every expand. */}
                      <Icon name="chevronRight" size={14}
                        className={"shrink-0 text-slate-400 transition-transform duration-150 " + (deptCollapsed ? "" : "rotate-90")} />
                      {/* A glyph for the level, not for the department. Which
                          department it is, is what the name says; what a row is
                          — a department, a type, a sub-type — is the thing three
                          levels of the same table cannot say any other way. */}
                      <span className="shrink-0 w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 inline-flex items-center justify-center">
                        <Icon name="building" size={16} />
                      </span>
                      <span className="text-[13.5px] font-bold text-slate-900 truncate">{g.deptName}</span>
                      <span className="shrink-0 min-w-[20px] px-1.5 py-0.5 rounded-md bg-slate-100 text-[10.5px] font-bold text-slate-500 tabular-nums text-center" data-notranslate>{g.typeGroups.length}</span>
                      {delta > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex-shrink-0 animate-pulse">
                          +{delta}
                        </span>
                      )}
                    </div>
                    <Money paise={g.committed} tone={TONES.committed} cls={COL_SM} />
                    <Money paise={g.pending} tone={TONES.pending} />
                    <Money paise={g.credit} tone={TONES.credit} dashWhenZero cls={COL_SM} />
                    <Money paise={g.total} tone={TONES.total} bold cls={COL_SM} />
                    <span className={COL_SM_TXT + " text-[11.5px] text-right text-slate-400 tabular-nums self-center"} data-notranslate>{g.allocs}</span>
                  </button>
                  <button onClick={function (e) { e.stopPropagation(); exportScopedPDF(g.deptId) }}
                    disabled={pdfBusy}
                    title="Open department PDF in new tab"
                    className={"hidden sm:inline-flex " + PDF_BTN}>
                    <Icon name="fileText" size={13} />
                    PDF
                  </button>
                </div>
                {!deptCollapsed && g.typeGroups.map(function (t) {
                  var typeKeyFull = g.key + '|' + t.typeKey
                  var typeCollapsed = collapsedTypes[typeKeyFull]
                  var typeName = t.typeId ? (typeMap[t.typeId] || 'Untyped') : 'Untyped'
                  return (
                    <div key={t.typeKey}>
                      <div className="flex items-stretch border-t border-slate-100 bg-slate-50/70 hover:bg-slate-100 transition-colors">
                        <button onClick={function () { toggleType(g.key, t.typeKey) }}
                          className={"flex-1 " + COLS + " items-center px-3 py-1.5 pl-5 sm:pl-9 text-left"}>
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon name="chevronRight" size={13}
                              className={"shrink-0 text-slate-400 transition-transform duration-150 " + (typeCollapsed ? "" : "rotate-90")} />
                            <span className="shrink-0 w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-500 inline-flex items-center justify-center">
                              <Icon name="box" size={14} />
                            </span>
                            <span className="text-[12.5px] font-semibold text-slate-800 truncate">{typeName}</span>
                            <span className="shrink-0 min-w-[20px] px-1.5 py-0.5 rounded-md bg-white text-[10.5px] font-bold text-slate-500 tabular-nums text-center" data-notranslate>{t.subRows.length}</span>
                          </div>
                          <Money paise={t.committed} tone={TONES.committed} cls={COL_SM} />
                          <Money paise={t.pending} tone={TONES.pending} />
                          <Money paise={t.credit} tone={TONES.credit} dashWhenZero cls={COL_SM} />
                          <Money paise={t.total} tone={TONES.total} bold cls={COL_SM} />
                          <span className={COL_SM_TXT + " text-[11.5px] text-right text-slate-400 tabular-nums self-center"} data-notranslate>{t.allocs}</span>
                        </button>
                        <button onClick={function (e) { e.stopPropagation(); exportScopedPDF(g.deptId, t.typeId) }}
                          disabled={pdfBusy}
                          title="Open expense-type PDF in new tab"
                          className={"hidden sm:inline-flex " + PDF_BTN}>
                          <Icon name="fileText" size={13} />
                          PDF
                        </button>
                      </div>
                      {!typeCollapsed && t.subRows.map(function (r, i) {
                        var subTypeName = r.subTypeId ? (subTypeMap[r.subTypeId] || '—') : '—'
                        return (
                          <div key={i} className="flex items-stretch border-t border-slate-100 hover:bg-indigo-50/60 transition-colors">
                            {/* pl-20, not pl-14. Indentation has to be measured
                                from where the TEXT starts, not from where the
                                padding does: the type row spends 45px on a
                                chevron and an icon tile before its name begins,
                                and the sub-type row only 24px. At pl-14 the
                                sub-type's name actually started nine pixels to
                                the LEFT of its own parent's. */}
                            <button onClick={function () { openRow(g, r) }}
                              className={"flex-1 " + COLS + " items-start sm:items-center px-3 py-1.5 pl-9 sm:pl-20 text-left"}>
                              {/* The tile and the badge its two parents have.
                                  A bare glyph beside a name, under two rows
                                  that each put theirs in a box, read as a
                                  different kind of row rather than the third
                                  level of the same one. */}
                              {/* Measured: at the old indent the name had 9px
                                  left once the tile, the badge, the figure and
                                  the chevron had taken theirs. The indent
                                  halves, the tile and the badge stand down —
                                  the row is already the third level and the
                                  only one with a chevron — and what is left
                                  wraps rather than truncating, because these
                                  names are the whole point of the row and
                                  "FLR-Casual La…" is not one. */}
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="hidden sm:inline-flex shrink-0 w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-400 items-center justify-center">
                                  <Icon name="fileText" size={13} />
                                </span>
                                <span className="text-[12.5px] text-slate-600 leading-snug sm:truncate">{subTypeName}</span>
                                <span className={COL_SM_TXT + " shrink-0 min-w-[20px] px-1.5 py-0.5 rounded-md bg-white text-[10.5px] font-bold text-slate-500 tabular-nums text-center"} data-notranslate>{r.allocs}</span>
                              </div>
                              <Money paise={r.committed} tone={TONES.committed} cls={COL_SM} />
                              <Money paise={r.pending} tone={TONES.pending} />
                              <Money paise={r.credit} tone={TONES.credit} dashWhenZero cls={COL_SM} />
                              <Money paise={r.total} tone={TONES.total} bold cls={COL_SM} />
                              {/* The count moved up beside the name, where the
                                  other two levels carry theirs. What ends this
                                  row instead is a chevron: the rows above
                                  expand in place, this one opens the
                                  allocations behind it. */}
                              <span className="flex items-center justify-end text-slate-300">
                                <Icon name="chevronRight" size={14} />
                              </span>
                            </button>
                            <button onClick={function (e) { e.stopPropagation(); exportScopedPDF(g.deptId, r.typeId, r.subTypeId) }}
                              disabled={pdfBusy}
                              title="Open sub-type PDF in new tab"
                              className={"hidden sm:inline-flex " + PDF_BTN}>
                              <Icon name="fileText" size={13} />
                              PDF
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )
          })}
          <p className="px-4 py-2.5 border-t border-slate-200/70 text-[12px] text-slate-600">
            Showing
            <span className="mx-1 font-bold text-slate-900 tabular-nums" data-notranslate>{visibleGroups.length}</span>
            of
            <span className="mx-1 font-bold text-slate-900 tabular-nums" data-notranslate>{deptGroups.length}</span>
            departments
          </p>
        </div>
      )}
    </div>
  )
}

export default Ledgers