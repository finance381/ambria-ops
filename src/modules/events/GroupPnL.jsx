import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPaise } from '../../lib/format'
import Icon from '../../components/ui/Icon'
import { fetchContractBalancesBatch, fetchLmsCollected } from '../../lib/contractBalance'

// Combined P&L for every function in a client group (the popup on the Events
// list). Money is the same reconciled per-contract balance the Contracts
// screen shows (every resync duplicate pooled, LMS's own payments added),
// summed across the group's distinct contracts -- per contract, never per
// function, since functions of one contract share its money.
//
// Loading is in two steps so the popup isn't blank while LMS answers:
// Ambria Ops' own figures (one batched query + one RPC) show first, LMS's
// payments are added when they arrive. The LMS calls start at the same time,
// not after. A group's last result is kept for the session, so opening the
// popup again shows it at once and refreshes quietly behind it.
//
// Cash is stored one zero less than the real amount; bank and expense are
// full. By default collected cash is used as stored and bank and expense in
// full -- totals and profit are worked out that way. "Show real amount"
// turns package cash and collected cash into the real figure (x 10).
//
// Profit = collected - expense.

var PKG_COLS = 'id, venue_name, location, catering, total_plates, complementary_plates, extra_plates_charge, menu_rate_paise, venue_rental_paise, decor_amount_paise, entertainment_amount_paise'

var pnlCache = {}

function n(v) { return Number(v || 0) }

function contractKey(f) {
  return f.contract_no ? (f.department || '') + '|' + f.contract_no : 'id|' + f.id
}

// whole rupees without the ".00" -- keeps the figures short
function rs(p) { return formatPaise(p).replace(/\.00$/, '') }
function amt(v) { return v != null && n(v) > 0 ? rs(v) : null }

// grids use inline styles on purpose: the dev server was not generating
// arbitrary/container grid classes for this file

