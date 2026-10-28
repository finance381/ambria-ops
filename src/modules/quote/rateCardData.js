import { supabase } from '../../lib/supabase'

// Phase 3 of the quote_config JSONB -> tables migration: RateCardEditor.jsx
// keeps every tab's existing UI and in-memory data shape (the exact
// {labels, q, t, f, ...} objects it already builds) — only where that data
// comes from and goes to changes, from a single quote_config blob to the
// quote_* tables calculate_quote_v2 actually reads. Each tab still calls
// onSave(key, value) exactly as before; loadRateCardConfig/saveRateCardKey
// are the only things that changed underneath it.
//
// A handful of scalars (the rental cascade-offset helpers) are editor-only —
// never read by calculate_quote_v2 — and stay in quote_config since there's
// no correctness reason to move them.
var EDITOR_ONLY_KEYS = [
  'rental_perfect_offset', 'rental_filler_offset',
  'rental_pushpanjali_manaktala_offset', 'rental_pushpanjali_exotica_offset',
  'rental_tier_pct',
]

function byOrder(a, b) { return (a.sort_order || 0) - (b.sort_order || 0) }
function pad2(n) { return n < 10 ? '0' + n : '' + n }

// ═══════════════════════════════════════════════════════
//  LOAD
// ═══════════════════════════════════════════════════════

