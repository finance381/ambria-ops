import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints, titleCase } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { useRealtime } from '../../lib/useRealtime'
import Modal from '../../components/ui/Modal'
import InventoryForm from '../inventory/InventoryForm'

var PAGE_SIZE = 20

function ItemReceipts({ profile, onCountChange }) {
  var [receipts, setReceipts] = useState([])
  var [loading, setLoading] = useState(true)
  var [hasMore, setHasMore] = useState(false)
  var [loadingMore, setLoadingMore] = useState(false)
  var [activeReceipt, setActiveReceipt] = useState(null)

  useRealtime(['expenses'], function () { loadReceipts(false) })
  useEffect(function () { loadReceipts(false) }, [])

  async function loadReceipts(append) {
    var offset = append ? receipts.length : 0
    if (append) setLoadingMore(true); else setLoading(true)
    var { data, error } = await supabase.rpc('list_pending_expense_receipts', {
      p_limit: PAGE_SIZE + 1,
      p_offset: offset,
    })
    if (error) {
      alert('Failed to load pending receipts: ' + error.message)
      setLoading(false); setLoadingMore(false)
      return
    }
    var rows = data || []
    var more = rows.length > PAGE_SIZE
    if (more) rows = rows.slice(0, PAGE_SIZE)
    var next = append ? receipts.concat(rows) : rows
    setReceipts(next)
    setHasMore(more)
    setLoading(false); setLoadingMore(false)
    if (!append && onCountChange) onCountChange(next.length + (more ? 1 : 0))
  }

  function handleReceiveDone() {
    setActiveReceipt(null)
    loadReceipts(false)
  }

  if (loading) return <p className="text-gray-400 text-sm text-center py-8">Loading...</p>

  return (
    <div className="space-y-3">
      {receipts.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No pending item receipts</p>
        </div>
      )}
      {receipts.map(function (r) {
        var ir = r.item_receipt || {}
        return (
          <div key={r.id} onClick={function () { setActiveReceipt(r) }}
            className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md active:bg-gray-50 cursor-pointer transition-all">
            <div className="flex items-start justify-between mb-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{ir.query || 'Item'}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {r.submitter_name || '—'} · {formatDate(r.expense_date || r.created_at)}
                </p>
              </div>
              <div className="text-right ml-2 flex-shrink-0">
                <p className="text-sm font-bold text-indigo-600">{ir.qty} {ir.unit}</p>
                <p className="text-[11px] text-gray-400">{formatPoints(r.amount_paise)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {ir.matched_item_id ? (
                <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">✓ Submitter matched</span>
              ) : (
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">New item</span>
              )}
              {ir.notes && <span className="text-[11px] text-gray-400 truncate">{ir.notes}</span>}
            </div>
            {r.description && <p className="text-[11px] text-gray-400 truncate mt-1">Expense: {r.description}</p>}
          </div>
        )
      })}
      {hasMore && (
        <button onClick={function () { loadReceipts(true) }} disabled={loadingMore}
          className="w-full py-3 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          {loadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}

      {activeReceipt && (
        <ReceiveModal receipt={activeReceipt} profile={profile}
          onClose={function () { setActiveReceipt(null) }}
          onDone={handleReceiveDone} />
      )}
    </div>
  )
}

function ReceiveModal({ receipt, profile, onClose, onDone }) {
  var ir = receipt.item_receipt || {}
  var [mode, setMode] = useState('match')
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  var [matchedId, setMatchedId] = useState(ir.matched_item_id || null)
  var [matchedSource, setMatchedSource] = useState(ir.matched_source || 'inventory')
  var [matchedName, setMatchedName] = useState(ir.matched_item_id ? (ir.query || '') : '')
  var [receiveQty, setReceiveQty] = useState(String(ir.qty || ''))
  var [itemQuery, setItemQuery] = useState('')
  var [itemMatches, setItemMatches] = useState([])
  var itemSearchTimer = useRef(null)

  var [cancelReason, setCancelReason] = useState('')

  function searchItems(term) {
    if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current)
    if (!term || term.trim().length < 2) { setItemMatches([]); return }
    itemSearchTimer.current = setTimeout(function () {
      var q = term.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
      Promise.all([
        supabase.from('inventory_items').select('id, name, unit').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(6),
        supabase.from('catering_store_items').select('id, name, unit').ilike('name', '%' + q + '%').eq('status', 'approved').order('name').limit(6),
      ]).then(function (results) {
        var inv = (results[0].data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
        var cs = (results[1].data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store' }) })
        setItemMatches(inv.concat(cs).slice(0, 8))
      })
    }, 300)
  }

  function pickMatch(item) {
    setMatchedId(item.id)
    setMatchedSource(item._source)
    setMatchedName(item.name)
    setItemQuery('')
    setItemMatches([])
  }

  function clearMatch() {
    setMatchedId(null)
    setMatchedSource('inventory')
    setMatchedName('')
    setItemQuery('')
  }

  async function confirmReceive() {
    if (saving) return
    setError('')
    if (!matchedId) { setError('Pick an item to match'); return }
    if (!receiveQty || Number(receiveQty) <= 0) { setError('Qty must be > 0'); return }
    setSaving(true)
    var { error: err } = await supabase.rpc('receive_expense_item', {
      p_expense_id: receipt.id,
      p_item_id: matchedId,
      p_qty: Number(receiveQty),
      p_source: matchedSource,
    })
    if (err) { setError(err.message); setSaving(false); return }
    try { await logActivity('EXPENSE_RECEIVE', matchedName + ' | qty ' + receiveQty + ' | exp #' + receipt.id) } catch (_) {}
    setSaving(false)
    onDone()
  }

  async function confirmCancel() {
    if (saving) return
    setError('')
    if (!cancelReason.trim()) { setError('Reason required'); return }
    setSaving(true)
    var { error: err } = await supabase.rpc('cancel_expense_item_receipt', {
      p_expense_id: receipt.id,
      p_reason: cancelReason.trim(),
    })
    if (err) { setError(err.message); setSaving(false); return }
    try { await logActivity('EXPENSE_RECEIVE_CANCEL', 'exp #' + receipt.id + ' | ' + cancelReason.trim().slice(0, 60)) } catch (_) {}
    setSaving(false)
    onDone()
  }

  async function handleNewItemSaved(savedItem, tableName) {
    if (saving) return
    setSaving(true)
    var source = tableName === 'catering_store_items' ? 'catering_store' : 'inventory'
    var { error: err } = await supabase.rpc('link_expense_to_new_item', {
      p_expense_id: receipt.id,
      p_new_item_id: savedItem.id,
      p_source: source,
    })
    if (err) {
      // Item saved but link failed — flip back to match mode; user can search for the just-created item
      setError('Item created but link failed: ' + err.message + '. Search for it under Match Existing.')
      setMode('match')
      setSaving(false)
      return
    }
    try { await logActivity('EXPENSE_RECEIVE_NEW', savedItem.name + ' | exp #' + receipt.id) } catch (_) {}
    setSaving(false)
    onDone()
  }

  var invFormPrefill = {
    name: ir.query || '',
    qty: ir.qty || '',
    unit: ir.unit || 'Pieces',
    category_id: ir.matched_category_id || null,
    description: ir.notes || '',
  }

  var modalTitle = mode === 'new' ? 'Create New Item' : mode === 'cancel' ? 'Cancel Receipt' : 'Receive Item'

  return (
    <Modal open={true} onClose={onClose} title={modalTitle}>
      <div className="space-y-4">
        {/* Header info */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="flex justify-between mb-1">
            <span className="text-xs text-gray-500">Submitter</span>
            <span className="text-xs font-semibold text-gray-800">{receipt.submitter_name || '—'}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-xs text-gray-500">Expense date</span>
            <span className="text-xs text-gray-800">{formatDate(receipt.expense_date || receipt.created_at)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs text-gray-500">Amount</span>
            <span className="text-xs text-gray-800">{formatPoints(receipt.amount_paise)}</span>
          </div>
          {receipt.description && (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <p className="text-[11px] text-gray-400 uppercase">Description</p>
              <p className="text-xs text-gray-700 mt-0.5">{receipt.description}</p>
            </div>
          )}
        </div>

        {/* Item requested */}
        <div className="bg-indigo-50/40 border border-indigo-100 rounded-lg p-3">
          <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider mb-1.5">Item Requested</p>
          <p className="text-sm font-semibold text-gray-800">{ir.query || '—'}</p>
          <p className="text-xs text-gray-500 mt-0.5">{ir.qty} {ir.unit}{ir.notes ? ' · ' + ir.notes : ''}</p>
          {ir.matched_item_id && (
            <p className="text-[11px] text-green-700 mt-1">✓ Submitter matched to existing item (id {ir.matched_item_id}, {ir.matched_source})</p>
          )}
        </div>

        {/* Mode tabs — hidden in 'new' mode */}
        {mode !== 'new' && (
          <div className="flex gap-2">
            <button type="button" onClick={function () { setMode('match'); setError('') }}
              className={"flex-1 py-2 text-xs font-bold rounded-lg border transition-colors " +
                (mode === 'match' ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
              Match Existing
            </button>
            <button type="button" onClick={function () { setMode('new'); setError('') }}
              className="flex-1 py-2 text-xs font-bold rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50">
              Create New
            </button>
            <button type="button" onClick={function () { setMode('cancel'); setError('') }}
              className={"flex-1 py-2 text-xs font-bold rounded-lg border transition-colors " +
                (mode === 'cancel' ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-500 border-gray-200 hover:bg-red-50 hover:text-red-600")}>
              Cancel Receipt
            </button>
          </div>
        )}

        {/* Match mode */}
        {mode === 'match' && (
          <div className="space-y-3">
            {matchedId ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-green-700 uppercase tracking-wider">Matched to</p>
                    <p className="text-sm font-semibold text-gray-800 mt-0.5">{matchedName}</p>
                    <p className="text-[11px] text-gray-500">{matchedSource === 'catering_store' ? 'Catering Store' : 'Inventory'}</p>
                  </div>
                  <button type="button" onClick={clearMatch}
                    className="text-xs text-gray-500 hover:text-red-600 underline">Change</button>
                </div>
              </div>
            ) : (
              <div className="relative">
                <label className="block text-xs font-medium text-gray-600 mb-1">Search inventory</label>
                <input type="text" value={itemQuery}
                  onChange={function (e) { setItemQuery(e.target.value); searchItems(e.target.value) }}
                  placeholder="Type item name..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white" style={{ fontSize: '16px' }} />
                {itemMatches.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {itemMatches.map(function (m) {
                      return (
                        <button key={m._source + '_' + m.id} type="button"
                          onMouseDown={function (evt) { evt.preventDefault(); pickMatch(m) }}
                          className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-50 last:border-0">
                          <div className="text-sm text-gray-800 font-medium truncate">{m.name}</div>
                          <div className="text-[10px] text-gray-400">{m._source === 'catering_store' ? 'Catering Store' : 'Inventory'}{m.unit ? ' · ' + m.unit : ''}</div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Qty received <span className="text-red-500">*</span></label>
              <input type="number" value={receiveQty}
                onChange={function (e) { setReceiveQty(e.target.value) }}
                min="0" step="any"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 bg-white" style={{ fontSize: '16px' }} />
              <p className="text-[10px] text-gray-400 mt-0.5">Submitter requested: {ir.qty} {ir.unit}</p>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={onClose} disabled={saving}
                className="flex-1 py-2.5 text-sm font-semibold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
                Close
              </button>
              <button type="button" onClick={confirmReceive} disabled={saving || !matchedId}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                {saving ? 'Receiving...' : 'Receive & Add to Stock'}
              </button>
            </div>
          </div>
        )}

        {/* New mode — renders InventoryForm inline */}
        {mode === 'new' && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center justify-between">
              <p className="text-[11px] text-amber-700">Adding <strong>{titleCase(ir.query || '')}</strong> as new inventory item. On save, expense receipt links automatically.</p>
              <button type="button" onClick={function () { setMode('match'); setError('') }}
                className="text-[11px] font-bold text-gray-500 hover:text-gray-700 underline ml-2 flex-shrink-0">Back</button>
            </div>
            <InventoryForm
              item={null}
              prefill={invFormPrefill}
              profile={profile}
              onClose={function () { setMode('match'); setError('') }}
              onSaved={handleNewItemSaved}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}

        {/* Cancel mode */}
        {mode === 'cancel' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-red-700 mb-1">Cancel reason <span className="text-red-500">*</span></label>
              <textarea value={cancelReason}
                onChange={function (e) { setCancelReason(e.target.value) }}
                rows={3} maxLength={500} placeholder="e.g. Damaged on arrival, wrong item delivered, expense not really for inventory..."
                className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm focus:ring-2 focus:ring-red-300 bg-white resize-none" style={{ fontSize: '16px' }} />
              <p className="text-[10px] text-gray-400 mt-0.5">Cancelling only marks the receipt cancelled — the expense itself is untouched.</p>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={function () { setMode('match'); setError('') }} disabled={saving}
                className="flex-1 py-2.5 text-sm font-semibold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
                Back
              </button>
              <button type="button" onClick={confirmCancel} disabled={saving || !cancelReason.trim()}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors">
                {saving ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default ItemReceipts