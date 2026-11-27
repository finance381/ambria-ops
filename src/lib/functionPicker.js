import { supabase } from './supabase'
import { deptOrder } from './ui'
import { isLmsRowCancelled } from './contractBalance'

// Shared by every "For a function?" cost/collection entry point (Expense,
// Decor Var Cost, GV, Wallet Collect) so a fix to the grouping or the
// contract-pooling logic only has to be made once.

export var FUNC_PICKER_COLS = 'id, event_name, function_date, venue_name, location, session, client_name, department, contract_no, created_user_name'

// One evening at one venue is booked as up to four contracts — one per
// department — and every one of them carries the same client, venue and
// session. This key folds those rows into one function so the picker lists
// the evening once, with departments riding along as chips, instead of
// repeating it once per department.
export function funcKeyOf(r) {
  return [r.client_name || '', r.venue_name || '', r.session || '', (r.event_name || '').trim().toLowerCase()].join('|')
}

export function groupFunctions(rows) {
  var byKey = {}
  var order = []
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]
    var k = funcKeyOf(r)
    if (!byKey[k]) {
      byKey[k] = {
        key: k,
        label: r.event_name + (r.client_name ? ' — ' + r.client_name : '') + ' · ' + (r.venue_name || '') + (r.session ? ' · ' + r.session : ''),
        contracts: [],
      }
      order.push(k)
    }
    byKey[k].contracts.push(r)
  }
  order.forEach(function (k) {
    byKey[k].contracts.sort(function (a, b) { return deptOrder(a.department) - deptOrder(b.department) })
  })
  return order.map(function (k) { return byKey[k] })
}

// A real LMS contract can run more than one function — Mehndi, Sangeet, the
// Wedding itself — on the same day or across several. Two function-groups
// belong to the same contract when any of their department rows share a
// (contract_no, department) pair: that pair is what's stable across a
// department's own functions under one booking. contract_no alone isn't
// enough to key on — LMS numbers each department's contracts in its own
// independent sequence, so it can collide across two unrelated bookings in
// different departments (same gotcha EventLedger.jsx's selectGroup works
// around). This is a plain union-find over the function groups.
export function buildContractBuckets(rows) {
  var funcGroups = groupFunctions(rows)
  var parent = funcGroups.map(function (_, i) { return i })
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }

  var seenPair = {}
  funcGroups.forEach(function (g, idx) {
    g.contracts.forEach(function (c) {
      if (!c.contract_no) return
      var pairKey = c.contract_no + '|' + c.department
      if (Object.prototype.hasOwnProperty.call(seenPair, pairKey)) union(idx, seenPair[pairKey])
      else seenPair[pairKey] = idx
    })
  })

  var buckets = {}
  funcGroups.forEach(function (g, idx) {
    var root = find(idx)
    if (!buckets[root]) buckets[root] = []
    buckets[root].push(g)
  })

  return Object.keys(buckets).map(function (root) {
    var funcs = buckets[root].slice().sort(function (a, b) {
      return new Date(a.contracts[0].function_date || 0) - new Date(b.contracts[0].function_date || 0)
    })
    var primary = funcs[0].contracts[0]
    return {
      isContract: funcs.length > 1,
      key: funcs.length > 1 ? 'contract:' + funcs.map(function (f) { return f.key }).join('~') : funcs[0].key,
      functions: funcs,
      clientName: primary.client_name,
      venueName: primary.venue_name,
      location: primary.location,
    }
  })
}

