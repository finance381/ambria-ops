import { supabase } from './supabase'
import { deptOrder } from './ui'

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
// one real function can appear as several rows sharing a contract_no. This
// picks the one row per distinct function that should represent it: the
// live (not cancelled) one, or among equally-(non-)cancelled rows the
// highest id, since ids increase with sync order here. (Mirrors
// EventLedger.jsx's _pickCanonical — kept as its own copy rather than a
// shared import since the two screens' balance math must each be verified
// against its own call site; change one, check the other still matches.)
function pickCanonicalByFuncKey(rows) {
  var byKey = {}
  rows.forEach(function (e) {
    var k = funcKeyOf(e)
    var cur = byKey[k]
    var eLive = !e.lms_cancelled_at
    var curLive = cur && !cur.lms_cancelled_at
    if (!cur || (eLive && !curLive) || (eLive === curLive && Number(e.id) > Number(cur.id))) byKey[k] = e
  })
  return byKey
}

// Agreed targets are restated identically on every resync duplicate of the
// same function, so they must be taken from one canonical row per distinct
// function — never summed across duplicates. Collected/spent are safe to
// sum across every id in the pool: each id's own ledger rows are disjoint,
// so the total is just whatever money actually exists, regardless of which
// duplicate it's attached to. Pending is then recomputed from those
// corrected totals. (Mirrors EventLedger.jsx's loadContractBalance.)
export async function computeContractBalance(pool, lmsRows) {
  var allIds = pool.map(function (e) { return e.id })
  if (allIds.length === 0) return { balance: null, balancesByEventId: {} }
  var { data, error } = await supabase.rpc('fn_event_group_balance', { p_event_ids: allIds.map(Number) })
  if (error || !data) return { balance: null, balancesByEventId: {} }
  var byId = {}
  data.forEach(function (row) { byId[row.event_id] = row })

  var canonicalByKey = pickCanonicalByFuncKey(pool)
  var agreedCash = 0, agreedBank = 0, tax = 0
  Object.keys(canonicalByKey).forEach(function (k) {
    var row = byId[canonicalByKey[k].id]
    if (row) {
      agreedCash += Number(row.agreed_cash_paise || 0)
      agreedBank += Number(row.agreed_bank_paise || 0)
      tax += Number(row.tax_amount_paise || 0)
    }
  })
  var collCash = 0, collBank = 0, spent = 0
  data.forEach(function (row) {
    collCash += Number(row.collected_cash_paise || 0)
    collBank += Number(row.collected_bank_paise || 0)
    spent += Number(row.spent_paise || 0)
  })
  // LMS-only collections (never touched Ambria Ops' own wallet) count toward
  // the real total too — otherwise "Collected" understates what the
  // contract has actually taken in, and "Pending" overstates what's owed.
  ;(lmsRows || []).forEach(function (r) {
    if (r.payment_mode === 'cash') collCash += Number(r.amount_paise || 0)
    else collBank += Number(r.amount_paise || 0)
  })
  // A guest who pays the agreed cash amount through bank instead isn't
  // actually short — the bank side just ran a surplus over what was agreed
  // there. That surplus pays down the cash shortfall first, and only
  // whatever's left over after that still reduces tax pending.
  var bankExcess = Math.max(0, collBank - agreedBank)
  var bankExcessHidden = Math.round(bankExcess / 10)
  var cashShortfall = agreedCash - collCash
  var leftoverForTax = Math.max(0, bankExcessHidden - Math.max(0, cashShortfall)) * 10
  return {
    balance: {
      agreed_cash_paise: agreedCash, agreed_bank_paise: agreedBank, tax_amount_paise: tax,
      collected_cash_paise: collCash, collected_bank_paise: collBank,
      pending_cash_paise: cashShortfall - bankExcessHidden,
      pending_bank_paise: Math.max(0, agreedBank - collBank),
      pending_tax_paise: Math.max(0, tax - leftoverForTax),
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
  var { data } = await supabase.from('events')
    .select(FUNC_PICKER_COLS)
    .eq('function_date', dateStr)
    .is('lms_cancelled_at', null)
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
