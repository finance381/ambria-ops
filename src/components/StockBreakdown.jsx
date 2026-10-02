import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { formatPaise, formatDate } from '../lib/format'
import { useReferenceData } from '../lib/referenceData.jsx'
import { reconcileStockBatches } from '../lib/stockBatches'
import Modal from './ui/Modal'
import Icon from './ui/Icon'

// Stock breakdown for one item: its total and value, the stock by venue, and
// each batch it came in as — qty, rate, date, who — with its venue split and
// an Allocate action for stock no venue holds. Opening it first settles the
// item's batches against its quantity and allocations as they are now.
// Shared by the admin Inventory card and the phone Item List.
//
// item: { id, _source, name, unit, qty }. onChanged: called after an
// allocation is saved, so the list behind can reload.
function StockBreakdown({ item, profile, onClose, onChanged }) {
  var allVenueRefs = useReferenceData().venues
  var venues = allVenueRefs.filter(function (v) { return v.active })
  var [subVenues, setSubVenues] = useState([])
  var [stockItem, setStockItem] = useState(item)
  var [stockBatches, setStockBatches] = useState(null)
  var [stockMissing, setStockMissing] = useState(false)
  // The two views: stock by venue, or batch by batch.
  var [stockView, setStockView] = useState('venue')
  // Placing a batch's unallocated stock at a venue:
  // { batchId, venue_id, sub_venue_id, qty } while its form is open.
  var [batchAlloc, setBatchAlloc] = useState(null)
  var [batchAllocSaving, setBatchAllocSaving] = useState(false)
  var [batchAllocErr, setBatchAllocErr] = useState('')

  useEffect(function () {
    supabase.from('sub_venues').select('id, name, venue_id').eq('active', true).order('name')
      .then(function (res) { setSubVenues(res.data || []) })
  }, [])
  useEffect(function () {
    if (item) openStock(item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item && item.id, item && item._source])

  // Every batch of stock the item received, oldest first, each with its
  // venue split (stock_batches / stock_batch_allocations, migration 00066).
  async function openStock(item) {
    setStockItem(item); setStockBatches(null); setStockMissing(false); setBatchAlloc(null); setBatchAllocErr('')
    // First settle the batches against the item as it is now — its quantity
    // and venue allocations may have been changed somewhere that does not
    // write batches (the phone form, Purchase, a quantity typed in directly).
    var isCs = item._source === 'catering_store'
    var [fresh, allocNow] = await Promise.all([
      supabase.from(isCs ? 'catering_store_items' : 'inventory_items').select('qty, rate_paise').eq('id', item.id).maybeSingle(),
      supabase.from(isCs ? 'cs_venue_allocations' : 'venue_allocations').select('venue_id, sub_venue_id, qty').eq('item_id', item.id),
    ])
    if (fresh.data && !allocNow.error) {
      await reconcileStockBatches(supabase, {
        itemId: item.id,
        itemSource: isCs ? 'catering_store' : 'inventory',
        finalQty: fresh.data.qty,
        finalAllocs: allocNow.data || [],
        ratePaise: fresh.data.rate_paise,
        userId: profile?.id,
      })
      setStockItem(Object.assign({}, item, { qty: fresh.data.qty }))
    }
    var { data, error } = await supabase
      .from('stock_batches')
      .select('id, qty, rate_paise, is_opening, created_at, profiles:added_by(name), stock_batch_allocations(id, venue_id, sub_venue_id, qty)')
      .eq('item_id', item.id)
      .eq('item_source', item._source === 'catering_store' ? 'catering_store' : 'inventory')
      .order('created_at', { ascending: true })
    if (error) { setStockMissing(true); setStockBatches([]); return }
    setStockBatches(data || [])
  }

  // Puts part of a batch's unallocated stock at a venue: onto the item's
  // venue allocations first (their guard trigger is what can refuse), then
  // onto the batch's own split, then reloads the breakdown.
  async function saveBatchAlloc(item, batch, left) {
    if (batchAllocSaving || !batchAlloc) return
    var q = Math.round((Number(batchAlloc.qty) || 0) * 1000) / 1000
    if (!batchAlloc.venue_id) { setBatchAllocErr('Pick a venue'); return }
    if (!(q > 0)) { setBatchAllocErr('Enter a quantity'); return }
    if (q > left) { setBatchAllocErr('Only ' + left + ' of this batch is not allocated'); return }
    setBatchAllocSaving(true); setBatchAllocErr('')
    var vId = Number(batchAlloc.venue_id)
    var svId = batchAlloc.sub_venue_id ? Number(batchAlloc.sub_venue_id) : null
    var allocTable = item._source === 'catering_store' ? 'cs_venue_allocations' : 'venue_allocations'
    var findQ = supabase.from(allocTable).select('id, qty').eq('item_id', item.id).eq('venue_id', vId).is('sub_department_id', null)
    findQ = svId ? findQ.eq('sub_venue_id', svId) : findQ.is('sub_venue_id', null)
    var { data: existingRow } = await findQ.limit(1).maybeSingle()
    var res = existingRow
      ? await supabase.from(allocTable).update({ qty: Math.round(((Number(existingRow.qty) || 0) + q) * 1000) / 1000 }).eq('id', existingRow.id)
      : await supabase.from(allocTable).insert({ item_id: item.id, venue_id: vId, sub_venue_id: svId, qty: q })
    if (res.error) { setBatchAllocSaving(false); setBatchAllocErr(res.error.message); return }
    var res2 = await supabase.from('stock_batch_allocations').insert({ batch_id: batch.id, venue_id: vId, sub_venue_id: svId, qty: q })
    setBatchAllocSaving(false)
    if (res2.error) { setBatchAllocErr(res2.error.message); return }
    setBatchAlloc(null)
    openStock(item)
    if (onChanged) onChanged()
  }

  if (!item) return null
  return (
    <Modal open={!!item} onClose={onClose} title="Stock breakdown" subtitle={stockItem ? stockItem.name : ''} wide>
        {(function () {
          var unitLbl = stockItem.unit || ''
          var onHand = Number(stockItem.qty) || 0
          if (stockBatches === null) return <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
          if (stockMissing) {
            return (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <span className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 inline-flex items-center justify-center"><Icon name="alert" size={20} /></span>
                <p className="text-[14px] font-semibold text-slate-800">Stock breakdown is not set up yet</p>
                <p className="text-[12.5px] text-slate-500 max-w-sm">The database update for stock batches (migration 00066) has to be applied first.</p>
              </div>
            )
          }
          var batchQty = Math.round(stockBatches.reduce(function (sum, b) { return sum + (Number(b.qty) || 0) }, 0) * 1000) / 1000
          var totalValue = stockBatches.reduce(function (sum, b) { return sum + (b.rate_paise ? Math.round((Number(b.qty) || 0) * b.rate_paise) : 0) }, 0)
          var gap = Math.round((onHand - batchQty) * 1000) / 1000
          // Every batch's share at a venue added together, in first-seen order,
          // with what it is worth at each batch's rate and which batches it
          // came from; the stock no venue holds is counted on its own.
          var byPlace = {}
          var placeOrder = []
          var restQty = 0, restVal = 0
          stockBatches.forEach(function (b, bi) {
            var used = 0
            ;(b.stock_batch_allocations || []).forEach(function (a) {
              var q = Number(a.qty) || 0
              used += q
              var k = (a.venue_id || '') + '|' + (a.sub_venue_id || '')
              if (!byPlace[k]) { byPlace[k] = { key: k, venue_id: a.venue_id, sub_venue_id: a.sub_venue_id, qty: 0, value: 0, parts: [] }; placeOrder.push(k) }
              byPlace[k].qty += q
              byPlace[k].value += b.rate_paise ? Math.round(q * b.rate_paise) : 0
              byPlace[k].parts.push({ n: bi + 1, q: q, rate: b.rate_paise })
            })
            var left = Math.round(((Number(b.qty) || 0) - used) * 1000) / 1000
            if (left > 0) { restQty += left; restVal += b.rate_paise ? Math.round(left * b.rate_paise) : 0 }
          })
          restQty = Math.round(restQty * 1000) / 1000
          var places = placeOrder.map(function (k) { return byPlace[k] })
          // One colour per place, shared by the bar, its legend and the list.
          var PALETTE = ['#818CF8', '#34D399', '#38BDF8', '#FB7185', '#A78BFA', '#2DD4BF', '#FACC15', '#F472B6', '#94A3B8']
          function colourOf(i) { return PALETTE[i % PALETTE.length] }
          function placeName(pl) {
            var v = allVenueRefs.find(function (x) { return x.id === pl.venue_id })
            var sv = pl.sub_venue_id ? subVenues.find(function (x) { return x.id === pl.sub_venue_id }) : null
            return { code: v ? v.code : '—', name: sv ? sv.name : (v ? v.name : 'Venue removed') }
          }
          function r3(n) { return Math.round(n * 1000) / 1000 }
          return (
            <div className="space-y-4">
              {/* Summary: the two numbers that matter, and where the stock is. */}
              <div className="rounded-2xl bg-gradient-to-br from-[#3B4668] to-[#262E49] text-white p-4 sm:p-5 shadow-[0_10px_30px_-12px_rgba(38,46,73,0.6)]">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">Total stock</p>
                    <p className="text-[30px] font-extrabold leading-tight tabular-nums">{onHand} <span className="text-[14px] font-semibold text-white/65">{unitLbl}</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">Total value</p>
                    <p className="text-[26px] font-extrabold leading-tight tabular-nums">{totalValue > 0 ? formatPaise(totalValue) : '—'}</p>
                  </div>
                </div>
                {batchQty > 0 && (
                  <>
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-white/80">
                      {places.map(function (pl, i) {
                        var nm = placeName(pl)
                        return (
                          <span key={pl.key} className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: colourOf(i) }} />
                            <b className="font-semibold text-white">{nm.code}</b> {nm.name} <span className="text-white/60 tabular-nums">{r3(pl.qty)}</span>
                          </span>
                        )
                      })}
                      {restQty > 0 && (
                        <span className="inline-flex items-center gap-1.5 text-amber-200">
                          <span className="w-2 h-2 rounded-full bg-amber-400" />Not allocated <span className="tabular-nums">{restQty}</span>
                        </span>
                      )}
                    </div>
                  </>
                )}
                <p className="mt-3 pt-3 border-t border-white/10 text-[12px] text-white/60">
                  {stockBatches.length} batch{stockBatches.length !== 1 ? 'es' : ''} · {places.length} place{places.length !== 1 ? 's' : ''}{restQty > 0 ? ' · ' + restQty + ' ' + unitLbl + ' not allocated' : ''}
                </p>
              </div>

              {stockBatches.length === 0 && (
                <p className="py-6 text-center text-[13px] text-slate-500">No stock batches recorded for this item yet.</p>
              )}

              {stockBatches.length > 0 && (
                <div className="inline-flex gap-1 p-1 bg-slate-100 rounded-xl">
                  {[{ k: 'venue', label: 'By venue', icon: 'mapPin' }, { k: 'batch', label: 'By batch', icon: 'list' }].map(function (t) {
                    var on = stockView === t.k
                    return (
                      <button key={t.k} type="button" onClick={function () { setStockView(t.k) }} aria-pressed={on}
                        className={"inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold transition-colors " + (on ? "bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)]" : "text-slate-500 hover:text-slate-800")}>
                        <Icon name={t.icon} size={14} />{t.label}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* By venue: each place's total, its value, and the batches it holds. */}
              {stockBatches.length > 0 && stockView === 'venue' && (
                <div className="rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                  {places.map(function (pl, i) {
                    var nm = placeName(pl)
                    return (
                      <div key={pl.key} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: colourOf(i) }} />
                          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded bg-[#EDEFF5] text-[11px] font-bold text-[#333D5E]">{nm.code}</span>
                          <span className="flex-1 min-w-0 text-[14px] font-medium text-slate-800 truncate">{nm.name}</span>
                          <span className="shrink-0 text-right">
                            <span className="block text-[15px] font-extrabold text-slate-900 tabular-nums">{r3(pl.qty)} <span className="text-[11.5px] font-semibold text-slate-500">{unitLbl}</span></span>
                            <span className="block text-[12.5px] font-semibold text-slate-500 tabular-nums">{pl.value > 0 ? formatPaise(pl.value) : '—'}</span>
                          </span>
                        </div>
                        <div className="mt-2 ml-[22px] flex flex-wrap gap-1.5">
                          {pl.parts.map(function (pt, pi) {
                            return (
                              <span key={pi} className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-slate-100 text-[11.5px] text-slate-600 tabular-nums">
                                <b className="text-slate-800">Batch {pt.n}</b> · {r3(pt.q)}{pt.rate ? ' × ' + formatPaise(pt.rate) : ''}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {restQty > 0 && (
                    <div className="flex items-center gap-3 px-4 py-3 bg-amber-50/70">
                      <span className="shrink-0 w-2.5 h-2.5 rounded-full bg-amber-400" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-semibold text-amber-900">Not allocated to a venue</span>
                        <button type="button" onClick={function () { setStockView('batch') }} className="text-[12px] font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900">Allocate from By batch</button>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[15px] font-extrabold text-amber-900 tabular-nums">{restQty} <span className="text-[11.5px] font-semibold text-amber-700">{unitLbl}</span></span>
                        <span className="block text-[12.5px] font-semibold text-amber-700 tabular-nums">{restVal > 0 ? formatPaise(restVal) : '—'}</span>
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[#F6F7FB]">
                    <span className="text-[14px] font-extrabold text-slate-900">Total</span>
                    <span className="text-right">
                      <span className="block text-[15px] font-extrabold text-slate-900 tabular-nums">{batchQty} <span className="text-[11.5px] font-semibold text-slate-500">{unitLbl}</span></span>
                      <span className="block text-[13px] font-bold text-[#2B3452] tabular-nums">{totalValue > 0 ? formatPaise(totalValue) : '—'}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* By batch: a timeline, oldest first — when it came, how much, at
                  what rate, and where it went. */}
              {stockBatches.length > 0 && stockView === 'batch' && (
                <ol className="relative space-y-3 before:absolute before:left-[15px] before:top-4 before:bottom-4 before:w-px before:bg-slate-200">
                  {stockBatches.map(function (b, bi) {
                    var bQty = Number(b.qty) || 0
                    var allocs = b.stock_batch_allocations || []
                    var allocated = r3(allocs.reduce(function (sum, a) { return sum + (Number(a.qty) || 0) }, 0))
                    var left = r3(bQty - allocated)
                    function price(q) { return b.rate_paise ? formatPaise(Math.round(q * b.rate_paise)) : '—' }
                    return (
                      <li key={b.id} className="relative pl-11">
                        <span className={"absolute left-0 top-3 w-[31px] h-[31px] rounded-full ring-4 ring-white inline-flex items-center justify-center text-[12px] font-extrabold " + (b.is_opening ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-700")}>{bi + 1}</span>
                        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
                            <div className="min-w-0">
                              <p className="text-[14px] font-bold text-slate-900">{b.is_opening ? 'Opening stock' : 'New stock'}</p>
                              <p className="text-[12px] text-slate-500 truncate">{formatDate(b.created_at)}{b.profiles?.name ? ' · ' + b.profiles.name : ''}</p>
                            </div>
                            {/* Qty, unit rate and total as three labelled figures. */}
                            <div className="flex items-stretch rounded-xl border border-slate-200 overflow-hidden text-right">
                              <div className="px-3 py-1.5">
                                <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Qty</p>
                                <p className="text-[14px] font-bold text-slate-900 tabular-nums">{bQty} <span className="text-[11.5px] font-semibold text-slate-500">{unitLbl}</span></p>
                              </div>
                              <div className="px-3 py-1.5 border-l border-slate-200">
                                <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Rate</p>
                                <p className="text-[14px] font-bold text-slate-900 tabular-nums">{b.rate_paise ? formatPaise(b.rate_paise) : '—'}</p>
                              </div>
                              <div className="px-3 py-1.5 border-l border-slate-200 bg-[#F6F7FB]">
                                <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Total</p>
                                <p className="text-[15px] font-extrabold text-[#2B3452] tabular-nums">{price(bQty)}</p>
                              </div>
                            </div>
                          </div>
                          {allocs.map(function (a) {
                            var nm = placeName(a)
                            var q = Number(a.qty) || 0
                            return (
                              <div key={a.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-4 py-2.5 border-b border-slate-100 last:border-b-0">
                                {/* The place in full; on a narrow screen its qty
                                    and price drop under it instead of cutting
                                    the name short. */}
                                <span className="flex-1 min-w-[150px] flex items-start gap-2">
                                  <span className="shrink-0 mt-px inline-flex items-center px-1.5 py-0.5 rounded bg-[#EDEFF5] text-[11px] font-bold text-[#333D5E]">{nm.code}</span>
                                  <span className="min-w-0 text-[13px] font-medium text-slate-800 break-words">{nm.name}</span>
                                </span>
                                <span className="ml-auto shrink-0 flex items-center gap-2.5">
                                  <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-slate-100 text-[13px] font-bold text-slate-900 tabular-nums">{q} <span className="text-[11px] font-semibold text-slate-500">{unitLbl}</span></span>
                                  <span className="w-[92px] text-right text-[14px] font-bold text-slate-900 tabular-nums">{price(q)}</span>
                                </span>
                              </div>
                            )
                          })}
                          {left > 0 && (
                            <div className="bg-amber-50/60">
                              <div className="flex items-center gap-2.5 px-4 pt-2.5 pb-2">
                                <span className="flex-1 min-w-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-amber-800">
                                  <Icon name="alert" size={13} className="shrink-0" />Not allocated
                                </span>
                                <span className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-amber-100 text-[13px] font-bold text-amber-900 tabular-nums">{left} <span className="text-[11px] font-semibold text-amber-700">{unitLbl}</span></span>
                                <span className="shrink-0 w-[92px] text-right text-[14px] font-bold text-amber-900 tabular-nums">{price(left)}</span>
                              </div>
                              {/* Its own full-width button, saying what it does —
                                  a small pin tucked beside the label was easy to
                                  miss, and on a phone it was squeezed to an icon. */}
                              {(!batchAlloc || batchAlloc.batchId !== b.id) && (
                                <div className="px-4 pb-3">
                                  <button type="button" onClick={function () { setBatchAllocErr(''); setBatchAlloc({ batchId: b.id, venue_id: '', sub_venue_id: '', qty: String(left) }) }}
                                    className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold text-white bg-[#3B4668] shadow-[0_4px_12px_-6px_rgba(59,70,104,0.6)] hover:bg-[#2F3854] active:bg-[#2F3854] transition-colors">
                                    <Icon name="mapPin" size={15} />Allocate {left} {unitLbl} to a venue
                                  </button>
                                </div>
                              )}
                              {batchAlloc && batchAlloc.batchId === b.id && (function () {
                                var svs = batchAlloc.venue_id ? subVenues.filter(function (sv) { return String(sv.venue_id) === String(batchAlloc.venue_id) }) : []
                                var SEL = "w-full h-10 pl-3 pr-8 appearance-none bg-white border border-slate-300 rounded-xl text-[13.5px] text-slate-800 focus:outline-none focus:ring-4 focus:ring-[#3B4668]/10 focus:border-[#A9B1CB]"
                                function set(patch) { setBatchAlloc(function (prev) { var n = Object.assign({}, prev, patch); if (patch.venue_id !== undefined) n.sub_venue_id = ''; return n }) }
                                return (
                                  <div className="px-4 pb-3">
                                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_auto] items-end">
                                      <div className="relative">
                                        <label className="block text-[12px] font-semibold text-slate-700 mb-1">Venue</label>
                                        <select value={batchAlloc.venue_id} onChange={function (e) { set({ venue_id: e.target.value }) }} className={SEL}>
                                          <option value="">Select venue…</option>
                                          {venues.map(function (v) { return <option key={v.id} value={String(v.id)}>{v.code + ' — ' + v.name}</option> })}
                                        </select>
                                        <Icon name="chevronDown" size={14} className="absolute right-2.5 bottom-3 text-slate-400 pointer-events-none" />
                                      </div>
                                      <div className="relative">
                                        <label className="block text-[12px] font-semibold text-slate-700 mb-1">Sub-venue</label>
                                        <select value={batchAlloc.sub_venue_id} onChange={function (e) { set({ sub_venue_id: e.target.value }) }} disabled={svs.length === 0} className={SEL + " disabled:bg-slate-100 disabled:text-slate-400"}>
                                          <option value="">{svs.length === 0 ? '—' : 'Select sub-venue…'}</option>
                                          {svs.map(function (sv) { return <option key={sv.id} value={String(sv.id)}>{sv.name}</option> })}
                                        </select>
                                        <Icon name="chevronDown" size={14} className="absolute right-2.5 bottom-3 text-slate-400 pointer-events-none" />
                                      </div>
                                      <div>
                                        <label className="block text-[12px] font-semibold text-slate-700 mb-1">Qty</label>
                                        <input type="number" min="0" step="any" inputMode="decimal" value={batchAlloc.qty} onChange={function (e) { set({ qty: e.target.value }) }}
                                          className="w-full h-10 px-3 bg-white border border-slate-300 rounded-xl text-[13.5px] text-slate-900 tabular-nums focus:outline-none focus:ring-4 focus:ring-[#3B4668]/10 focus:border-[#A9B1CB]" />
                                      </div>
                                      <div className="flex gap-1.5">
                                        <button type="button" onClick={function () { setBatchAlloc(null); setBatchAllocErr('') }}
                                          className="h-10 px-3 rounded-xl text-[13px] font-semibold text-slate-600 hover:bg-white transition-colors">Cancel</button>
                                        <button type="button" disabled={batchAllocSaving} onClick={function () { saveBatchAlloc(stockItem, b, left) }}
                                          className="h-10 px-4 rounded-xl text-[13px] font-semibold text-white bg-[#3B4668] hover:bg-[#2F3854] disabled:opacity-50 transition-colors">
                                          {batchAllocSaving ? 'Saving…' : 'Save'}
                                        </button>
                                      </div>
                                    </div>
                                    {batchAllocErr && <p className="mt-1.5 text-[12px] font-medium text-red-600">{batchAllocErr}</p>}
                                  </div>
                                )
                              })()}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}

              {stockBatches.length > 0 && gap !== 0 && (
                <p className="flex items-start gap-2 text-[12.5px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                  <Icon name="info" size={14} className="shrink-0 mt-0.5 text-slate-400" />
                  {gap > 0
                    ? gap + ' ' + unitLbl + ' of the stock on hand is not in any batch — it was changed without Add new stock.'
                    : 'The batches add up to ' + (-gap) + ' ' + unitLbl + ' more than is on hand — stock was reduced since.'}
                </p>
              )}
            </div>
          )
        })()}
    </Modal>
  )
}

export default StockBreakdown
