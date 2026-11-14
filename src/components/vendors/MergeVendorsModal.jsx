import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/logger'
import { appConfirm } from '../ui/AppDialog'
import { useBodyScrollLock } from '../../lib/useBodyScrollLock'
import { useBackButtonClose } from '../../lib/useBackButtonClose'
import SearchField from '../ui/SearchField'
import SearchDropdown from '../ui/SearchDropdown'
import Icon from '../ui/Icon'

var MERGE_LABEL = 'block text-[12px] font-semibold text-slate-600 mb-1.5'

// Shared by Vendors.jsx (master) and VendorLedger.jsx — folding duplicate
// vendor records into one is the same operation and the same confirmation
// regardless of which screen it's opened from, backed by fn_merge_vendors
// (00048): every ledger_entries row and real FK reference (cost transfers,
// manpower assignments, project vendors/ledger) moves from each source
// vendor onto the target, expenses.metadata's vendor-lookup fields get
// rewritten, and the source vendor is soft-retired (active=false,
// merged_into_id set) rather than deleted.
//
// `vendors`: [{ id, name, active, subtitle?, weight? }] — subtitle is an
// optional caller-supplied line of context shown beside each name in the
// picker (VendorLedger passes its entry count + balance; a caller with
// nothing relevant to show can just leave it out). `weight` is an optional
// plain number (VendorLedger passes its ledger entry count) summed across
// the selected sources and handed to `weightLabel(total)` — when a caller
// provides both, the confirm dialog and the warning banner name the actual
// thing moving ("14 ledger entries") instead of just a vendor count; a
// caller with nothing meaningful to count (Vendors.jsx master) can leave
// both out and gets the generic vendor-count wording instead.
function MergeVendorsModal({ open, onClose, vendors, onMerged, weightLabel }) {
  var [sourceIds, setSourceIds] = useState([])
  var [targetId, setTargetId] = useState('')
  var [search, setSearch] = useState('')
  var [saving, setSaving] = useState(false)
  useBodyScrollLock(open)
  useBackButtonClose(open, function () { if (!saving) handleClose() })

  function toggleSource(vendorId) {
    setSourceIds(function (prev) {
      if (prev.indexOf(vendorId) !== -1) return prev.filter(function (id) { return id !== vendorId })
      return prev.concat([vendorId])
    })
    setTargetId(function (prev) { return String(prev) === String(vendorId) ? '' : prev })
  }

  function reset() {
    setSourceIds([])
    setTargetId('')
    setSearch('')
  }

  function handleClose() {
    if (saving) return
    reset()
    onClose()
  }

  async function doMerge() {
    if (saving || sourceIds.length === 0 || !targetId) return
    var pool = (vendors || []).filter(function (v) { return v.active })
    var targetVendor = pool.find(function (v) { return String(v.id) === String(targetId) })
    var sourceVendors = pool.filter(function (v) { return sourceIds.indexOf(v.id) !== -1 })
    var sourceNames = sourceVendors.map(function (v) { return v.name }).join(', ')
    var totalWeight = sourceVendors.reduce(function (s, v) { return s + (v.weight || 0) }, 0)
    var ok = await appConfirm(
      'Merge ' + sourceNames + ' into "' + (targetVendor ? targetVendor.name : '—') + '"?\n\n' +
      (typeof weightLabel === 'function' ? weightLabel(totalWeight) + ' and every ' : 'Every ') +
      'expense reference will move to the target. ' +
      'The merged vendor(s) will be deactivated. This cannot be undone from here.'
    )
    if (!ok) return
    setSaving(true)
    var { data, error } = await supabase.rpc('fn_merge_vendors', {
      p_source_ids: sourceIds,
      p_target_id: Number(targetId),
    })
    setSaving(false)
    if (error) { alert('Merge failed: ' + error.message); return }
    try { await logActivity('VENDOR_MERGE', sourceNames + ' -> ' + (targetVendor ? targetVendor.name : targetId)) } catch (_) {}
    reset()
    onClose()
    // Reloaded (and, visually, the modal already closed above) before the
    // blocking alert — alerting first left the modal sitting on screen,
    // sources still ticked, behind a dialog the browser doesn't let React
    // paint past until it's dismissed.
    if (onMerged) await onMerged(data)
    var summary = (data && (data.ledger_entries_moved || 0)) + ' ledger entries and ' + (data && (data.expenses_updated || 0)) + ' expense reference(s) moved.'
    alert('Merged. ' + summary)
  }

  if (!open) return null
  var q = search.trim().toLowerCase()
  var pool = (vendors || []).filter(function (v) { return v.active })
  var searched = q ? pool.filter(function (v) { return (v.name || '').toLowerCase().indexOf(q) !== -1 }) : pool
  var targetOptions = pool.filter(function (v) { return sourceIds.indexOf(v.id) === -1 })
  var readyToMerge = sourceIds.length > 0 && targetId
  var selectedTotalWeight = pool
    .filter(function (v) { return sourceIds.indexOf(v.id) !== -1 })
    .reduce(function (s, v) { return s + (v.weight || 0) }, 0)

  return createPortal((
    <div className="fixed inset-0 z-[9998] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={handleClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto overscroll-contain ambria-thin-scroll"
        onClick={function (ev) { ev.stopPropagation() }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-display text-[17px] font-bold text-slate-900">
              <Icon name="split" size={17} className="shrink-0 text-indigo-500" />
              Merge Vendors
            </h3>
            <p className="mt-1 text-[12.5px] text-slate-500 leading-snug">
              Fold duplicates into one. Every ledger entry and expense reference moves to the target you pick below.
            </p>
          </div>
          <button type="button" onClick={handleClose} disabled={saving} aria-label="Close"
            className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div>
          <label className={MERGE_LABEL}>
            Vendors to merge
            {sourceIds.length > 0 && (
              <span className="ml-1.5 font-bold text-indigo-600" data-notranslate>{sourceIds.length} selected</span>
            )}
          </label>
          <SearchField value={search} onChange={function (v) { setSearch(v) }} placeholder="Search vendors..." />
          <div className="mt-2 border border-slate-200 rounded-xl max-h-60 overflow-y-auto overscroll-contain ambria-thin-scroll divide-y divide-slate-100">
            {searched.length === 0 && <p className="text-[12.5px] text-slate-400 text-center py-6">No vendors match</p>}
            {searched.map(function (v) {
              var checked = sourceIds.indexOf(v.id) !== -1
              return (
                <label key={v.id}
                  className={"flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors " +
                    (checked ? "bg-indigo-50" : "hover:bg-slate-50")}>
                  <input type="checkbox" checked={checked} onChange={function () { toggleSource(v.id) }}
                    className="shrink-0 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30" />
                  <span className={"flex-1 min-w-0 truncate text-[13px] font-semibold " + (checked ? "text-indigo-800" : "text-slate-800")}>
                    {v.name}
                  </span>
                  {v.subtitle && (
                    <span className="shrink-0 text-[11.5px] text-slate-500 tabular-nums" data-notranslate>
                      {v.subtitle}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>

        {sourceIds.length > 0 && (
          <div>
            <label className={MERGE_LABEL}>Merge into</label>
            <SearchDropdown
              items={targetOptions.map(function (v) { return { label: v.name + (v.subtitle ? ' (' + v.subtitle + ')' : ''), value: String(v.id) } })}
              value={targetId ? String(targetId) : ''}
              onChange={function (val) { setTargetId(val) }}
              placeholder="Search target vendor..." noVoice />
            {/* What the press will actually do, in the numbers it will do it
                to. A merge cannot be undone from this screen, so the sentence
                before it should be the specific one. */}
            <p className="mt-2 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[12px] font-semibold text-amber-800">
              <span className="shrink-0 mt-px"><Icon name="alert" size={14} /></span>
              <span>
                {typeof weightLabel === 'function' ? (
                  <>{weightLabel(selectedTotalWeight)} from <span data-notranslate>{sourceIds.length}</span> {sourceIds.length === 1 ? 'vendor' : 'vendors'} will move here.</>
                ) : (
                  <><span data-notranslate>{sourceIds.length}</span> {sourceIds.length === 1 ? 'vendor' : 'vendors'} will move into the target above.</>
                )} This cannot be undone.
              </span>
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-3 border-t border-slate-100">
          <button type="button" onClick={handleClose} disabled={saving}
            className="flex-1 h-11 text-[13px] font-bold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 disabled:opacity-40 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={doMerge} disabled={!readyToMerge || saving}
            className="flex-1 h-11 inline-flex items-center justify-center gap-2 text-[13px] font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-indigo-600 transition-all">
            <Icon name={saving ? 'refresh' : 'split'} size={15} />
            {saving ? 'Merging…' : 'Merge Vendors'}
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}

export default MergeVendorsModal
