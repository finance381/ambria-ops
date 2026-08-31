import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import PayVendorModal from './PayVendorModal'
import { hasPerm } from '../../lib/permissions'
import { filterVisibleVendors } from '../../lib/vendorGating'

function daysBetween(d1, d2) {
  var ms = new Date(d2) - new Date(d1)
  return Math.round(ms / 86400000)
}

function dueChip(dueStr) {
  if (!dueStr) return { label: 'No deadline', cls: 'bg-gray-100 text-gray-500 border-gray-200' }
  var today = new Date().toISOString().split('T')[0]
  var d = daysBetween(today, dueStr)
  if (d < 0) return { label: '⚠ ' + Math.abs(d) + 'd overdue', cls: 'bg-red-100 text-red-700 border-red-300' }
  if (d === 0) return { label: 'Due today', cls: 'bg-amber-100 text-amber-700 border-amber-300' }
  if (d === 1) return { label: 'Due tomorrow', cls: 'bg-amber-100 text-amber-700 border-amber-300' }
  if (d <= 7) return { label: 'Due in ' + d + 'd', cls: 'bg-orange-50 text-orange-700 border-orange-200' }
  return { label: 'Due ' + d + 'd', cls: 'bg-gray-50 text-gray-600 border-gray-200' }
}

function sortRows(a, b) {
  // Overdue first (oldest overdue at top) → soonest due → no due at bottom
  var da = a.earliest_due, db = b.earliest_due
  if (!da && !db) return (b.balance - a.balance)
  if (!da) return 1
  if (!db) return -1
  return da.localeCompare(db)
}

