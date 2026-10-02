// Keeps an item's stock batches (stock_batches / stock_batch_allocations,
// migration 00059) in line with its stock on hand: the batches add up to the
// item's quantity, and their venue splits to its venue allocations.
//
// Quantity and allocations are changed in more places than the batches are
// written — the phone form, Purchase, merges, a quantity typed straight into
// the admin form — so this runs after the admin Edit save and again whenever
// the stock breakdown is opened, and only writes the batches that are off.
//
// How it settles a difference, keeping each batch's own split wherever it
// still fits:
//   - stock that went down comes off the oldest batches first;
//   - stock that went up without "Add new stock" becomes a batch at the
//     item's rate;
//   - at a venue that now holds less, the newest batches give it back first;
//   - a venue that holds more takes from batches with unallocated room,
//     oldest first.
// A changed batch is rewritten — deleted, then inserted again with the same
// date, rate and author — because the client may insert and delete batches
// but not update them.
//
// opts.rateOverrides ({ batchId: ratePaise }) sets those batches' rates in
// the same pass — a batch saved before rates were kept has none.
//
// Returns true when something was written. Never throws.

function r3(n) { return Math.round(n * 1000) / 1000 }
function placeKey(x) { return (x.venue_id || '') + '|' + (x.sub_venue_id || '') }

export async function reconcileStockBatches(supabase, opts) {
  try {
    var itemId = opts.itemId
    var src = opts.itemSource === 'catering_store' ? 'catering_store' : 'inventory'
    var finalQty = Number(opts.finalQty) || 0
    var res = await supabase.from('stock_batches')
      .select('id, qty, rate_paise, is_opening, added_by, created_at, stock_batch_allocations(venue_id, sub_venue_id, qty)')
      .eq('item_id', itemId).eq('item_source', src)
      .order('created_at', { ascending: true })
    if (res.error || !res.data) return false

    function allocSum(b) { return r3(b.allocs.reduce(function (sum, x) { return sum + x.qty }, 0)) }
    var batches = res.data.map(function (b) {
      var allocs = (b.stock_batch_allocations || []).filter(function (x) { return x.venue_id }).map(function (x) {
        return { venue_id: x.venue_id, sub_venue_id: x.sub_venue_id || null, qty: Number(x.qty) || 0 }
      })
      var q0 = Number(b.qty) || 0
      var overrides = opts.rateOverrides || {}
      var rate = Object.prototype.hasOwnProperty.call(overrides, b.id) ? overrides[b.id] : b.rate_paise
      return { id: b.id, qty: q0, rate_paise: rate, is_opening: b.is_opening, added_by: b.added_by, created_at: b.created_at, allocs: allocs, before: JSON.stringify([q0, allocs, b.rate_paise || null]) }
    })

    // 1. Quantity: oldest stock goes first; growth becomes a batch.
    var excess = r3(batches.reduce(function (sum, b) { return sum + b.qty }, 0) - finalQty)
    for (var i = 0; i < batches.length && excess > 0; i++) {
      var cut = r3(Math.min(batches[i].qty, excess))
      batches[i].qty = r3(batches[i].qty - cut)
      excess = r3(excess - cut)
    }
    if (excess < 0) {
      batches.push({ id: null, qty: -excess, rate_paise: opts.ratePaise || null, is_opening: batches.length === 0, added_by: opts.userId || null, created_at: null, allocs: [], before: null })
    }
    // A batch's split cannot hold more than the batch.
    batches.forEach(function (b) {
      var over = r3(allocSum(b) - b.qty)
      for (var j = b.allocs.length - 1; j >= 0 && over > 0; j--) {
        var off = r3(Math.min(b.allocs[j].qty, over))
        b.allocs[j].qty = r3(b.allocs[j].qty - off)
        over = r3(over - off)
      }
      b.allocs = b.allocs.filter(function (x) { return x.qty > 0 })
    })

    // 2. Venue splits: match the item's allocations.
    var target = {}
    ;(opts.finalAllocs || []).forEach(function (x) {
      if (x.venue_id && Number(x.qty) > 0) target[placeKey(x)] = r3((target[placeKey(x)] || 0) + Number(x.qty))
    })
    var have = {}
    batches.forEach(function (b) { b.allocs.forEach(function (x) { have[placeKey(x)] = r3((have[placeKey(x)] || 0) + x.qty) }) })
    Object.keys(have).forEach(function (k) {
      var less = r3(have[k] - (target[k] || 0))
      for (var bi = batches.length - 1; bi >= 0 && less > 0; bi--) {
        batches[bi].allocs.forEach(function (x) {
          if (less > 0 && placeKey(x) === k) { var off = r3(Math.min(x.qty, less)); x.qty = r3(x.qty - off); less = r3(less - off) }
        })
        batches[bi].allocs = batches[bi].allocs.filter(function (x) { return x.qty > 0 })
      }
    })
    Object.keys(target).forEach(function (k) {
      var more = r3(target[k] - (have[k] || 0))
      if (more <= 0) return
      var parts = k.split('|')
      var vId = Number(parts[0])
      var svId = parts[1] ? Number(parts[1]) : null
      for (var bj = 0; bj < batches.length && more > 0; bj++) {
        var bb = batches[bj]
        var room = r3(bb.qty - allocSum(bb))
        if (room <= 0) continue
        var put = r3(Math.min(room, more))
        var same = bb.allocs.find(function (x) { return placeKey(x) === k })
        if (same) same.qty = r3(same.qty + put)
        else bb.allocs.push({ venue_id: vId, sub_venue_id: svId, qty: put })
        more = r3(more - put)
      }
    })

    // 3. Write back only the batches that changed.
    var wrote = false
    for (var w = 0; w < batches.length; w++) {
      var bw = batches[w]
      if (bw.id && JSON.stringify([bw.qty, bw.allocs, bw.rate_paise || null]) === bw.before) continue
      wrote = true
      if (bw.id) await supabase.from('stock_batches').delete().eq('id', bw.id)
      if (bw.qty <= 0) continue
      var row = { item_id: itemId, item_source: src, qty: bw.qty, rate_paise: bw.rate_paise || null, is_opening: !!bw.is_opening, added_by: bw.added_by || null }
      if (bw.created_at) row.created_at = bw.created_at
      var ins = await supabase.from('stock_batches').insert(row).select('id').single()
      if (ins.error || !ins.data) continue
      if (bw.allocs.length > 0) {
        await supabase.from('stock_batch_allocations').insert(bw.allocs.map(function (x) {
          return { batch_id: ins.data.id, venue_id: x.venue_id, sub_venue_id: x.sub_venue_id, qty: x.qty }
        }))
      }
    }
    return wrote
  } catch (_) {
    return false
  }
}

