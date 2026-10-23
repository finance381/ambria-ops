import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'
import Icon from '../../components/ui/Icon'
import VendorLedger from './VendorLedger'

// Quick path to paying a vendor without going through the full Vendor
// Ledger list — pick (or create) a vendor first, then land straight on
// their ledger with the same Pay Vendor modal that screen already uses.
function PayVendor({ profile, onNavigateToExpenses }) {
  var [vendors, setVendors] = useState([])
  var [loading, setLoading] = useState(true)
  var [picked, setPicked] = useState(null)  // { id, name, status }
  var [creating, setCreating] = useState(false)
  var [error, setError] = useState('')

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

  function pickExisting(value) {
    var v = vendors.find(function (x) { return String(x.id) === value })
    if (!v) return
    setError('')
    setPicked({ id: v.id, name: v.name, status: v.status })
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
      setPicked({ id: hit.id, name: hit.name, status: hit.status })
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
    setPicked({ id: data.id, name: data.name, status: data.status })
  }

  if (picked) {
    return (
      <VendorLedger profile={profile} onNavigateToExpenses={onNavigateToExpenses}
        initialVendorId={picked.id} initialVendorName={picked.name} initialVendorStatus={picked.status} />
    )
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
          value=""
          onChange={pickExisting}
          allowAdd
          onAdd={createVendor}
        />
        {creating && <p className="mt-2 text-[12px] text-slate-400">Adding vendor…</p>}
        {error && <p className="mt-2 text-[12px] text-rose-600">{error}</p>}
      </div>

      <p className="text-[11.5px] text-slate-400 px-1 leading-relaxed">
        A vendor added here is created with just a name — fill in GST, bank
        details and categories later from Procurement &gt; Vendors.
      </p>
    </div>
  )
}

export default PayVendor
