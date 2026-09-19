import { useState, useEffect, useCallback, memo } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints, formatDate, formatDateTime } from '../../lib/format'
import PayVendorModal from './PayVendorModal'
import PaymentProofThumbs from '../../components/ledger/PaymentProofThumbs'
import SearchDropdown from '../../components/ui/SearchDropdown'
import { useExpenseDetailModal } from '../../hooks/useExpenseDetailModal.jsx'
import LedgerSourceMedia from '../../components/ledger/LedgerSourceMedia'
import { filterVisibleVendors } from '../../lib/vendorGating'
import { registerPdfFont } from '../../lib/pdfFont'
import { openOrSharePdf } from '../../lib/pdfOutput'
import { plainParticularsLines, plainDateLines, makeStatementCellHooks } from '../../lib/pdfStatementTable'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import SearchField from '../../components/ui/SearchField'
import CheckedStamp from '../../components/ui/CheckedStamp'
import Icon from '../../components/ui/Icon'
import { avatarTint } from '../../lib/avatarTint'
import { ON, OFF } from '../../lib/ui'

function byName(a, b) { return (a.name || '').localeCompare(b.name || '') }

// Outstanding is the ordinary state of a vendor ledger — nearly every row has
// some — so colouring it said nothing and turned the whole grid amber. A
// colour that is on everything is not a signal, it is a background.
//
// The figure is dark by default, which is what an amount you simply want to
// read should be, and takes a colour only where the colour means something:
// emerald when the balance runs the other way and the money is owed to us,
// grey when there is nothing outstanding at all. Overdue is not in here — it
// has its own chip on the same line, and saying it twice in two reds was half
// of what made this loud.
function balanceColour(paise) {
  if (paise < 0) return 'text-emerald-700'
  if (!paise) return 'text-slate-400'
  return 'text-slate-900'
}

// The balance as a pill, the way the wallet list prints one: contained,
// tabular, and sitting on the same line as the name rather than below it as a
// headline of its own.
//
// The wallet's red is for a negative balance, because there a negative means
// somebody is overdrawn. Here a positive is the ordinary case — we owe nearly
// every vendor something — so it takes the plain slate pill, and the emerald
// is kept for the balance running the other way, which is the one worth
// noticing. Overdue has its chip on the same line and does not need a second
// colour here.
function BalancePill({ paise, large }) {
  var tone = paise < 0 ? 'bg-emerald-50 text-emerald-700'
    : !paise ? 'bg-slate-100 text-slate-400'
    : 'bg-slate-100 text-slate-800'
  return (
    <span data-notranslate
      className={'shrink-0 inline-flex items-center rounded-full font-bold tabular-nums whitespace-nowrap ' +
        (large ? 'h-8 px-3.5 text-[15px] ' : 'h-6 px-2.5 text-[12.5px] ') + tone}>
      {formatPoints(paise)}
    </span>
  )
}

// A figure, what it is, and the glyph that says which. The number carries the
// colour; the tile around it does not.
//
// Four of these are also the filter. A tile that already prints how many
// vendors are overdue is a better button for "show me those" than a segment in
// a bar underneath saying the same word without the count — so the tiles that
// count a state can be pressed, and the two that are pure readings cannot.
function Tile({ icon, tone, label, value, valueClass, wide, small, tint, active, onClick, children }) {
  // h-full and an explicit centre on every tile, because a <button> centres
  // its own contents and a <div> does not. Four of these are buttons and two
  // are not, and the outstanding tile is taller than all of them — so the two
  // plain ones were pinned to the top of a row the buttons were sitting in the
  // middle of, and the labels stopped lining up across the row.
  // The picked tile is a fill, not an outline. Every outline tried here read
  // as a focus artefact rather than a choice: a ring is a second border drawn
  // outside the first, and a tinted border is a line the eye tracks round the
  // shape instead of resting inside it. So the border never changes colour —
  // the face tints and the label and figure darken, and the tile still has
  // exactly one edge, the same one every tile has.
  var box = 'text-left h-full flex flex-col justify-center border border-slate-200 rounded-2xl px-4 py-3.5 transition-colors duration-150 ' +
    (wide ? 'lg:col-span-2 ' : '') +
    // `tint` is for the one tile on a screen that is the answer rather than a
    // reading — the outstanding balance on a vendor's own page. It is a face,
    // not a border, for the same reason the picked tile is.
    (active ? 'bg-indigo-50 ' : (tint || 'bg-white ')) +
    (onClick && !active ? 'hover:bg-slate-50 ' : '') +
    // The browser draws its own ring on a focused button, and clicking one
    // leaves it focused. Replaced with a ring that only shows for the keyboard,
    // so a pointer never leaves a blue outline sitting on the tile it pressed.
    (onClick ? 'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 ' : '')
  var inner = (
    <>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={'shrink-0 w-11 h-11 rounded-full inline-flex items-center justify-center ' + tone}>
          <Icon name={icon} size={19} />
        </span>
        {/* The figure in the display face, set larger and with the tracking
            pulled in — at 19px in the body face beside a 12px label the two
            were close enough in weight to read as one block of text. The
            label loses half a point and keeps its colour, so the figure is
            clearly the thing and the label is clearly what it is called. */}
        <div className="min-w-0">
          <p className={'truncate text-[11.5px] font-semibold ' + (active ? 'text-indigo-700' : 'text-slate-600')}>{label}</p>
          {/* One line. At 22px in a seventh of the grid, "4,51,413 pts" and
              "17 Sept 2026" both ran to two — and a tile whose figure wraps is
              taller than the five beside it. The wide one keeps its size
              because it has twice the room; the rest come down, and truncate
              rather than wrap if a number ever outgrows even that. */}
          <p className={'mt-1.5 font-display font-extrabold tabular-nums leading-none tracking-[-0.02em] whitespace-nowrap truncate ' + (wide ? 'text-[24px] ' : small ? 'text-[18px] ' : 'text-[22px] ') + valueClass} data-notranslate>{value}</p>
        </div>
      </div>
      {children}
    </>
  )
  if (!onClick) return <div className={box}>{inner}</div>
  return <button type="button" onClick={onClick} aria-pressed={!!active} className={box + 'w-full'}>{inner}</button>
}

// Chips stay white, with one exception. A coloured chip competes with the
// coloured figure beside it, so a state that is merely a state — incomplete,
// no activity — says so with a word and a glyph. Overdue is not a state, it is
// a deadline that has passed, and it is the only one worth finding by colour
// while scanning a page of them.
function StateChip({ icon, label, alarm }) {
  return (
    // A fixed height rather than padding, so two chips side by side are the
    // same height whatever is in them, and neither is taller than the line.
    //
    // Only the white one is outlined. A tint already gives a chip its edge, so
    // a border round the rose one was a second edge a pixel inside the first —
    // two rose lines with a paler rose between them, which is what made it look
    // furred. The white one keeps its hairline, because without it there is
    // nothing at all between the chip and the card.
    <span className={"shrink-0 h-6 inline-flex items-center gap-1.5 px-2.5 rounded-md text-[10.5px] font-bold uppercase tracking-[0.04em] whitespace-nowrap " +
      (alarm ? "bg-rose-100 text-rose-700" : "bg-white border border-slate-200 text-slate-600")}>
      <Icon name={icon} size={11} className={alarm ? "text-rose-600" : "text-slate-500"} />
      {label}
    </span>
  )
}

// One fact in a footer: a glyph, what it is, and the value in the darker grey
// so the value is what you land on rather than its label.
// `label` reads "Last: 17 Sep 26"; `lead` reads "by Ompal Sharma" — the same
// shape without the colon, for the facts that are a phrase rather than a field.
function Fact({ icon, label, value, lead, first }) {
  return (
    <span className="shrink-0 inline-flex items-center whitespace-nowrap">
      {!first && <span aria-hidden="true" className="mx-2 w-px h-3.5 bg-slate-200" />}
      <Icon name={icon} size={13} className="shrink-0 mr-1.5 text-slate-400" />
      {label ? label + ':' : (lead || '')}
      <span className="ml-1 font-semibold text-slate-700" data-notranslate>{value}</span>
    </span>
  )
}