// What the stock on hand is worth, priced batch by batch (oldest first):
// qty × each batch's own rate. If the item now holds less than its batches,
// the oldest stock is taken as gone first — the same rule reconcile uses;
// if it holds more, the extra is priced at fallbackRatePaise (the item's
// rate). Batches must be oldest first. Returns paise.
export function stockValuePaise(batches, qty, fallbackRatePaise) {
  var list = batches || []
  var excess = r3(list.reduce(function (sum, b) { return sum + (Number(b.qty) || 0) }, 0) - (Number(qty) || 0))
  var value = 0
  list.forEach(function (b) {
    var q = Number(b.qty) || 0
    if (excess > 0) { var cut = Math.min(q, excess); q = r3(q - cut); excess = r3(excess - cut) }
    value += q * (b.rate_paise || fallbackRatePaise || 0)
  })
  if (excess < 0) value += -excess * (fallbackRatePaise || 0)
  return Math.round(value)
}

// The unit rate of the stock at each venue / sub-venue, in paise: each
// batch's share there at that batch's rate, averaged by quantity. Keyed
// "venue_id|sub_venue_id".
export function placeRates(batches, fallbackRatePaise) {
  var acc = {}
  ;(batches || []).forEach(function (b) {
    ;(b.stock_batch_allocations || []).forEach(function (a) {
      var q = Number(a.qty) || 0
      if (!a.venue_id || q <= 0) return
      var k = placeKey(a)
      if (!acc[k]) acc[k] = { q: 0, v: 0 }
      acc[k].q += q
      acc[k].v += q * (b.rate_paise || fallbackRatePaise || 0)
    })
  })
  var out = {}
  Object.keys(acc).forEach(function (k) { if (acc[k].q > 0) out[k] = acc[k].v / acc[k].q })
  return out
}
