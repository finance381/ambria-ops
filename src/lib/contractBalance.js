import { supabase } from './supabase'

// An LMS resync mints a new event row for the same function rather than
// updating the old one, marking the old one lms_cancelled_at, so one real
// function can appear as several rows sharing a contract_no. Every pool this
// is called on (loadContractPool / fetchContractBalancesBatch) is already
// scoped to one contract_no + department, so no grouping key is needed here
// -- just the live-over-cancelled, highest-id-among-equals tie-break.
//
// agreed_cash_paise/agreed_bank_paise/tax_amount_paise (LMS's own header-
// level fields -- h + "cash_part"/"cheque"/"tax_amt" in sync-events) are
// restated IDENTICALLY on every function-detail row of the same contract,
// not split per function -- confirmed live: a 3-function Decor contract
// (#00144) carried the same 30,000/2,00,000 on all 3 of its rows. An earlier
// version of this picked one row per distinct FUNCTION and summed those,
// which multiplied that contract-level figure by its function count. This
// picks exactly ONE row for the whole pool instead.
function pickOneCanonical(rows) {
  var best = null
  rows.forEach(function (e) {
    var eLive = !e.lms_cancelled_at
    var bestLive = best && !best.lms_cancelled_at
    if (!best || (eLive && !bestLive) || (eLive === bestLive && Number(e.id) > Number(best.id))) best = e
  })
  return best
}

var EVT_COLS = 'id, event_name, function_date, venue_name, location, client_name, session, department, contract_no, lms_cancelled_at'

// What LMS itself has collected on one contract (payments made outside
// Ambria Ops' wallet). Cash comes back on the hidden ÷10 scale already (the
// edge function converts it), bank in full. null when LMS can't be reached.
export async function fetchLmsCollected(contractNo, department) {
  if (!contractNo) return null
  try {
    var sessionRes = await supabase.auth.getSession()
    var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
    var lmsRes = await supabase.functions.invoke('lms-payment-collections', {
      body: { contract_no: contractNo, department: department || '' },
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    })
    if (lmsRes.error) return null
    var cash = 0, bank = 0
    ;((lmsRes.data && lmsRes.data.data) || []).forEach(function (r) {
      var isCash = String(r.pay_mode || '').toLowerCase().indexOf('cash') !== -1
      if (isCash) cash += Number(r.net_amount_paise || 0)
      else bank += Number(r.net_amount_paise || 0)
    })
    return { cash: cash, bank: bank }
  } catch { return null /* LMS unreachable — still show what Ambria Ops itself knows */ }
}

// Many contracts at once, Ambria Ops' own money only (no LMS -- add that
// with fetchLmsCollected, so a screen can show these figures first instead
// of waiting on LMS). Same pooling and canonical-row rules as
// fetchContractBalanceSummary below, but two round trips for the whole list
// instead of three per contract. contracts: [{ id, contract_no, department }].
// Returns one entry per contract, in order (null if it couldn't be read).
export async function fetchContractBalancesBatch(contracts) {
  var nos = []
  contracts.forEach(function (c) { if (c.contract_no && nos.indexOf(c.contract_no) === -1) nos.push(c.contract_no) })
  var res = await Promise.all([
    supabase.from('events').select(EVT_COLS).in('id', contracts.map(function (c) { return Number(c.id) })),
    nos.length ? supabase.from('events').select(EVT_COLS).in('contract_no', nos).is('merged_into_id', null) : Promise.resolve({ data: [] }),
  ])
  if (res[0].error || res[1].error) return contracts.map(function () { return null })
  var primaryById = {}
  ;(res[0].data || []).forEach(function (e) { primaryById[e.id] = e })

  var pools = contracts.map(function (c) {
    var primary = primaryById[c.id]
    if (!primary) return null
    var pool = [primary]
    if (primary.contract_no && primary.department) {
      var same = (res[1].data || []).filter(function (e) { return e.contract_no === primary.contract_no && e.department === primary.department })
      if (same.length > 0) pool = same
    }
    return pool
  })

  var allIds = []
  pools.forEach(function (p) { (p || []).forEach(function (e) { if (allIds.indexOf(Number(e.id)) === -1) allIds.push(Number(e.id)) }) })
  if (allIds.length === 0) return contracts.map(function () { return null })
  var rpc = await supabase.rpc('fn_event_group_balance', { p_event_ids: allIds })
  if (rpc.error || !rpc.data) return contracts.map(function () { return null })
  var byId = {}
  rpc.data.forEach(function (row) { byId[row.event_id] = row })

  return pools.map(function (pool) {
    if (!pool) return null
    var canonical = pickOneCanonical(pool)
    var canonicalRow = canonical ? byId[canonical.id] : null
    var agreedCash = canonicalRow ? Number(canonicalRow.agreed_cash_paise || 0) : 0
    var agreedBank = canonicalRow ? Number(canonicalRow.agreed_bank_paise || 0) : 0
    var tax = canonicalRow ? Number(canonicalRow.tax_amount_paise || 0) : 0
    var collCash = 0, collBank = 0, spent = 0
    pool.forEach(function (e) {
      var row = byId[e.id]
      if (!row) return
      collCash += Number(row.collected_cash_paise || 0)
      collBank += Number(row.collected_bank_paise || 0)
      spent += Number(row.spent_paise || 0)
    })
    // Same netting as reconcileOneContract below (no LMS-only payments here
    // though -- this batch path is Ambria Ops' own money only, see this
    // function's own opening comment). Kept as its own copy rather than a
    // shared helper -- same call as the other three copies of this formula.
    var bankExcess = Math.max(0, collBank - agreedBank)
    var bankExcessHidden = Math.round(bankExcess / 10)
    var cashShortfall = agreedCash - collCash
    var cashAppliedFromBank = Math.min(bankExcessHidden, Math.max(0, cashShortfall))
    var leftoverForTax = (bankExcessHidden - cashAppliedFromBank) * 10
    return {
      agreed_cash_paise: agreedCash, agreed_bank_paise: agreedBank, tax_amount_paise: tax,
      collected_cash_paise: collCash, collected_bank_paise: collBank,
      pending_cash_paise: cashShortfall - cashAppliedFromBank,
      pending_bank_paise: Math.max(0, agreedBank - collBank),
      pending_tax_paise: Math.max(0, tax - leftoverForTax),
      spent_paise: spent,
    }
  })
}

