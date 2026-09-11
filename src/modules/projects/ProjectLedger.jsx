import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { formatPoints, formatDate, formatDateTime } from '../../lib/format'
import { hasPerm } from '../../lib/permissions'
import { logActivity } from '../../lib/logger'
import SearchDropdown from '../../components/ui/SearchDropdown'
import VoiceInput from '../../components/ui/VoiceInput'

var TYPE_LABEL = {
  advance: 'Advance', running_bill: 'Running Bill', retention: 'Retention',
  final_settlement: 'Final Settlement', misc: 'Misc', reversal: 'Reversal',
}
var TYPE_CLS = {
  advance: 'bg-blue-100 text-blue-700', running_bill: 'bg-amber-100 text-amber-700',
  retention: 'bg-purple-100 text-purple-700', final_settlement: 'bg-green-100 text-green-700',
  misc: 'bg-gray-100 text-gray-700', reversal: 'bg-rose-100 text-rose-700',
}
var ENTRY_TYPES = ['advance', 'running_bill', 'retention', 'final_settlement', 'misc']
var CAN_POST_STATUSES = ['approved', 'in_progress', 'on_hold', 'completed']

function ProjectLedger({ profile, project, onBack }) {
  var permsNew = (profile && profile.permsNew) || []
  var canView = hasPerm(permsNew, 'projects.ledger.view')
  var canWrite = hasPerm(permsNew, 'projects.ledger.write') && CAN_POST_STATUSES.indexOf(project.status) !== -1

  var [entries, setEntries] = useState([])
  var [loading, setLoading] = useState(true)
  var [vendors, setVendors] = useState([])
  var [showAdd, setShowAdd] = useState(false)
  var [form, setForm] = useState({ entry_type: 'advance', vendor_id: '', amount_rupees: '', payment_mode: 'cash', reference: '', description: '' })
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  useEffect(function () {
    if (canView) load()
    supabase.from('project_vendors').select('vendor_id, trade, vendors(name)').eq('project_id', project.id)
      .then(function (res) {
        setVendors((res.data || []).map(function (v) { return { value: String(v.vendor_id), label: (v.vendors?.name || 'Vendor #' + v.vendor_id) + (v.trade ? ' — ' + v.trade : '') } }))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView])

  async function load() {
    setLoading(true)
    var res = await supabase.from('project_ledger')
      .select('id, entry_type, vendor_id, amount_paise, payment_mode, reference, description, posted_at, posted_by, reversal_of')
      .eq('project_id', project.id)
      .order('posted_at', { ascending: false })
    var rows = res.data || []
    var vendorIds = []
    rows.forEach(function (r) { if (r.vendor_id && vendorIds.indexOf(r.vendor_id) === -1) vendorIds.push(r.vendor_id) })
    var vendorName = {}
    if (vendorIds.length > 0) {
      var vRes = await supabase.from('vendors').select('id, name').in('id', vendorIds)
      ;(vRes.data || []).forEach(function (v) { vendorName[v.id] = v.name })
    }
    setEntries(rows.map(function (r) { return Object.assign({}, r, { _vendorName: r.vendor_id ? (vendorName[r.vendor_id] || '—') : '—' }) }))
    setLoading(false)
  }

  function openAdd() {
    setForm({ entry_type: 'advance', vendor_id: '', amount_rupees: '', payment_mode: 'cash', reference: '', description: '' })
    setError('')
    setShowAdd(true)
  }

  async function submitEntry() {
    if (saving) return
    var amt = Number(form.amount_rupees || 0)
    if (!isFinite(amt) || amt <= 0) { setError('Enter a valid amount'); return }
    if (!form.description.trim()) { setError('Description required'); return }
    setSaving(true); setError('')

    var { error: insErr } = await supabase.from('project_ledger').insert({
      project_id: project.id,
      entry_type: form.entry_type,
      vendor_id: form.vendor_id ? Number(form.vendor_id) : null,
      amount_paise: Math.round(amt * 100),
      payment_mode: form.payment_mode || null,
      reference: form.reference.trim() || null,
      description: form.description.trim(),
    })
    if (insErr) { setError(insErr.message || 'Save failed'); setSaving(false); return }
    try { await logActivity('PROJECT_LEDGER_POST', project.name + ' | ' + form.entry_type + ' | ' + amt) } catch (_) {}
    setSaving(false)
    setShowAdd(false)
    load()
  }

  async function reverseEntry(e) {
    if (!window.confirm('Reverse this entry? This posts a new offsetting entry — it does not delete the original.')) return
    var { error: insErr } = await supabase.from('project_ledger').insert({
      project_id: project.id,
      entry_type: 'reversal',
      vendor_id: e.vendor_id,
      amount_paise: -e.amount_paise,
      payment_mode: e.payment_mode,
      reference: e.reference,
      description: 'Reversal of #' + e.id + (e.description ? ': ' + e.description : ''),
      reversal_of: e.id,
    })
    if (insErr) { alert('Reverse failed: ' + insErr.message); return }
    try { await logActivity('PROJECT_LEDGER_REVERSE', project.name + ' | entry #' + e.id) } catch (_) {}
    load()
  }

  var totals = (function () {
    var t = { advance: 0, running_bill: 0, retention: 0, paid: 0 }
    entries.forEach(function (e) {
      t.paid += e.amount_paise || 0
      if (t[e.entry_type] != null) t[e.entry_type] += e.amount_paise || 0
    })
    return t
  })()
  var approvedBudget = project.approved_budget_paise || 0
  var variance = approvedBudget > 0 ? totals.paid - approvedBudget : null
  var variancePct = approvedBudget > 0 ? Math.round((variance / approvedBudget) * 100) : null

  if (!canView) return <p className="text-gray-400 text-sm text-center py-8">No access to the project ledger.</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {onBack && <button onClick={onBack} className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors mb-1">← Back</button>}
          <h2 className="text-lg font-bold text-gray-900">{project.name} — Ledger</h2>
          <p className="text-xs text-gray-400 font-mono">{project.project_code}</p>
        </div>
        {canWrite && (
          <button onClick={openAdd} className="px-3 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">+ Add Entry</button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Advances</p>
          <p className="text-lg font-semibold text-blue-700">{formatPoints(totals.advance)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Running Bills</p>
          <p className="text-lg font-semibold text-amber-700">{formatPoints(totals.running_bill)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Retention</p>
          <p className="text-lg font-semibold text-purple-700">{formatPoints(totals.retention)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total Paid</p>
          <p className="text-lg font-semibold text-gray-900">{formatPoints(totals.paid)}</p>
          {variance != null && (
            <p className={"text-[11px] font-medium " + (variance > 0 ? "text-red-600" : "text-green-600")}>
              {variance > 0 ? 'Over' : 'Under'} budget {variancePct}%
            </p>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <p className="text-xs text-gray-400 p-4">Loading entries...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-400 p-4 text-center">No ledger entries yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Vendor</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Reference</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(function (e) {
                  var isReversed = entries.some(function (o) { return o.reversal_of === e.id })
                  var canReverse = canWrite && e.entry_type !== 'reversal' && !isReversed
                  return (
                    <tr key={e.id} className={"border-b border-gray-100 last:border-b-0 " + (isReversed ? "opacity-50" : "")}>
                      <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                        {formatDate(e.posted_at)}
                        <div className="text-[10px] text-gray-400">{formatDateTime(e.posted_at)}</div>
                      </td>
                      <td className="px-3 py-2"><span className={"inline-block px-2 py-0.5 rounded text-xs font-medium " + (TYPE_CLS[e.entry_type] || '')}>{TYPE_LABEL[e.entry_type] || e.entry_type}</span></td>
                      <td className="px-3 py-2 text-xs text-gray-700">{e._vendorName}</td>
                      <td className={"px-3 py-2 text-right font-mono text-xs " + (e.amount_paise < 0 ? "text-red-600" : "text-gray-900")}>{formatPoints(e.amount_paise)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{e.reference || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-700">{e.description || '—'}{isReversed && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 uppercase">Reversed</span>}</td>
                      <td className="px-3 py-2 text-right">
                        {canReverse ? (
                          <button onClick={function () { reverseEntry(e) }} className="text-xs text-red-600 hover:text-red-800">Reverse</button>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && createPortal((
        <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={function () { if (!saving) setShowAdd(false) }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={function (ev) { ev.stopPropagation() }}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">Add Ledger Entry</h3>
              <button onClick={function () { if (!saving) setShowAdd(false) }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            {error && <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">{error}</div>}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Entry Type</label>
              <select value={form.entry_type} onChange={function (ev) { setForm(Object.assign({}, form, { entry_type: ev.target.value })) }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" style={{ fontSize: '16px' }}>
                {ENTRY_TYPES.map(function (t) { return <option key={t} value={t}>{TYPE_LABEL[t]}</option> })}
              </select>
            </div>
            <SearchDropdown label="Vendor (optional)" items={vendors} value={form.vendor_id}
              onChange={function (v) { setForm(Object.assign({}, form, { vendor_id: v })) }} placeholder="Search vendor..." />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹)</label>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount_rupees}
                onChange={function (ev) { setForm(Object.assign({}, form, { amount_rupees: ev.target.value })) }}
                placeholder="0.00" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment Mode</label>
              <div className="flex gap-2">
                {['cash', 'bank'].map(function (m) {
                  var active = form.payment_mode === m
                  return (
                    <button key={m} type="button" onClick={function () { setForm(Object.assign({}, form, { payment_mode: m })) }}
                      className={"flex-1 px-3 py-2 rounded-lg text-sm font-semibold border " + (active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-700 border-gray-200")}>
                      {m === 'cash' ? '💵 Cash' : '🏦 Bank'}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
              <input type="text" value={form.reference} onChange={function (ev) { setForm(Object.assign({}, form, { reference: ev.target.value })) }}
                placeholder="Invoice / cheque no." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description <span className="text-red-500">*</span></label>
              <VoiceInput type="text" value={form.description} onChange={function (ev) { setForm(Object.assign({}, form, { description: ev.target.value })) }}
                placeholder="What this entry is for" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={function () { if (!saving) setShowAdd(false) }} disabled={saving}
                className="flex-1 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
              <button onClick={submitEntry} disabled={saving}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg disabled:opacity-50">{saving ? 'Saving...' : 'Post Entry'}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}

export default ProjectLedger
