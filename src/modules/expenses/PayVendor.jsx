import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { formatPoints } from '../../lib/format'
import SearchDropdown from '../../components/ui/SearchDropdown'
import Icon from '../../components/ui/Icon'
import PayVendorModal from './PayVendorModal'

// Quick path to paying a vendor without going through the full Vendor
// Ledger list — pick (or create) a vendor, see what's owed, and pay right
// here with the exact same Pay Vendor modal Vendor Ledger's own detail view
// uses. No navigation into that screen at all.
function PayVendor({ profile }) {
  var [vendors, setVendors] = useState([])
  var [loading, setLoading] = useState(true)
  var [picked, setPicked] = useState(null)  // { id, name, status }
  var [creating, setCreating] = useState(false)
  var [error, setError] = useState('')

  var [balance, setBalance] = useState(null)  // the v_vendor_ledger-shaped row PayVendorModal reads
  var [balanceLoading, setBalanceLoading] = useState(false)
  var [showPayModal, setShowPayModal] = useState(false)
  var [paidJustNow, setPaidJustNow] = useState(false)

  useEffect(function () {
    supabase.from('vendors').select('id, name, contact, status').eq('active', true).order('name')
      .then(function (res) {
        setVendors(res.data || [])
        setLoading(false)
      })
  }, [])

  var items = vendors.map(function (v) {
    var suffix = v.status === 'incomplete' ? ' · incomplete' : (v.contact ? ' — ' + v.contact : '')
    return { label: v.name + suffix, value: String(v.id) }
  })

  async function loadBalance(id, name, status) {
    setBalanceLoading(true)
    var { data } = await supabase.from('v_vendor_ledger').select('*').eq('vendor_id', id).maybeSingle()
    // A vendor created moments ago (or one that simply has no ledger
    // activity yet) has no row in this view at all — zero is the correct
    // balance for that case, not a failed load.
    setBalance(data || {
      vendor_id: id, vendor_name: name, vendor_status: status, vendor_active: true,
      balance_paise: 0, cash_balance_paise: 0, bank_balance_paise: 0,
      overdue_count: 0, entry_count: 0, earliest_due_date: null, last_entry_date: null,
    })
    setBalanceLoading(false)
  }

  function choose(id, name, status) {
    setError('')
    setPaidJustNow(false)
    setPicked({ id: id, name: name, status: status })
    loadBalance(id, name, status)
  }

  function pickExisting(value) {
    var v = vendors.find(function (x) { return String(x.id) === value })
    if (!v) return
    choose(v.id, v.name, v.status)
  }

  // Same minimal-stub pattern as the expense form's inline vendor create —
  // a bare name, marked "incomplete" so it's obvious elsewhere (GST, bank
  // details, categories) that someone still needs to fill it in properly.
  async function createVendor(typedRaw) {
    var typed = (typedRaw || '').trim()
    if (!typed) return
    setError('')
    setCreating(true)
    var normalized = typed.toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '')
    var hit = vendors.find(function (v) { return (v.name || '').toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '') === normalized })
    if (hit) {
      setCreating(false)
      choose(hit.id, hit.name, hit.status)
      return
    }
    var { data, error: err } = await supabase.from('vendors')
      .insert({ name: typed, status: 'incomplete', active: true, created_by: profile.id })
      .select('id, name, status').single()
    setCreating(false)
    if (err || !data) {
      setError('Could not add vendor: ' + (err && err.message || 'unknown error'))
      return
    }
    setVendors(function (prev) { return prev.concat([data]) })
    try { logActivity('VENDOR_STUB_CREATE', data.name + ' (id ' + data.id + ')') } catch (_) {}
    choose(data.id, data.name, data.status)
  }

  function changeVendor() {
    setPicked(null)
    setBalance(null)
    setPaidJustNow(false)
    setError('')
  }

  async function onPaySuccess() {
    setShowPayModal(false)
    setPaidJustNow(true)
    if (picked) await loadBalance(picked.id, picked.name, picked.status)
  }

  return (
    <div className="max-w-md mx-auto space-y-4 pt-2">
      <div className="flex items-center gap-3">
        <span className="shrink-0 w-11 h-11 rounded-full bg-indigo-50 text-indigo-600 inline-flex items-center justify-center">
          <Icon name="building" size={19} />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-[19px] font-bold text-slate-900 leading-snug">Pay Vendor</h2>
          <p className="text-[12.5px] text-slate-500">Search a vendor, or add a new one to pay</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <SearchDropdown
          label="Vendor"
          placeholder={loading ? 'Loading vendors…' : 'Search or type a new vendor name...'}
          items={items}
          value={picked ? String(picked.id) : ''}
          onChange={pickExisting}
          allowAdd
          onAdd={createVendor}
        />
        {creating && <p className="mt-2 text-[12px] text-slate-400">Adding vendor…</p>}
        {error && <p className="mt-2 text-[12px] text-rose-600">{error}</p>}
      </div>

      {!picked && (
        <p className="text-[11.5px] text-slate-400 px-1 leading-relaxed">
          A vendor added here is created with just a name — fill in GST, bank
          details and categories later from Procurement &gt; Vendors.
        </p>
      )}

      {picked && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-slate-900 truncate">{picked.name}</p>
              {picked.status === 'incomplete' && (
                <span className="inline-flex mt-1 items-center px-2 py-0.5 rounded-md bg-amber-100 text-[10.5px] font-bold uppercase tracking-[0.04em] text-amber-700">
                  Incomplete vendor
                </span>
              )}
            </div>
            <button type="button" onClick={changeVendor} className="shrink-0 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800">
              Change vendor
            </button>
          </div>

          {paidJustNow && (
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
              <Icon name="checkCircle" size={14} className="shrink-0" />
              Payment recorded
            </p>
          )}

          {balanceLoading ? (
            <p className="text-[13px] text-slate-400">Loading balance…</p>
          ) : balance && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-400">Cash owed</p>
                  <p className="mt-1 text-[16px] font-bold text-slate-900 tabular-nums" data-notranslate>{formatPoints(balance.cash_balance_paise || 0)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-400">Bank owed</p>
                  <p className="mt-1 text-[16px] font-bold text-slate-900 tabular-nums" data-notranslate>{formatPoints(balance.bank_balance_paise || 0)}</p>
                </div>
              </div>
              {balance.earliest_due_date && (
                <p className="text-[11.5px] text-slate-400">
                  {balance.overdue_count > 0 ? balance.overdue_count + ' overdue · ' : ''}Earliest due {balance.earliest_due_date}
                </p>
              )}
              <button type="button" onClick={function () { setShowPayModal(true) }}
                className="w-full py-3 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-sm">
                Pay {picked.name}
              </button>
            </>
          )}
        </div>
      )}

      {showPayModal && balance && (
        <PayVendorModal
          vendor={balance}
          profile={profile}
          onClose={function () { setShowPayModal(false) }}
          onSuccess={onPaySuccess}
        />
      )}
    </div>
  )
}

export default PayVendor
