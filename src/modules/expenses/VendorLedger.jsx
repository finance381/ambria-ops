import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'
import PayVendorModal from './PayVendorModal'
import PaymentProofThumbs from '../../components/ledger/PaymentProofThumbs'
import SearchDropdown from '../../components/ui/SearchDropdown'
import ExpenseDetail from './ExpenseDetail'
import LedgerSourceMedia from '../../components/ledger/LedgerSourceMedia'

// Cached Unicode font for jsPDF — loaded once per session on first PDF export.
var _pdfFontCache = { regular: null, bold: null }

async function _fetchTtfBase64(url) {
  var r = await fetch(url)
  if (!r.ok) throw new Error('font ' + url + ' → HTTP ' + r.status)
  var buf = await r.arrayBuffer()
  var bytes = new Uint8Array(buf)
  var chunk = 0x8000
  var pieces = []
  for (var i = 0; i < bytes.length; i += chunk) {
    pieces.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)))
  }
  return btoa(pieces.join(''))
}

async function _registerPdfFont(doc) {
  try {
    if (!_pdfFontCache.regular || !_pdfFontCache.bold) {
      var REG_URL = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf'
      var BLD_URL = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf'
      var results = await Promise.all([_fetchTtfBase64(REG_URL), _fetchTtfBase64(BLD_URL)])
      _pdfFontCache.regular = results[0]
      _pdfFontCache.bold = results[1]
    }
    doc.addFileToVFS('NotoSans-Regular.ttf', _pdfFontCache.regular)
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal')
    doc.addFileToVFS('NotoSans-Bold.ttf', _pdfFontCache.bold)
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold')
    return true
  } catch (e) {
    console.warn('PDF font load failed, using helvetica fallback:', e.message)
    return false
  }
}