// The pool for one contract (every event row sharing its contract_no +
// department, resync duplicates included) plus the raw per-id balance rows
// and LMS's own payment history for it -- everything fetchOneContractBalance
// needs, split out so fetchConsolidatedContractBalance can fetch several of
// these in parallel instead of one at a time.
async function loadContractPool(primary) {
  var pool = [primary]
  if (primary.contract_no) {
    // department IS part of the key: LMS numbers each department's contracts
    // in its own independent sequence, so contract_no alone can collide
    // across two unrelated real contracts in different departments.
    var sameContract = await supabase.from('events').select(EVT_COLS)
      .eq('contract_no', primary.contract_no)
      .eq('department', primary.department)
      .is('merged_into_id', null)
    if (sameContract.data && sameContract.data.length > 0) pool = sameContract.data
  }
  var allIds = pool.map(function (e) { return e.id })
  var balRes = await supabase.rpc('fn_event_group_balance', { p_event_ids: allIds.map(Number) })
  var lms = primary.contract_no ? await fetchLmsCollected(primary.contract_no, primary.department) : null
  return { pool: pool, balanceRows: (balRes.data || []), balanceError: balRes.error, lms: lms }
}

// One contract's reconciled balance, given its already-loaded pool + balance
// rows + LMS payments (see loadContractPool). Agreed targets come from
// exactly ONE row for the whole contract (see pickOneCanonical -- LMS
// restates the same contract-level figure on every function row, so summing
// one per function would multiply it); Collected/Spent sum across every row
// in the pool, since each one's event_ledger rows are real, disjoint money.
function reconcileOneContract(loaded) {
  if (loaded.balanceError || loaded.balanceRows.length === 0) return null
  var byId = {}
  loaded.balanceRows.forEach(function (row) { byId[row.event_id] = row })

  var canonical = pickOneCanonical(loaded.pool)
  var canonicalRow = canonical ? byId[canonical.id] : null
  var agreedCash = canonicalRow ? Number(canonicalRow.agreed_cash_paise || 0) : 0
  var agreedBank = canonicalRow ? Number(canonicalRow.agreed_bank_paise || 0) : 0
  var tax = canonicalRow ? Number(canonicalRow.tax_amount_paise || 0) : 0
  var collCash = 0, collBank = 0, spent = 0
  loaded.balanceRows.forEach(function (row) {
    collCash += Number(row.collected_cash_paise || 0)
    collBank += Number(row.collected_bank_paise || 0)
    spent += Number(row.spent_paise || 0)
  })
  if (loaded.lms) { collCash += loaded.lms.cash; collBank += loaded.lms.bank }

  // See EventLedger.jsx's loadContractBalance for why bank surplus pays down
  // cash shortfall before any of it reduces tax pending, and why bankExcess
  // must be converted to the hidden ÷10 cash scale first (agreedCash/collCash
  // are hidden-scale, collBank/agreedBank are true rupee values) -- same
  // math, kept in sync here.
  var bankExcess = Math.max(0, collBank - agreedBank)
  var bankExcessHidden = Math.round(bankExcess / 10)
  var cashShortfall = agreedCash - collCash
  // Bank excess only pays down a REAL, positive cash shortfall -- capped
  // here so excess beyond that shortfall can't also drag pending_cash
  // negative (a false "cash over-collected") on top of correctly reducing
  // tax below. Without this cap the same rupee of surplus got counted
  // against both buckets at once -- confirmed live: agreed cash fully met,
  // bank over-collected by exactly the agreed tax, and pending_cash showed
  // -11,500 instead of 0 even though cash was never over-collected.
  var cashAppliedFromBank = Math.min(bankExcessHidden, Math.max(0, cashShortfall))
  var leftoverForTax = (bankExcessHidden - cashAppliedFromBank) * 10
  return {
    agreed_cash_paise: agreedCash, agreed_bank_paise: agreedBank, tax_amount_paise: tax,
    collected_cash_paise: collCash, collected_bank_paise: collBank,
    pending_cash_paise: cashShortfall - cashAppliedFromBank,
    pending_bank_paise: Math.max(0, agreedBank - collBank),
    pending_tax_paise: Math.max(0, tax - leftoverForTax),
    spent_paise: spent,
  }
}