function Payments({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var isAdmin = hasPerm(permsNew, 'admin.dashboard')
  var canView = isAdmin || hasPerm(permsNew, 'finance.payments')

  var [vendors, setVendors] = useState([])
  var [purchases, setPurchases] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [departments, setDepartments] = useState([])
  var [vendorTypeFilter, setVendorTypeFilter] = useState('')
  var [deptFilter, setDeptFilter] = useState('')
  var [agingBucket, setAgingBucket] = useState('all')
  var [minAmount, setMinAmount] = useState('')
  var [sortMode, setSortMode] = useState('priority')
  var [expanded, setExpanded] = useState({})
  var [payTarget, setPayTarget] = useState(null)
  var [payLockedMode, setPayLockedMode] = useState('')
  var [recent, setRecent] = useState([])
  var [showRecent, setShowRecent] = useState(false)
  var [lightbox, setLightbox] = useState(null)

  function openLightbox(paths, startIdx) {
    var items = (paths || []).map(function (path) {
      return {
        path: path,
        url: supabase.storage.from('receipts').getPublicUrl(path).data?.publicUrl,
        isImage: /\.(jpg|jpeg|png|gif|webp)$/i.test(path),
        isPdf: /\.pdf$/i.test(path),
        isAudio: /\.(webm|ogg|mp3|wav)$/i.test(path),
      }
    })
    setLightbox({ items: items, index: startIdx || 0 })
  }

  function closeLightbox() { setLightbox(null) }
  function navLightbox(dir) {
    setLightbox(function (lb) {
      if (!lb) return lb
      var n = lb.items.length
      var next = (lb.index + dir + n) % n
      return Object.assign({}, lb, { index: next })
    })
  }

  async function loadAll() {
    if (!canView) { setLoading(false); return }
    setLoading(true)
    var { data: vs } = await supabase
      .from('v_vendor_ledger')
      .select('vendor_id, vendor_name, vendor_active, cash_balance_paise, bank_balance_paise, balance_paise, earliest_due_date, overdue_count')
      .eq('vendor_active', true)
    var pendingVendors = (vs || []).filter(function (v) {
      return (v.cash_balance_paise || 0) > 0 || (v.bank_balance_paise || 0) > 0
    })

    // Enrich vendors with vendor_type + department chain
    var vendorIds = pendingVendors.map(function (v) { return v.vendor_id })
    var [vExtRes, catsRes, sdRes, etRes, estRes, dRes] = await Promise.all([
      vendorIds.length > 0 ? supabase.from('vendors').select('id, vendor_type, category_ids, expense_type_ids, expense_sub_type_ids').in('id', vendorIds) : Promise.resolve({ data: [] }),
      supabase.from('categories').select('id, sub_department_id'),
      supabase.from('sub_departments').select('id, department_id'),
      supabase.from('expense_types').select('id, department_id, sub_department_id'),
      supabase.from('expense_sub_types').select('id, expense_type_id'),
      supabase.from('departments').select('id, name').eq('active', true).order('name')
    ])
    var catToSd = {}; (catsRes.data || []).forEach(function (c) { catToSd[c.id] = c.sub_department_id })
    var sdToDept = {}; (sdRes.data || []).forEach(function (s) { sdToDept[s.id] = s.department_id })
    var etToDept = {}
    ;(etRes.data || []).forEach(function (t) {
      if (t.department_id) etToDept[t.id] = t.department_id
      else if (t.sub_department_id && sdToDept[t.sub_department_id]) etToDept[t.id] = sdToDept[t.sub_department_id]
    })
    var stToType = {}; (estRes.data || []).forEach(function (s) { stToType[s.id] = s.expense_type_id })
    var vExtras = {}
    ;(vExtRes.data || []).forEach(function (v) {
      var deptIds = {}
      ;(v.category_ids || []).forEach(function (cid) { var sd = catToSd[cid]; if (sd) { var d = sdToDept[sd]; if (d) deptIds[d] = true } })
      ;(v.expense_type_ids || []).forEach(function (tid) { var d = etToDept[tid]; if (d) deptIds[d] = true })
      ;(v.expense_sub_type_ids || []).forEach(function (stid) { var tid = stToType[stid]; if (tid) { var d = etToDept[tid]; if (d) deptIds[d] = true } })
      vExtras[v.id] = { vendorType: v.vendor_type, deptIds: Object.keys(deptIds).map(Number), estIds: v.expense_sub_type_ids || [] }
    })
    var enriched = pendingVendors.map(function (v) {
      var ext = vExtras[v.vendor_id] || {}
      return Object.assign({}, v, {
        _vendorType: ext.vendorType || null,
        _deptIds: ext.deptIds || [],
        expense_sub_type_ids: ext.estIds || []
      })
    })
    setVendors(filterVisibleVendors(enriched, profile))
    setDepartments(dRes.data || [])
    if (pendingVendors.length === 0) {
      setPurchases([]); setLoading(false); return
    }
    var ids = pendingVendors.map(function (v) { return v.vendor_id })
    var { data: rows } = await supabase
      .from('ledger_entries')
      .select('id, party_id, entry_date, description, credit_paise, debit_paise, metadata, ref_type, ref_id')
      .eq('ledger_type', 'vendor')
      .in('party_id', ids)
      .is('deleted_at', null)
    var pur = (rows || []).filter(function (r) {
      return r.metadata && r.metadata.kind === 'purchase'
    })

    // Enrich purchases with expense receipt paths
    var expIds = []
    pur.forEach(function (p) {
      if (p.ref_type === 'expense' && p.ref_id && /^[0-9]+$/.test(String(p.ref_id))) {
        var id = Number(p.ref_id)
        if (expIds.indexOf(id) === -1) expIds.push(id)
      }
    })
    var receiptsByExpId = {}
    if (expIds.length > 0) {
      var { data: exps } = await supabase.from('expenses')
        .select('id, receipt_paths, receipt_path')
        .in('id', expIds)
      ;(exps || []).forEach(function (ex) {
        var paths = Array.isArray(ex.receipt_paths) && ex.receipt_paths.length > 0
          ? ex.receipt_paths
          : (ex.receipt_path ? [ex.receipt_path] : [])
        if (paths.length > 0) receiptsByExpId[ex.id] = paths
      })
    }
    var purWithReceipts = pur.map(function (p) {
      if (p.ref_type === 'expense' && p.ref_id) {
        var id = Number(p.ref_id)
        if (receiptsByExpId[id]) return Object.assign({}, p, { _receipts: receiptsByExpId[id] })
      }
      return p
    })
    setPurchases(purWithReceipts)

    // Recently paid — last 7 days of payment + deduction rows across all vendors
    var since = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    var { data: rec } = await supabase
      .from('ledger_entries')
      .select('id, party_id, entry_date, description, debit_paise, ref_id, ref_type, metadata')
      .eq('ledger_type', 'vendor')
      .in('ref_type', ['vendor_payment', 'vendor_deduction'])
      .is('deleted_at', null)
      .gte('entry_date', since)
      .order('entry_date', { ascending: false })
    var recRows = rec || []
    // Batch-fetch vendor names not already in cache
    var needIds = {}
    recRows.forEach(function (r) { needIds[r.party_id] = true })
    ;(pendingVendors || []).forEach(function (v) { delete needIds[v.vendor_id] })
    var missingIds = Object.keys(needIds).map(function (id) { return Number(id) })
    var nameMap = {}
    ;(pendingVendors || []).forEach(function (v) { nameMap[v.vendor_id] = v.vendor_name })
    if (missingIds.length > 0) {
      var { data: extra } = await supabase
        .from('vendors').select('id, name').in('id', missingIds)
      ;(extra || []).forEach(function (v) { nameMap[v.id] = v.name })
    }
    recRows.forEach(function (r) { r._vendor_name = nameMap[r.party_id] || '—' })
    setRecent(recRows)

    setLoading(false)
  }

  useEffect(function () { loadAll() }, [canView])
  useRealtime(['ledger_entries', 'expenses'], function () { loadAll() })

  var cards = useMemo(function () {
    // Group purchase rows by vendor+mode, compute per-mode earliest_due + outstanding
    var byKey = {}
    purchases.forEach(function (p) {
      var m = p.metadata && p.metadata.mode
      if (m !== 'cash' && m !== 'bank') return
      var key = p.party_id + '|' + m
      if (!byKey[key]) byKey[key] = { vendor_id: p.party_id, mode: m, rows: [], earliest_due: null }
      byKey[key].rows.push(p)
      var due = p.metadata && p.metadata.due_date
      if (due && (!byKey[key].earliest_due || due < byKey[key].earliest_due)) {
        byKey[key].earliest_due = due
      }
    })

    var vendorMap = {}
    vendors.forEach(function (v) { vendorMap[v.vendor_id] = v })

    var today = new Date().toISOString().split('T')[0]

    function build(mode) {
      var out = []
      Object.keys(byKey).forEach(function (k) {
        var g = byKey[k]
        if (g.mode !== mode) return
        var v = vendorMap[g.vendor_id]
        if (!v) return
        var bal = mode === 'cash' ? (v.cash_balance_paise || 0) : (v.bank_balance_paise || 0)
        if (bal <= 0) return
        var isOverdue = g.earliest_due && g.earliest_due < today
        out.push({
          vendor_id: g.vendor_id,
          vendor_name: v.vendor_name,
          mode: mode,
          balance: bal,
          earliest_due: g.earliest_due,
          is_overdue: isOverdue,
          rows: g.rows,
          row_count: g.rows.length,
          _vendorType: v._vendorType || null,
          _deptIds: v._deptIds || []
        })
      })
      return out.sort(sortRows)
    }

    return { cash: build('cash'), bank: build('bank') }
  }, [vendors, purchases])

  var filtered = useMemo(function () {
    var q = search.trim().toLowerCase()
    var minAmt = Number(minAmount) || 0
    var deptId = deptFilter ? Number(deptFilter) : 0
    var today = new Date().toISOString().split('T')[0]

    function inBucket(r) {
      if (agingBucket === 'all') return true
      var due = r.earliest_due
      if (agingBucket === 'no_deadline') return !due
      if (!due) return false
      var d = daysBetween(today, due)
      if (agingBucket === 'overdue') return d < 0
      if (agingBucket === 'due_week') return d >= 0 && d <= 7
      if (agingBucket === 'due_later') return d > 7
      return true
    }

    function apply(list) {
      var out = list.filter(function (r) {
        if (q && (r.vendor_name || '').toLowerCase().indexOf(q) === -1) return false
        if (vendorTypeFilter && r._vendorType !== vendorTypeFilter) return false
        if (deptId && (r._deptIds || []).indexOf(deptId) === -1) return false
        if (minAmt > 0 && r.balance < minAmt) return false
        if (!inBucket(r)) return false
        return true
      })
      if (sortMode === 'amount_desc') {
        out = out.slice().sort(function (a, b) { return b.balance - a.balance })
      } else if (sortMode === 'name') {
        out = out.slice().sort(function (a, b) { return (a.vendor_name || '').localeCompare(b.vendor_name || '') })
      } else if (sortMode === 'oldest') {
        out = out.slice().sort(function (a, b) {
          var da = a.earliest_due; var db = b.earliest_due
          if (!da && !db) return b.balance - a.balance
          if (!da) return 1
          if (!db) return -1
          return da.localeCompare(db)
        })
      }
      return out
    }
    return { cash: apply(cards.cash), bank: apply(cards.bank) }
  }, [cards, search, vendorTypeFilter, deptFilter, agingBucket, minAmount, sortMode])

  var totals = useMemo(function () {
    function sum(list) { return list.reduce(function (s, r) { return s + r.balance }, 0) }
    var overdueVendors = {}
    cards.cash.concat(cards.bank).forEach(function (r) {
      if (r.is_overdue) overdueVendors[r.vendor_id] = true
    })
    return {
      cash: sum(cards.cash),
      bank: sum(cards.bank),
      overdue: Object.keys(overdueVendors).length
    }
  }, [cards])

  function toggleExpand(vendorId, mode) {
    var key = vendorId + '|' + mode
    setExpanded(Object.assign({}, expanded, expanded[key] ? { [key]: false } : { [key]: true }))
  }

  function openPay(row) {
    var v = vendors.find(function (x) { return x.vendor_id === row.vendor_id })
    if (!v) return
    setPayLockedMode(row.mode)
    setPayTarget(v)
  }

  function closePay() {
    setPayTarget(null)
    setPayLockedMode('')
  }

  async function onPaySuccess() {
    closePay()
    await loadAll()
  }

  function printSheet() {
    window.print()
  }

  if (!canView) {
    return <p className="text-gray-400 text-sm text-center py-12">You don't have access to Payments.</p>
  }

  if (loading) {
    return <p className="text-gray-400 text-sm text-center py-12">Loading payments...</p>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Payments</h2>
          <p className="text-xs text-gray-500">Vendors awaiting payment · {filtered.cash.length + filtered.bank.length} shown</p>
        </div>
        <button onClick={printSheet}
          className="px-3 py-2 text-xs font-bold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
          🖨 Print
        </button>
      </div>

      {/* Overdue banner */}
      {totals.overdue > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <span className="text-lg">⚠</span>
          <p className="text-sm text-red-700 font-medium">
            {totals.overdue} vendor{totals.overdue !== 1 ? 's' : ''} past due
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2 print:hidden">
        <input type="text" value={search}
          onChange={function (ev) { setSearch(ev.target.value) }}
          placeholder="Search vendor name..."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-300"
          style={{ fontSize: '16px' }} />

        <div className="flex flex-wrap items-center gap-2">
          <select value={vendorTypeFilter}
            onChange={function (ev) { setVendorTypeFilter(ev.target.value) }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }}>
            <option value="">All Types</option>
            <option value="Supplier">Supplier</option>
            <option value="Contractor">Contractor</option>
            <option value="Service Provider">Service Provider</option>
            <option value="Rental">Rental</option>
          </select>

          <select value={deptFilter}
            onChange={function (ev) { setDeptFilter(ev.target.value) }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300"
            style={{ fontSize: '16px' }}>
            <option value="">All Depts</option>
            {departments.map(function (d) { return <option key={d.id} value={String(d.id)}>{d.name}</option> })}
          </select>

          <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
            {[['all', 'All'], ['overdue', 'Overdue'], ['due_week', 'Due ≤ 7d'], ['due_later', 'Later'], ['no_deadline', 'No date']].map(function (opt) {
              var active = agingBucket === opt[0]
              var color = opt[0] === 'overdue' ? 'text-red-700' : opt[0] === 'due_week' ? 'text-amber-700' : 'text-gray-700'
              return (
                <button key={opt[0]} type="button" onClick={function () { setAgingBucket(opt[0]) }}
                  className={"px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors " + (active ? "bg-white shadow-sm " + color : "text-gray-500")}>
                  {opt[1]}
                </button>
              )
            })}
          </div>

          <div className="inline-flex items-center gap-1.5">
            <span className="text-[11px] text-gray-500">Min</span>
            <input type="number" value={minAmount}
              onChange={function (ev) { setMinAmount(ev.target.value) }}
              placeholder="0" min="0"
              className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300"
              style={{ fontSize: '16px' }} />
            <span className="text-[11px] text-gray-500">pts</span>
          </div>

          <select value={sortMode}
            onChange={function (ev) { setSortMode(ev.target.value) }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-indigo-300 ml-auto"
            style={{ fontSize: '16px' }}>
            <option value="priority">Sort: Priority</option>
            <option value="amount_desc">Amount high → low</option>
            <option value="name">Name A → Z</option>
            <option value="oldest">Oldest due first</option>
          </select>

          {(vendorTypeFilter || deptFilter || agingBucket !== 'all' || minAmount || sortMode !== 'priority') && (
            <button type="button"
              onClick={function () { setVendorTypeFilter(''); setDeptFilter(''); setAgingBucket('all'); setMinAmount(''); setSortMode('priority') }}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 px-2">Clear</button>
          )}
        </div>
      </div>

      {/* Two cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PaymentCard title="💵 Cash Payments" rows={filtered.cash} total={totals.cash}
          expanded={expanded} onToggleExpand={toggleExpand} onPay={openPay} onOpenLightbox={openLightbox} />
        <PaymentCard title="🏦 Bank Transfers" rows={filtered.bank} total={totals.bank}
          expanded={expanded} onToggleExpand={toggleExpand} onPay={openPay} onOpenLightbox={openLightbox} />
      </div>

      {/* Empty state */}
      {filtered.cash.length === 0 && filtered.bank.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-8">No pending payments match the filters.</p>
      )}

      {/* Recently paid (last 7 days) */}
      {recent.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden print:hidden">
          <button onClick={function () { setShowRecent(!showRecent) }}
            className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors">
            <span className="text-sm font-bold text-gray-900">
              Recently Paid <span className="text-xs font-normal text-gray-500 ml-1">· last 7 days · {recent.length} row{recent.length !== 1 ? 's' : ''}</span>
            </span>
            <span className="text-gray-500 text-sm">{showRecent ? '▲' : '▼'}</span>
          </button>
          {showRecent && (
            <div className="divide-y divide-gray-100">
              {recent.map(function (r) {
                var isDed = r.ref_type === 'vendor_deduction'
                var mode = r.metadata && r.metadata.mode
                return (
                  <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{r._vendor_name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-gray-500">{formatDate(r.entry_date)}</span>
                        {mode && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 border rounded bg-gray-50 text-gray-700 border-gray-200">
                            {mode === 'cash' ? '💵 Cash' : '🏦 Bank'}
                          </span>
                        )}
                        {isDed && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 border rounded bg-amber-50 text-amber-700 border-amber-200">
                            Deduction
                          </span>
                        )}
                      </div>
                    </div>
                    <p className={"text-sm font-bold flex-shrink-0 " + (isDed ? "text-amber-700" : "text-green-700")}>
                      {formatPoints(r.debit_paise || 0)}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Pay modal */}
            {payTarget && (
        <PayVendorModal
          vendor={payTarget}
          profile={profile}
          onClose={closePay}
          onSuccess={onPaySuccess}
          lockedMode={payLockedMode}
        />
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={closeLightbox}>
          <button onClick={function (e) { e.stopPropagation(); closeLightbox() }}
            className="absolute top-4 right-4 text-white text-2xl w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20">✕</button>
          {lightbox.items.length > 1 && (
            <>
              <button onClick={function (e) { e.stopPropagation(); navLightbox(-1) }}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-2xl w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20">‹</button>
              <button onClick={function (e) { e.stopPropagation(); navLightbox(1) }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-2xl w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20">›</button>
            </>
          )}
          <div className="max-w-5xl max-h-[90vh] w-full flex flex-col items-center gap-2" onClick={function (e) { e.stopPropagation() }}>
            {(function () {
              var it = lightbox.items[lightbox.index]
              if (!it || !it.url) return <p className="text-white">Receipt unavailable</p>
              if (it.isImage) return <img src={it.url} alt="Receipt" className="max-w-full max-h-[85vh] object-contain rounded shadow-2xl" />
              if (it.isPdf) return <iframe src={it.url} title="Receipt PDF" className="w-full h-[85vh] rounded shadow-2xl bg-white" />
              if (it.isAudio) return <audio controls src={it.url} className="w-full max-w-md" />
              return <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-white underline">Open file</a>
            })()}
            {lightbox.items.length > 1 && (
              <p className="text-white/70 text-xs">{lightbox.index + 1} / {lightbox.items.length}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PaymentCard({ title, rows, total, expanded, onToggleExpand, onPay, onOpenLightbox }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-600 mt-0.5">
          <span className="font-bold text-gray-900">{formatPoints(total)}</span> pending · {rows.length} vendor{rows.length !== 1 ? 's' : ''}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-gray-400 text-xs text-center py-6">Nothing pending.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map(function (r) {
            var chip = dueChip(r.earliest_due)
            var key = r.vendor_id + '|' + r.mode
            var isExpanded = !!expanded[key]
            return (
              <div key={key} className={"p-3 " + (r.is_overdue ? "bg-red-50/40" : "")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{r.vendor_name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={"text-[10px] font-semibold px-1.5 py-0.5 border rounded " + chip.cls}>
                        {chip.label}
                      </span>
                      <span className="text-[10px] text-gray-500">{r.row_count} purchase{r.row_count !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900">{formatPoints(r.balance)}</p>
                    <div className="flex gap-1 mt-1 print:hidden">
                      <button onClick={function () { onPay(r) }}
                        className="px-2 py-1 text-[10px] font-bold rounded bg-indigo-600 text-white hover:bg-indigo-700">
                        Pay
                      </button>
                      <button onClick={function () { onToggleExpand(r.vendor_id, r.mode) }}
                        className="px-2 py-1 text-[10px] font-bold rounded bg-gray-100 text-gray-700 hover:bg-gray-200">
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </div>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
                    {r.rows.slice().sort(function (a, b) {
                      var da = a.metadata && a.metadata.due_date
                      var db = b.metadata && b.metadata.due_date
                      if (!da && !db) return 0
                      if (!da) return 1
                      if (!db) return -1
                      return da.localeCompare(db)
                    }).map(function (p) {
                      var portion = (p.metadata && p.metadata.credit_portion_paise) || 0
                      var pDue = p.metadata && p.metadata.due_date
                      var pChip = dueChip(pDue)
                      var receipts = p._receipts || []
                      var firstImgPath = receipts.find(function (path) { return /\.(jpg|jpeg|png|gif|webp)$/i.test(path) }) || receipts[0]
                      var firstThumb = firstImgPath
                        ? { path: firstImgPath, url: supabase.storage.from('receipts').getPublicUrl(firstImgPath).data?.publicUrl, isImage: /\.(jpg|jpeg|png|gif|webp)$/i.test(firstImgPath) }
                        : null
                      return (
                        <div key={p.id} className="flex items-center gap-2 text-[11px]">
                          {firstThumb ? (
                            <button onClick={function () { onOpenLightbox && onOpenLightbox(receipts, 0) }}
                              className="relative group flex-shrink-0 w-8 h-8 rounded border border-gray-200 overflow-hidden bg-gray-50 hover:border-indigo-400 hover:shadow-md transition-all">
                              {firstThumb.isImage ? (
                                <>
                                  <img src={firstThumb.url} alt="Receipt" className="w-full h-full object-cover" />
                                  <div className="absolute left-0 top-0 opacity-0 group-hover:opacity-100 pointer-events-none z-20 transition-opacity">
                                    <img src={firstThumb.url} alt="Receipt preview"
                                      className="max-w-[240px] max-h-[240px] rounded-lg shadow-2xl border-2 border-white -translate-y-full mb-1 bg-white" />
                                  </div>
                                </>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-500 text-base">📄</div>
                              )}
                              {receipts.length > 1 && (
                                <span className="absolute bottom-0 right-0 text-[8px] font-bold text-white bg-indigo-600 px-1 rounded-tl leading-none py-0.5">+{receipts.length - 1}</span>
                              )}
                            </button>
                          ) : (
                            <div className="w-8 h-8 flex-shrink-0 rounded border border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-[10px]">—</div>
                          )}
                          <span className="text-gray-700 truncate flex-1">
                            {formatDate(p.entry_date)} · {p.description}
                          </span>
                          <span className={"text-[9px] font-semibold px-1 py-0.5 border rounded flex-shrink-0 " + pChip.cls}>
                            {pChip.label}
                          </span>
                          <span className="font-semibold text-gray-900 flex-shrink-0">{formatPoints(portion)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Payments