export async function loadRateCardConfig() {
  var results = await Promise.all([
    supabase.from('quote_venues').select('*'),
    supabase.from('quote_date_categories').select('*').order('sort_order'),
    supabase.from('quote_slots').select('*').order('sort_order'),
    supabase.from('quote_decor_rate_cards').select('*').order('sort_order'),
    supabase.from('quote_decor_rate_cells').select('*'),
    supabase.from('quote_rental_rate_cells').select('*'),
    supabase.from('quote_dj_options').select('*').order('sort_order'),
    supabase.from('quote_dj_rate_cells').select('*'),
    supabase.from('quote_menu_items').select('*').order('sort_order'),
    supabase.from('quote_menu_item_also_available').select('*'),
    supabase.from('quote_menu_settings').select('*'),
    supabase.from('quote_ttd_discounts').select('*').order('sort_order'),
    supabase.from('quote_event_types').select('*').order('sort_order'),
    supabase.from('quote_inquiry_modes').select('*').order('sort_order'),
    supabase.from('quote_season_dates').select('*'),
    supabase.from('quote_config').select('key, value').in('key', EDITOR_ONLY_KEYS),
  ])
  var venuesRes = results[0], catRes = results[1], slotRes = results[2],
    decorCardRes = results[3], decorCellRes = results[4], rentalRes = results[5],
    djOptRes = results[6], djCellRes = results[7], menuItemRes = results[8],
    menuAvailRes = results[9], menuSettRes = results[10], ttdRes = results[11],
    etRes = results[12], imRes = results[13], seasonRes = results[14], editorOnlyRes = results[15]

  var dateCats = (catRes.data || []).slice().sort(byOrder)
  var slotRows = (slotRes.data || []).slice().sort(byOrder)
  var venueRows = venuesRes.data || []

  // ── venues ──
  var parentById = {}
  venueRows.filter(function (v) { return !v.parent_id }).forEach(function (v) {
    parentById[v.id] = { id: v.id, name: v.name, location: v.location, lms_venue_id: v.lms_venue_id || '', status: v.status, decor_mode: v.decor_mode, sub_venues: [] }
  })
  venueRows.filter(function (v) { return v.parent_id }).sort(byOrder).forEach(function (v) {
    if (parentById[v.parent_id]) parentById[v.parent_id].sub_venues.push({ id: v.id, parent_id: v.parent_id, name: v.name, status: v.status, decor_mode: v.decor_mode })
  })
  var venues = venueRows.filter(function (v) { return !v.parent_id }).sort(byOrder).map(function (v) { return parentById[v.id] })

  // ── categories / slots (position is the real id — see schema's comment) ──
  var categories = dateCats.map(function (c) { return { label: c.label, color: c.color } })
  var slots = slotRows.map(function (s) { return s.label })

  // ── decor (regular + lunch_override) ──
  var decorCards = decorCardRes.data || []
  var cellsByCard = {}
  ;(decorCellRes.data || []).forEach(function (c) {
    if (!cellsByCard[c.rate_card_id]) cellsByCard[c.rate_card_id] = {}
    cellsByCard[c.rate_card_id][c.date_category_id] = c
  })
  function buildDecorBucket(venueId, isOverride) {
    var cards = decorCards.filter(function (c) { return c.venue_id === venueId && c.is_lunch_override === isOverride }).sort(byOrder)
    if (cards.length === 0) return null
    var out = { labels: cards.map(function (c) { return c.tier_label }), nw_offset: cards[0].nw_offset || 0, q: [], t: [], f: [] }
    cards.forEach(function (c) {
      var qRow = [], tRow = [], fRow = []
      dateCats.forEach(function (dc) {
        var cell = (cellsByCard[c.id] || {})[dc.id]
        qRow.push(cell ? cell.quote_amt : 0); tRow.push(cell ? cell.target_amt : 0); fRow.push(cell ? cell.floor_amt : 0)
      })
      out.q.push(qRow); out.t.push(tRow); out.f.push(fRow)
    })
    return out
  }
  var decor = {}
  venueRows.forEach(function (v) {
    var regular = buildDecorBucket(v.id, false)
    var lunch = buildDecorBucket(v.id, true)
    if (!regular && !lunch) return
    var entry = regular || { labels: [], nw_offset: 0, q: [], t: [], f: [] }
    if (lunch) entry = Object.assign({}, entry, { lunch_override: lunch })
    decor[v.id] = entry
  })

  // ── rentals ──
  var rentals = {}
  ;(rentalRes.data || []).forEach(function (rc) {
    if (!rentals[rc.venue_id]) {
      rentals[rc.venue_id] = {
        q: dateCats.map(function () { return slotRows.map(function () { return 0 }) }),
        t: dateCats.map(function () { return slotRows.map(function () { return 0 }) }),
        f: dateCats.map(function () { return slotRows.map(function () { return 0 }) }),
      }
    }
    var catPos = dateCats.findIndex(function (dc) { return dc.id === rc.date_category_id })
    var slotPos = slotRows.findIndex(function (s) { return s.id === rc.slot_id })
    if (catPos === -1 || slotPos === -1) return
    rentals[rc.venue_id].q[catPos][slotPos] = rc.quote_amt
    rentals[rc.venue_id].t[catPos][slotPos] = rc.target_amt
    rentals[rc.venue_id].f[catPos][slotPos] = rc.floor_amt
  })

  // ── dj (keyed by parent venue id) ──
  var djCellsByOpt = {}
  ;(djCellRes.data || []).forEach(function (c) {
    if (!djCellsByOpt[c.dj_option_id]) djCellsByOpt[c.dj_option_id] = {}
    djCellsByOpt[c.dj_option_id][c.date_category_id] = c
  })
  var djByParent = {}
  ;(djOptRes.data || []).forEach(function (o) {
    if (!djByParent[o.parent_venue_id]) djByParent[o.parent_venue_id] = []
    djByParent[o.parent_venue_id].push(o)
  })
  var dj = {}
  Object.keys(djByParent).forEach(function (parentId) {
    var opts = djByParent[parentId].slice().sort(byOrder)
    var entry = { labels: opts.map(function (o) { return o.label }), q: [], t: [], f: [] }
    opts.forEach(function (o) {
      var qRow = [], tRow = [], fRow = []
      dateCats.forEach(function (dc) {
        var cell = (djCellsByOpt[o.id] || {})[dc.id]
        qRow.push(cell ? cell.quote_amt : 0); tRow.push(cell ? cell.target_amt : 0); fRow.push(cell ? cell.floor_amt : 0)
      })
      entry.q.push(qRow); entry.t.push(tRow); entry.f.push(fRow)
    })
    dj[parentId] = entry
  })

  // ── menu + menu_lms ──
  var menuItems = menuItemRes.data || []
  var menuAvail = menuAvailRes.data || []
  var menuSett = menuSettRes.data || []
  function buildMenu(variant) {
    var items = menuItems.filter(function (m) { return m.variant === variant }).sort(byOrder)
    var sett = menuSett.find(function (s) { return s.variant === variant })
    return {
      labels: items.map(function (m) { return m.label }),
      base_rate: items.map(function (m) { return m.base_rate }),
      flat_add: items.map(function (m) { return m.flat_add }),
      max_pax: items.map(function (m) { return m.max_pax }),
      is_sliding: items.map(function () { return false }),
      restro_only: items.map(function (m) { return m.restro_only }),
      also_available_on: items.map(function (m) {
        return menuAvail.filter(function (a) { return a.menu_item_id === m.id }).map(function (a) { return a.venue_id })
      }),
      nv_upgrade: sett ? sett.nv_upgrade : 0,
    }
  }
  var menu = buildMenu('quote_calc')
  var menuLms = buildMenu('lms_push')

  // ── ttd / ttd_restro ──
  var ttdRows = ttdRes.data || []
  function buildTtd(isRestro) {
    var rows = ttdRows.filter(function (t) { return t.is_restro === isRestro }).sort(byOrder)
    return { labels: rows.map(function (t) { return t.label }), discounts: rows.map(function (t) { return t.discount_pct }) }
  }
  var ttd = buildTtd(false)
  var ttdRestro = buildTtd(true)

  // ── event_types / inquiry_modes ──
  var eventTypes = (etRes.data || []).slice().sort(byOrder).map(function (e) { return { label: e.label, icon: e.icon, wedding: e.is_wedding, pinned: e.pinned } })
  var inquiryModes = (imRes.data || []).slice().sort(byOrder).map(function (m) { return m.label })

  // ── season_dates (position is the real date_category id) ──
  var seasonDates = {}
  ;(seasonRes.data || []).forEach(function (r) {
    var key = r.year ? (r.year + '-' + pad2(r.month) + '-' + pad2(r.day)) : (pad2(r.month) + '-' + pad2(r.day))
    seasonDates[key] = r.date_category_id
  })

  // ── editor-only scalars, still in quote_config ──
  var editorOnly = {}
  ;(editorOnlyRes.data || []).forEach(function (r) { editorOnly[r.key] = r.value })

  return Object.assign({
    venues: venues, categories: categories, slots: slots,
    decor: decor, rentals: rentals, dj: dj,
    menu: menu, menu_lms: menuLms,
    ttd: ttd, ttd_restro: ttdRestro,
    event_types: eventTypes, inquiry_modes: inquiryModes,
    season_dates: seasonDates,
    // Raw rows, kept only so saveRateCardKey can diff against current state
    // (e.g. how many categories exist today) without a second round trip.
    _dateCatRows: dateCats, _slotRows: slotRows,
  }, editorOnly)
}