function VendorLedger({ profile }) {
  var perms = (profile && profile.permissions) || []
  var isAdmin = perms.indexOf('feature_admin') !== -1
  var canView = isAdmin || perms.indexOf('feature_vendor_ledger') !== -1

  var [view, setView] = useState('list')  // 'list' | 'detail'
  var [vendors, setVendors] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [statusFilter, setStatusFilter] = useState('all')  // 'all' | 'with_balance' | 'incomplete'

  // Filter dropdowns (all optional, cascade where hierarchical)
  var [fExpType, setFExpType] = useState('')
  var [fExpSubType, setFExpSubType] = useState('')
  var [fCategory, setFCategory] = useState('')
  var [fSubCategory, setFSubCategory] = useState('')
  var [expenseTypes, setExpenseTypes] = useState([])
  var [expenseSubTypes, setExpenseSubTypes] = useState([])
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  // vendorTags: { [vendor_id]: { types:[], subTypes:[], cats:[], subCats:[] } }
  var [vendorTags, setVendorTags] = useState({})

  var [selectedVendor, setSelectedVendor] = useState(null)
  var [entries, setEntries] = useState([])
  var [entriesLoading, setEntriesLoading] = useState(false)
  var [expenseDetailTarget, setExpenseDetailTarget] = useState(null)  // hydrated expense row for overlay
  var [expenseDetailLoading, setExpenseDetailLoading] = useState(false)

  async function openExpenseDetail(expenseId) {
    if (!expenseId) return
    setExpenseDetailLoading(true)
    setExpenseDetailTarget({ _placeholder: true, id: expenseId })
    var { data: row, error } = await supabase.from('expenses')
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name), expense_allocations(department, department_id, venue_id, amount_paise)')
      .eq('id', Number(expenseId)).maybeSingle()
    setExpenseDetailLoading(false)
    if (error || !row) { alert('Expense not found: ' + (error?.message || 'missing')); setExpenseDetailTarget(null); return }
    setExpenseDetailTarget(row)
  }

  function closeExpenseDetail(refresh) {
    setExpenseDetailTarget(null)
    if (refresh && selectedVendor) { loadEntries(selectedVendor, showDeleted) }
  }

  function renderExpenseDetailModal() {
    if (!expenseDetailTarget) return null
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
        onClick={function () { closeExpenseDetail(false) }}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl p-4 sm:p-5 min-h-screen sm:min-h-0 sm:max-h-[92vh] overflow-y-auto"
          onClick={function (ev) { ev.stopPropagation() }}>
          {expenseDetailLoading || expenseDetailTarget._placeholder ? (
            <div className="py-16 text-center text-sm text-gray-500">Loading expense…</div>
          ) : (
            <ExpenseDetail
              key={expenseDetailTarget.id}
              exp={expenseDetailTarget}
              profile={profile}
              isAdmin={isAdmin}
              isDeptApprover={false}
              onBack={function () { closeExpenseDetail(false) }}
              onUpdated={function () { closeExpenseDetail(true) }}
              onEdit={function () { alert('To edit this expense, please open the Expenses tab.'); closeExpenseDetail(false) }}
              onRaiseGV={function () { alert('To raise a General Voucher, please open the Expenses tab.'); closeExpenseDetail(false) }}
            />
          )}
        </div>
      </div>
    )
  }
  var [showDeleted, setShowDeleted] = useState(false)

  useEffect(function () {
    if (canView) { loadVendors(); loadFilterData() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cascade: clearing parent clears its child; changing parent clears child too
  useEffect(function () { setFExpSubType('') }, [fExpType])
  useEffect(function () { setFSubCategory('') }, [fCategory])

  async function loadFilterData() {
    // Reference tables for the 4 dropdowns
    var [rTypes, rSubTypes, rCats, rSubCats] = await Promise.all([
      supabase.from('expense_types').select('id, name').order('name'),
      supabase.from('expense_sub_types').select('id, name, expense_type_id').order('name'),
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('sub_categories').select('id, name, category_id').order('name')
    ])
    setExpenseTypes(rTypes.data || [])
    setExpenseSubTypes(rSubTypes.data || [])
    setCategories(rCats.data || [])
    setSubCategories(rSubCats.data || [])

    // ── Build vendor→tags map ──
    // 1. Vendor ↔ expense linkage via ledger_entries
    var { data: entriesRaw } = await supabase.from('ledger_entries')
      .select('party_id, ref_id')
      .eq('ledger_type', 'vendor')
      .eq('ref_type', 'expense')
      .not('ref_id', 'is', null)
      .limit(50000)
    var vendorExpMap = {}  // vendor_id → [expense_id]
    var allExpIds = []
    ;(entriesRaw || []).forEach(function (le) {
      if (!/^[0-9]+$/.test(String(le.ref_id))) return
      var eid = Number(le.ref_id)
      var vid = String(le.party_id)
      if (!vendorExpMap[vid]) vendorExpMap[vid] = []
      if (vendorExpMap[vid].indexOf(eid) === -1) vendorExpMap[vid].push(eid)
      if (allExpIds.indexOf(eid) === -1) allExpIds.push(eid)
    })
    // 2. Fetch type/sub-type for those expenses (chunked)
    var expTagMap = {}  // expense_id → { t, st }
    var i, chunk, exps
    for (i = 0; i < allExpIds.length; i += 500) {
      chunk = allExpIds.slice(i, i + 500)
      var r1 = await supabase.from('expenses')
        .select('id, expense_type_id, expense_sub_type_id')
        .in('id', chunk)
      exps = r1.data || []
      exps.forEach(function (e) { expTagMap[e.id] = { t: e.expense_type_id, st: e.expense_sub_type_id } })
    }
    // 3. PO items → vendor_name, category_id, item_id (for sub-category lookup)
    var { data: poItems } = await supabase.from('purchase_order_items')
      .select('vendor_name, category_id, item_id')
      .not('vendor_name', 'is', null)
      .limit(50000)
    // 4. Sub-cat via inventory_items for referenced item_ids
    var itemIds = []
    ;(poItems || []).forEach(function (pi) {
      if (pi.item_id && itemIds.indexOf(pi.item_id) === -1) itemIds.push(pi.item_id)
    })
    var itemSubCatMap = {}
    for (i = 0; i < itemIds.length; i += 500) {
      chunk = itemIds.slice(i, i + 500)
      var r2 = await supabase.from('inventory_items')
        .select('id, sub_category_id')
        .in('id', chunk)
      ;(r2.data || []).forEach(function (it) { if (it.sub_category_id) itemSubCatMap[it.id] = it.sub_category_id })
    }
    // Build vendor_name (lowercased) → { cats, subCats }
    var vendorNameTagMap = {}
    ;(poItems || []).forEach(function (pi) {
      var nm = (pi.vendor_name || '').trim().toLowerCase()
      if (!nm) return
      if (!vendorNameTagMap[nm]) vendorNameTagMap[nm] = { cats: [], subCats: [] }
      if (pi.category_id && vendorNameTagMap[nm].cats.indexOf(pi.category_id) === -1) vendorNameTagMap[nm].cats.push(pi.category_id)
      var sc = itemSubCatMap[pi.item_id]
      if (sc && vendorNameTagMap[nm].subCats.indexOf(sc) === -1) vendorNameTagMap[nm].subCats.push(sc)
    })
    // 5. Merge into final vendor_id → tags. Cats/subCats matched by vendor_name via the vendors list.
    var { data: vListForName } = await supabase.from('v_vendor_ledger')
      .select('vendor_id, vendor_name')
    var vidToName = {}
    ;(vListForName || []).forEach(function (v) { vidToName[String(v.vendor_id)] = (v.vendor_name || '').trim().toLowerCase() })
    var finalMap = {}
    Object.keys(vendorExpMap).forEach(function (vid) {
      var types = [], subTypes = []
      vendorExpMap[vid].forEach(function (eid) {
        var t = expTagMap[eid]
        if (t) {
          if (t.t && types.indexOf(t.t) === -1) types.push(t.t)
          if (t.st && subTypes.indexOf(t.st) === -1) subTypes.push(t.st)
        }
      })
      var nameKey = vidToName[vid] || ''
      var poTags = vendorNameTagMap[nameKey] || { cats: [], subCats: [] }
      finalMap[vid] = { types: types, subTypes: subTypes, cats: poTags.cats, subCats: poTags.subCats }
    })
    // Also populate empty tags for vendors that have PO items but no expenses
    ;(vListForName || []).forEach(function (v) {
      var vid = String(v.vendor_id)
      if (finalMap[vid]) return
      var nameKey = vidToName[vid] || ''
      var poTags = vendorNameTagMap[nameKey] || { cats: [], subCats: [] }
      if (poTags.cats.length > 0 || poTags.subCats.length > 0) {
        finalMap[vid] = { types: [], subTypes: [], cats: poTags.cats, subCats: poTags.subCats }
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

    // Merge phones from vendors master (v_vendor_ledger doesn't expose contact fields)
    var vendorIds = rows.map(function (r) { return r.vendor_id }).filter(Boolean)
    if (vendorIds.length > 0) {
      var CHUNK = 500
      var phoneMap = {}
      for (var i = 0; i < vendorIds.length; i += CHUNK) {
        var chunk = vendorIds.slice(i, i + CHUNK)
        var pRes = await supabase.from('vendors')
          .select('id, phone, phone2, contact')
          .in('id', chunk)
        ;(pRes.data || []).forEach(function (p) { phoneMap[p.id] = p })
      }
      rows = rows.map(function (r) {
        var p = phoneMap[r.vendor_id]
        if (!p) return r
        return Object.assign({}, r, { _phone: p.phone || null, _phone2: p.phone2 || null, _contact: p.contact || null })
      })
    }

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
    if (expIds.length > 0) {
      var { data: exps } = await supabase.from('expenses')
        .select('id, receipt_paths, receipt_path, amount_paise, tax_paise, expense_allocations(department, department_id, venue_id, amount_paise, remarks)')
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
    if (venueIds.length > 0) {
      var { data: vRows } = await supabase.from('venues').select('id, name').in('id', venueIds)
      ;(vRows || []).forEach(function (v) { venueNameById[v.id] = v.name })
    }

    var merged = rows.map(function (r) {
      if (r.ref_type === 'expense' && r.ref_id) {
        var id = Number(r.ref_id)
        var patch = {}
        if (receiptsByExpId[id]) patch._sourceReceipts = receiptsByExpId[id]
        if (breakdownByExpId[id]) {
          patch._breakdown = breakdownByExpId[id]
          patch._venueNames = venueNameById
        }
        if (Object.keys(patch).length > 0) return Object.assign({}, r, patch)
      }
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
        .select('phone, phone2, contact')
        .eq('id', v.vendor_id).maybeSingle()
      if (contactRes.data) {
        setSelectedVendor(function (prev) {
          if (!prev || prev.vendor_id !== v.vendor_id) return prev
          return Object.assign({}, prev, {
            _phone: contactRes.data.phone || null,
            _phone2: contactRes.data.phone2 || null,
            _contact: contactRes.data.contact || null,
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

    return (
      <div className="space-y-4">
        {/* Overdue banner */}
        {overdueVendors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-lg">⚠</span>
            <p className="text-sm text-red-700 font-medium">
              {overdueVendors.length} vendor{overdueVendors.length !== 1 ? 's' : ''} with overdue payments
            </p>
          </div>
        )}

        {/* Summary card */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Total Outstanding</p>
              <p className="text-2xl font-bold text-amber-800">{formatPoints(totalOutstanding)}</p>
              <div className="flex gap-3 mt-1.5 text-[11px]">
                <span className="text-gray-600">💵 Cash: <span className="font-semibold text-gray-900">{formatPoints(totalCash)}</span></span>
                <span className="text-gray-600">🏦 Bank: <span className="font-semibold text-gray-900">{formatPoints(totalBank)}</span></span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-gray-500">Vendors with balance</p>
              <p className="text-lg font-bold text-gray-800">{vendorsWithBalance}</p>
            </div>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="text" value={search} onChange={function (e) { setSearch(e.target.value) }}
            placeholder="Search vendors..."
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white"
            style={{ fontSize: '16px' }} />
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 self-start">
            {[
              { key: 'all', label: 'All' },
              { key: 'with_balance', label: 'With Balance' },
              { key: 'incomplete', label: 'Incomplete' }
            ].map(function (s) {
              return (
                <button key={s.key} onClick={function () { setStatusFilter(s.key) }}
                  className={"px-3 py-1.5 text-xs font-semibold rounded-md transition-colors " +
                    (statusFilter === s.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Advanced filters */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <SearchDropdown
            items={expenseTypes.map(function (t) { return { label: t.name, value: String(t.id) } })}
            value={fExpType} onChange={function (v) { setFExpType(v) }}
            placeholder="Expense type" />
          <SearchDropdown
            items={(fExpType ? expenseSubTypes.filter(function (st) { return String(st.expense_type_id) === String(fExpType) }) : expenseSubTypes)
              .map(function (st) { return { label: st.name, value: String(st.id) } })}
            value={fExpSubType} onChange={function (v) { setFExpSubType(v) }}
            placeholder="Expense sub-type" />
          <SearchDropdown
            items={categories.map(function (c) { return { label: c.name, value: String(c.id) } })}
            value={fCategory} onChange={function (v) { setFCategory(v) }}
            placeholder="Item category" />
          <SearchDropdown
            items={(fCategory ? subCategories.filter(function (sc) { return String(sc.category_id) === String(fCategory) }) : subCategories)
              .map(function (sc) { return { label: sc.name, value: String(sc.id) } })}
            value={fSubCategory} onChange={function (v) { setFSubCategory(v) }}
            placeholder="Item sub-category" />
        </div>
        {(fExpType || fExpSubType || fCategory || fSubCategory) && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">
              {filtered.length} of {vendors.filter(function (v) { return v.vendor_active }).length} vendors match
            </span>
            <button type="button"
              onClick={function () { setFExpType(''); setFExpSubType(''); setFCategory(''); setFSubCategory('') }}
              className="text-indigo-600 hover:text-indigo-800 font-semibold">✕ Clear filters</button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <p className="text-gray-400 text-sm text-center py-12">Loading vendors...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-12">
            {vendors.length === 0 ? 'No vendors yet' : 'No vendors match your filter'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(function (v) {
              var bal = v.balance_paise || 0
              var balColor = bal > 0 ? 'text-amber-800' : bal < 0 ? 'text-red-700' : 'text-gray-500'
              var balBg = bal > 0 ? 'bg-amber-50 border-amber-200' : bal < 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
              var cashBal = v.cash_balance_paise || 0
              var bankBal = v.bank_balance_paise || 0
              var isOverdue = (v.overdue_count || 0) > 0
              return (
                <button key={v.vendor_id} onClick={function () { openVendor(v) }}
                  className={"text-left border rounded-xl p-3 hover:shadow-sm active:scale-[0.99] transition-all w-full " + balBg + (isOverdue ? " ring-2 ring-red-300" : "")}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-bold text-gray-900 truncate flex-1">{v.vendor_name || '—'}</p>
                    <div className="flex gap-1 flex-shrink-0 items-center">
                      {isOverdue && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-red-100 text-red-700 rounded">⚠ Overdue</span>
                      )}
                      {v.vendor_status === 'incomplete' && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Incomplete</span>
                      )}
                      {v._phone && (
                        <a href={'tel:' + v._phone.replace(/[^0-9+]/g, '')}
                          onClick={function (ev) { ev.stopPropagation() }}
                          title={'Call ' + (v._contact || v.vendor_name || 'vendor') + (v._phone2 ? ' · alt: ' + v._phone2 : '')}
                          className="text-[10px] font-bold px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 no-underline">
                          📞
                        </a>
                      )}
                    </div>
                  </div>
                  <p className={"text-lg font-bold " + balColor}>{formatPoints(bal)}</p>
                  {(cashBal !== 0 || bankBal !== 0) && (
                    <div className="flex gap-2 mt-1 text-[10px] text-gray-600">
                      {cashBal !== 0 && <span>💵 {formatPoints(cashBal)}</span>}
                      {bankBal !== 0 && <span>🏦 {formatPoints(bankBal)}</span>}
                    </div>
                  )}
                  <p className="text-[11px] text-gray-500 mt-1">
                    {(v.entry_count || 0) > 0
                      ? (v.entry_count + ' entries · last ' + (v.last_entry_date || '—'))
                      : 'No activity'}
                    {v.earliest_due_date && ' · earliest due ' + v.earliest_due_date}
                  </p>
                </button>
              )
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
      var fontOk = await _registerPdfFont(doc)
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
      var closing = totalCr - totalDb
      var opening = 0  // Vendor ledgers start from zero — no imported opening balance concept
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
      function refCellFor(e) {
        var kind = (e.metadata && e.metadata.kind) || e.ref_type || ''
        var refNo = ''
        if (e.metadata && e.metadata.purchase_number) refNo = 'PO #' + e.metadata.purchase_number
        else if (e.metadata && e.metadata.receipt_number) refNo = 'RCPT #' + e.metadata.receipt_number
        else if (e.ref_id) refNo = '#' + String(e.ref_id).slice(0, 8)
        var label = kind ? kind.toString().toUpperCase().replace(/_/g, ' ') : ''
        return label + (refNo ? '\n' + refNo : '')
      }
      function particularsFor(e) {
        var desc = e.description || '—'
        var extra = []
        if (e.metadata && e.metadata.mode) extra.push(String(e.metadata.mode).toUpperCase())
        if (e.metadata && e.metadata.due_date) extra.push('Due ' + fmtD(e.metadata.due_date))
        return desc + (extra.length ? '\n' + extra.join(' · ') : '')
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

      // Main ledger table (running balance recomputed chronologically)
      var running = 0
      var body = chrono.map(function (e) {
        var isCredit = (e.credit_paise || 0) > 0
        running += (e.credit_paise || 0) - (e.debit_paise || 0)
        var dt = e.created_at ? new Date(e.created_at) : null
        var dateCell = dt ? fmtD(e.created_at.split('T')[0]) + '\n' + dt.toTimeString().slice(0, 5) : ''
        var cr = (e.credit_paise || 0)
        var db = (e.debit_paise || 0)
        return [
          dateCell,
          refCellFor(e),
          particularsFor(e),
          isCredit ? fmtN(cr) : '',
          !isCredit ? fmtN(db) : '',
          fmtN(running),
        ]
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 6,
        head: [['Date', 'Ref', 'Particulars', 'Bill (Cr)', 'Payment (Dr)', 'Balance']],
        body: body,
        styles: { font: FONT, fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { cellWidth: 22, fontSize: 7 },
          1: { cellWidth: 24, fontSize: 7 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 22, halign: 'right', textColor: [140, 90, 20] },
          4: { cellWidth: 22, halign: 'right', textColor: [16, 128, 60] },
          5: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: 10, right: 10 },
        didDrawPage: function () {
          doc.setFontSize(7); doc.setTextColor(120)
          doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 10, pageH - 6, { align: 'right' })
          doc.text('Ambria Ops · Vendor statement for ' + vendorName, 10, pageH - 6)
          doc.setTextColor(0)
        },
      })

      var safeName = vendorName.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
      doc.save('vendor_' + safeName + '_' + new Date().toISOString().split('T')[0] + '.pdf')
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
  var running = 0
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
          <button onClick={payVendor} disabled={currentBalance <= 0}
            className={"px-3 py-2 text-xs font-bold rounded-lg transition-colors flex-shrink-0 " +
              (currentBalance > 0 ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-200 text-gray-400 cursor-not-allowed")}>
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
                    {e.entry_date} · {kind} #{e.ref_id}
                    {isDeleted && ' · deleted'}
                  </p>
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
                              var parts = []
                              if (a.department) parts.push(a.department)
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
                    {isCredit ? '+' : '−'}{formatPoints(amt)}
                  </p>
                  {!isDeleted && (
                    <p className="text-[10px] text-gray-400">Bal: {formatPoints(e.runningBalance)}</p>
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
      {renderExpenseDetailModal()}
    </div>
  )
}

export default VendorLedger