var PENDING_KEYS = ['pending_cash_paise', 'pending_bank_paise', 'pending_tax_paise']

function sumBalances(list) {
  var keys = ['agreed_cash_paise', 'agreed_bank_paise', 'tax_amount_paise', 'collected_cash_paise',
    'collected_bank_paise', 'pending_cash_paise', 'pending_bank_paise', 'pending_tax_paise', 'spent_paise']
  var out = {}
  keys.forEach(function (k) { out[k] = 0 })
  list.forEach(function (b) {
    if (!b) return
    keys.forEach(function (k) {
      // Each contract's own pending figure can go negative (over-collected,
      // see reconcileOneContract) -- real and worth showing for that one
      // contract on its own, but summed across contracts it would let one
      // department's over-collection cancel out another's shortfall, e.g. a
      // Decor contract paid ahead erasing a Venue contract's real due. Each
      // department owes LMS its own balance; clamped at zero here so the
      // combined Pending can only ever be "what's still owed, across all of
      // them", never a net that hides one of them being short.
      var v = Number(b[k] || 0)
      out[k] += PENDING_KEYS.indexOf(k) !== -1 ? Math.max(0, v) : v
    })
  })
  return out
}

// Pools every event sharing this contract's contract_no, sums Collected/Spent
// across all of them (each one's event_ledger rows are real, disjoint money —
// see EventLedger's loadContractBalance), takes Agreed targets from exactly
// one row for the whole contract (see pickOneCanonical), and folds in LMS's
// own payment history for collections made outside Ambria Ops' wallet
// entirely.
//
// This is a standalone copy of the same math EventLedger.jsx's
// loadContractBalance/fetchLmsPayments already do internally — kept separate
// so a caller can get just the numbers without mounting that whole component.
// Change one, check the other.
export async function fetchContractBalanceSummary(eventId) {
  var primaryRes = await supabase.from('events').select(EVT_COLS).eq('id', Number(eventId)).maybeSingle()
  if (!primaryRes.data) return null
  var loaded = await loadContractPool(primaryRes.data)
  return reconcileOneContract(loaded)
}

// The consolidated-card version: several contracts behind one guest+function
// (Venue + Decor + Entertainment, each its own contract_no/department) pooled
// into one combined balance, plus a per-contract breakdown so the combined
// figure never hides where it came from. primaries: the anchor `events` row
// for each contract (any row in that contract's own pool works — it's
// re-pooled here the same way fetchContractBalanceSummary does for one).
// Returns { total, byContract: [{ department, contract_no, balance }] }, or
// null if none of the contracts had a readable balance.
export async function fetchConsolidatedContractBalance(primaries) {
  var loadedList = await Promise.all((primaries || []).filter(Boolean).map(loadContractPool))
  var reconciled = loadedList.map(reconcileOneContract)
  var byContract = primaries.map(function (p, i) {
    return { department: p.department, contract_no: p.contract_no, balance: reconciled[i] }
  }).filter(function (c) { return c.balance })
  if (byContract.length === 0) return null
  return { total: sumBalances(reconciled), byContract: byContract }
}