// Collecting a payment is scoped to one department's contract, not a whole
// evening — Decor and Catering carry separate agreed amounts and separate
// balances even when booked for the same function, so (unlike
// buildContractBuckets, built for a cost entry's department-agnostic
// traceability tag) rows here are never merged across departments. Each row
// is its own function; rows sharing a (contract_no, department) pair — the
// one real LMS contract run across more than one date — pool into one
// bucket.
export function buildDeptContractBuckets(rows) {
  var byPairKey = {}
  var order = []
  rows.forEach(function (r) {
    var k = r.contract_no ? (r.contract_no + '|' + r.department) : ('solo:' + r.id)
    if (!byPairKey[k]) { byPairKey[k] = []; order.push(k) }
    byPairKey[k].push(r)
  })
  return order.map(function (k) {
    var group = byPairKey[k].slice().sort(function (a, b) {
      return new Date(a.function_date || 0) - new Date(b.function_date || 0)
    })
    var primary = group[0]
    return {
      isContract: group.length > 1,
      key: 'dept:' + k,
      functions: group,
      clientName: primary.client_name,
      venueName: primary.venue_name,
      department: primary.department,
    }
  })
}

// An LMS resync mints a new event row for the same function rather than
// updating the old one in place, marking the old one lms_cancelled_at — so
// one real function can appear as several rows sharing a contract_no. pool
// is always scoped to one contract_no + department already (see this
// function's own callers), so this just picks the one row that should
// represent the whole contract: the live (not cancelled) one, or among
// equally-(non-)cancelled rows the highest id, since ids increase with sync
// order here. (Mirrors contractBalance.js's pickOneCanonical — kept as its
// own copy rather than a shared import since the two screens' balance math
// must each be verified against its own call site; change one, check the
// other still matches.)
function pickOneCanonical(rows) {
  var best = null
  rows.forEach(function (e) {
    var eLive = !e.lms_cancelled_at
    var bestLive = best && !best.lms_cancelled_at
    if (!best || (eLive && !bestLive) || (eLive === bestLive && Number(e.id) > Number(best.id))) best = e
  })
  return best
}

// Collected money doesn't arrive earmarked by channel -- a guest who was
// agreed to pay bank + tax but paid the whole thing in cash still settled
// the contract, even though cash/bank/tax are tracked as separate targets.
// Pools everything collected into one hidden-cash-scale total (bank
// converted down via /10, the same scale collCash/agreedCash already use)
// and allocates it against agreed cash, then bank, then tax, in that order
// -- confirmed live: a contract paid entirely in cash showed Agreed Bank and
// Agreed Tax both still fully pending while cash showed a huge, confusing
// over-collection, even though the whole deal was genuinely settled.
// Whatever's left after all three targets are satisfied is real
// over-collection beyond the whole deal, folded back into cash (negative =
// over-collected), the same convention pending_cash_paise already had.
// (Mirrors contractBalance.js's settleAcrossChannels -- kept as its own copy,
// same reason as pickOneCanonical above.)
function settleAcrossChannels(agreedCash, collCash, agreedBank, collBank, tax) {
  var pool = collCash + Math.round(collBank / 10)

  var cashApplied = Math.min(pool, Math.max(0, agreedCash))
  pool -= cashApplied
  var pendingCash = agreedCash - cashApplied

  var bankNeedHidden = Math.round(agreedBank / 10)
  var bankAppliedHidden = Math.min(pool, Math.max(0, bankNeedHidden))
  pool -= bankAppliedHidden
  var pendingBank = agreedBank - bankAppliedHidden * 10

  var taxNeedHidden = Math.round(tax / 10)
  var taxAppliedHidden = Math.min(pool, Math.max(0, taxNeedHidden))
  pool -= taxAppliedHidden
  var pendingTax = tax - taxAppliedHidden * 10

  pendingCash -= pool
  return { pending_cash_paise: pendingCash, pending_bank_paise: pendingBank, pending_tax_paise: pendingTax }
}