// QuoteCalculator.jsx (the customer-facing form, not the admin editor)
// separately needs its venue picker, event-type/inquiry-mode dropdowns, and
// season-date classification kept in sync with whatever RateCardEditor
// saves — all four used to come from quote_config directly, the same rows
// RateCardEditor wrote to. Now that those live in quote_* tables instead,
// this is its equivalent read: lighter than loadRateCardConfig() above
// (no rate cells at all), since pricing itself only ever goes through
// calculate_quote_v2.
export async function loadQuoteFormData() {
  var results = await Promise.all([
    supabase.from('quote_venues').select('*'),
    supabase.from('quote_event_types').select('*').order('sort_order'),
    supabase.from('quote_inquiry_modes').select('*').order('sort_order'),
    supabase.from('quote_season_dates').select('*'),
  ])
  var venuesRes = results[0], etRes = results[1], imRes = results[2], seasonRes = results[3]
  var venueRows = venuesRes.data || []

  var parentById = {}
  venueRows.filter(function (v) { return !v.parent_id }).forEach(function (v) {
    parentById[v.id] = { id: v.id, name: v.name, location: v.location, lms_venue_id: v.lms_venue_id || '', status: v.status, decor_mode: v.decor_mode, sub_venues: [] }
  })
  venueRows.filter(function (v) { return v.parent_id }).sort(byOrder).forEach(function (v) {
    if (parentById[v.parent_id]) parentById[v.parent_id].sub_venues.push({ id: v.id, parent_id: v.parent_id, name: v.name, status: v.status, decor_mode: v.decor_mode })
  })
  var venues = venueRows.filter(function (v) { return !v.parent_id }).sort(byOrder).map(function (v) { return parentById[v.id] })

  var eventTypes = (etRes.data || []).slice().sort(byOrder).map(function (e) { return { label: e.label, icon: e.icon, wedding: e.is_wedding, pinned: e.pinned } })
  var inquiryModes = (imRes.data || []).slice().sort(byOrder).map(function (m) { return m.label })

  var seasonDates = {}
  ;(seasonRes.data || []).forEach(function (r) {
    var key = r.year ? (r.year + '-' + pad2(r.month) + '-' + pad2(r.day)) : (pad2(r.month) + '-' + pad2(r.day))
    seasonDates[key] = r.date_category_id
  })

  return { venues: venues, event_types: eventTypes, inquiry_modes: inquiryModes, season_dates: seasonDates }
}