// Three facts on one line in a third of the grid's width, so each one is
// cut to what it cannot lose: "Earliest due" becomes "Due", and the dates
// drop to a two-digit year. With the full labels and "17 Sept 2026" twice,
// the line wrapped and the card grew a fourth row to hold half a date.
function shortDate(s) {
  if (!s) return ''
  var d = new Date(s)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

function renderFacts(v) {
  var n = v.entry_count || 0
  var facts = [
    { icon: 'fileText', value: n + (n === 1 ? ' entry' : ' entries') },
    v.last_entry_date ? { icon: 'calendar', label: 'Last', value: shortDate(v.last_entry_date) } : null,
    v.earliest_due_date ? { icon: 'clock', label: 'Due', value: shortDate(v.earliest_due_date) } : null,
  ].filter(Boolean)
  return facts.map(function (f, fi) {
    return <Fact key={fi} first={fi === 0} icon={f.icon} label={f.label} value={f.value} />
  })
}

function renderChips(v) {
  var chips = []
  if ((v.overdue_count || 0) > 0) chips.push({ icon: 'alert', label: 'Overdue', alarm: true })
  if (v.vendor_status === 'incomplete') chips.push({ icon: 'fileText', label: 'Incomplete' })
  if (chips.length === 0 && (v.entry_count || 0) === 0) chips.push({ icon: 'clock', label: 'No activity' })
  return chips.map(function (c, ci) { return <StateChip key={ci} icon={c.icon} label={c.label} alarm={c.alarm} /> })
}

function renderMoneyNotes(v) {
  var cashBal = v.cash_balance_paise || 0
  var bankBal = v.bank_balance_paise || 0
  var opening = v._opening_paise || 0
  if (!cashBal && !bankBal && !opening) return null
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-y-1 text-[11.5px] text-slate-500">
      {cashBal !== 0 && <Fact first icon="banknote" label="Cash" value={formatPoints(cashBal)} />}
      {bankBal !== 0 && <Fact first={!cashBal} icon="bank" label="Bank" value={formatPoints(bankBal)} />}
      {opening !== 0 && <Fact first={!cashBal && !bankBal} icon="wallet" label="Opening" value={formatPoints(Math.abs(opening)) + (opening > 0 ? ' Cr' : ' Dr')} />}
    </div>
  )
}

function renderCallLink(v) {
  if (!v._phone) return null
  return (
    <a href={'tel:' + v._phone.replace(/[^0-9+]/g, '')}
      onClick={function (ev) { ev.stopPropagation() }}
      title={'Call ' + (v._contact || v.vendor_name || 'vendor') + (v._phone2 ? ' · alt: ' + v._phone2 : '')}
      className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:text-emerald-700 no-underline transition-colors">
      <Icon name="phone" size={15} />
    </a>
  )
}

// A card and a row are the same facts in two shapes, in the same order:
// who, what state it is in, how much, then the history under a rule.
function VendorCardInner({ v, onOpen }) {
  var bal = v.balance_paise || 0
  return (
    <button type="button" onClick={function () { onOpen(v) }}
      // The card lifts off the page rather than only changing colour: a
      // tint and a border tint are both flat, so on a grid of sixty the
      // one under the pointer was a slightly different white. transform-gpu
      // keeps the lift off the layout, and the press puts it back down.
      className="group text-left w-full bg-white border border-slate-200 rounded-2xl p-4 transform-gpu transition-all duration-150 hover:border-indigo-300 hover:bg-indigo-50/30 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(79,70,229,0.10)] active:translate-y-0 active:shadow-none active:scale-[0.995] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30">
      {/* No initial circle. A person's avatar stands in for a face you
          would recognise; a vendor's first letter is just the first letter
          of the name printed beside it, in a colour that means nothing. */}
      {/* The name leads and the balance sits beside it in a pill, the way
          the wallet list sets a row. As a 19px figure on its own line the
          amount was the headline and the vendor it belonged to was the
          caption — which is backwards for a list you scan by name. */}
      {/* items-center, not items-start. The name, the chips and the pill
          are three different heights, so aligning their tops staggered
          them down the line — a 14.5px name, an 18px chip and a 30px pill
          each starting at the same y and ending somewhere else. One centre
          line puts them on one line. */}
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0 text-[15.5px] font-bold text-slate-900 truncate transition-colors group-hover:text-indigo-700">{v.vendor_name || '—'}</p>
        {renderChips(v)}
        <BalancePill paise={bal} large />
      </div>
      {renderMoneyNotes(v)}
      {/* The call button and the chevron end the card together, on the
          footer's right. They used to sit on the money line, which left a
          white box and an arrow floating in the middle of the card with
          nothing either side of them and nothing under them — the card had
          three rows and its two controls were parked on the second. */}
      <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center gap-3">
        {/* One line, and it stays one: nowrap plus a min-w-0 that lets it
            be clipped rather than pushing the two controls off the end. */}
        <div className="flex-1 min-w-0 flex flex-nowrap items-center overflow-hidden text-[11.5px] text-slate-500">
          {renderFacts(v)}
        </div>
        {renderCallLink(v)}
        {/* The chevron slides the way it points, so the card says where
            pressing it goes rather than only that it can be pressed. */}
        <span aria-hidden="true" className="shrink-0 text-slate-300 transition-all duration-150 group-hover:text-indigo-500 group-hover:translate-x-0.5">
          <Icon name="chevronRight" size={17} />
        </span>
      </div>
    </button>
  )
}


// memo, because the grid holds one of these per vendor and the page re-renders
// for things that have nothing to do with any of them — opening the filter panel,
// typing in the search. Without it, every keystroke rebuilt two hundred and sixty
// cards before the panel could paint, which is the delay that showed up as the
// funnel being slow to open.
//
// The vendor objects come straight out of the loaded rows, so their identity
// survives filtering and sorting; onOpen is wrapped in useCallback for the same
// reason. If either really changes, the card re-renders.
var VendorCard = memo(VendorCardInner)