function GroupPnL({ functions }) {
  var idsKey = functions.map(function (f) { return f.id }).join(',')
  var cached = pnlCache[idsKey]

  var [contracts, setContracts] = useState(cached ? cached.contracts : [])
  var [rows, setRows] = useState(cached ? cached.rows : [])
  var [loading, setLoading] = useState(!cached)
  var [lmsPending, setLmsPending] = useState(false)
  var [realCash, setRealCash] = useState(false)
  // closed by default; nothing is fetched until it is first opened
  var [open, setOpen] = useState(false)
  var [closedCards, setClosedCards] = useState({}) // per function / add-on card

  useEffect(function () {
    if (!open) return
    var cancelled = false
    var fromCache = pnlCache[idsKey]
    if (fromCache) {
      setContracts(fromCache.contracts); setRows(fromCache.rows); setLoading(false); setLmsPending(false)
    } else {
      setContracts([]); setRows([]); setLoading(true); setLmsPending(false)
    }

    // one function per distinct contract
    var byContract = {}
    functions.forEach(function (f) { if (!byContract[contractKey(f)]) byContract[contractKey(f)] = f })
    var list = Object.keys(byContract).map(function (k) { return byContract[k] })

    var lmsP = Promise.all(list.map(function (f) {
      return f.contract_no ? fetchLmsCollected(f.contract_no, f.department) : Promise.resolve(null)
    }))
    var appP = Promise.all([
      fetchContractBalancesBatch(list).catch(function () { return list.map(function () { return null }) }),
      supabase.from('events_safe').select(PKG_COLS).in('id', functions.map(function (f) { return Number(f.id) })),
    ])

    appP.then(function (res) {
      if (cancelled) return
      var base = list.map(function (f, i) { return { key: contractKey(f), fn: f, app: res[0][i], lms: null } })
      // keep the group's own order
      var pkgById = {}
      ;((res[1] && res[1].data) || []).forEach(function (r) { pkgById[r.id] = r })
      var ordered = functions.map(function (f) { return pkgById[f.id] ? Object.assign({}, pkgById[f.id], { event_name: f.event_name, department: f.department, contract_no: f.contract_no, ckey: contractKey(f) }) : null })
        .filter(Boolean)

      // first paint without LMS -- only when there's nothing cached to show
      if (!fromCache) { setContracts(base); setRows(ordered); setLoading(false); setLmsPending(true) }

      return lmsP.then(function (lms) {
        if (cancelled) return
        var full = base.map(function (c, i) { return Object.assign({}, c, { lms: lms[i] }) })
        pnlCache[idsKey] = { contracts: full, rows: ordered }
        setContracts(full); setRows(ordered); setLoading(false); setLmsPending(false)
      })
    })
    return function () { cancelled = true }
  }, [idsKey, open]) // eslint-disable-line react-hooks/exhaustive-deps

  var sums = { agreedCash: 0, agreedBank: 0, collCash: 0, collBank: 0, spent: 0 }
  var failed = 0, lmsFailed = 0, loaded = 0
  var addons = []
  var moneyByKey = {} // each contract's own package / collected / expense
  contracts.forEach(function (c) {
    if (!c.app) { failed++; return }
    loaded++
    var a = c.app
    var lc = c.lms ? c.lms.cash : 0
    var lb = c.lms ? c.lms.bank : 0
    if (!lmsPending && c.fn.contract_no && !c.lms) lmsFailed++
    sums.agreedCash += n(a.agreed_cash_paise)
    sums.agreedBank += n(a.agreed_bank_paise)
    sums.collCash += n(a.collected_cash_paise) + lc
    sums.collBank += n(a.collected_bank_paise) + lb
    sums.spent += n(a.spent_paise)
    var own = { key: c.key, department: c.fn.department, event_name: c.fn.event_name, contract_no: c.fn.contract_no,
      agreedCash: n(a.agreed_cash_paise), agreedBank: n(a.agreed_bank_paise),
      collCash: n(a.collected_cash_paise) + lc, collBank: n(a.collected_bank_paise) + lb, spent: n(a.spent_paise) }
    moneyByKey[c.key] = own
    // add-ons are their own Decor / Entertainment contracts in LMS --
    // anything that isn't the Venue contract
    if (c.fn.department && !/venue/i.test(c.fn.department)) addons.push(own)
  })
  var money = loaded > 0 ? sums : null

  // LMS's own package split -- Venue contracts only (other departments carry
  // none of these)
  var pkgRows = rows.filter(function (r) {
    return r.venue_rental_paise != null || r.menu_rate_paise != null || r.decor_amount_paise != null || r.entertainment_amount_paise != null
  })

  var shownKeys = {}
  var cashMul = realCash ? 10 : 1
  var profit = !money ? 0 : money.collCash * cashMul + money.collBank - money.spent
  var good = profit >= 0

  function toggleCard(key) {
    setClosedCards(function (prev) { var next = Object.assign({}, prev); next[key] = !prev[key]; return next })
  }

  function split(cash, bank) {
    return (
      <div className="mt-1.5 space-y-0.5 text-[11.5px] tabular-nums">
        <div className="flex justify-between gap-2"><span className="text-slate-400">Cash</span><span className="text-slate-600">{rs(cash)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-slate-400">Bank</span><span className="text-slate-600">{rs(bank)}</span></div>
      </div>
    )
  }

  // one figure in the summary strip
  function stat(label, value, extra, valueClass, dim) {
    return (
      <div className="bg-white px-4 py-3.5 min-w-0">
        <p className="text-[11.5px] font-medium text-slate-500">{label}</p>
        <p className={'mt-0.5 text-[18px] leading-tight font-semibold tabular-nums truncate ' + (valueClass || 'text-slate-900') + (dim ? ' opacity-50' : '')}>{value}</p>
        {extra}
      </div>
    )
  }

  // label / figure pairs split by thin dividers; wraps on narrow screens
  // (the -1px margin + overflow hides the divider at each row start)
  // label / figure pairs in an even grid with plenty of air between them
  function fieldRow(items, strong) {
    var shown = items.filter(function (it) { return it[1] != null && it[1] !== '' })
    if (shown.length === 0) return null
    return (
      <dl style={fieldGrid}>
        {shown.map(function (it) {
          return (
            <div key={it[0]} className="min-w-0">
              <dt className="text-[11.5px] text-slate-400">{it[0]}</dt>
              <dd className={'mt-0.5 tabular-nums truncate ' + (strong ? 'text-[14px] font-semibold text-slate-900' : 'text-[13px] font-medium text-slate-700')}>{it[1]}</dd>
            </div>
          )
        })}
      </dl>
    )
  }

  function moneyItems(m) {
    return [
      ['Package', rs(m.agreedCash * cashMul + m.agreedBank)],
      ['Collected', rs(m.collCash * cashMul + m.collBank)],
      ['Expense', rs(m.spent)],
    ]
  }

  // one function / add-on row in the list, with its own collapse
  function item(key, title, tag, contractNo, place, body) {
    var closed = !!closedCards[key]
    return (
      <div key={key} className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-[13.5px] font-semibold text-slate-900">{title || '—'}</p>
              {tag && <span className="text-[11px] font-medium text-slate-500 px-1.5 py-px rounded border border-slate-200 bg-white">{tag}</span>}
              {contractNo && <span className="text-[11.5px] text-slate-400 tabular-nums">#{contractNo}</span>}
            </div>
            {place && <p className="mt-0.5 text-[12px] text-slate-500 truncate">{place}</p>}
          </div>
          <button type="button" onClick={function () { toggleCard(key) }} aria-expanded={!closed} aria-label={closed ? 'Show details' : 'Hide details'}
            className="shrink-0 w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white flex items-center justify-center">
            <Icon name={closed ? 'chevronDown' : 'chevronUp'} size={15} />
          </button>
        </div>
        {!closed && <div className="mt-3.5 space-y-3">{body}</div>}
      </div>
    )
  }

  var ready = open && !loading && money

  return (
    <div className="rounded-xl border border-slate-200 bg-white min-w-0">
      <div className={'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 sm:px-5 py-3' + (open ? ' border-b border-slate-100' : '')}>
        <button type="button" onClick={function () { setOpen(!open) }} aria-expanded={open}
          className="flex-1 min-w-0 inline-flex items-center gap-2 text-left cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <Icon name="chart" size={16} className="shrink-0 text-slate-400" />
          <span className="text-[14px] font-semibold text-slate-900">Profit &amp; Loss</span>
          <span className="text-[12px] text-slate-400">{functions.length} function{functions.length !== 1 ? 's' : ''} combined</span>
        </button>
        <div className="flex items-center gap-2">
          {open && money && (
            <button type="button" role="switch" aria-checked={realCash} onClick={function () { setRealCash(!realCash) }}
              className="inline-flex items-center gap-2 text-[12px] font-medium text-slate-600">
              <span className={'relative inline-block w-8 rounded-full transition-colors ' + (realCash ? 'bg-indigo-600' : 'bg-slate-300')} style={{ height: '18px' }}>
                <span className="absolute w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform" style={{ top: '2px', left: '2px', transform: realCash ? 'translateX(14px)' : 'none' }} />
              </span>
              Show real amount
            </button>
          )}
          <button type="button" onClick={function () { setOpen(!open) }} aria-label={open ? 'Collapse' : 'Expand'}
            className="w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center">
            <Icon name={open ? 'chevronUp' : 'chevronDown'} size={15} />
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 sm:px-5 py-4 space-y-4">
          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-200 overflow-hidden" style={statGrid}>
              {[0, 1, 2, 3].map(function (i) {
                return (
                  <div key={i} className="bg-white px-3.5 py-3.5 space-y-2 animate-pulse">
                    <div className="h-2.5 w-14 rounded bg-slate-200" />
                    <div className="h-4 w-24 rounded bg-slate-200" />
                  </div>
                )
              })}
            </div>
          ) : !money ? (
            <p className="text-[12.5px] text-slate-400 py-1">P&amp;L not available.</p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-200 overflow-hidden" style={statGrid}>
                {stat('Package', rs(money.agreedCash * cashMul + money.agreedBank), split(money.agreedCash * cashMul, money.agreedBank))}
                {stat('Collected', rs(money.collCash * cashMul + money.collBank), (
                  <>
                    {split(money.collCash * cashMul, money.collBank)}
                    {lmsPending && <p className="mt-1 text-[11px] text-slate-400 animate-pulse">Adding LMS payments…</p>}
                  </>
                ), null, lmsPending)}
                {stat('Expense', rs(money.spent), <p className="mt-1.5 text-[11.5px] text-slate-400">Full amount</p>)}
                {stat(good ? 'Profit' : 'Loss', rs(Math.abs(profit)), <p className="mt-1.5 text-[11.5px] text-slate-400">Collected − expense</p>, good ? 'text-emerald-600' : 'text-red-600', lmsPending)}
              </div>

              <p className="-mt-1.5 flex items-start gap-1.5 text-[11.5px] text-slate-500">
                <Icon name="info" size={13} className="shrink-0 mt-px text-slate-400" />
                <span>{realCash ? 'Showing real amounts — package and collected cash × 10.' : 'Package and collected cash are one zero less than the real amount. Bank and expense are full amounts.'}</span>
              </p>
              {failed > 0 && (
                <p className="text-[11.5px] text-amber-700">{failed} contract{failed !== 1 ? 's' : ''} could not be loaded — totals leave {failed !== 1 ? 'them' : 'it'} out.</p>
              )}
              {lmsFailed > 0 && (
                <p className="text-[11.5px] text-amber-700">LMS payments could not be loaded for {lmsFailed} contract{lmsFailed !== 1 ? 's' : ''} — collected may be short.</p>
              )}
            </>
          )}

          {ready && pkgRows.length > 0 && (
            <div className="pt-1 space-y-2">
              <p className="text-[12px] font-semibold text-slate-600">Functions</p>
              <div className="space-y-2.5">
                {pkgRows.map(function (r) {
                  var menuValue = n(r.menu_rate_paise) * n(r.total_plates)
                  var place = [r.venue_name, r.location].filter(Boolean).join(' · ')
                  // a contract's money is shown once, on its first function
                  var m = moneyByKey[r.ckey]
                  var firstOfContract = !shownKeys[r.ckey]
                  shownKeys[r.ckey] = true
                  var details = [
                    ['Rental', amt(r.venue_rental_paise)],
                    ['Pax / Free pax', (r.total_plates || 0) + ' / ' + (r.complementary_plates || 0)],
                    ['Menu', r.catering || null],
                    ['Menu value', menuValue > 0 ? rs(menuValue) : null],
                    ['Extra plate rate', amt(r.extra_plates_charge)],
                    ['Decoration', amt(r.decor_amount_paise)],
                    ['Entertainment', amt(r.entertainment_amount_paise)],
                  ]
                  return item('fn-' + r.id, r.event_name, r.department, r.contract_no, place, (
                    <>
                      {m && firstOfContract && fieldRow(moneyItems(m), true)}
                      {m && !firstOfContract && <p className="text-[11.5px] text-slate-400">Package and collected are shown with the first function of contract #{r.contract_no}.</p>}
                      {m && firstOfContract && <div className="border-t border-slate-200/70" />}
                      {fieldRow(details)}
                    </>
                  ))
                })}
              </div>
            </div>
          )}

          {ready && addons.length > 0 && (
            <div className="pt-1 space-y-2">
              <p className="text-[12px] font-semibold text-slate-600">Add-ons</p>
              <div className="space-y-2.5">
                {addons.map(function (a) {
                  return item('addon-' + a.key, a.event_name, a.department + ' add-on', a.contract_no, null, fieldRow(moneyItems(a), true))
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

var statGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '1px' }
var fieldGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7.5rem, 1fr))', columnGap: '1.5rem', rowGap: '0.75rem' }

export default GroupPnL