// ═══════════════════════════════════════════════════════
//  SAVE — one function per key, dispatched from saveRateCardKey
// ═══════════════════════════════════════════════════════

async function syncDecorCards(venueId, isOverride, entry, dateCats) {
  var delRes = await supabase.from('quote_decor_rate_cards').delete().eq('venue_id', venueId).eq('is_lunch_override', isOverride)
  if (delRes.error) return { error: delRes.error }
  var labels = (entry && entry.labels) || []
  for (var i = 0; i < labels.length; i++) {
    var insRes = await supabase.from('quote_decor_rate_cards')
      .insert({ venue_id: venueId, tier_label: labels[i], is_lunch_override: isOverride, nw_offset: entry.nw_offset || 0, sort_order: i })
      .select('id').single()
    if (insRes.error) return { error: insRes.error }
    var cells = dateCats.map(function (dc, ci) {
      return { rate_card_id: insRes.data.id, date_category_id: dc.id, quote_amt: (entry.q[i] || [])[ci] || 0, target_amt: (entry.t[i] || [])[ci] || 0, floor_amt: (entry.f[i] || [])[ci] || 0 }
    })
    var cellRes = await supabase.from('quote_decor_rate_cells').insert(cells)
    if (cellRes.error) return { error: cellRes.error }
  }
  return { error: null }
}

async function saveDecor(mergedObj, snapshot) {
  var dateCats = snapshot._dateCatRows
  var venueIds = Object.keys(mergedObj)
  for (var i = 0; i < venueIds.length; i++) {
    var entry = mergedObj[venueIds[i]]
    var r1 = await syncDecorCards(venueIds[i], false, entry, dateCats)
    if (r1.error) return r1
    var r2 = await syncDecorCards(venueIds[i], true, entry.lunch_override, dateCats)
    if (r2.error) return r2
  }
  return { error: null }
}