// agreed_cash_paise/agreed_bank_paise/tax_amount_paise are LMS's own
// contract-level fields, restated identically on every function-detail row
// of the same contract -- taken from exactly ONE row for the whole contract
// (see pickOneCanonical), never summed across its functions, which would
// multiply that contract-level figure by its function count. Collected/spent
// are safe to sum across every id in the pool: each id's own ledger rows are
// disjoint, so the total is just whatever money actually exists, regardless
// of which row it's attached to. Pending is then recomputed from those
// corrected totals. (Mirrors EventLedger.jsx's loadContractBalance.)
export async function computeContractBalance(pool, lmsRows) {
  var allIds = pool.map(function (e) { return e.id })
  if (allIds.length === 0) return { balance: null, balancesByEventId: {} }
  var { data, error } = await supabase.rpc('fn_event_group_balance', { p_event_ids: allIds.map(Number) })
  if (error || !data) return { balance: null, balancesByEventId: {} }
  var byId = {}
  data.forEach(function (row) { byId[row.event_id] = row })

  var canonical = pickOneCanonical(pool)
  var canonicalRow = canonical ? byId[canonical.id] : null
  var agreedCash = canonicalRow ? Number(canonicalRow.agreed_cash_paise || 0) : 0
  var agreedBank = canonicalRow ? Number(canonicalRow.agreed_bank_paise || 0) : 0
  var tax = canonicalRow ? Number(canonicalRow.tax_amount_paise || 0) : 0
  var collCash = 0, collBank = 0, spent = 0
  data.forEach(function (row) {
    collCash += Number(row.collected_cash_paise || 0)
    collBank += Number(row.collected_bank_paise || 0)
    spent += Number(row.spent_paise || 0)
  })
  // LMS-only collections (never touched Ambria Ops' own wallet) count toward
  // the real total too — otherwise "Collected" understates what the
  // contract has actually taken in, and "Pending" overstates what's owed.
  //
  // lmsRows here is the RAW lms-payment-collections response (pay_mode/
  // net_amount_paise), not the payment_mode/amount_paise shape EventLedger.jsx's
  // own fetchLmsPayments remaps to for its Transactions tab — this previously
  // read those wrong field names, so every row fell through to the `else`
  // (collBank) with amount_paise always undefined → 0: LMS collections were
  // silently never actually counted here at all, cancelled or not.
  ;(lmsRows || []).forEach(function (r) {
    if (isLmsRowCancelled(r)) return
    var isCash = String(r.pay_mode || '').toLowerCase().indexOf('cash') !== -1
    if (isCash) collCash += Number(r.net_amount_paise || 0)
    else collBank += Number(r.net_amount_paise || 0)
  })
  var pending = settleAcrossChannels(agreedCash, collCash, agreedBank, collBank, tax)
  return {
    balance: {
      agreed_cash_paise: agreedCash, agreed_bank_paise: agreedBank, tax_amount_paise: tax,
      collected_cash_paise: collCash, collected_bank_paise: collBank,
      pending_cash_paise: pending.pending_cash_paise,
      pending_bank_paise: pending.pending_bank_paise,
      pending_tax_paise: pending.pending_tax_paise,
      spent_paise: spent,
    },
    balancesByEventId: byId,
  }
}

