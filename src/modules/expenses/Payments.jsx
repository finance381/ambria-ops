import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate } from '../../lib/format'
import { useRealtime } from '../../lib/useRealtime'
import PayVendorModal from './PayVendorModal'

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
  var perms = (profile && profile.permissions) || []
  var isAdmin = perms.indexOf('feature_admin') !== -1
  var canView = isAdmin || perms.indexOf('feature_payments') !== -1

  var [vendors, setVendors] = useState([])
  var [purchases, setPurchases] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [dueWithin, setDueWithin] = useState('')
  var [onlyOverdue, setOnlyOverdue] = useState(false)
  var [expanded, setExpanded] = useState({})
  var [payTarget, setPayTarget] = useState(null)
  var [payLockedMode, setPayLockedMode] = useState('')
  var [recent, setRecent] = useState([])
  var [showRecent, setShowRecent] = useState(false)

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
    setVendors(pendingVendors)
    if (pendingVendors.length === 0) {
      setPurchases([]); setLoading(false); return
    }
    var ids = pendingVendors.map(function (v) { return v.vendor_id })
    var { data: rows } = await supabase
      .from('ledger_entries')
      .select('id, party_id, entry_date, description, credit_paise, debit_paise, metadata')
      .eq('ledger_type', 'vendor')
      .in('party_id', ids)
      .is('deleted_at', null)
    var pur = (rows || []).filter(function (r) {
      return r.metadata && r.metadata.kind === 'purchase'
    })
    setPurchases(pur)

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
          row_count: g.rows.length
        })
      })
      return out.sort(sortRows)
    }

    return { cash: build('cash'), bank: build('bank') }
  }, [vendors, purchases])

  var filtered = useMemo(function () {
    function apply(list) {
      var q = search.trim().toLowerCase()
      var within = Number(dueWithin) || 0
      var today = new Date().toISOString().split('T')[0]
      return list.filter(function (r) {
        if (q && (r.vendor_name || '').toLowerCase().indexOf(q) === -1) return false
        if (onlyOverdue && !r.is_overdue) return false
        if (within > 0) {
          if (!r.earliest_due) return false
          var d = daysBetween(today, r.earliest_due)
          if (d > within) return false
        }
        return true
      })
    }
    return { cash: apply(cards.cash), bank: apply(cards.bank) }
  }, [cards, search, dueWithin, onlyOverdue])

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

  async function onPaySuccess() {
    setPayTarget(null)
    setPayLockedMode('')
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
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-xs text-gray-600">Due within</label>
          <input type="number" value={dueWithin}
            onChange={function (ev) { setDueWithin(ev.target.value) }}
            placeholder="days" min="0"
            className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white"
            style={{ fontSize: '16px' }} />
          <span className="text-xs text-gray-500">days (blank = all)</span>
          <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer ml-2">
            <input type="checkbox" checked={onlyOverdue}
              onChange={function (ev) { setOnlyOverdue(ev.target.checked) }} />
            Show only overdue
          </label>
        </div>
      </div>

      {/* Two cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PaymentCard title="💵 Cash Payments" rows={filtered.cash} total={totals.cash}
          expanded={expanded} onToggleExpand={toggleExpand} onPay={openPay} />
        <PaymentCard title="🏦 Bank Transfers" rows={filtered.bank} total={totals.bank}
          expanded={expanded} onToggleExpand={toggleExpand} onPay={openPay} />
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
          lockedMode={payLockedMode}
          onClose={function () { setPayTarget(null); setPayLockedMode('') }}
          onSuccess={onPaySuccess}
        />
      )}
    </div>
  )
}

function PaymentCard({ title, rows, total, expanded, onToggleExpand, onPay }) {
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
                      return (
                        <div key={p.id} className="flex items-center justify-between text-[11px] gap-2">
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