async function saveRentals(fullObj, snapshot) {
  var dateCats = snapshot._dateCatRows, slotRows = snapshot._slotRows
  var venueIds = Object.keys(fullObj)
  for (var i = 0; i < venueIds.length; i++) {
    var vid = venueIds[i], vd = fullObj[vid]
    var delRes = await supabase.from('quote_rental_rate_cells').delete().eq('venue_id', vid)
    if (delRes.error) return { error: delRes.error }
    var rows = []
    dateCats.forEach(function (dc, ci) {
      slotRows.forEach(function (sl, si) {
        rows.push({ venue_id: vid, date_category_id: dc.id, slot_id: sl.id, quote_amt: (vd.q[ci] || [])[si] || 0, target_amt: (vd.t[ci] || [])[si] || 0, floor_amt: (vd.f[ci] || [])[si] || 0 })
      })
    })
    if (rows.length) {
      var insRes = await supabase.from('quote_rental_rate_cells').insert(rows)
      if (insRes.error) return { error: insRes.error }
    }
  }
  return { error: null }
}

async function saveDj(fullObj, snapshot) {
  var dateCats = snapshot._dateCatRows
  var parentIds = Object.keys(fullObj)
  for (var i = 0; i < parentIds.length; i++) {
    var pid = parentIds[i], entry = fullObj[pid]
    var delRes = await supabase.from('quote_dj_options').delete().eq('parent_venue_id', pid)
    if (delRes.error) return { error: delRes.error }
    var labels = entry.labels || []
    for (var j = 0; j < labels.length; j++) {
      var insRes = await supabase.from('quote_dj_options').insert({ parent_venue_id: pid, label: labels[j], sort_order: j }).select('id').single()
      if (insRes.error) return { error: insRes.error }
      var cells = dateCats.map(function (dc, ci) {
        return { dj_option_id: insRes.data.id, date_category_id: dc.id, quote_amt: (entry.q[j] || [])[ci] || 0, target_amt: (entry.t[j] || [])[ci] || 0, floor_amt: (entry.f[j] || [])[ci] || 0 }
      })
      var cellRes = await supabase.from('quote_dj_rate_cells').insert(cells)
      if (cellRes.error) return { error: cellRes.error }
    }
  }
  return { error: null }
}

async function saveTtd(isRestro, value) {
  var delRes = await supabase.from('quote_ttd_discounts').delete().eq('is_restro', isRestro)
  if (delRes.error) return { error: delRes.error }
  var rows = (value.labels || []).map(function (l, i) { return { is_restro: isRestro, label: l, discount_pct: value.discounts[i] || 0, sort_order: i } })
  if (rows.length) {
    var insRes = await supabase.from('quote_ttd_discounts').insert(rows)
    if (insRes.error) return { error: insRes.error }
  }
  return { error: null }
}

async function saveMenu(variant, value) {
  var existing = await supabase.from('quote_menu_items').select('id').eq('variant', variant)
  if (existing.error) return { error: existing.error }
  var existingIds = (existing.data || []).map(function (r) { return r.id })
  if (existingIds.length) {
    var delRes = await supabase.from('quote_menu_items').delete().in('id', existingIds)
    if (delRes.error) return { error: delRes.error }
  }
  var rows = (value.labels || []).map(function (l, i) {
    return { variant: variant, label: l, base_rate: value.base_rate[i] || 0, flat_add: value.flat_add[i] || 0, max_pax: value.max_pax[i] || 0, restro_only: !!value.restro_only[i], sort_order: i }
  })
  if (rows.length) {
    var insRes = await supabase.from('quote_menu_items').insert(rows).select('id')
    if (insRes.error) return { error: insRes.error }
    var availRows = []
    insRes.data.forEach(function (row, i) {
      ;(value.also_available_on[i] || []).forEach(function (vid) { availRows.push({ menu_item_id: row.id, venue_id: vid }) })
    })
    if (availRows.length) {
      var availRes = await supabase.from('quote_menu_item_also_available').insert(availRows)
      if (availRes.error) return { error: availRes.error }
    }
  }
  var settRes = await supabase.from('quote_menu_settings').upsert({ variant: variant, nv_upgrade: value.nv_upgrade || 0 }, { onConflict: 'variant' })
  if (settRes.error) return { error: settRes.error }
  return { error: null }
}