// Loads every function booked on dateStr, plus every sibling function on
// OTHER dates that shares a contract with one of them — so picking either
// the 19th or the 20th of a two-day contract surfaces the same, whole
// contract, not just whichever date happened to be clicked.
export async function loadFunctionPickerPool(dateStr) {
  if (!dateStr) return { dateRows: [], allRows: [] }
  // department IS NULL normally means a stale orphan row (no contract_no, no
  // lms_event_id — never went through sync-events' normalizeVenue): blank
  // "VENUE"/"VENU" tiles with no real contract to post a cost/collection
  // against. The one legitimate department-null case is a genuine tentative
  // event (fn_create_tentative_event, 00040) — it has no department either
  // since there's no LMS contract yet — so those are let through via
  // is_tentative instead of lumped in with the junk. A tentative event that's
  // since been merged into a real one (merged_into_id set) is excluded too,
  // same as every other pick-list in the app already does for it.
  var { data } = await supabase.from('events')
    .select(FUNC_PICKER_COLS + ', is_tentative, merged_into_id')
    .eq('function_date', dateStr)
    .is('lms_cancelled_at', null)
    .is('merged_into_id', null)
    .or('department.not.is.null,is_tentative.eq.true')
    .order('event_name')
  var dateRows = data || []

  var pairs = {}
  dateRows.forEach(function (r) {
    if (r.contract_no) pairs[r.contract_no + '|' + r.department] = { contract_no: r.contract_no, department: r.department }
  })
  var pairList = Object.keys(pairs).map(function (k) { return pairs[k] })

  var siblingRows = []
  for (var i = 0; i < pairList.length; i++) {
    var p = pairList[i]
    var res = await supabase.from('events')
      .select(FUNC_PICKER_COLS)
      .eq('contract_no', p.contract_no)
      .eq('department', p.department)
      .is('merged_into_id', null)
      .is('lms_cancelled_at', null)
    siblingRows = siblingRows.concat(res.data || [])
  }

  var byId = {}
  dateRows.concat(siblingRows).forEach(function (r) { byId[r.id] = r })
  var allRows = Object.keys(byId).map(function (k) { return byId[k] })

  return { dateRows: dateRows, allRows: allRows }
}

// Same as loadFunctionPickerPool above, but for a whole date range instead of
// one day -- the Expense form's "Period" mode, where a single bill (e.g. a
// Dihari labour sheet) covers several days and needs every function booked
// across all of them, so each split-allocation row can pick which one it
// hits. Same sibling-expansion rule applies: a multi-day contract that only
// partially overlaps the picked range still resolves to its one whole
// contract, not a truncated slice of it.
export async function loadFunctionPickerPoolRange(fromStr, toStr) {
  if (!fromStr || !toStr) return { rangeRows: [], allRows: [] }
  var { data } = await supabase.from('events')
    .select(FUNC_PICKER_COLS + ', is_tentative, merged_into_id')
    .gte('function_date', fromStr)
    .lte('function_date', toStr)
    .is('lms_cancelled_at', null)
    .is('merged_into_id', null)
    .or('department.not.is.null,is_tentative.eq.true')
    .order('function_date').order('event_name')
  var rangeRows = data || []

  var pairs = {}
  rangeRows.forEach(function (r) {
    if (r.contract_no) pairs[r.contract_no + '|' + r.department] = { contract_no: r.contract_no, department: r.department }
  })
  var pairList = Object.keys(pairs).map(function (k) { return pairs[k] })

  var siblingRows = []
  for (var i = 0; i < pairList.length; i++) {
    var p = pairList[i]
    var res = await supabase.from('events')
      .select(FUNC_PICKER_COLS)
      .eq('contract_no', p.contract_no)
      .eq('department', p.department)
      .is('merged_into_id', null)
      .is('lms_cancelled_at', null)
    siblingRows = siblingRows.concat(res.data || [])
  }

  var byId = {}
  rangeRows.concat(siblingRows).forEach(function (r) { byId[r.id] = r })
  var allRows = Object.keys(byId).map(function (k) { return byId[k] })

  return { rangeRows: rangeRows, allRows: allRows }
}

// Every event row for a (contract_no, department) pair, for balance/history
// purposes — deliberately NOT filtering lms_cancelled_at, unlike the picker
// pool above. A resync mints a new event row for the same function and marks
// the old one cancelled, rather than updating it in place, but never
// re-points collections already logged against the old id, so a "cancelled"
// duplicate can still be the one real money is sitting on (mirrors
// EventLedger.jsx's own contract pool, which hit this exact gotcha first).
// Only ever call this for balance/history math once a function is already
// selected — the live-only picker pool above is still correct for what a
// user may pick as "the" function to log a new entry against.
export async function loadFullContractPool(contractNo, department) {
  if (!contractNo) return []
  var res = await supabase.from('events')
    .select(FUNC_PICKER_COLS)
    .eq('contract_no', contractNo)
    .eq('department', department)
    .is('merged_into_id', null)
  return res.data || []
}