function VendorLedger({ profile, onNavigateToExpenses }) {
  var permsNew = (profile && profile.permsNew) || []
  var isAdmin = hasPerm(permsNew, 'admin.dashboard')
  var canView = isAdmin || hasPerm(permsNew, 'finance.ledgers.vendor')
  var canMarkChecked = hasPerm(permsNew, 'finance.wallet.mark_checked')
  var [checkingEntryId, setCheckingEntryId] = useState(null)

  var [view, setView] = useState('list')  // 'list' | 'detail'
  var [vendors, setVendors] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [statusFilter, setStatusFilter] = useState('all')  // 'all' | 'with_balance' | 'incomplete' | 'overdue'

  // Filter dropdowns (all optional, cascade where hierarchical)
  var [fExpType, setFExpType] = useState('')
  var [fExpSubType, setFExpSubType] = useState('')
  var [fCategory, setFCategory] = useState('')
  var [fSubCategory, setFSubCategory] = useState('')
  var [filtersOpen, setFiltersOpen] = useState(false)
  var refData = useReferenceData()
  var expenseTypes = refData.expenseTypes.slice().sort(byName)
  var expenseSubTypes = refData.expenseSubTypes.slice().sort(byName)
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  // vendorTags: { [vendor_id]: { types:[], subTypes:[], cats:[], subCats:[] } }
  var [vendorTags, setVendorTags] = useState({})

  var [selectedVendor, setSelectedVendor] = useState(null)
  var [entries, setEntries] = useState([])
  var [entriesLoading, setEntriesLoading] = useState(false)
  var [showDeleted, setShowDeleted] = useState(false)
  var { openExpenseDetail, expenseDetailModal } = useExpenseDetailModal(profile, isAdmin, function () {
    if (selectedVendor) loadEntries(selectedVendor, showDeleted)
  }, onNavigateToExpenses)

  useEffect(function () {
    if (canView) { loadVendors(); loadFilterData() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cascade: clearing parent clears its child; changing parent clears child too
  useEffect(function () { setFExpSubType('') }, [fExpType])
  useEffect(function () { setFSubCategory('') }, [fCategory])

  async function loadFilterData() {
    // Reference tables for the 4 dropdowns
    var [rCats, rSubCats] = await Promise.all([
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name')
    ])
    setCategories(rCats.data || [])
    setSubCategories(rSubCats.data || [])

    // Vendor → expense-type/sub-type/category/sub-category tags, computed server-side
    // (was a multi-step, 50000-row-capped client join across 4 tables).
    var { data: tagRows } = await supabase.from('v_vendor_tags').select('*')
    var finalMap = {}
    ;(tagRows || []).forEach(function (r) {
      finalMap[String(r.vendor_id)] = {
        types: r.expense_type_ids || [],
        subTypes: r.expense_sub_type_ids || [],
        cats: r.category_ids || [],
        subCats: r.sub_category_ids || [],
      }
    })
    setVendorTags(finalMap)
  }

  async function loadVendors() {
    setLoading(true)
    var { data, error } = await supabase.from('v_vendor_ledger')
      .select('*')
      .order('balance_paise', { ascending: false })
    if (error) { setLoading(false); return }
    var rows = data || []

    // Merge phones + gating tags from vendors master (v_vendor_ledger doesn't expose these fields)
    var vendorIds = rows.map(function (r) { return r.vendor_id }).filter(Boolean)
    if (vendorIds.length > 0) {
      var CHUNK = 500
      var vMasterMap = {}
      for (var i = 0; i < vendorIds.length; i += CHUNK) {
        var chunk = vendorIds.slice(i, i + CHUNK)
        var pRes = await supabase.from('vendors')
          .select('id, phone, phone2, contact, expense_sub_type_ids, opening_balance_paise')
          .in('id', chunk)
        ;(pRes.data || []).forEach(function (p) { vMasterMap[p.id] = p })
      }
      rows = rows.map(function (r) {
        var p = vMasterMap[r.vendor_id]
        if (!p) return r
        return Object.assign({}, r, {
          _phone: p.phone || null,
          _phone2: p.phone2 || null,
          _contact: p.contact || null,
          expense_sub_type_ids: p.expense_sub_type_ids || [],
          _opening_paise: p.opening_balance_paise || 0
        })
      })
    }

    // Apply user-tag gating (admin/auditor bypass)
    rows = filterVisibleVendors(rows, profile)

    setVendors(rows)
    setLoading(false)
  }

  async function loadEntries(v, withDeleted) {
    setEntriesLoading(true)
    setEntries([])
    var q = supabase.from('ledger_entries')
      .select('*')
      .eq('ledger_type', 'vendor')
      .eq('party_id', v.vendor_id)
      .order('entry_date', { ascending: true })
      .order('id', { ascending: true })
      .limit(1000)
    if (!withDeleted) q = q.is('deleted_at', null)
    var { data, error } = await q
    if (error) { setEntries([]); setEntriesLoading(false); return }

    var rows = data || []

    // Batch-fetch source expense receipts for expense-type rows (bill/voice note attached to the source expense)
    var expIds = []
    rows.forEach(function (r) {
      if (r.ref_type === 'expense' && r.ref_id && /^[0-9]+$/.test(String(r.ref_id))) {
        var id = Number(r.ref_id)
        if (expIds.indexOf(id) === -1) expIds.push(id)
      }
    })

    var receiptsByExpId = {}
    var breakdownByExpId = {}  // { [expId]: { amount_paise, tax_paise, allocations: [...] } }
    var submitterIdByExpId = {}
    var acknowledgerIdByExpId = {}
    var expCheckByExpId = {}  // { [expId]: { checked_by, checked_at } } — the expense's own check, not this ledger row's
    if (expIds.length > 0) {
      var { data: exps } = await supabase.from('expenses')
        .select('id, receipt_paths, receipt_path, amount_paise, tax_paise, user_id, acknowledged_by, checked_by, checked_at, expense_allocations(department, department_id, venue_id, amount_paise, remarks, expense_type_id, expense_sub_type_id)')
        .in('id', expIds)
      ;(exps || []).forEach(function (ex) {
        var paths = Array.isArray(ex.receipt_paths) && ex.receipt_paths.length > 0
          ? ex.receipt_paths
          : (ex.receipt_path ? [ex.receipt_path] : [])
        if (paths.length > 0) receiptsByExpId[ex.id] = paths
        breakdownByExpId[ex.id] = {
          amount_paise: ex.amount_paise || 0,
          tax_paise: ex.tax_paise || 0,
          allocations: ex.expense_allocations || []
        }
        expCheckByExpId[ex.id] = { checked_by: ex.checked_by, checked_at: ex.checked_at }
        if (ex.user_id) submitterIdByExpId[ex.id] = ex.user_id
        if (ex.acknowledged_by) acknowledgerIdByExpId[ex.id] = ex.acknowledged_by
      })
    }

    // Venue name lookup for allocation display
    var venueIds = []
    Object.keys(breakdownByExpId).forEach(function (k) {
      breakdownByExpId[k].allocations.forEach(function (a) {
        if (a.venue_id && venueIds.indexOf(a.venue_id) === -1) venueIds.push(a.venue_id)
      })
    })
    var venueNameById = {}
    refData.venues.forEach(function (v) { venueNameById[v.id] = v.name })
    var expTypeNameById = {}
    refData.expenseTypes.forEach(function (t) { expTypeNameById[t.id] = t.name })
    var expSubTypeNameById = {}
    refData.expenseSubTypes.forEach(function (st) { expSubTypeNameById[st.id] = st.name })

    // Profile name lookup — resolves ledger_entries.created_by plus, for expense-linked
    // rows, the submitter (expenses.user_id) and acknowledger (expenses.acknowledged_by).
    var profileIds = []
    rows.forEach(function (r) {
      if (r.created_by && profileIds.indexOf(r.created_by) === -1) profileIds.push(r.created_by)
      if (r.checked_by && profileIds.indexOf(r.checked_by) === -1) profileIds.push(r.checked_by)
    })
    Object.keys(submitterIdByExpId).forEach(function (eid) {
      var id = submitterIdByExpId[eid]
      if (profileIds.indexOf(id) === -1) profileIds.push(id)
    })
    Object.keys(acknowledgerIdByExpId).forEach(function (eid) {
      var id = acknowledgerIdByExpId[eid]
      if (profileIds.indexOf(id) === -1) profileIds.push(id)
    })
    Object.keys(expCheckByExpId).forEach(function (eid) {
      var id = expCheckByExpId[eid].checked_by
      if (id && profileIds.indexOf(id) === -1) profileIds.push(id)
    })
    var profileNameById = {}
    if (profileIds.length > 0) {
      var { data: pRows } = await supabase.from('profiles').select('id, name').in('id', profileIds)
      ;(pRows || []).forEach(function (p) { profileNameById[p.id] = p.name || null })
    }

    var merged = rows.map(function (r) {
      var patch = {}
      if (r.created_by && profileNameById[r.created_by]) patch._creatorName = profileNameById[r.created_by]
      if (r.checked_by && profileNameById[r.checked_by]) patch._checkedByName = profileNameById[r.checked_by]
      if (r.ref_type === 'expense' && r.ref_id) {
        var id = Number(r.ref_id)
        if (receiptsByExpId[id]) patch._sourceReceipts = receiptsByExpId[id]
        if (breakdownByExpId[id]) {
          patch._breakdown = breakdownByExpId[id]
          patch._venueNames = venueNameById
          patch._typeNames = expTypeNameById
          patch._subTypeNames = expSubTypeNameById
        }
        if (submitterIdByExpId[id] && profileNameById[submitterIdByExpId[id]]) patch._submitterName = profileNameById[submitterIdByExpId[id]]
        if (acknowledgerIdByExpId[id] && profileNameById[acknowledgerIdByExpId[id]]) patch._acknowledgerName = profileNameById[acknowledgerIdByExpId[id]]
        if (expCheckByExpId[id]) {
          patch._expChecked = expCheckByExpId[id]
          patch._expCheckedByName = expCheckByExpId[id].checked_by ? (profileNameById[expCheckByExpId[id].checked_by] || null) : null
        }
      }
      if (Object.keys(patch).length > 0) return Object.assign({}, r, patch)
      return r
    })

    setEntries(merged)
    setEntriesLoading(false)
  }

  var openVendor = useCallback(async function (v) {
    setSelectedVendor(v)
    setView('detail')
    setShowDeleted(false)
    await loadEntries(v, false)
    // Fetch phones + contact name from vendors master (not in v_vendor_ledger view)
    try {
      var contactRes = await supabase.from('vendors')
        .select('phone, phone2, contact, opening_balance_paise')
        .eq('id', v.vendor_id).maybeSingle()
      if (contactRes.data) {
        setSelectedVendor(function (prev) {
          if (!prev || prev.vendor_id !== v.vendor_id) return prev
          return Object.assign({}, prev, {
            _phone: contactRes.data.phone || null,
            _phone2: contactRes.data.phone2 || null,
            _contact: contactRes.data.contact || null,
            _opening_paise: contactRes.data.opening_balance_paise || 0,
          })
        })
      }
    } catch (_) {}
    try { logActivity('VENDOR_LEDGER_VIEW', v.vendor_name + ' (id ' + v.vendor_id + ')') } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleShowDeleted(next) {
    setShowDeleted(next)
    if (selectedVendor) loadEntries(selectedVendor, next)
  }

  function backToList() {
    setView('list')
    setSelectedVendor(null)
    setEntries([])
    loadVendors()  // refresh in case something changed
  }

  var [showPayModal, setShowPayModal] = useState(false)
  var [pdfBusy, setPdfBusy] = useState(false)

  function payVendor() {
    if (!selectedVendor) return
    setShowPayModal(true)
  }

  async function onPaymentSuccess() {
    setShowPayModal(false)
    await loadVendors()
    if (selectedVendor) await loadEntries(selectedVendor, showDeleted)
  }

  

  async function reverseEntry(entryId) {
    var reason = prompt('Reason for reversal (optional)?')
    if (reason === null) return
    var { error } = await supabase.rpc('reverse_ledger_entry', {
      p_entry_id: entryId,
      p_reason: (reason || '').trim() || null
    })
    if (error) { alert('Reversal failed: ' + error.message); return }
    try { logActivity('LEDGER_REVERSE', 'entry #' + entryId) } catch (_) {}
    if (selectedVendor) await loadEntries(selectedVendor, showDeleted)
  }

  async function toggleLedgerCheck(entryId) {
    if (checkingEntryId) return
    setCheckingEntryId(entryId)
    var { error } = await supabase.rpc('fn_toggle_ledger_check', { p_entry_id: entryId })
    setCheckingEntryId(null)
    if (error) { alert('Could not update: ' + error.message); return }
    if (selectedVendor) await loadEntries(selectedVendor, showDeleted)
  }

  // Purchase entries (ref_type='expense') check the underlying expenses row
  // itself, same as everywhere else that shows an expense — not this
  // ledger_entries row's own checked_by, which is for vendor_payment/
  // vendor_deduction rows that have no expenses row to attach to.
  async function toggleExpenseCheck(expenseId) {
    if (checkingEntryId) return
    setCheckingEntryId(expenseId)
    var { error } = await supabase.rpc('fn_toggle_expense_check', { p_expense_id: expenseId })
    setCheckingEntryId(null)
    if (error) { alert('Could not update: ' + error.message); return }
    if (selectedVendor) await loadEntries(selectedVendor, showDeleted)
  }

  if (!canView) {
    return <p className="text-gray-400 text-sm text-center py-12">You don't have access to Vendor Ledger.</p>
  }

  // ── LIST VIEW ──
  if (view === 'list') {
    var q = search.trim().toLowerCase()
    var hasAnyDropdownFilter = !!(fExpType || fExpSubType || fCategory || fSubCategory)
    var filtered = vendors.filter(function (v) {
      if (!v.vendor_active) return false
      if (q && (v.vendor_name || '').toLowerCase().indexOf(q) === -1) return false
      if (statusFilter === 'with_balance' && (v.balance_paise || 0) === 0) return false
      if (statusFilter === 'incomplete' && v.vendor_status !== 'incomplete') return false
      if (statusFilter === 'overdue' && (v.overdue_count || 0) === 0) return false
      if (hasAnyDropdownFilter) {
        var tags = vendorTags[String(v.vendor_id)]
        if (!tags) return false
        if (fExpType && tags.types.indexOf(Number(fExpType)) === -1) return false
        if (fExpSubType && tags.subTypes.indexOf(Number(fExpSubType)) === -1) return false
        if (fCategory && tags.cats.indexOf(Number(fCategory)) === -1) return false
        if (fSubCategory && tags.subCats.indexOf(Number(fSubCategory)) === -1) return false
      }
      return true
    })

    var totalOutstanding = vendors
      .filter(function (v) { return v.vendor_active })
      .reduce(function (s, v) { return s + (v.balance_paise || 0) }, 0)
    var totalCash = vendors
      .filter(function (v) { return v.vendor_active })
      .reduce(function (s, v) { return s + (v.cash_balance_paise || 0) }, 0)
    var totalBank = vendors
      .filter(function (v) { return v.vendor_active })
      .reduce(function (s, v) { return s + (v.bank_balance_paise || 0) }, 0)
    var vendorsWithBalance = vendors.filter(function (v) { return v.vendor_active && (v.balance_paise || 0) !== 0 }).length
    var overdueVendors = vendors.filter(function (v) { return v.vendor_active && (v.overdue_count || 0) > 0 })

    var activeVendors = vendors.filter(function (v) { return v.vendor_active })
    var incompleteCount = activeVendors.filter(function (v) { return v.vendor_status === 'incomplete' }).length
    var outstandingClass = balanceColour(totalOutstanding)
    var dropdownFilterCount = [fExpType, fExpSubType, fCategory, fSubCategory].filter(Boolean).length
    var hasDropdownFilter = dropdownFilterCount > 0

    // Most owed first, always. The order is not a control any more: the five
    // it offered were four ways of not answering the question this list is
    // opened to answer, and the one that did was already the default.
    var sorted = filtered.slice().sort(function (a, b) {
      return (b.balance_paise || 0) - (a.balance_paise || 0)
    })

    return (
      <div className="space-y-4">
        {/* Five readings of the same list, four of which are also the filter.
            The segmented All / With Balance / Incomplete / Overdue bar is gone:
            it repeated four words that were already up here with their counts
            beside them, and a count is the part that tells you whether pressing
            it is worth anything.

            There is no Total Vendors tile, because All was already printing
            that number — the filter that shows every vendor and the count of
            every vendor are the same figure, and it was on the screen twice,
            side by side. */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Tile wide icon="wallet" tone="bg-amber-50 text-amber-600" label="Total Outstanding"
            value={formatPoints(totalOutstanding)} valueClass={outstandingClass}>
            {(totalCash !== 0 || totalBank !== 0) && (
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-y-1 text-[11px] text-slate-500">
                <Fact first icon="banknote" label="Cash" value={formatPoints(totalCash)} />
                <Fact icon="bank" label="Bank" value={formatPoints(totalBank)} />
              </div>
            )}
          </Tile>
          <Tile icon="list" tone="bg-indigo-50 text-indigo-600" label="All vendors"
            value={activeVendors.length} valueClass="text-indigo-700"
            active={statusFilter === 'all'} onClick={function () { setStatusFilter('all') }} />
          <Tile icon="clock" tone="bg-rose-50 text-rose-600" label="Overdue Vendors"
            value={overdueVendors.length} valueClass={overdueVendors.length > 0 ? 'text-rose-700' : 'text-slate-400'}
            active={statusFilter === 'overdue'} onClick={function () { setStatusFilter('overdue') }} />
          <Tile icon="checkCircle" tone="bg-emerald-50 text-emerald-600" label="With Balance"
            value={vendorsWithBalance} valueClass={vendorsWithBalance > 0 ? 'text-emerald-700' : 'text-slate-400'}
            active={statusFilter === 'with_balance'} onClick={function () { setStatusFilter('with_balance') }} />
          <Tile icon="fileText" tone="bg-amber-50 text-amber-600" label="Incomplete"
            value={incompleteCount} valueClass={incompleteCount > 0 ? 'text-amber-700' : 'text-slate-400'}
            active={statusFilter === 'incomplete'} onClick={function () { setStatusFilter('incomplete') }} />
        </div>

        {/* The search stays out, because it is the one you reach for without
            thinking. The four dropdowns go behind the funnel: they are a
            narrowing you do occasionally, and out on the bar they were four
            boxes reading "All" taking three-quarters of the width to say that
            nothing was filtered.

            The funnel carries the count, so a closed panel still tells you how
            many filters are on — otherwise hiding them hides the fact that the
            list is not showing everything. */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchField value={search} onChange={function (v) { setSearch(v) }} placeholder="Search vendors..." />
            </div>
            <button type="button" onClick={function () { setFiltersOpen(!filtersOpen) }}
              aria-label="Filters" aria-expanded={filtersOpen}
              className={"shrink-0 h-10 px-3 inline-flex items-center gap-1.5 rounded-xl border text-[12.5px] font-semibold transition-colors " +
                (filtersOpen || dropdownFilterCount > 0 ? ON : OFF)}>
              <Icon name="filter" size={16} />
              {dropdownFilterCount > 0 && <span className="tabular-nums" data-notranslate>{dropdownFilterCount}</span>}
            </button>
            {(hasDropdownFilter || search) && (
              <button type="button" aria-label="Clear filters"
                onClick={function () { setSearch(''); setFExpType(''); setFExpSubType(''); setFCategory(''); setFSubCategory('') }}
                className="shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-xl border border-slate-300 text-slate-500 hover:border-rose-300 hover:text-rose-600 transition-colors">
                <Icon name="close" size={16} />
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Expense type</label>
                <SearchDropdown
                  items={expenseTypes.map(function (t) { return { label: t.name, value: String(t.id) } })}
                  value={fExpType} onChange={function (v) { setFExpType(v) }}
                  placeholder="All" noVoice />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Expense sub-type</label>
                <SearchDropdown
                  items={(fExpType ? expenseSubTypes.filter(function (st) { return String(st.expense_type_id) === String(fExpType) }) : expenseSubTypes)
                    .map(function (st) { return { label: st.name, value: String(st.id) } })}
                  value={fExpSubType} onChange={function (v) { setFExpSubType(v) }}
                  placeholder="All" noVoice />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Item category</label>
                <SearchDropdown
                  items={categories.map(function (c) { return { label: c.name, value: String(c.id) } })}
                  value={fCategory} onChange={function (v) { setFCategory(v) }}
                  placeholder="All" noVoice />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1.5">Item sub-category</label>
                <SearchDropdown
                  items={(fCategory ? subCategories.filter(function (sc) { return String(sc.category_id) === String(fCategory) }) : subCategories)
                    .map(function (sc) { return { label: sc.name, value: String(sc.id) } })}
                  value={fSubCategory} onChange={function (v) { setFSubCategory(v) }}
                  placeholder="All" noVoice />
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm text-center py-12">Loading vendors...</p>
        ) : sorted.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-12">
            {vendors.length === 0 ? 'No vendors yet' : 'No vendors match your filter'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {sorted.map(function (v) {
              return <VendorCard key={v.vendor_id} v={v} onOpen={openVendor} />
            })}
          </div>
        )}
      </div>
    )
  }

  // ── PDF EXPORT: bank-statement style vendor ledger ──
  async function exportVendorPDF() {
    if (pdfBusy || !selectedVendor || !entries || entries.length === 0) return
    setPdfBusy(true)
    try {
      var jsPDFmod = await import('jspdf')
      var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
      var autoTableMod = await import('jspdf-autotable')
      var autoTable = autoTableMod.default || autoTableMod

      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      var fontOk = await registerPdfFont(doc)
      var FONT = fontOk ? 'NotoSans' : 'helvetica'
      var pageW = doc.internal.pageSize.getWidth()
      var pageH = doc.internal.pageSize.getHeight()

      // Chronological, deleted excluded (matches on-screen balance math)
      var chrono = entries.filter(function (e) { return !e.deleted_at }).slice().sort(function (a, b) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })

      var totalCr = 0, totalDb = 0
      chrono.forEach(function (e) {
        totalCr += (e.credit_paise || 0)
        totalDb += (e.debit_paise || 0)
      })
      var opening = selectedVendor._opening_paise || 0
      var closing = opening + totalCr - totalDb
      var oldest = chrono[0]
      var newest = chrono[chrono.length - 1]
      var periodFrom = oldest && oldest.created_at ? oldest.created_at.split('T')[0] : ''
      var periodTo   = newest && newest.created_at ? newest.created_at.split('T')[0] : ''

      var vendorName = selectedVendor.vendor_name || 'Vendor #' + selectedVendor.vendor_id
      var mm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      function fmtD(iso) {
        if (!iso) return '—'
        var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
        return String(d.getDate()).padStart(2, '0') + '-' + mm[d.getMonth()] + '-' + d.getFullYear()
      }
      function fmtN(paise) {
        return ((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      }
      function refLabelFor(e) {
        var kind = (e.metadata && e.metadata.kind) || e.ref_type || ''
        var refNo = ''
        if (e.metadata && e.metadata.purchase_number) refNo = 'PO #' + e.metadata.purchase_number
        else if (e.metadata && e.metadata.receipt_number) refNo = 'RCPT #' + e.metadata.receipt_number
        else if (e.ref_id) refNo = '#' + String(e.ref_id).slice(0, 8)
        var label = kind ? kind.toString().toUpperCase().replace(/_/g, ' ') : ''
        return label + (refNo ? '  ' + refNo : '') || '—'
      }
      // Structured Particulars lines for the hand-drawn column: a bold ref/kind
      // header, the description, then a grey chip line for mode/due-date facts.
      function particularsLinesFor(e) {
        var lines = [{ kind: 'header', text: refLabelFor(e) }]
        lines.push({ kind: 'desc', text: e.description || '—' })
        var chipParts = []
        if (e.metadata && e.metadata.mode) chipParts.push(String(e.metadata.mode).toUpperCase())
        if (e.metadata && e.metadata.due_date) chipParts.push('Due ' + fmtD(e.metadata.due_date))
        if (chipParts.length) lines.push({ kind: 'chip', text: chipParts.join('   ·   ') })
        // Per-allocation split for expense-linked rows — same breakdown the
        // on-screen entry shows (e._breakdown, built in loadEntries), so the
        // statement matches what opening the entry in the app shows.
        if (e._breakdown && e._breakdown.allocations && e._breakdown.allocations.length > 0) {
          e._breakdown.allocations.forEach(function (a) {
            var vName = a.venue_id && e._venueNames ? e._venueNames[a.venue_id] : null
            var tName = a.expense_type_id && e._typeNames ? e._typeNames[a.expense_type_id] : null
            var stName = a.expense_sub_type_id && e._subTypeNames ? e._subTypeNames[a.expense_sub_type_id] : null
            var typeLabel = tName ? (tName + (stName ? ' › ' + stName : '')) : (stName || '')
            var parts = []
            if (a.department) parts.push(a.department)
            if (typeLabel) parts.push(typeLabel)
            if (vName) parts.push(vName)
            var label = parts.length > 0 ? parts.join(' · ') : '—'
            if (a.remarks) label += ' — ' + a.remarks
            lines.push({ kind: 'alloc', text: label, amount: fmtN(a.amount_paise || 0) })
          })
          if ((e._breakdown.tax_paise || 0) > 0) {
            lines.push({ kind: 'foot', text: 'GST', amount: fmtN(e._breakdown.tax_paise) })
          }
        }
        return lines
      }

      // Header
      doc.setFont(FONT, 'bold'); doc.setFontSize(14)
      doc.text('VENDOR STATEMENT', 10, 14)
      doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(120)
      doc.text('Generated ' + new Date().toLocaleString('en-IN'), pageW - 10, 14, { align: 'right' })
      doc.setTextColor(0)

      doc.setFontSize(9)
      var y = 22
      doc.setFont(FONT, 'bold'); doc.text('Vendor:', 10, y)
      doc.setFont(FONT, 'normal'); doc.text(vendorName + '   (Vendor #' + selectedVendor.vendor_id + ')', 28, y)
      y += 5
      doc.setFont(FONT, 'bold'); doc.text('Period:', 10, y)
      doc.setFont(FONT, 'normal'); doc.text(fmtD(periodFrom) + '  to  ' + fmtD(periodTo) + '     (' + chrono.length + ' entries)', 28, y)
      y += 7

      // Summary strip
      autoTable(doc, {
        startY: y,
        head: [['Opening Balance', 'Bills (Credits)', 'Payments (Debits)', 'Closing Balance']],
        body: [[
          fmtN(opening),
          '+' + fmtN(totalCr),
          '-' + fmtN(totalDb),
          fmtN(closing),
        ]],
        styles: { font: FONT, fontSize: 9, halign: 'right', cellPadding: 2 },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold', halign: 'right', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 47.5 },
          1: { cellWidth: 47.5, textColor: [140, 90, 20] },
          2: { cellWidth: 47.5, textColor: [16, 128, 60] },
          3: { cellWidth: 47.5, fontStyle: 'bold' },
        },
        margin: { left: 10, right: 10 },
      })

      // Main ledger table (running balance recomputed chronologically, seeded with vendor opening balance)
      var running = opening
      var dateMeta = []
      var particularsMeta = []
      var body = chrono.map(function (e) {
        var isCredit = (e.credit_paise || 0) > 0
        running += (e.credit_paise || 0) - (e.debit_paise || 0)
        var dt = e.created_at ? new Date(e.created_at) : null
        var loggedCell = dt ? fmtD(e.created_at.split('T')[0]) + ' ' + dt.toTimeString().slice(0, 5) : ''
        var dm = { top: e.entry_date ? fmtD(e.entry_date) : '—', bottom: loggedCell }
        dateMeta.push(dm)
        var pLines = particularsLinesFor(e)
        particularsMeta.push(pLines)
        var cr = (e.credit_paise || 0)
        var db = (e.debit_paise || 0)
        return [
          plainDateLines(dm, 'Logged '),
          plainParticularsLines(pLines).join('\n'),
          isCredit ? fmtN(cr) : '',
          !isCredit ? fmtN(db) : '',
          fmtN(running),
        ]
      })

      var statementHooks = makeStatementCellHooks(doc, FONT, {
        dateCol: 0, particularsCol: 1, dateMeta: dateMeta, particularsMeta: particularsMeta,
        topLabel: 'ENTRY', bottomLabel: 'LOGGED',
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 6,
        // columnStyles' halign only ever reaches body cells (jspdf-autotable applies it
        // exclusively to sectionName === 'body'), so Bill/Payment/Balance need their own
        // per-cell halign here to land over the right-aligned figures below.
        head: [['Date', 'Particulars',
          { content: 'Bill (Cr)', styles: { halign: 'right' } },
          { content: 'Payment (Dr)', styles: { halign: 'right' } },
          { content: 'Balance', styles: { halign: 'right' } }]],
        body: body,
        styles: { font: FONT, fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 30, fontSize: 7 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 24, halign: 'right', textColor: [140, 90, 20] },
          3: { cellWidth: 24, halign: 'right', textColor: [16, 128, 60] },
          4: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: 10, right: 10 },
        didParseCell: statementHooks.didParseCell,
        willDrawCell: statementHooks.willDrawCell,
        didDrawCell: statementHooks.didDrawCell,
        didDrawPage: function () {
          doc.setFontSize(7); doc.setTextColor(120)
          doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 10, pageH - 6, { align: 'right' })
          doc.text('Ambria Ops · Vendor statement for ' + vendorName, 10, pageH - 6)
          doc.setTextColor(0)
        },
      })

      var safeName = vendorName.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
      await openOrSharePdf(doc, 'vendor_' + safeName + '_' + new Date().toISOString().split('T')[0] + '.pdf')
      try { await logActivity('VENDOR_LEDGER_PDF_EXPORT', vendorName + ' | ' + chrono.length + ' entries | closing ' + (closing / 100).toFixed(2)) } catch (_) {}
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  // ── DETAIL VIEW ──
  var vs = selectedVendor
  if (!vs) return null

  // Compute running balance chronologically forward (deleted rows contribute 0)
  // Seed with vendor opening balance from master (matches PDF export)
  var openingPaise = vs._opening_paise || 0
  var running = openingPaise
  var withRunning = entries.map(function (e) {
    if (!e.deleted_at) running += (e.credit_paise || 0) - (e.debit_paise || 0)
    return Object.assign({}, e, { runningBalance: e.deleted_at ? null : running })
  })
  var displayEntries = withRunning.slice().reverse()

  var currentBalance = running

  return (
    <div className="space-y-4">
      {/* Just where you came from. The overflow menu that used to sit on
          the right held one item, and a menu you have to open to reach a
          single action is two presses for what a button does in one — the
          call moved onto the header card beside the other two. */}
      <button type="button" onClick={backToList}
        className="inline-flex items-center gap-1.5 h-9 -ml-1 px-2 rounded-lg text-[13px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors">
        <Icon name="arrowLeft" size={15} />
        Vendors
      </button>

      {/* Who this is, and the three things you came here to do. The emoji are
          gone: a glyph from the set the rest of the app draws from sits on the
          text's baseline and takes its colour, which a font-dependent picture
          of a banknote does not. */}
      <div className="flex flex-wrap items-center gap-4 bg-white border border-slate-200 rounded-2xl px-5 py-4">
        {/* One initial circle here, where the list has none. On the list it
            was sixty first letters in six colours down the left of a column
            you read by name; here it is the one thing on the page that says
            which vendor you are looking at, so a mark beside the name helps
            rather than repeats. */}
        <span aria-hidden="true" className={'shrink-0 w-12 h-12 rounded-full inline-flex items-center justify-center text-[17px] font-bold ' + avatarTint(vs.vendor_name)}>
          {(vs.vendor_name || '?').trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="font-display text-[19px] font-bold text-slate-900 truncate">{vs.vendor_name || '—'}</h2>
            {vs.vendor_status === 'incomplete' && (
              <span className="shrink-0 h-6 inline-flex items-center px-2.5 rounded-md bg-amber-100 text-[10.5px] font-bold uppercase tracking-[0.04em] text-amber-700">
                Incomplete
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-slate-500" data-notranslate>Vendor #{vs.vendor_id}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button type="button" onClick={payVendor}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition-all">
            <Icon name="banknote" size={15} />
            Pay Vendor
          </button>
          {vs._phone && (
            <a href={'tel:' + vs._phone.replace(/[^0-9+]/g, '')}
              title={'Call ' + (vs._contact || vs.vendor_name || 'vendor') + (vs._phone2 ? ' · alt: ' + vs._phone2 : '')}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-[13px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] no-underline transition-all">
              <Icon name="phone" size={15} />
              Call
            </a>
          )}
          <button type="button" onClick={exportVendorPDF}
            disabled={pdfBusy || !entries || entries.length === 0}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-[13px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all">
            <Icon name={pdfBusy ? 'refresh' : 'fileText'} size={15} />
            {pdfBusy ? 'Building…' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Six readings of this vendor, the balance given the room the other five
          do not need. They were a paragraph under the name — a 3xl figure, then
          two facts in one grey line, then a red strip — which is a lot of
          different shapes for six numbers. */}
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
        {/* White, like the five beside it. The amber face and the amber
            figure made this tile a warning, and an outstanding balance is
            the ordinary state of a vendor ledger — the thing that is
            actually wrong is the overdue note under it, which is the one
            red on the page. */}
        <Tile wide icon="wallet" tone="bg-slate-100 text-slate-600" label="Outstanding Balance"
          value={formatPoints(currentBalance)} valueClass={balanceColour(currentBalance)}>
          {openingPaise !== 0 && (
            <p className="mt-2 self-start text-[11.5px] font-semibold text-slate-500">
              Includes opening: <span className="text-slate-700" data-notranslate>{formatPoints(Math.abs(openingPaise))} {openingPaise > 0 ? 'Cr' : 'Dr'}</span>
            </p>
          )}
          {/* self-start, because the tile is a flex column and a flex item
              stretches to the column's width by default — which is how a chip
              ended up as a full-width bar. And the wording is one span rather
              than a count beside a text run: three flex items meant the gap
              fell between the number and the word after it as well as after
              the glyph, so it read as "1  overdue". */}
          {(vs.overdue_count || 0) > 0 && (
            <p className="mt-2.5 self-start inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md bg-rose-100 text-[11px] font-bold text-rose-700 whitespace-nowrap">
              <Icon name="alert" size={12} className="shrink-0" />
              <span>
                <span data-notranslate>{vs.overdue_count}</span> overdue · earliest {formatDate(vs.earliest_due_date)}
              </span>
            </p>
          )}
        </Tile>
        <Tile small icon="banknote" tone="bg-emerald-50 text-emerald-600" label="Cash"
          value={formatPoints(vs.cash_balance_paise || 0)} valueClass="text-slate-900" />
        <Tile small icon="bank" tone="bg-indigo-50 text-indigo-600" label="Bank"
          value={formatPoints(vs.bank_balance_paise || 0)} valueClass="text-slate-900" />
        <Tile small icon="fileText" tone="bg-slate-100 text-slate-500" label="Total Entries"
          value={entries.length} valueClass="text-slate-900" />
        <Tile small icon="calendar" tone="bg-violet-50 text-violet-600" label="Last Entry"
          value={vs.last_entry_date ? shortDate(vs.last_entry_date) : '—'}
          valueClass={vs.last_entry_date ? 'text-slate-900' : 'text-slate-400'} />
        <Tile small icon="clock" tone="bg-rose-50 text-rose-600" label="Earliest Due"
          value={vs.earliest_due_date ? shortDate(vs.earliest_due_date) : '—'}
          valueClass={vs.earliest_due_date ? 'text-slate-900' : 'text-slate-400'} />
      </div>

      {/* Admin toggle: show deleted */}
      {isAdmin && (
        <label className="inline-flex items-center gap-2 text-[12px] font-medium text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showDeleted}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
            onChange={function (e) { toggleShowDeleted(e.target.checked) }} />
          Show deleted entries (audit)
        </label>
      )}

      {/* Pay Vendor modal (shared component) */}
      {showPayModal && selectedVendor && (
        <PayVendorModal
          vendor={selectedVendor}
          profile={profile}
          onClose={function () { setShowPayModal(false) }}
          onSuccess={onPaymentSuccess}
        />
      )}

      {/* Entries list */}
      {entriesLoading ? (
        <p className="text-slate-400 text-[13px] font-medium text-center py-10">Loading entries…</p>
      ) : displayEntries.length === 0 ? (
        <p className="text-slate-400 text-[13px] font-medium text-center py-10">No entries for this vendor.</p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {displayEntries.map(function (e, idx) {
            var isCredit = (e.credit_paise || 0) > 0
            var isDeleted = !!e.deleted_at
            var amt = isCredit ? (e.credit_paise || 0) : (e.debit_paise || 0)
            // GST-driven fractional-rupee amounts (e.g. 7,584.84) are exact in the
            // ledger, but the headline figure shows the same rounded whole-rupee
            // total as "Grand total (rounded)" in the breakdown panel below, so the
            // two don't visibly disagree on the same entry.
            var headlineAmt = e._breakdown ? Math.round(e._breakdown.amount_paise / 100) * 100 : amt
            var kind = e.metadata && e.metadata.kind ? e.metadata.kind : e.ref_type
            var dotColor = isDeleted ? 'bg-slate-300' : isCredit ? 'bg-amber-500' : 'bg-emerald-500'
            var isExpRow = e.ref_type === 'expense' && e.ref_id && /^[0-9]+$/.test(String(e.ref_id)) && !isDeleted
            function handleRowClick() {
              if (!isExpRow) return
              openExpenseDetail(Number(e.ref_id))
            }
            return (
              <div key={e.id}
                onClick={handleRowClick}
                className={"flex items-start gap-3.5 px-4 py-4 " +
                  (idx < displayEntries.length - 1 ? "border-b border-slate-100 " : "") +
                  (isDeleted ? "opacity-50" : "") +
                  (isExpRow ? " cursor-pointer hover:bg-indigo-50/40 transition-colors" : "")}>
                <span aria-hidden="true" className={"shrink-0 w-2.5 h-2.5 rounded-full mt-2 " + dotColor} />
                <div className="flex-1 min-w-0">
                  <p className={"text-[15px] font-bold text-slate-900 leading-snug " + (isDeleted ? "line-through" : "")}>
                    {e.description || (isCredit ? 'Credit' : 'Debit')}
                  </p>
                  {/* One band, not three stacked lines. Date and reference on
                      one, "Logged …" on another and "Submitted by …" on a
                      third gave three runs of grey text at almost the same
                      size with nothing to say which was which — and the name
                      appeared on two of them. A glyph apiece and a rule
                      between says what kind of fact each one is, and the band
                      wraps instead of growing a new line per fact. */}
                  {(function () {
                    var facts = [
                      { icon: 'calendar', value: formatDate(e.entry_date) },
                      { icon: 'receipt', value: kind + (e.ref_id ? ' #' + e.ref_id : '') },
                      e._creatorName ? { icon: 'user', lead: 'by', value: e._creatorName } : null,
                      { icon: 'clock', label: 'Logged', value: formatDateTime(e.created_at) },
                      e._submitterName ? { icon: 'send', lead: 'Submitted by', value: e._submitterName } : null,
                      e._acknowledgerName ? { icon: 'checkCircle', lead: 'Acknowledged by', value: e._acknowledgerName } : null,
                      isDeleted ? { icon: 'trash', value: 'Deleted' } : null,
                    ].filter(Boolean)
                    return (
                      <div className="mt-1.5 flex flex-wrap items-center gap-y-1.5 text-[12px] text-slate-500">
                        {facts.map(function (f, fi) {
                          return <Fact key={fi} first={fi === 0} icon={f.icon} label={f.label} lead={f.lead} value={f.value} />
                        })}
                      </div>
                    )
                  })()}
                  {(function () {
                    var meta = e.metadata || {}
                    var m = meta.mode
                    var due = meta.due_date
                    var isOverdueRow = kind === 'purchase' && due && due < new Date().toISOString().split('T')[0]
                    if (!m && !due) return null
                    return (
                      <div className="flex gap-1.5 mt-2.5 flex-wrap">
                        {/* Glyphs from the set the rest of the app draws from,
                            not emoji. An emoji is a picture the font picks, so
                            it sits off the baseline, keeps its own colour and
                            is a different size on every machine — three things
                            a chip this small cannot absorb. */}
                        {m && (
                          <span className="h-6 inline-flex items-center gap-1.5 px-2.5 rounded-md bg-indigo-50 text-[10.5px] font-bold text-indigo-700">
                            <Icon name={m === 'cash' ? 'banknote' : 'bank'} size={12} />
                            {m === 'cash' ? 'Cash' : 'Bank'}
                          </span>
                        )}
                        {due && (
                          <span className={"h-6 inline-flex items-center gap-1.5 px-2.5 rounded-md text-[10.5px] font-bold " + (isOverdueRow ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600")}>
                            <Icon name={isOverdueRow ? 'alert' : 'clock'} size={12} />
                            Due {due}
                          </span>
                        )}
                      </div>
                    )
                  })()}
                  <div onClick={function (ev) { ev.stopPropagation() }}>
                    <PaymentProofThumbs meta={e.metadata} />
                  </div>
                  {e._sourceReceipts && e._sourceReceipts.length > 0 && (
                    <div onClick={function (ev) { ev.stopPropagation() }}>
                      <LedgerSourceMedia paths={e._sourceReceipts} />
                    </div>
                  )}
                  {e._breakdown && (function () {
                    var b = e._breakdown
                    var totalPaise = b.amount_paise
                    var taxPaise = b.tax_paise || 0
                    var basePaise = totalPaise - taxPaise
                    var roundedTotalPaise = Math.round(totalPaise / 100) * 100
                    var roundOffPaise = roundedTotalPaise - totalPaise
                    var hasRoundOff = roundOffPaise !== 0
                    // Two cards, side by side once there is room. The breakdown
                    // is a short column of totals and the allocations are a
                    // long column of lines, so stacking them made a tall narrow
                    // strip with a lot of empty space beside the first half of
                    // it. Each gets a heading with its own glyph, the way the
                    // rest of this screen labels a box.
                    return (
                      <div className="mt-3.5 grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
                        <div className="bg-white border border-slate-200 rounded-xl p-4">
                          <p className="flex items-center gap-2 mb-3 text-[11.5px] font-bold uppercase tracking-[0.06em] text-slate-500">
                            <Icon name="calculator" size={14} className="text-slate-400" />
                            Amount Breakdown
                          </p>
                          <div className="text-[13px] space-y-1.5" data-notranslate>
                            <div className="flex justify-between gap-3 text-slate-600"><span>Base</span><span className="tabular-nums">{formatPoints(basePaise)}</span></div>
                            {taxPaise > 0 && (
                              <div className="flex justify-between gap-3 text-slate-600"><span>GST</span><span className="tabular-nums">{formatPoints(taxPaise)}</span></div>
                            )}
                            <div className="flex justify-between gap-3 text-slate-600 pt-1.5 border-t border-slate-100"><span>Sub-total</span><span className="tabular-nums">{formatPoints(totalPaise)}</span></div>
                            {hasRoundOff && (
                              <div className="flex justify-between gap-3 text-amber-700"><span>Round off</span><span className="tabular-nums">{roundOffPaise > 0 ? '+' : ''}{formatPoints(roundOffPaise)}</span></div>
                            )}
                            <div className="flex justify-between gap-3 pt-2 border-t border-slate-200 text-[13.5px] font-bold text-slate-900">
                              <span>Grand total{hasRoundOff ? ' (rounded)' : ''}</span>
                              <span className="tabular-nums">{formatPoints(roundedTotalPaise)}</span>
                            </div>
                          </div>
                        </div>

                        {b.allocations && b.allocations.length > 0 && (
                          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4">
                            <p className="flex items-center gap-2 mb-3 text-[11.5px] font-bold uppercase tracking-[0.06em] text-slate-500">
                              <Icon name="split" size={14} className="text-slate-400" />
                              Allocation{b.allocations.length > 1 ? 's' : ''}
                            </p>
                            <div className="space-y-2">
                              {b.allocations.map(function (a, ai) {
                                var vName = a.venue_id && e._venueNames ? e._venueNames[a.venue_id] : null
                                var tName = a.expense_type_id && e._typeNames ? e._typeNames[a.expense_type_id] : null
                                var stName = a.expense_sub_type_id && e._subTypeNames ? e._subTypeNames[a.expense_sub_type_id] : null
                                var typeLabel = tName ? (tName + ' › ' + stName) : (stName || '')
                                if (tName && !stName) typeLabel = tName
                                var parts = []
                                if (a.department) parts.push(a.department)
                                if (typeLabel) parts.push(typeLabel)
                                if (vName) parts.push(vName)
                                return (
                                  <div key={ai} className="flex justify-between gap-4 text-[13px] text-slate-600 leading-snug">
                                    <span className="min-w-0">{parts.length > 0 ? parts.join(' · ') : '—'}{a.remarks ? ' — ' + a.remarks : ''}</span>
                                    <span className="shrink-0 font-semibold tabular-nums text-slate-800" data-notranslate>{formatPoints(a.amount_paise || 0)}</span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
                {/* One column, aligned to its right edge, with the figure
                    and its running balance as one block and the two controls
                    as another. They were four right-aligned things at four
                    sizes with a different margin under each, so nothing in
                    the column shared an edge with anything but the wall. */}
                <div className="shrink-0 flex flex-col items-end gap-2.5">
                  <div className="text-right">
                    <p className={"text-[16px] font-bold tabular-nums whitespace-nowrap " + (isCredit ? "text-amber-700" : "text-emerald-700")} data-notranslate>
                      {isCredit ? '+' : '−'}{formatPoints(headlineAmt)}
                    </p>
                    {/* The two are different facts — what this entry was worth,
                        and what the vendor stood at after it — but on the first
                        entry of a vendor with no opening balance they are the
                        same number, and printing it twice one under the other
                        reads as a bug rather than as a coincidence. Shown when
                        it says something the figure above it does not. */}
                    {!isDeleted && e.runningBalance !== headlineAmt && (
                      <p className="mt-1 text-[12px] text-slate-400 tabular-nums whitespace-nowrap" data-notranslate>Bal: {formatPoints(e.runningBalance)}</p>
                    )}
                  </div>
                  {!isDeleted && isExpRow && e._expChecked && (
                    <div className="flex justify-end">
                      <CheckedStamp
                        checked={!!e._expChecked.checked_by}
                        checkerName={e._expCheckedByName}
                        checkedAt={e._expChecked.checked_at}
                        canToggle={canMarkChecked}
                        canUncheck={e._expChecked.checked_by === profile.id || isAdmin}
                        busy={checkingEntryId === Number(e.ref_id)}
                        onToggle={function (ev) { ev.stopPropagation(); toggleExpenseCheck(Number(e.ref_id)) }}
                      />
                    </div>
                  )}
                  {!isDeleted && !isExpRow && (
                    <div className="flex justify-end">
                      <CheckedStamp
                        checked={!!e.checked_by}
                        checkerName={e._checkedByName}
                        checkedAt={e.checked_at}
                        canToggle={canMarkChecked}
                        canUncheck={e.checked_by === profile.id || isAdmin}
                        busy={checkingEntryId === e.id}
                        onToggle={function (ev) { ev.stopPropagation(); toggleLedgerCheck(e.id) }}
                      />
                    </div>
                  )}
                  {isAdmin && !isDeleted && (
                    <button onClick={function (ev) { ev.stopPropagation(); reverseEntry(e.id) }}
                      // The same box as the Checked stamp beside it: they sit
                      // one under the other in a narrow column, so two chips a
                      // few pixels different in height read as misaligned
                      // rather than as two different kinds of thing.
                      className="h-[22px] inline-flex items-center gap-1 px-2 rounded-md border border-slate-200 bg-white text-[9px] font-bold uppercase tracking-[0.04em] text-slate-600 hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50 transition-colors">
                      <Icon name="reverse" size={10} />
                      Reverse
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {expenseDetailModal}
    </div>
  )
}

export default VendorLedger