async function saveEventTypes(value) {
  var existing = await supabase.from('quote_event_types').select('id')
  if (existing.error) return { error: existing.error }
  if ((existing.data || []).length) {
    var delRes = await supabase.from('quote_event_types').delete().in('id', existing.data.map(function (r) { return r.id }))
    if (delRes.error) return { error: delRes.error }
  }
  var rows = value.map(function (t, i) { return { label: t.label, icon: t.icon || null, is_wedding: !!t.wedding, pinned: !!t.pinned, sort_order: i } })
  if (rows.length) {
    var insRes = await supabase.from('quote_event_types').insert(rows)
    if (insRes.error) return { error: insRes.error }
  }
  return { error: null }
}

async function saveInquiryModes(value) {
  var existing = await supabase.from('quote_inquiry_modes').select('id')
  if (existing.error) return { error: existing.error }
  if ((existing.data || []).length) {
    var delRes = await supabase.from('quote_inquiry_modes').delete().in('id', existing.data.map(function (r) { return r.id }))
    if (delRes.error) return { error: delRes.error }
  }
  var rows = value.map(function (m, i) { return { label: m, sort_order: i } })
  if (rows.length) {
    var insRes = await supabase.from('quote_inquiry_modes').insert(rows)
    if (insRes.error) return { error: insRes.error }
  }
  return { error: null }
}

async function saveSeasonDates(value, snapshot) {
  var dateCats = snapshot._dateCatRows
  var delRes = await supabase.from('quote_season_dates').delete().gt('id', 0)
  if (delRes.error) return { error: delRes.error }
  var rows = []
  Object.keys(value).forEach(function (key) {
    var catRow = dateCats[value[key]]
    if (!catRow) return
    var parts = key.split('-')
    var year = null, month, day
    if (parts.length === 3) { year = +parts[0]; month = +parts[1]; day = +parts[2] } else { month = +parts[0]; day = +parts[1] }
    rows.push({ year: year, month: month, day: day, date_category_id: catRow.id })
  })
  for (var i = 0; i < rows.length; i += 500) {
    var chunk = rows.slice(i, i + 500)
    var insRes = await supabase.from('quote_season_dates').insert(chunk)
    if (insRes.error) return { error: insRes.error }
  }
  return { error: null }
}

// Categories/slots/venues are referenced by POSITION everywhere else
// (date_category_id/slot_id are literally the array index — see the Phase 1
// schema's comment), so unlike every table above, these can't just be
// wiped and reinserted: that would renumber every surviving row's id too,
// silently repointing whatever other tables reference it — the exact
// "deleting shifts indexes" landmine the app's own confirm dialogs already
// warn about. Existing positions are updated in place instead; only
// positions beyond the new length are removed, and only once nothing
// still references them (the DB now enforces this with a real foreign key,
// where the old jsonb just silently let it happen).
async function saveCategories(value, snapshot) {
  var existingCount = (snapshot._dateCatRows || []).length
  var rows = value.map(function (c, i) { return { id: i, label: c.label, color: c.color || null, sort_order: i } })
  var upRes = await supabase.from('quote_date_categories').upsert(rows, { onConflict: 'id' })
  if (upRes.error) return { error: upRes.error }
  if (value.length < existingCount) {
    var removeIds = []
    for (var i = value.length; i < existingCount; i++) removeIds.push(i)
    var delRes = await supabase.from('quote_date_categories').delete().in('id', removeIds)
    if (delRes.error) return { error: new Error('Could not remove — rate cells or season dates still reference ' + (removeIds.length > 1 ? 'these categories' : 'this category') + '. Clear those first.') }
  }
  return { error: null }
}

