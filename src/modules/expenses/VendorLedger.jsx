import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'
import PayVendorModal from './PayVendorModal'
import PaymentProofThumbs from '../../components/ledger/PaymentProofThumbs'

function VendorLedger({ profile }) {
  var perms = (profile && profile.permissions) || []
  var isAdmin = perms.indexOf('feature_admin') !== -1
  var canView = isAdmin || perms.indexOf('feature_vendor_ledger') !== -1

  var [view, setView] = useState('list')  // 'list' | 'detail'
  var [vendors, setVendors] = useState([])
  var [loading, setLoading] = useState(true)
  var [search, setSearch] = useState('')
  var [statusFilter, setStatusFilter] = useState('all')  // 'all' | 'with_balance' | 'incomplete'

  var [selectedVendor, setSelectedVendor] = useState(null)
  var [entries, setEntries] = useState([])
  var [entriesLoading, setEntriesLoading] = useState(false)
  var [showDeleted, setShowDeleted] = useState(false)

  useEffect(function () {
    if (canView) loadVendors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadVendors() {
    setLoading(true)
    var { data, error } = await supabase.from('v_vendor_ledger')
      .select('*')
      .order('balance_paise', { ascending: false })
    if (!error) setVendors(data || [])
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
    if (!error) setEntries(data || [])
    setEntriesLoading(false)
  }

  async function openVendor(v) {
    setSelectedVendor(v)
    setView('detail')
    setShowDeleted(false)
    await loadEntries(v, false)
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
    var filtered = vendors.filter(function (v) {
      if (!v.vendor_active) return false
      if (q && (v.vendor_name || '').toLowerCase().indexOf(q) === -1) return false
      if (statusFilter === 'with_balance' && (v.balance_paise || 0) === 0) return false
      if (statusFilter === 'incomplete' && v.vendor_status !== 'incomplete') return false
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
                  className={"text-left border rounded-xl p-3 hover:shadow-sm active:scale-[0.99] transition-all " + balBg + (isOverdue ? " ring-2 ring-red-300" : "")}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-bold text-gray-900 truncate flex-1">{v.vendor_name || '—'}</p>
                    <div className="flex gap-1 flex-shrink-0">
                      {isOverdue && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-red-100 text-red-700 rounded">⚠ Overdue</span>
                      )}
                      {v.vendor_status === 'incomplete' && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Incomplete</span>
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
            return (
              <div key={e.id}
                className={"flex items-start gap-3 px-3 py-3 " +
                  (idx < displayEntries.length - 1 ? "border-b border-gray-100 " : "") +
                  (isDeleted ? "opacity-50" : "")}>
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
                  <PaymentProofThumbs meta={e.metadata} />
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={"text-sm font-bold " + (isCredit ? "text-amber-800" : "text-green-700")}>
                    {isCredit ? '+' : '−'}{formatPoints(amt)}
                  </p>
                  {!isDeleted && (
                    <p className="text-[10px] text-gray-400">Bal: {formatPoints(e.runningBalance)}</p>
                  )}
                  {isAdmin && !isDeleted && (
                    <button onClick={function () { reverseEntry(e.id) }}
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
    </div>
  )
}

export default VendorLedger