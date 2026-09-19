import { useState, useEffect } from 'react'
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
        (large ? 'px-3 py-1.5 text-[14px] ' : 'px-2.5 py-1 text-[12.5px] ') + tone}>
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
function Tile({ icon, tone, label, value, valueClass, wide, active, onClick, children }) {
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
    (active ? 'bg-indigo-50 ' : 'bg-white ') +
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
          <p className={'mt-1.5 font-display font-extrabold tabular-nums leading-none tracking-[-0.02em] ' + (wide ? 'text-[24px] ' : 'text-[22px] ') + valueClass} data-notranslate>{value}</p>
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
    <span className={"shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-[0.04em] whitespace-nowrap " +
      (alarm ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-white border-slate-200 text-slate-600")}>
      <Icon name={icon} size={11} className={alarm ? "text-rose-500" : "text-slate-500"} />
      {label}
    </span>
  )
}

// One fact in a footer: a glyph, what it is, and the value in the darker grey
// so the value is what you land on rather than its label.
function Fact({ icon, label, value, first }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap">
      {!first && <span aria-hidden="true" className="mx-2.5 w-px h-3.5 bg-slate-200" />}
      <Icon name={icon} size={12} className="shrink-0 mr-1.5 text-slate-400" />
      {label ? label + ': ' : ''}
      <span className="ml-1 font-semibold text-slate-700" data-notranslate>{value}</span>
    </span>
  )
}

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

  async function openVendor(v) {
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
  }

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

    function renderFacts(v) {
      var facts = [
        { icon: 'fileText', value: (v.entry_count || 0) + ' entries' },
        v.last_entry_date ? { icon: 'calendar', label: 'Last', value: formatDate(v.last_entry_date) } : null,
        v.earliest_due_date ? { icon: 'clock', label: 'Earliest due', value: formatDate(v.earliest_due_date) } : null,
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
        <div className="mt-1.5 flex flex-wrap items-center gap-y-1 text-[11px] text-slate-500">
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
          className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-emerald-300 hover:text-emerald-700 no-underline transition-colors">
          <Icon name="phone" size={14} />
        </a>
      )
    }

    // A card and a row are the same facts in two shapes, in the same order:
    // who, what state it is in, how much, then the history under a rule.
    function renderVendorCard(v) {
      var bal = v.balance_paise || 0
      return (
        <button key={v.vendor_id} type="button" onClick={function () { openVendor(v) }}
          // The card lifts off the page rather than only changing colour: a
          // tint and a border tint are both flat, so on a grid of sixty the
          // one under the pointer was a slightly different white. transform-gpu
          // keeps the lift off the layout, and the press puts it back down.
          className="group text-left w-full bg-white border border-slate-200 rounded-2xl p-3.5 transform-gpu transition-all duration-150 hover:border-indigo-300 hover:bg-indigo-50/30 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(79,70,229,0.10)] active:translate-y-0 active:shadow-none active:scale-[0.995] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30">
          {/* No initial circle. A person's avatar stands in for a face you
              would recognise; a vendor's first letter is just the first letter
              of the name printed beside it, in a colour that means nothing. */}
          {/* The name leads and the balance sits beside it in a pill, the way
              the wallet list sets a row. As a 19px figure on its own line the
              amount was the headline and the vendor it belonged to was the
              caption — which is backwards for a list you scan by name. */}
          <div className="flex items-start gap-2">
            <p className="flex-1 min-w-0 text-[14.5px] font-bold text-slate-900 truncate transition-colors group-hover:text-indigo-700">{v.vendor_name || '—'}</p>
            {renderChips(v)}
            <BalancePill paise={bal} large />
          </div>
          <div className="mt-2 flex items-end gap-3">
            <div className="flex-1 min-w-0">{renderMoneyNotes(v)}</div>
            {renderCallLink(v)}
            {/* The chevron slides the way it points, so the card says where
                pressing it goes rather than only that it can be pressed. */}
            <span aria-hidden="true" className="shrink-0 self-center text-slate-300 transition-all duration-150 group-hover:text-indigo-500 group-hover:translate-x-0.5">
              <Icon name="chevronRight" size={16} />
            </span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-y-1 text-[11px] text-slate-500">
            {renderFacts(v)}
          </div>
        </button>
      )
    }

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
            {sorted.map(renderVendorCard)}
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
  var balColor = currentBalance > 0 ? 'text-amber-800' : currentBalance < 0 ? 'text-red-700' : 'text-gray-500'

  return (
    <div className="space-y-4">
      <button onClick={backToList} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors">
        ← Back to vendors
      </button>

      {/* Vendor header card */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-gray-900 truncate">{vs.vendor_name || '—'}</h3>
              {vs.vendor_status === 'incomplete' && (
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-amber-100 text-amber-700 rounded">Incomplete</span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">Vendor #{vs.vendor_id}</p>
          </div>
          <button onClick={payVendor}
            className="px-3 py-2 text-xs font-bold rounded-lg transition-colors flex-shrink-0 bg-indigo-600 text-white hover:bg-indigo-700">
            💸 Pay Vendor
          </button>
          {vs._phone && (
            <a href={'tel:' + vs._phone.replace(/[^0-9+]/g, '')}
              title={'Call ' + (vs._contact || vs.vendor_name || 'vendor') + (vs._phone2 ? ' · alt: ' + vs._phone2 : '')}
              className="px-3 py-2 text-xs font-bold rounded-lg transition-colors flex-shrink-0 bg-green-600 text-white hover:bg-green-700 no-underline">
              📞 Call
            </a>
          )}
          <button onClick={exportVendorPDF}
            disabled={pdfBusy || !entries || entries.length === 0}
            className="px-3 py-2 text-sm font-bold rounded-lg transition-colors bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed">
            {pdfBusy ? 'Building…' : '📄 PDF'}
          </button>
        </div>
        <div className="border-t border-gray-100 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Outstanding Balance</p>
          <p className={"text-3xl font-bold " + balColor}>{formatPoints(currentBalance)}</p>
          {openingPaise !== 0 && (
            <p className={"text-[11px] font-semibold mt-0.5 " + (openingPaise > 0 ? "text-amber-700" : "text-green-700")}>
              Includes opening: {formatPoints(Math.abs(openingPaise))} {openingPaise > 0 ? 'Cr' : 'Dr'}
            </p>
          )}
          {((vs.cash_balance_paise || 0) !== 0 || (vs.bank_balance_paise || 0) !== 0) && (
            <div className="flex gap-3 mt-2 text-xs">
              <span className="text-gray-600">💵 Cash: <span className="font-semibold text-gray-900">{formatPoints(vs.cash_balance_paise || 0)}</span></span>
              <span className="text-gray-600">🏦 Bank: <span className="font-semibold text-gray-900">{formatPoints(vs.bank_balance_paise || 0)}</span></span>
            </div>
          )}
          {(vs.overdue_count || 0) > 0 && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 bg-red-50 border border-red-200 rounded text-[11px] text-red-700 font-medium">
              ⚠ {vs.overdue_count} overdue · earliest {vs.earliest_due_date}
            </div>
          )}
        </div>
      </div>

      {/* Admin toggle: show deleted */}
      {isAdmin && (
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showDeleted}
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
        <p className="text-gray-400 text-sm text-center py-8">Loading entries...</p>
      ) : displayEntries.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">No entries for this vendor.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
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
            var dotColor = isDeleted ? 'bg-gray-300' : isCredit ? 'bg-amber-500' : 'bg-green-500'
            var isExpRow = e.ref_type === 'expense' && e.ref_id && /^[0-9]+$/.test(String(e.ref_id)) && !isDeleted
            function handleRowClick() {
              if (!isExpRow) return
              openExpenseDetail(Number(e.ref_id))
            }
            return (
              <div key={e.id}
                onClick={handleRowClick}
                className={"flex items-start gap-3 px-3 py-3 " +
                  (idx < displayEntries.length - 1 ? "border-b border-gray-100 " : "") +
                  (isDeleted ? "opacity-50" : "") +
                  (isExpRow ? " cursor-pointer hover:bg-indigo-50/40 transition-colors" : "")}>
                <div className={"w-2 h-2 rounded-full mt-1.5 flex-shrink-0 " + dotColor}></div>
                <div className="flex-1 min-w-0">
                  <p className={"text-sm font-medium text-gray-900 " + (isDeleted ? "line-through" : "")}>
                    {e.description || (isCredit ? 'Credit' : 'Debit')}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {formatDate(e.entry_date)} · {kind} #{e.ref_id}
                    {e._creatorName && ' · by ' + e._creatorName}
                    {isDeleted && ' · deleted'}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Logged {formatDateTime(e.created_at)}</p>
                  {(e._submitterName || e._acknowledgerName) && (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {e._submitterName && 'Submitted by ' + e._submitterName}
                      {e._submitterName && e._acknowledgerName && ' · '}
                      {e._acknowledgerName && 'Acknowledged by ' + e._acknowledgerName}
                    </p>
                  )}
                  {(function () {
                    var meta = e.metadata || {}
                    var m = meta.mode
                    var due = meta.due_date
                    var isOverdueRow = kind === 'purchase' && due && due < new Date().toISOString().split('T')[0]
                    if (!m && !due) return null
                    return (
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        {m && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                            {m === 'cash' ? '💵 Cash' : '🏦 Bank'}
                          </span>
                        )}
                        {due && (
                          <span className={"text-[10px] font-semibold px-1.5 py-0.5 border rounded " + (isOverdueRow ? "bg-red-50 text-red-700 border-red-200" : "bg-gray-50 text-gray-700 border-gray-200")}>
                            {isOverdueRow ? '⚠ Due ' : 'Due '}{due}
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
                    return (
                      <div className="mt-2 p-2.5 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                        <div className="text-[11px]">
                          <div className="font-bold uppercase text-[9px] tracking-wider text-gray-500 mb-1">Amount breakdown</div>
                          <div className="flex justify-between text-gray-700"><span>Base</span><span>{formatPoints(basePaise)}</span></div>
                          {taxPaise > 0 && (
                            <div className="flex justify-between text-gray-700"><span>GST</span><span>{formatPoints(taxPaise)}</span></div>
                          )}
                          <div className="flex justify-between text-gray-700 pt-1 border-t border-gray-200 mt-1"><span>Sub-total</span><span>{formatPoints(totalPaise)}</span></div>
                          {hasRoundOff && (
                            <div className="flex justify-between text-amber-700"><span>Round off</span><span>{roundOffPaise > 0 ? '+' : ''}{formatPoints(roundOffPaise)}</span></div>
                          )}
                          <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-300 mt-1">
                            <span>Grand total{hasRoundOff ? ' (rounded)' : ''}</span>
                            <span>{formatPoints(roundedTotalPaise)}</span>
                          </div>
                        </div>
                        {b.allocations && b.allocations.length > 0 && (
                          <div className="text-[11px] pt-2 border-t border-gray-200">
                            <div className="font-bold uppercase text-[9px] tracking-wider text-gray-500 mb-1">Allocation{b.allocations.length > 1 ? 's' : ''}</div>
                            {b.allocations.map(function (a, ai) {
                              var vName = a.venue_id && e._venueNames ? e._venueNames[a.venue_id] : null
                              var tName = a.expense_type_id && e._typeNames ? e._typeNames[a.expense_type_id] : null
                              var stName = a.expense_sub_type_id && e._subTypeNames ? e._subTypeNames[a.expense_sub_type_id] : null
                              var typeLabel = tName ? (tName + (stName ? ' › ' + stName : '')) : (stName || '')
                              var parts = []
                              if (a.department) parts.push(a.department)
                              if (typeLabel) parts.push(typeLabel)
                              if (vName) parts.push(vName)
                              return (
                                <div key={ai} className="flex justify-between gap-2 text-gray-700 py-0.5">
                                  <span className="truncate">{parts.length > 0 ? parts.join(' · ') : '—'}{a.remarks ? ' — ' + a.remarks : ''}</span>
                                  <span className="flex-shrink-0 font-medium">{formatPoints(a.amount_paise || 0)}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={"text-sm font-bold " + (isCredit ? "text-amber-800" : "text-green-700")}>
                    {isCredit ? '+' : '−'}{formatPoints(headlineAmt)}
                  </p>
                  {!isDeleted && (
                    <p className="text-[10px] text-gray-400">Bal: {formatPoints(e.runningBalance)}</p>
                  )}
                  {!isDeleted && isExpRow && e._expChecked && (
                    <div className="mt-1 flex justify-end">
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
                    <div className="mt-1 flex justify-end">
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
                      className="text-[10px] text-red-500 hover:text-red-700 mt-1 font-medium">
                      ↩ Reverse
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