async function saveSlots(value, snapshot) {
  var existingCount = (snapshot._slotRows || []).length
  var rows = value.map(function (s, i) { return { id: i, label: s, is_lunch: (s || '').toLowerCase() === 'lunch', sort_order: i } })
  var upRes = await supabase.from('quote_slots').upsert(rows, { onConflict: 'id' })
  if (upRes.error) return { error: upRes.error }
  if (value.length < existingCount) {
    var removeIds = []
    for (var i = value.length; i < existingCount; i++) removeIds.push(i)
    var delRes = await supabase.from('quote_slots').delete().in('id', removeIds)
    if (delRes.error) return { error: new Error('Could not remove slot(s) — rental rates still reference ' + (removeIds.length > 1 ? 'them' : 'it') + '. Clear those first.') }
  }
  return { error: null }
}

async function saveVenues(value) {
  var parentRows = [], subRows = []
  value.forEach(function (p, pIdx) {
    parentRows.push({ id: p.id, parent_id: null, name: p.name, location: p.location || null, lms_venue_id: p.lms_venue_id || null, status: p.status || 'live', decor_mode: p.decor_mode || null, sort_order: pIdx })
    ;(p.sub_venues || []).forEach(function (s, sIdx) {
      // Subs don't carry their own location in the UI — they've always
      // inherited the parent's, same as calculate_quote already reads it.
      subRows.push({ id: s.id, parent_id: p.id, name: s.name, location: p.location || null, lms_venue_id: null, status: s.status || 'live', decor_mode: s.decor_mode || null, sort_order: sIdx })
    })
  })
  var newIds = parentRows.concat(subRows).map(function (v) { return v.id })
  var existing = await supabase.from('quote_venues').select('id')
  if (existing.error) return { error: existing.error }
  var removedIds = (existing.data || []).map(function (r) { return r.id }).filter(function (id) { return newIds.indexOf(id) === -1 })

  var pRes = await supabase.from('quote_venues').upsert(parentRows, { onConflict: 'id' })
  if (pRes.error) return { error: pRes.error }
  var sRes = await supabase.from('quote_venues').upsert(subRows, { onConflict: 'id' })
  if (sRes.error) return { error: sRes.error }

  if (removedIds.length > 0) {
    var delRes = await supabase.from('quote_venues').delete().in('id', removedIds)
    if (delRes.error) return { error: new Error('Could not remove venue(s) — they still have rate data (decor/rentals/DJ/menu availability). Clear that first.') }
  }
  return { error: null }
}

async function saveEditorOnlyScalar(key, value) {
  var res = await supabase.from('quote_config').upsert({ key: key, value: value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return { error: res.error }
}

// snapshot: the config object loadRateCardConfig() returned, so saves that
// need to diff against current state (categories/slots length, which
// date-category/slot rows exist) don't need a second round trip.
export async function saveRateCardKey(key, value, snapshot) {
  if (EDITOR_ONLY_KEYS.indexOf(key) !== -1) return saveEditorOnlyScalar(key, value)
  switch (key) {
    case 'venues': return saveVenues(value)
    case 'categories': return saveCategories(value, snapshot)
    case 'slots': return saveSlots(value, snapshot)
    case 'decor': return saveDecor(value, snapshot)
    case 'rentals': return saveRentals(value, snapshot)
    case 'dj': return saveDj(value, snapshot)
    case 'ttd': return saveTtd(false, value)
    case 'ttd_restro': return saveTtd(true, value)
    case 'menu': return saveMenu('quote_calc', value)
    case 'menu_lms': return saveMenu('lms_push', value)
    case 'event_types': return saveEventTypes(value)
    case 'inquiry_modes': return saveInquiryModes(value)
    case 'season_dates': return saveSeasonDates(value, snapshot)
    default: return { error: new Error('Unknown rate card key: ' + key) }
  }
}
