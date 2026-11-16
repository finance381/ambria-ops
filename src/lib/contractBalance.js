import { supabase } from './supabase'

// Same grouping key as EventLedger.jsx's own _groupKey/_pickCanonical — an
// LMS resync mints a new event row for the same function rather than
// updating the old one, marking the old one lms_cancelled_at, so one real
// function can appear as several rows sharing a contract_no.
function groupKey(f) {
  return (f.client_name || '') + '|' + (f.function_date || '') + '|' + (f.venue_name || '') + '|' + (f.session || '')
}

function pickCanonical(rows) {
  var byKey = {}
  rows.forEach(function (e) {
    var k = groupKey(e)
    var cur = byKey[k]
    var eLive = !e.lms_cancelled_at
    var curLive = cur && !cur.lms_cancelled_at
    if (!cur || (eLive && !curLive) || (eLive === curLive && Number(e.id) > Number(cur.id))) byKey[k] = e
  })
  return byKey
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
    var canonicalByKey = pickCanonical(pool)
    var agreedCash = 0, agreedBank = 0
    Object.keys(canonicalByKey).forEach(function (k) {
      var row = byId[canonicalByKey[k].id]
      if (row) { agreedCash += Number(row.agreed_cash_paise || 0); agreedBank += Number(row.agreed_bank_paise || 0) }
    })
    var collCash = 0, collBank = 0, spent = 0
    pool.forEach(function (e) {
      var row = byId[e.id]
      if (!row) return
      collCash += Number(row.collected_cash_paise || 0)
      collBank += Number(row.collected_bank_paise || 0)
      spent += Number(row.spent_paise || 0)
    })
    return { agreed_cash_paise: agreedCash, agreed_bank_paise: agreedBank, collected_cash_paise: collCash, collected_bank_paise: collBank, spent_paise: spent }
  })
}

// Pools every event sharing this contract's contract_no, sums Collected/Spent
// across all of them (each one's event_ledger rows are real, disjoint money —
// see EventLedger's loadContractBalance), takes Agreed targets from one
// canonical row per distinct function only (never summed across resync
// duplicates, which would multiply the target instead of just recovering
// money attached to a superseded id), and folds in LMS's own payment history
// for collections made outside Ambria Ops' wallet entirely.
//
// This is a standalone copy of the same math EventLedger.jsx's
// loadContractBalance/fetchLmsPayments already do internally — kept separate
// so a caller can get just the numbers without mounting that whole component.
// Change one, check the other.
export async function fetchContractBalanceSummary(eventId) {
  var primaryRes = await supabase.from('events').select(EVT_COLS).eq('id', Number(eventId)).maybeSingle()
  if (!primaryRes.data) return null
  var primary = primaryRes.data

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

  var { data, error } = await supabase.rpc('fn_event_group_balance', { p_event_ids: allIds.map(Number) })
  if (error || !data) return null
  var byId = {}
  data.forEach(function (row) { byId[row.event_id] = row })

  var canonicalByKey = pickCanonical(pool)
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

  if (primary.contract_no) {
    var lms = await fetchLmsCollected(primary.contract_no, primary.department)
    if (lms) { collCash += lms.cash; collBank += lms.bank }
  }

  // See EventLedger.jsx's loadContractBalance for why bank surplus pays down
  // cash shortfall before any of it reduces tax pending, and why bankExcess
  // must be converted to the hidden ÷10 cash scale first (agreedCash/collCash
  // are hidden-scale, collBank/agreedBank are true rupee values) -- same
  // math, kept in sync here.
  var bankExcess = Math.max(0, collBank - agreedBank)
  var bankExcessHidden = Math.round(bankExcess / 10)
  var cashShortfall = agreedCash - collCash
  var leftoverForTax = Math.max(0, bankExcessHidden - Math.max(0, cashShortfall)) * 10
  return {
    agreed_cash_paise: agreedCash, agreed_bank_paise: agreedBank, tax_amount_paise: tax,
    collected_cash_paise: collCash, collected_bank_paise: collBank,
    pending_cash_paise: cashShortfall - bankExcessHidden,
    pending_bank_paise: Math.max(0, agreedBank - collBank),
    pending_tax_paise: Math.max(0, tax - leftoverForTax),
    spent_paise: spent,
  }
}
