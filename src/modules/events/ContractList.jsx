import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge } from '../../components/ui/Badge'
import { formatDate, formatPaise, titleCase } from '../../lib/format'
import Modal from '../../components/ui/Modal'
import { appConfirm } from '../../components/ui/AppDialog'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import EnteredMark from '../../components/ui/EnteredMark'
import Icon from '../../components/ui/Icon'
import EventLedger from '../expenses/EventLedger'
import EventDatePicker from '../../components/ui/EventDatePicker'
import { fetchContractBalanceSummary, fetchConsolidatedContractBalance, fetchContractBalancesBatch } from '../../lib/contractBalance'
import { generateContractStatementPdf } from '../../lib/pdfContractStatement'

// The list's columns from sm up: event, contract, date, venue, balance, Tally.
var COLS = 'sm:grid-cols-[minmax(0,2.2fr)_140px_110px_minmax(0,1.5fr)_150px_120px]'
var CTL = 'h-10 rounded-xl border border-slate-200 bg-white text-[13.5px] text-slate-800 focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5'

var DEPT_BADGE = {
  Venue: 'bg-blue-100 text-blue-700',
  Decor: 'bg-purple-100 text-purple-700',
  Catering: 'bg-amber-100 text-amber-700',
  Entertainment: 'bg-pink-100 text-pink-700',
}

var CONTRACT_SELECT = 'id, lms_event_id, contract_no, contract_date, function_date, department, contract_type, ' +
  'venue_name, location, contact_person, contact_number, secondary_contact, event_name, client_name, session, ' +
  'catering, total_plates, complementary_plates, extra_plates_charge, balance_received, balance_bank, ' +
  'balance_amount, status, synced_at, created_user_name, ppt_link, pdf_link, enquiry_mode, priority, address, ' +
  'is_tentative, pax, function_type, merged_into_id, tally_entered_by, tally_entered_at, ' +
  'menu_rate_paise, venue_rental_paise, decor_amount_paise, entertainment_amount_paise, tentative_created_at, ' +
  'venue_menu_paise, addons_json, total_amount_paise, net_amount_paise, tax_amount_paise, ' +
  'manual_addon_contract_no, manual_addon_department'

// LMS's own indoor/outdoor flag — confirmed directly against the live API:
// every department returns a `lead_type` field, "I" (one of Ambria's own
// venues) or "O" (an external/off-site booking), which sync-events already
// pulls in under `contract_type` (mapRow in supabase/functions/sync-events,
// `e[dep.d + "lead_type"]`). It was never decoded anywhere it's shown — a
// blank event_name fell back to the raw letter as a title. This is the
// authoritative signal; venue_name string-matching was a guess and is gone.
function venueTypeLabel(v) {
  return v === 'I' ? 'Indoor' : v === 'O' ? 'Outdoor' : v
}

// A flat, un-grouped list of every synced LMS contract — Events.jsx clusters
// same-guest functions into one card and hides most contract fields behind
// two levels of drill-down (group → function). This is the other view: one
// row per contract, click through to see every field events_safe carries,
// for whoever needs the raw contract detail rather than the day-of grouping.
function ContractList({ profile, deepLinkContractId }) {
  var [contracts, setContracts] = useState([])
  var [loading, setLoading] = useState(true)
  var [departments, setDepartments] = useState([])
  var [search, setSearch] = useState('')
  var [venueFilter, setVenueFilter] = useState('')
  var [deptFilter, setDeptFilter] = useState('')
  var [venueTypeFilter, setVenueTypeFilter] = useState('')
  var [salesFilter, setSalesFilter] = useState('')
  var [sessionFilter, setSessionFilter] = useState('')
  var [tentativeFilter, setTentativeFilter] = useState('')
  var [dateFrom, setDateFrom] = useState('')
  var [dateTo, setDateTo] = useState('')
  var [filtersOpen, setFiltersOpen] = useState(false)
  var [page, setPage] = useState(1)
  var [perPage, setPerPage] = useState(25)
  var [selected, setSelected] = useState(null)
  // The matched Decor/Entertainment groups folded into selected's own Venue
  // group (see the consolidation pass above), or null for a standalone
  // contract / a non-Venue selection. { Decor: [group,...], Entertainment: [group,...] }
  var [selectedAddons, setSelectedAddons] = useState(null)
  // Every function row in selected's own group (see groupsMap above) -- just
  // selected itself for a single-function contract, but the full sibling set
  // for a multi-function one (e.g. Lunch+Dinner+Sagan under one contract_no),
  // which neither selected nor selectedAddons carries on its own. Only ever
  // used by the print export's new Functions section.
  var [selectedGroupRows, setSelectedGroupRows] = useState(null)
  // LMS's own Decor/Entertainment "Total Deal Amount" (total_amount_paise)
  // is entered at half the real value as a matter of habit (confirmed
  // live: contract #00374's Deal Amount 95000 vs. its own true 190000) --
  // same "store the hidden figure, reveal on request" treatment as the
  // cashX10 toggle elsewhere (EventLedger.jsx, GroupPnL.jsx), not a blanket
  // correction baked into the sync, since it's an opt-in reveal rather
  // than an assumed-universal fix.
  var [pkgX2, setPkgX2] = useState(false)
  var [showFinancials, setShowFinancials] = useState(false)
  var [printing, setPrinting] = useState(false)
  // Manual add-on linking (fn_link_addon_contract/fn_unlink_addon_contract) --
  // for when the automatic guest+venue+date match (see the grouping pass
  // above) misses and a Decor/Entertainment contract needs pointing at its
  // Venue contract by hand.
  var [linkSearch, setLinkSearch] = useState('')
  var [linkResults, setLinkResults] = useState([])
  var [linkSearching, setLinkSearching] = useState(false)
  var [linkTargetId, setLinkTargetId] = useState(null)
  var [linking, setLinking] = useState(false)
  var [unlinkingAddon, setUnlinkingAddon] = useState(false)
  // Multi-select merge from the list itself -- same fn_link_addon_contract
  // under the hood as the single-contract "Link to a Venue contract" search,
  // just picking both ends of the link from checkboxes instead of a search
  // box. Holds each selected group's own representative id (g.rows[0].id).
  var [mergeSelectIds, setMergeSelectIds] = useState([])
  var [merging, setMerging] = useState(false)
  var [liveBalance, setLiveBalance] = useState(null)
  var [liveBalanceLoading, setLiveBalanceLoading] = useState(false)
  // Live reconciled balance for whatever page of rows is currently shown in
  // the list (one batched RPC call, not one per row) -- keyed by the row's
  // own primary contract id. Only ever used to upgrade a row to "Settled"
  // once we know for certain it is; everything else still falls back to
  // events.balance_amount (LMS's own, possibly-stale figure) exactly as
  // before. See fetchContractBalancesBatch's own notes on why this doesn't
  // fold in LMS-only payments or a Venue row's own Add-on contracts the way
  // the detail panel's Balance box does.
  var [listBalances, setListBalances] = useState({})
  // The real Extra Plate Collect history for this contract (ExtraPlateCollect.jsx,
  // fn_extra_plate_collect) -- distinct from extra_plates_charge (just LMS's
  // own rate, shown in the field list below). fn_extra_plate_collect already
  // posts every collection to event_ledger too, so this is already folded
  // into "Advance received" above -- shown here only as a labeled breakdown
  // of that figure, never added on top of it.
  var [extraPlateCollected, setExtraPlateCollected] = useState(null)

  useEffect(function () {
    setExtraPlateCollected(null)
    if (!selected) return
    var cancelled = false
    ;(async function () {
      var ids = [selected.id]
      if (selected.contract_no) {
        var poolRes = await supabase.from('events').select('id').eq('contract_no', selected.contract_no).eq('department', selected.department)
        if (poolRes.data && poolRes.data.length > 0) ids = poolRes.data.map(function (r) { return r.id })
      }
      var res = await supabase.from('extra_plate_collections').select('total_paise, discount_paise, payment_mode').in('event_id', ids).is('cancelled_at', null)
      if (cancelled) return
      var cash = 0, bank = 0
      ;(res.data || []).forEach(function (r) {
        var net = Number(r.total_paise || 0) - Number(r.discount_paise || 0)
        // Collected cash is logged to event_ledger at the hidden ÷10 scale
        // (see fn_extra_plate_collect's own v_ledger_amt_paise) -- matching
        // that here so this lines up with "Advance received — cash" above,
        // which is shown at that same hidden scale, not the true rupee one.
        if (r.payment_mode === 'cash') cash += Math.round(net / 10)
        else if (r.payment_mode === 'bank') bank += net
      })
      setExtraPlateCollected({ cash: cash, bank: bank })
    })()
    return function () { cancelled = true }
  }, [selected && selected.id])

  // Reset the financials disclosure whenever a different contract is opened,
  // so it doesn't stay expanded (showing the previous contract's figures for
  // a flash) across a selection change. The top Balance box reflects the
  // real, reconciled figures (every function under this contract pooled
  // together, LMS's own payment history folded in) — the same numbers "Show
  // financials" reveals in full below — rather than the stale balance_* columns
  // events carries from whatever LMS last synced, so it loads independent of
  // that toggle and whether it's open.
  useEffect(function () {
    setShowFinancials(false)
    setLiveBalance(null)
    if (!selected) return
    setLiveBalanceLoading(true)
    var addonPrimaries = selectedAddons
      ? [].concat(selectedAddons.Decor || [], selectedAddons.Entertainment || []).map(function (g) { return g.rows[0] })
      : []
    var p = addonPrimaries.length > 0
      ? fetchConsolidatedContractBalance([selected].concat(addonPrimaries)).then(function (r) { return r && r.total })
      : fetchContractBalanceSummary(selected.id)
    p.then(function (b) {
      setLiveBalance(b)
      setLiveBalanceLoading(false)
    })
  }, [selected && selected.id, selectedAddons])

  // Deep-link from a "new contract synced" notification — pins the view to
  // just that one contract regardless of the normal date-floor/search/filter
  // state, fetched directly by id so it resolves even if the contract falls
  // outside the default list window. Local state (not read straight off the
  // prop) so "Clear" can drop it without needing the parent to forget it too.
  var [filterId, setFilterId] = useState(deepLinkContractId || null)
  var [pinnedContract, setPinnedContract] = useState(null)
  var [pinnedLoading, setPinnedLoading] = useState(false)

  useEffect(function () {
    if (deepLinkContractId) setFilterId(deepLinkContractId)
  }, [deepLinkContractId])

  useEffect(function () {
    if (!filterId) { setPinnedContract(null); return }
    setPinnedLoading(true)
    supabase.from('events_safe').select(CONTRACT_SELECT).eq('id', filterId).maybeSingle()
      .then(function (res) {
        setPinnedContract(res.data || null)
        setSelected(res.data || null)
        setSelectedAddons(null)
        setSelectedGroupRows(null)
        if (res.data) loadEnteredNames([res.data])
        setPinnedLoading(false)
      })
  }, [filterId])
  var refData = useReferenceData()
  var venueMap = useMemo(function () {
    var m = {}
    refData.venues.filter(function (v) { return v.active }).forEach(function (v) { if (v.name) m[v.name] = v.code })
    return m
  }, [refData.venues])

  var isAdmin = hasPerm(profile?.permsNew, 'events.list')
  var isSysAdmin = hasPerm(profile?.permsNew, 'admin.dashboard')
  var canMarkEntered = hasPerm(profile?.permsNew, 'finance.wallet.mark_entered')
  // Same permission fn_merge_events already gates (Events.jsx) -- linking an
  // add-on contract is the same class of privileged, cross-contract action,
  // just non-destructive (see fn_link_addon_contract's own note).
  var canLinkAddon = hasPerm(profile?.permsNew, 'events.list.merge')
  var userEventDeptNames = (profile?.event_dept_ids || []).map(function (id) {
    var dept = departments.find(function (d) { return d.id === id })
    return dept ? dept.name : null
  }).filter(Boolean)
  var hasEventDeptFilter = !isAdmin && userEventDeptNames.length > 0

  var [enteredNames, setEnteredNames] = useState({})
  var [enteringId, setEnteringId] = useState(null)
  var [enteredFilter, setEnteredFilter] = useState('')

  // The list only ever fetches function_date >= (today - 5 days) -- a
  // contract ages out of view on its own once its date rolls past that
  // floor, with no sync/data problem at all (confirmed live: contract #00568,
  // Nov 18, was visible on Nov 23 -- floor Nov 18 -- and gone on Nov 24 --
  // floor Nov 19). Setting an earlier "From" date in Filters widens the
  // floor to match (never narrows it -- that's dateTo's job, client-side on
  // whatever's already loaded) so a past contract can still be found.
  useEffect(function () { load() }, [dateFrom])

  async function load() {
    setLoading(true)
    var defaultFloor = new Date()
    defaultFloor.setDate(defaultFloor.getDate() - 5)
    var defaultFloorStr = defaultFloor.toISOString().split('T')[0]
    var dateFloorStr = dateFrom && dateFrom < defaultFloorStr ? dateFrom : defaultFloorStr
    var [res, deptRes] = await Promise.all([
      supabase.from('events_safe')
        .select(CONTRACT_SELECT)
        .gte('function_date', dateFloorStr)
        .is('merged_into_id', null)
        .order('function_date', { ascending: false })
        .limit(2000),
      supabase.from('departments').select('id, name').eq('active', true).eq('hide_from_lists', false),
    ])
    setDepartments(deptRes.data || [])
    var rows = res.data || []
    setContracts(rows)
    loadEnteredNames(rows)
    setLoading(false)
  }

  function loadEnteredNames(rows) {
    var ids = []
    rows.forEach(function (c) { if (c.tally_entered_by && ids.indexOf(c.tally_entered_by) === -1) ids.push(c.tally_entered_by) })
    if (ids.length === 0) return
    // fn_profile_names, not a direct select -- RLS on profiles only lets a
    // user read their own row, and most entries here were entered by someone
    // else.
    supabase.rpc('fn_profile_names', { p_ids: ids }).then(function (res) {
      var next = {}
      ;(res.data || []).forEach(function (p) { next[p.id] = p.name })
      setEnteredNames(function (prev) { return Object.assign({}, prev, next) })
    })
  }

  async function toggleContractEntered(id) {
    if (enteringId) return
    setEnteringId(id)
    var res = await supabase.rpc('fn_toggle_event_tally_entered', { p_event_id: id })
    setEnteringId(null)
    if (res.error) { alert('Failed: ' + res.error.message); return }
    var patch = res.data
      ? { tally_entered_by: profile.id, tally_entered_at: new Date().toISOString() }
      : { tally_entered_by: null, tally_entered_at: null }
    setContracts(function (prev) { return prev.map(function (c) { return c.id === id ? Object.assign({}, c, patch) : c }) })
    setPinnedContract(function (prev) { return prev && prev.id === id ? Object.assign({}, prev, patch) : prev })
    setSelected(function (prev) { return prev && prev.id === id ? Object.assign({}, prev, patch) : prev })
    // selectedAddons is a snapshot of the group objects taken when the modal
    // opened (see the row click handlers) -- without patching it too, an
    // Add-on Decor/Ent card's own tally mark shows the pre-toggle state
    // until the modal is closed and reopened, and clicking it again would
    // toggle fn_toggle_event_tally_entered right back off.
    setSelectedAddons(function (prev) {
      if (!prev) return prev
      // Same reference back when id isn't one of these add-ons (e.g. the
      // toggle was on the Venue contract itself) -- selectedAddons is a
      // dependency of the live-balance effect, and a new object every
      // single toggle would needlessly reload it (flicker to "Loading…"
      // and re-query every contract) for a click that never touched it.
      var touchesAddons = [].concat(prev.Decor || [], prev.Entertainment || []).some(function (g) { return g.rows.some(function (r) { return r.id === id }) })
      if (!touchesAddons) return prev
      var patchRows = function (rows) { return rows.map(function (r) { return r.id === id ? Object.assign({}, r, patch) : r }) }
      var patchGroups = function (groups) { return (groups || []).map(function (g) { return Object.assign({}, g, { rows: patchRows(g.rows) }) }) }
      return { Decor: patchGroups(prev.Decor), Entertainment: patchGroups(prev.Entertainment) }
    })
    if (res.data && profile.name) setEnteredNames(function (prev) { return Object.assign({}, prev, { [profile.id]: profile.name }) })
  }

  function searchLinkTargets(q) {
    setLinkSearch(q)
    setLinkTargetId(null)
    if (!q || q.trim().length < 2) { setLinkResults([]); return }
    setLinkSearching(true)
    supabase.from('events_safe')
      .select('id, event_name, client_name, venue_name, function_date, contract_no')
      .eq('department', 'Venue')
      .eq('is_tentative', false)
      .ilike('client_name', '%' + q.trim() + '%')
      .order('function_date', { ascending: false })
      .limit(20)
      .then(function (res) {
        setLinkResults(res.data || [])
        setLinkSearching(false)
      })
  }

  async function submitLinkAddon() {
    if (linking || !selected || !linkTargetId) return
    if (!(await appConfirm('Link this contract as an add-on of the selected Venue contract? Its balance folds into that contract\'s consolidated Balance box.'))) return
    setLinking(true)
    var res = await supabase.rpc('fn_link_addon_contract', { p_addon_event_id: selected.id, p_venue_event_id: linkTargetId })
    setLinking(false)
    if (res.error) { alert('Link failed: ' + res.error.message); return }
    setLinkSearch(''); setLinkResults([]); setLinkTargetId(null)
    setSelected(null); setSelectedAddons(null); setSelectedGroupRows(null)
    load()
  }

  async function unlinkAddon(addonEventId) {
    if (unlinkingAddon) return
    if (!(await appConfirm('Unlink this add-on contract? It goes back to showing its own separate balance.'))) return
    setUnlinkingAddon(true)
    var res = await supabase.rpc('fn_unlink_addon_contract', { p_addon_event_id: addonEventId })
    setUnlinkingAddon(false)
    if (res.error) { alert('Unlink failed: ' + res.error.message); return }
    setSelected(null); setSelectedAddons(null); setSelectedGroupRows(null)
    load()
  }

  function toggleMergeSelect(id) {
    setMergeSelectIds(function (prev) {
      return prev.indexOf(id) !== -1 ? prev.filter(function (x) { return x !== id }) : prev.concat([id])
    })
  }

  // Picked from the list's own checkboxes. Two different merges share this
  // button, told apart by whether a tentative placeholder is in the
  // selection:
  //  - a tentative (no LMS contract yet) + one real contract -> fn_merge_events
  //    (Events.jsx's existing "Merge into a real LMS event" path, just
  //    triggered from here too) -- moves every real operational record
  //    (ledger, requisitions, manpower, challans...) onto the target.
  //    Irreversible.
  //  - Venue + one or more Decor/Entertainment contracts, none tentative ->
  //    fn_link_addon_contract -- no history moves, reversible (Unlink).
  // Mixing the two shapes in one selection is rejected rather than guessed at.
  async function submitMergeSelected(selGroups) {
    if (merging) return
    var tentativeGroups = selGroups.filter(function (g) { return g.rows[0].is_tentative })
    var realGroups = selGroups.filter(function (g) { return !g.rows[0].is_tentative })

    if (tentativeGroups.length > 0) {
      if (realGroups.length !== 1) {
        alert('Select exactly one real, already-synced contract as the merge target, plus one or more tentative placeholders to merge into it.')
        return
      }
      var target = realGroups[0].rows[0]
      if (!(await appConfirm('Merge ' + tentativeGroups.length + ' tentative placeholder' + (tentativeGroups.length === 1 ? '' : 's') + ' into "' + (target.event_name || target.client_name || ('#' + target.contract_no)) + '"? This moves all of its collections/ledger history onto the target and cannot be undone.'))) return
      setMerging(true)
      var tErrors = []
      for (var ti = 0; ti < tentativeGroups.length; ti++) {
        var src = tentativeGroups[ti].rows[0]
        var tRes = await supabase.rpc('fn_merge_events', { p_tentative_id: src.id, p_target_id: target.id })
        if (tRes.error) tErrors.push((src.event_name || src.client_name || 'Tentative #' + src.id) + ': ' + tRes.error.message)
      }
      setMerging(false)
      setMergeSelectIds([])
      if (tErrors.length > 0) alert('Some contracts could not be merged:\n' + tErrors.join('\n'))
      load()
      return
    }

    var venueGroups = realGroups.filter(function (g) { return g.rows[0].department === 'Venue' })
    var addonGroups = realGroups.filter(function (g) { return g.rows[0].department === 'Decor' || g.rows[0].department === 'Entertainment' })
    if (venueGroups.length !== 1) {
      alert('Select exactly one Venue contract (the one everything else merges into), plus one or more Decor/Entertainment contracts for the same guest.')
      return
    }
    if (addonGroups.length === 0) {
      alert('Select at least one Decor/Entertainment contract to merge into the Venue contract.')
      return
    }
    if (addonGroups.length !== realGroups.length - 1) {
      alert('Only Venue + Decor/Entertainment contracts can be merged here — drop any other selected contract and try again.')
      return
    }
    var venue = venueGroups[0].rows[0]
    if (!(await appConfirm('Merge ' + addonGroups.length + ' contract' + (addonGroups.length === 1 ? '' : 's') + ' into Venue contract #' + venue.contract_no + '? Their balances fold into one consolidated Balance box — no history moves, and each can be unlinked again later.'))) return
    setMerging(true)
    var errors = []
    for (var i = 0; i < addonGroups.length; i++) {
      var addon = addonGroups[i].rows[0]
      var res = await supabase.rpc('fn_link_addon_contract', { p_addon_event_id: addon.id, p_venue_event_id: venue.id })
      if (res.error) errors.push('#' + addon.contract_no + ': ' + res.error.message)
    }
    setMerging(false)
    setMergeSelectIds([])
    if (errors.length > 0) alert('Some contracts could not be merged:\n' + errors.join('\n'))
    load()
  }

  var visible = hasEventDeptFilter
    ? contracts.filter(function (c) { return userEventDeptNames.includes(c.department) })
    : contracts

  var venueNames = [...new Set(contracts.map(function (c) { return c.venue_name }).filter(Boolean))]
  var salesNames = [...new Set(contracts.map(function (c) { return c.created_user_name }).filter(Boolean))].sort()
  var sessionNames = [...new Set(contracts.map(function (c) { return c.session }).filter(Boolean))].sort()

  var searchLower = search.toLowerCase()
  var filtered = visible.filter(function (c) {
    var matchSearch = !search ||
      (c.client_name || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (c.event_name || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (c.contact_person || '').toLowerCase().indexOf(searchLower) !== -1 ||
      (c.contact_number || '').indexOf(search) !== -1 ||
      (c.contract_no || '').indexOf(search) !== -1 ||
      (c.venue_name || '').toLowerCase().indexOf(searchLower) !== -1
    var matchVenue = !venueFilter || c.venue_name === venueFilter
    var matchDept = !deptFilter || c.department === deptFilter
    var matchEntered = !enteredFilter || (enteredFilter === 'yes' ? !!c.tally_entered_by : !c.tally_entered_by)
    var matchVenueType = !venueTypeFilter || c.contract_type === (venueTypeFilter === 'outdoor' ? 'O' : 'I')
    var matchSales = !salesFilter || c.created_user_name === salesFilter
    var matchSession = !sessionFilter || c.session === sessionFilter
    var matchTentative = !tentativeFilter || (tentativeFilter === 'yes' ? !!c.is_tentative : !c.is_tentative)
    var cDate = (c.function_date || c.contract_date || '').slice(0, 10)
    var matchDate = (!dateFrom || !cDate || cDate >= dateFrom) && (!dateTo || !cDate || cDate <= dateTo)
    return matchSearch && matchVenue && matchDept && matchEntered && matchVenueType && matchSales && matchSession && matchTentative && matchDate
  })

  // One group per contract (contract_no + department) rather than one row
  // per function — a multi-function contract (Lunch, Dinner, Sagan, all
  // under the same contract_no) used to show as N separate full-width
  // cards. A row with no contract_no yet (tentative, no LMS contract) is
  // its own singleton group, keyed by id so it never merges with anything.
  function groupKeyOf(c) { return c.contract_no ? ((c.department || '') + '|' + c.contract_no) : ('single-' + c.id) }
  var groupsMap = {}
  var groupOrder = []
  filtered.forEach(function (c) {
    var k = groupKeyOf(c)
    if (!groupsMap[k]) { groupsMap[k] = []; groupOrder.push(k) }
    groupsMap[k].push(c)
  })
  var groups = groupOrder.map(function (k) { return { key: k, rows: groupsMap[k] } })

  // Fold a matching Decor and/or Entertainment contract into its Venue
  // contract as an add-on, rather than showing all 3 as separate top-level
  // rows for the same guest+function. Each department numbers its own
  // contracts independently (no shared contract_no to join on), so the only
  // reliable cross-department link is the guest and the venue themselves;
  // function_date must also fall among the Venue group's own dates, so an
  // unrelated earlier or later booking for the same repeat guest at the
  // same venue never gets folded in by mistake.
  function clientVenueKey(c) { return (c.client_name || '').trim().toLowerCase() + '|' + (c.venue_name || '').trim().toLowerCase() }
  var venueGroupsByKey = {}
  var venueGroupsByContractKey = {}
  groups.forEach(function (g) {
    // Tentative (no contract_no yet) excluded: EventLedger's own pooling
    // for a tentative primary never looks at extraEventIds at all (there's
    // no real contract to anchor a cross-department pool on), so a
    // tentative card that still picked up add-ons would show a combined
    // Balance box up top that "Show financials" then can't reproduce.
    if (g.rows[0].department !== 'Venue' || !g.rows[0].contract_no) return
    var k = clientVenueKey(g.rows[0])
    if (!venueGroupsByKey[k]) venueGroupsByKey[k] = []
    venueGroupsByKey[k].push(g)
    venueGroupsByContractKey[g.rows[0].department + '|' + g.rows[0].contract_no] = g
  })
  var consumedKeys = {}
  groups.forEach(function (g) {
    var dept = g.rows[0].department
    if (dept !== 'Decor' && dept !== 'Entertainment') return
    // A manual link (see fn_link_addon_contract, for when the automatic
    // guest+venue+date match below misses) always wins when it points at a
    // Venue group that's actually in view -- explicit beats implicit, and it
    // has to work even for a guest/venue name the automatic match would
    // never have matched in the first place.
    var manualTarget = g.rows[0].manual_addon_contract_no
      ? venueGroupsByContractKey[(g.rows[0].manual_addon_department || 'Venue') + '|' + g.rows[0].manual_addon_contract_no]
      : null
    var matched = manualTarget
    if (!matched) {
      var candidates = venueGroupsByKey[clientVenueKey(g.rows[0])]
      if (candidates && candidates.length > 0) {
        var venueDates = {}
        matched = candidates.find(function (vg) {
          vg.rows.forEach(function (r) { if (r.function_date) venueDates[r.function_date] = true })
          return g.rows.some(function (r) { return !r.function_date || venueDates[r.function_date] })
        })
      }
    }
    if (!matched) return
    if (!matched.addons) matched.addons = { Decor: [], Entertainment: [] }
    matched.addons[dept].push(g)
    consumedKeys[g.key] = true
  })
  groups = groups.filter(function (g) { return !consumedKeys[g.key] })

  var totalPages = Math.ceil(groups.length / perPage)
  var pagedGroups = groups.slice((page - 1) * perPage, page * perPage)
  var groupsToShow = filterId ? (pinnedContract ? [{ key: 'pinned', rows: [pinnedContract] }] : []) : pagedGroups

  var listBalanceIdsKey = groupsToShow.map(function (g) { return g.rows[0].id }).join(',')
  useEffect(function () {
    if (!isAdmin || groupsToShow.length === 0) { setListBalances({}); return }
    var cancelled = false
    fetchContractBalancesBatch(groupsToShow.map(function (g) {
      var p = g.rows[0]
      return { id: p.id, contract_no: p.contract_no, department: p.department }
    })).then(function (results) {
      if (cancelled) return
      var next = {}
      results.forEach(function (b, i) { if (b) next[groupsToShow[i].rows[0].id] = b })
      setListBalances(next)
    })
    return function () { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listBalanceIdsKey, isAdmin])

  if (loading) {
    return <p className="text-slate-500 text-[13px] text-center py-10">Loading contracts…</p>
  }

  return (
    <div className="space-y-4">
      {filterId && (
        <div className="flex items-center justify-between gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
          <p className="text-sm font-semibold text-indigo-900">Showing 1 contract from your notification</p>
          <button type="button" onClick={function () { setFilterId(null) }}
            className="shrink-0 text-xs font-bold text-indigo-600 hover:text-indigo-800">
            Clear — view all
          </button>
        </div>
      )}

      {/* Toolbar: search, a single Filters button holding every dropdown
          plus the date range, page size at its end, the count under it. Six
          "All ..." selects spread across the row said nothing useful most of
          the time — the button now says how many are actually narrowed. */}
      {!filterId && (function () {
        var FILTER_DROPDOWNS = [
          [venueFilter, setVenueFilter, 'mapPin', 'Venue', [['', 'All venues']].concat(venueNames.map(function (v) { return [v, venueMap[v] ? (venueMap[v] + ' — ' + v) : v] }))],
          [deptFilter, setDeptFilter, 'tag', 'Department', [['', 'All depts']].concat(departments.map(function (d) {
            // The "Department" master record (id 23) covers several sub-departments
            // (Allied, Entertainment, Tech, Tender, ...) — renaming it to
            // "Entertainment" in the masters screen would be wrong, since it isn't
            // exclusively that. But every Entertainment-department contract is
            // stamped with the literal string "Entertainment" on events.department
            // by sync-events, with no master record of its own to filter by — so
            // this one option is relabelled (and its filter value swapped to
            // match) here only, scoped to this dropdown, leaving the master as is.
            var label = d.name === 'Department' ? 'Entertainment' : d.name
            return [label, label]
          }))],
          [enteredFilter, setEnteredFilter, 'checkCircle', 'Entered in Tally', [['', 'Entered: all'], ['yes', 'Entered'], ['no', 'Not entered']]],
          [venueTypeFilter, setVenueTypeFilter, 'building', 'Indoor or outdoor', [['', 'Indoor & outdoor'], ['indoor', 'Indoor'], ['outdoor', 'Outdoor']]],
          [salesFilter, setSalesFilter, 'user', 'Sales person', [['', 'All sales']].concat(salesNames.map(function (s) { return [s, s] }))],
          [sessionFilter, setSessionFilter, 'clock', 'Session', [['', 'All sessions']].concat(sessionNames.map(function (s) { return [s, s] }))],
          [tentativeFilter, setTentativeFilter, 'alert', 'Tentative', [['', 'Tentative: all'], ['yes', 'Tentative only'], ['no', 'Confirmed only']]],
        ]
        var filterCount = [venueFilter, deptFilter, enteredFilter, venueTypeFilter, salesFilter, sessionFilter, tentativeFilter, dateFrom, dateTo].filter(Boolean).length
        function clearAll() {
          setSearch(''); setVenueFilter(''); setDeptFilter(''); setEnteredFilter(''); setVenueTypeFilter('')
          setSalesFilter(''); setSessionFilter(''); setTentativeFilter(''); setDateFrom(''); setDateTo(''); setPage(1)
        }
        return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)] p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input type="text" value={search}
              onChange={function (e) { setSearch(e.target.value); setPage(1) }}
              placeholder="Search client, event, contract, venue…"
              className={CTL + ' w-full pl-9 pr-3 placeholder:text-slate-400'}
              style={{ fontSize: '16px' }} />
          </div>
          <button type="button" onClick={function () { setFiltersOpen(!filtersOpen) }} aria-expanded={filtersOpen}
            className={'relative h-10 px-3.5 rounded-xl border text-[13px] font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ' +
              (filtersOpen || filterCount > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
            <Icon name="filter" size={14} />Filters
            {filterCount > 0 && (
              <span data-notranslate className="px-1.5 rounded-md bg-indigo-600 text-white text-[11px] tabular-nums">{filterCount}</span>
            )}
          </button>
          <span className="relative ml-auto">
            <select value={perPage}
              onChange={function (e) { setPerPage(Number(e.target.value)); setPage(1) }}
              aria-label="Per page"
              className={CTL + ' pl-3 pr-8 appearance-none font-semibold'}>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
            <Icon name="chevronDown" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </span>
        </div>

        {filtersOpen && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-2.5 sm:grid-cols-3">
            {FILTER_DROPDOWNS.map(function (f) {
              return (
                <div key={f[3]} className="relative">
                  <Icon name={f[2]} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select value={f[0]} onChange={function (e) { f[1](e.target.value); setPage(1) }} aria-label={f[3]}
                    className={CTL + ' w-full pl-8 pr-8 appearance-none bg-white ' + (f[0] ? '' : 'text-slate-500')}>
                    {f[4].map(function (o) { return <option key={o[0]} value={o[0]}>{o[1]}</option> })}
                  </select>
                  <Icon name="chevronDown" size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              )
            })}
            <div className="flex items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex-1 min-w-0">
                <EventDatePicker value={dateFrom} placeholder="From" collapsible includePast plain
                  onChange={function (v) { setDateFrom(v); setPage(1) }} />
              </div>
              <span aria-hidden="true" className="shrink-0 self-stretch my-2 w-px bg-slate-200" />
              <div className="flex-1 min-w-0">
                <EventDatePicker value={dateTo} placeholder="To" collapsible includePast plain
                  onChange={function (v) { setDateTo(v); setPage(1) }} />
              </div>
              {(dateFrom || dateTo) && (
                <button type="button" onClick={function () { setDateFrom(''); setDateTo(''); setPage(1) }}
                  aria-label="Clear dates"
                  className="shrink-0 px-2 text-slate-400 hover:text-slate-600">
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
            {filterCount > 0 && (
              <button type="button" onClick={clearAll}
                className="sm:col-span-3 justify-self-start inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] font-semibold text-slate-600 hover:bg-white hover:text-red-600 transition-colors">
                <Icon name="refresh" size={13} />Clear filters
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 px-0.5 text-[12.5px] text-slate-500">
          <span className="h-6 px-2 rounded-md bg-slate-100 inline-flex items-center"><b className="text-slate-800 tabular-nums">{groups.length}</b>&nbsp;contract{groups.length === 1 ? '' : 's'}</span>
          {(filterCount > 0 || search) && (
            <button type="button" onClick={clearAll}
              className="h-6 px-2 rounded-md font-bold text-indigo-600 hover:bg-indigo-50">Reset</button>
          )}
          {canLinkAddon && mergeSelectIds.length > 0 && (
            <>
              <span className="h-6 px-2 rounded-md bg-indigo-50 text-indigo-700 font-semibold inline-flex items-center">{mergeSelectIds.length} selected</span>
              <button type="button" disabled={mergeSelectIds.length < 2 || merging}
                onClick={function () {
                  var selGroups = groupsToShow.filter(function (g) { return mergeSelectIds.indexOf(g.rows[0].id) !== -1 })
                  submitMergeSelected(selGroups)
                }}
                className="h-6 px-2.5 rounded-md font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {merging ? 'Merging…' : 'Merge selected'}
              </button>
              <button type="button" onClick={function () { setMergeSelectIds([]) }}
                className="h-6 px-2 rounded-md font-semibold text-slate-500 hover:bg-slate-100">Clear selection</button>
            </>
          )}
        </div>
      </div>
        )
      })()}

      {filterId && pinnedLoading && (
        <p className="text-slate-500 text-[13px] text-center py-8">Loading contract…</p>
      )}
      {filterId && !pinnedLoading && !pinnedContract && (
        <p className="text-slate-500 text-[13px] text-center py-8">That contract couldn't be found — it may have been merged or removed.</p>
      )}
      {!filterId && groups.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl px-6 py-14 text-center">
          <span className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 inline-flex items-center justify-center mb-3"><Icon name="fileText" size={22} /></span>
          <p className="font-display text-[15px] font-bold text-slate-800">No contracts found</p>
          <p className="mt-1 text-[13px] text-slate-500">Try a different search or loosen a filter.</p>
        </div>
      )}

      {/* The contracts: one bordered card per contract, with a gap between
          them — a shared divider between a card's own header row and its
          Pax/rate detail strip read the same as the gap between two
          different contracts, so the list kept reading as one long run
          with no clear edges. A gap and a border per card is unambiguous
          regardless of how heavy the internal divider is. */}
      {groupsToShow.length > 0 && (
        <div className="space-y-2.5">
          <div className={'hidden sm:grid ' + COLS + ' gap-3 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11.5px] font-bold uppercase tracking-[0.07em] text-slate-500'}>
            <span>Event</span><span>Contract</span><span>Date</span><span>Venue</span><span className="text-right">Balance</span><span className="text-right">Tally</span>
          </div>
          {groupsToShow.map(function (g) {
            var rows = g.rows
            var c = rows[0]
            var multi = rows.length > 1
            // Only ever used to confirm a genuine settlement -- a live
            // balance that ISN'T settled doesn't override the existing
            // due/adv figure below (different scales/sources, see
            // fetchContractBalancesBatch's own notes; not worth a cross-
            // scale combined number for a case nobody asked to fix).
            var lb = listBalances[c.id]
            var liveSettled = isAdmin && lb && Number(lb.pending_cash_paise || 0) === 0 &&
              (Number(lb.pending_bank_paise || 0) + Number(lb.pending_tax_paise || 0)) === 0
            var dates = rows.map(function (r) { return r.function_date || r.contract_date }).filter(Boolean).sort()
            var dateStart = dates[0], dateEnd = dates[dates.length - 1]
            var isTentative = rows.some(function (r) { return r.is_tentative })
            var uniqueLocations = [...new Set(rows.map(function (r) { return r.location }).filter(Boolean))]
            var enteredCount = rows.filter(function (r) { return r.tally_entered_by }).length
            // Folded-in Decor/Ent contracts (see the consolidation pass
            // above) no longer show as their own top-level row at all, so
            // without this chip they'd be invisible here -- including
            // whether either of them is still waiting to be entered in
            // Tally, which the Venue row's own EnteredMark can't show since
            // it only ever reflects the Venue side.
            var addonRows = g.addons ? [].concat(g.addons.Decor || [], g.addons.Entertainment || []).map(function (ag) { return ag.rows[0] }) : []
            var addonNotEntered = addonRows.filter(function (r) { return !r.tally_entered_by }).length
            return (
              <div key={g.key}
                role="button" tabIndex={0}
                onClick={function () { setSelected(c); setSelectedAddons(g.addons || null); setSelectedGroupRows(g.rows) }}
                onKeyDown={function (e) { if (e.key === 'Enter') { setSelected(c); setSelectedAddons(g.addons || null); setSelectedGroupRows(g.rows) } }}
                className={'group bg-white border border-slate-200 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.05)] px-4 py-3.5 transition-colors sm:grid ' + COLS + ' sm:gap-3 sm:items-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40'}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {canLinkAddon && (c.contract_no || c.is_tentative) && (
                      <input type="checkbox" checked={mergeSelectIds.indexOf(c.id) !== -1}
                        title="Select to merge with another contract"
                        onClick={function (e) { e.stopPropagation() }}
                        onChange={function () { toggleMergeSelect(c.id) }}
                        className="shrink-0 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    )}
                    <h3 className={'font-display text-[14px] font-bold tracking-[-0.01em] text-slate-900 truncate ' + (multi ? '' : 'group-hover:text-indigo-700')}>
                      {multi ? titleCase(c.client_name || '—') : (c.event_name || '—')}
                    </h3>
                    {isTentative && <span className="shrink-0 text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Tentative</span>}
                    {c.department && <span className={'shrink-0 text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded ' + (DEPT_BADGE[c.department] || 'bg-slate-100 text-slate-600')}>{c.department}</span>}
                    {addonRows.length > 0 && (
                      <span className={'shrink-0 text-[10.5px] font-bold px-1.5 py-0.5 rounded ' + (addonNotEntered > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}
                        title={addonRows.map(function (r) { return r.department + ' #' + r.contract_no + (r.tally_entered_by ? ' — entered' : ' — not entered'); }).join(', ')}>
                        +{addonRows.length} add-on{addonRows.length === 1 ? '' : 's'}{addonNotEntered > 0 ? ' · ' + addonNotEntered + ' not entered' : ''}
                      </span>
                    )}
                  </div>
                  {multi ? (
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {rows.map(function (r) {
                        return (
                          <span key={r.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600">
                            {r.event_name || '—'}{r.session ? ' · ' + r.session : ''}
                          </span>
                        )
                      })}
                    </p>
                  ) : (
                    <p className="text-[12.5px] text-slate-600 truncate mt-0.5">{titleCase(c.client_name || '—')}</p>
                  )}
                  {/* phone: the columns as one meta line */}
                  <p className="sm:hidden mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-slate-500">
                    {c.contract_no && <span className="font-mono">#{c.contract_no}</span>}
                    <span className="inline-flex items-center gap-1"><Icon name="calendar" size={12} className="text-slate-400" />
                      {multi && dateStart !== dateEnd ? formatDate(dateStart) + ' – ' + formatDate(dateEnd) : formatDate(dateStart || c.contract_date)}
                    </span>
                    {c.contract_date && dateStart && (
                      <span className="text-slate-400">Contracted {formatDate(c.contract_date)}</span>
                    )}
                    {c.is_tentative && c.tentative_created_at && (
                      <span className="text-slate-400">Created {formatDate(c.tentative_created_at)}</span>
                    )}
                    {(c.venue_name || uniqueLocations.length > 0) && (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="mapPin" size={12} className="text-slate-400" />
                        {[c.venue_name ? (venueMap[c.venue_name] ? (venueMap[c.venue_name] + ' — ' + c.venue_name) : c.venue_name) : null, uniqueLocations.length === 1 ? uniqueLocations[0] : (uniqueLocations.length > 1 ? uniqueLocations.length + ' sub-venues' : null)].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {!multi && c.session && <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} className="text-slate-400" />{c.session}</span>}
                    {multi && <span className="font-semibold text-slate-600">{rows.length} functions</span>}
                    {c.created_user_name && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-100 font-bold text-indigo-700">
                        <Icon name="user" size={11} />{c.created_user_name}
                      </span>
                    )}
                  </p>
                </div>
                <div className="hidden sm:block min-w-0">
                  <span className="block font-mono text-[12.5px] text-slate-600">{c.contract_no ? '#' + c.contract_no : '—'}</span>
                  {c.created_user_name && (
                    <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-100 text-[10.5px] font-bold text-indigo-700 max-w-full truncate">
                      <Icon name="user" size={10} className="shrink-0" /><span className="truncate">{c.created_user_name}</span>
                    </span>
                  )}
                </div>
                <div className="hidden sm:block">
                  <span className="block text-[13px] text-slate-700 tabular-nums">
                    {multi && dateStart !== dateEnd ? formatDate(dateStart) + ' – ' + formatDate(dateEnd) : formatDate(dateStart || c.contract_date)}
                  </span>
                  {c.contract_date && dateStart && (
                    <span className="block text-[10.5px] text-slate-400 tabular-nums">Contracted {formatDate(c.contract_date)}</span>
                  )}
                  {c.is_tentative && c.tentative_created_at && (
                    <span className="block text-[10.5px] text-slate-400 tabular-nums">Created {formatDate(c.tentative_created_at)}</span>
                  )}
                </div>
                <div className="hidden sm:block min-w-0">
                  <span className="block text-[13px] text-slate-600 truncate">{c.venue_name ? (venueMap[c.venue_name] ? (venueMap[c.venue_name] + ' — ' + c.venue_name) : c.venue_name) : '—'}</span>
                  {uniqueLocations.length === 1 && <span className="block text-[11px] text-slate-400 truncate">{uniqueLocations[0]}</span>}
                  {uniqueLocations.length > 1 && <span className="block text-[11px] text-slate-400 truncate">{uniqueLocations.length} sub-venues</span>}
                  {!multi && c.session && (
                    <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] text-slate-400">
                      <Icon name="clock" size={10} className="text-slate-400" />{c.session}
                    </span>
                  )}
                </div>
                <span className="hidden sm:block text-right">
                    {liveSettled ? (
                      <span className="inline-flex items-center text-[10.5px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-wide">Settled</span>
                    ) : isAdmin && c.balance_amount != null ? (
                      c.balance_amount === 0 ? (
                        <span className="inline-flex items-center text-[10.5px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-wide">Settled</span>
                      ) : (
                        <span className={'text-[13px] font-bold tabular-nums ' + (c.balance_amount < 0 ? 'text-red-600' : 'text-emerald-600')}>
                          {formatPaise(Math.abs(c.balance_amount))}
                          <span className="ml-1 text-[11px] font-semibold opacity-80">{c.balance_amount < 0 ? 'due' : 'adv'}</span>
                        </span>
                      )
                    ) : <span className="text-slate-300">—</span>}
                  </span>
                  <div className="mt-2 sm:mt-0 flex sm:justify-end items-center gap-3">
                    {liveSettled ? (
                      <span className="sm:hidden inline-flex items-center text-[10.5px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-wide">Settled</span>
                    ) : isAdmin && c.balance_amount != null ? (
                      c.balance_amount === 0 ? (
                        <span className="sm:hidden inline-flex items-center text-[10.5px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-wide">Settled</span>
                      ) : (
                        <span className={'sm:hidden text-[12.5px] font-bold tabular-nums ' + (c.balance_amount < 0 ? 'text-red-600' : 'text-emerald-600')}>
                          {formatPaise(Math.abs(c.balance_amount))} {c.balance_amount < 0 ? 'due' : 'adv'}
                        </span>
                      )
                    ) : null}
                    {multi ? (
                      <span className="ml-auto sm:ml-0 text-[11px] font-bold text-slate-500 tabular-nums">{enteredCount}/{rows.length} entered</span>
                    ) : (c.tally_entered_by || canMarkEntered) && (
                      <span onClick={function (ev) { ev.stopPropagation() }} className="ml-auto sm:ml-0">
                        <EnteredMark
                          entered={!!c.tally_entered_by}
                          enteredByName={enteredNames[c.tally_entered_by]}
                          enteredAt={c.tally_entered_at}
                          canToggle={canMarkEntered}
                          canUnenter={c.tally_entered_by === profile.id || isSysAdmin}
                          busy={enteringId === c.id}
                          onToggle={function () { toggleContractEntered(c.id) }}
                        />
                      </span>
                    )}
                  </div>

                  {/* Multi-function contract: each function gets its own line —
                      own date/session/venue, own Venue-dept Pax/rate chips, and
                      critically its own EnteredMark, since "entered in Tally" is
                      tracked per function, not per contract (see fix() notes on
                      sync-events' composite dedup key — collapsing this back to
                      one shared mark would silently hide a not-yet-entered
                      sibling function). The card itself opens the contract's
                      primary function (stopPropagation below so a click on one
                      of these lines instead opens that specific function). */}
                  {multi ? (
                    <div className="sm:col-span-full mt-2 pt-2 border-t border-slate-100 space-y-1">
                      {rows.map(function (r) {
                        var rVenueName = r.venue_name ? (venueMap[r.venue_name] ? (venueMap[r.venue_name] + ' — ' + r.venue_name) : r.venue_name) : null
                        var rVenueLine = (r.venue_name !== c.venue_name || r.location) ? [rVenueName, r.location].filter(Boolean).join(' · ') : null
                        return (
                          <div key={r.id} role="button" tabIndex={0}
                            onClick={function (ev) { ev.stopPropagation(); setSelected(r); setSelectedAddons(g.addons || null); setSelectedGroupRows(g.rows) }}
                            onKeyDown={function (ev) { if (ev.key === 'Enter') { setSelected(r); setSelectedAddons(g.addons || null); setSelectedGroupRows(g.rows) } }}
                            className="flex items-start justify-between gap-3 px-2.5 py-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                                <span className="font-bold text-slate-800">{r.event_name || '—'}</span>
                                <span className="text-slate-400 tabular-nums">{formatDate(r.function_date)}{r.session ? ' · ' + r.session : ''}</span>
                              </div>
                              {rVenueLine && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{rVenueLine}</p>}
                              {r.department === 'Venue' && (r.total_plates || r.menu_rate_paise != null || r.venue_rental_paise != null || r.decor_amount_paise != null || r.entertainment_amount_paise != null) && (
                                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                                  {!!r.total_plates && <span className="text-slate-500">Pax <b className="text-slate-800 tabular-nums">{r.total_plates}</b></span>}
                                  {r.menu_rate_paise != null && r.menu_rate_paise > 0 && <span className="text-slate-500">Menu <b className="text-slate-800 tabular-nums">{formatPaise(r.menu_rate_paise)}</b></span>}
                                  {r.venue_rental_paise != null && <span className="text-slate-500">Rental <b className="text-slate-800 tabular-nums">{formatPaise(r.venue_rental_paise)}</b></span>}
                                  {r.decor_amount_paise != null && r.decor_amount_paise > 0 && <span className="text-slate-500">Decor <b className="text-slate-800 tabular-nums">{formatPaise(r.decor_amount_paise)}</b></span>}
                                  {r.entertainment_amount_paise != null && r.entertainment_amount_paise > 0 && <span className="text-slate-500">Entertainment <b className="text-slate-800 tabular-nums">{formatPaise(r.entertainment_amount_paise)}</b></span>}
                                </div>
                              )}
                            </div>
                            {(r.tally_entered_by || canMarkEntered) && (
                              <span onClick={function (ev) { ev.stopPropagation() }} className="shrink-0">
                                <EnteredMark
                                  entered={!!r.tally_entered_by}
                                  enteredByName={enteredNames[r.tally_entered_by]}
                                  enteredAt={r.tally_entered_at}
                                  canToggle={canMarkEntered}
                                  canUnenter={r.tally_entered_by === profile.id || isSysAdmin}
                                  busy={enteringId === r.id}
                                  onToggle={function () { toggleContractEntered(r.id) }}
                                />
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    /* LMS already computes these per Venue contract (see migration
                       00094's note) — pax was already synced as total_plates, just
                       never shown as a column; menu rate/venue rental/decor/
                       entertainment are new. Scoped to Venue rows only — the other
                       three departments are their own standalone contracts with
                       nothing to decompose. A full-width strip under the row
                       rather than more grid columns, since it's blank dead space
                       for 3 of every 4 rows otherwise. */
                    c.department === 'Venue' && (c.total_plates || c.menu_rate_paise != null || c.venue_rental_paise != null || c.decor_amount_paise != null || c.entertainment_amount_paise != null) && (
                    <div className="sm:col-span-full mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px]">
                      {!!c.total_plates && (
                        <span className="text-slate-500">Pax <b className="text-slate-800 tabular-nums">{c.total_plates}</b></span>
                      )}
                      {c.menu_rate_paise != null && c.menu_rate_paise > 0 && (
                        <span className="text-slate-500">Menu rate <b className="text-slate-800 tabular-nums">{formatPaise(c.menu_rate_paise)}</b></span>
                      )}
                      {c.venue_rental_paise != null && (
                        <span className="text-slate-500">Venue rental <b className="text-slate-800 tabular-nums">{formatPaise(c.venue_rental_paise)}</b></span>
                      )}
                      {c.decor_amount_paise != null && c.decor_amount_paise > 0 && (
                        <span className="text-slate-500">Decor <b className="text-slate-800 tabular-nums">{formatPaise(c.decor_amount_paise)}</b></span>
                      )}
                      {c.entertainment_amount_paise != null && c.entertainment_amount_paise > 0 && (
                        <span className="text-slate-500">Entertainment <b className="text-slate-800 tabular-nums">{formatPaise(c.entertainment_amount_paise)}</b></span>
                      )}
                    </div>
                    )
                  )}
                </div>
              )
            })}
        </div>
      )}

      {/* Pagination */}
      {!filterId && totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
          {[['«', 1, page === 1, 'First page'], ['‹', page - 1, page === 1, 'Previous page']].map(function (b) {
            return <button key={b[3]} onClick={function () { setPage(b[1]) }} disabled={b[2]} aria-label={b[3]}
              className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-[13px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">{b[0]}</button>
          })}
          {Array.from({ length: totalPages }, function (_, i) { return i + 1 }).filter(function (p) {
            return p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)
          }).map(function (p, i, arr) {
            var showGap = i > 0 && p - arr[i - 1] > 1
            return (
              <span key={p} className="inline-flex items-center gap-1.5">
                {showGap && <span className="px-0.5 text-slate-300">…</span>}
                <button onClick={function () { setPage(p) }} aria-current={p === page ? 'page' : undefined}
                  className={'h-9 min-w-[36px] px-2.5 rounded-lg text-[13px] font-bold tabular-nums transition-colors ' +
                    (p === page ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>{p}</button>
              </span>
            )
          })}
          {[['›', page + 1, page === totalPages, 'Next page'], ['»', totalPages, page === totalPages, 'Last page']].map(function (b) {
            return <button key={b[3]} onClick={function () { setPage(b[1]) }} disabled={b[2]} aria-label={b[3]}
              className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-[13px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">{b[0]}</button>
          })}
          <span className="text-[12px] text-slate-500 ml-2">Page {page} of {totalPages}</span>
        </div>
      )}

      {/* ═══ CONTRACT DETAIL MODAL — every events_safe field ═══ */}
      <Modal open={!!selected} onClose={function () { setSelected(null); setSelectedAddons(null); setSelectedGroupRows(null) }}
        title={selected ? (selected.event_name || '—') : ''} wide>
        {selected && (function () {
          var addonEventIds = selectedAddons
            ? [].concat(selectedAddons.Decor || [], selectedAddons.Entertainment || []).map(function (g) { return g.rows[0].id })
            : []
          var hasAddons = addonEventIds.length > 0

          async function printStatement() {
            if (!liveBalance || printing) return
            setPrinting(true)
            try {
              // [selected.id].concat(addonEventIds) (the old poolIds) only
              // ever covered the ONE function row each of selected/an add-on
              // happened to be opened on -- a multi-function contract (e.g.
              // Lunch+Dinner+Sagan, or Sahiba's own WEDDING/HALDI/SANGEET)
              // has its collections spread across every sibling function's
              // own event id, same gap EventLedger's Transactions tab
              // already closes for its own query (see its own "sameContract"
              // pool) -- confirmed live, two of three real Ambria Ops
              // collections on Sahiba were silently dropped from the print
              // while the Transactions tab showed all three. Queried fresh
              // by contract_no+department here (not off selectedGroupRows,
              // which only ever reflects whatever the current list's own
              // filters happened to have loaded) so it's never short a
              // function the same way the Balance box above isn't.
              async function poolIdsFor(contractNo, department, fallbackId) {
                if (!contractNo) return [fallbackId]
                var res = await supabase.from('events').select('id')
                  .eq('contract_no', contractNo).eq('department', department).is('merged_into_id', null)
                var ids = (res.data || []).map(function (r) { return r.id })
                return ids.length > 0 ? ids : [fallbackId]
              }
              var addonGroupsList = [].concat(selectedAddons ? (selectedAddons.Decor || []) : [], selectedAddons ? (selectedAddons.Entertainment || []) : [])
              var poolIdsNested = await Promise.all(
                [poolIdsFor(selected.contract_no, selected.department, selected.id)]
                  .concat(addonGroupsList.map(function (g) { var a = g.rows[0]; return poolIdsFor(a.contract_no, a.department, a.id) }))
              )
              var poolIds = [].concat.apply([], poolIdsNested)

              function addonPkgTax(dept) {
                var list = (selectedAddons && selectedAddons[dept]) || []
                var pkg = 0, tax = 0
                list.forEach(function (g) {
                  var a = g.rows[0]
                  var pkgFromTotal = a.total_amount_paise > 0
                  var pkgRaw = pkgFromTotal ? a.total_amount_paise : (a.net_amount_paise || 0)
                  pkg += pkgRaw
                  if (pkgFromTotal) tax += Number(a.tax_amount_paise || 0)
                })
                return { pkg: pkg, tax: tax }
              }

              // The print export always reveals the TRUE scale, regardless of
              // the live pkgX2/cashX10 toggles above -- LMS enters the package
              // total at half its real value (see pkgX2's own note) and the
              // app logs collected cash at a hidden ÷10 scale (see
              // fn_extra_plate_collect); this statement exists specifically
              // to show finance the real numbers, not the masked defaults.
              // Re-fetched fresh here rather than trusting the already-loaded
              // liveBalance state -- that only reloads when selected.id/
              // selectedAddons changes (see its own effect above), so a
              // collection made elsewhere while this same modal sat open
              // (or a very recent one the effect just hasn't caught up with
              // yet) wouldn't be reflected in it. A printed statement is
              // meant to be authoritative, so it gets its own up-to-the-
              // moment read instead of risking a stale on-screen snapshot --
              // this is exactly the shape of a reported mismatch (print
              // showed Pending — bank where the Balance box, reopened after,
              // showed Settled: the gap matched a cash collection landing
              // between the two reads almost paisa-for-paisa).
              var addonPrimariesForBalance = [].concat(selectedAddons ? (selectedAddons.Decor || []) : [], selectedAddons ? (selectedAddons.Entertainment || []) : []).map(function (g) { return g.rows[0] })
              var balance = (addonPrimariesForBalance.length > 0
                ? await fetchConsolidatedContractBalance([selected].concat(addonPrimariesForBalance)).then(function (r) { return r && r.total })
                : await fetchContractBalanceSummary(selected.id)) || liveBalance

              var venuePkg = Number(selected.total_amount_paise || 0) * 2
              var venueTax = Number(selected.tax_amount_paise || 0)
              var decor = addonPkgTax('Decor')
              var ent = addonPkgTax('Entertainment')
              var totalDealPaise = venuePkg + venueTax + (decor.pkg * 2) + decor.tax + (ent.pkg * 2) + ent.tax
              var advCashPaise = Number(balance.collected_cash_paise || 0) * 10
              var advBankPaise = Number(balance.collected_bank_paise || 0)
              var pendingCashPaise = Number(balance.pending_cash_paise || 0) * 10
              var pendingBankPaise = Number(balance.pending_bank_paise || 0) + Number(balance.pending_tax_paise || 0)
              var totalCollectedPaise = advCashPaise + advBankPaise
              var surplusPaise = totalCollectedPaise > totalDealPaise ? totalCollectedPaise - totalDealPaise : 0
              var isSettled = pendingCashPaise <= 0 && pendingBankPaise <= 0

              var packageLines = [{
                label: selected.department === 'Venue' ? 'Venue Contract package' : selected.department + ' Contract package',
                pkgPaise: venuePkg, taxPaise: venueTax,
              }]
              if (decor.pkg > 0) packageLines.push({ label: 'Add-on Decor package', pkgPaise: decor.pkg * 2, taxPaise: decor.tax })
              if (ent.pkg > 0) packageLines.push({ label: 'Add-on Entertainment package', pkgPaise: ent.pkg * 2, taxPaise: ent.tax })

              // LMS's own per-department split of this Venue contract's total
              // (Menu rate/Venue rental/Venue+Menu/Decor amount/Entertainment
              // amount) -- the same fields the on-screen detail list already
              // shows further down, none of them subject to the pkgX2 ÷2
              // habit (that's only ever total_amount_paise), so shown as-is.
              var packageBreakdown = [
                ['Menu rate', selected.menu_rate_paise > 0 ? selected.menu_rate_paise : null],
                ['Venue rental', selected.venue_rental_paise != null ? selected.venue_rental_paise : null],
                ['Venue + Menu', selected.venue_menu_paise != null ? selected.venue_menu_paise : null],
                ['Decor amount', selected.decor_amount_paise > 0 ? selected.decor_amount_paise : null],
                ['Entertainment amount', selected.entertainment_amount_paise > 0 ? selected.entertainment_amount_paise : null],
              ].filter(function (r) { return r[1] != null }).map(function (r) { return { label: r[0], amountPaise: r[1] } })

              // Multi-function contract (Lunch+Dinner+Sagan etc. under one
              // contract_no, see groupsMap above) -- selected is only ever
              // one of those function rows, selectedGroupRows carries every
              // sibling. Just [selected] (nothing to list) on a single-
              // function contract. Same shape reused below for a multi-
              // function ADD-ON contract (page 2) -- rows[0] alone would
              // silently show only one of its own functions' date/session,
              // same gap this was just added to close for the primary
              // contract above.
              function rowsToFunctions(rows) {
                return (rows || []).map(function (r) {
                  return {
                    name: r.event_name || '—',
                    date: r.function_date ? formatDate(r.function_date) : '—',
                    session: r.session || '—',
                    venue: [r.venue_name ? (venueMap[r.venue_name] ? (venueMap[r.venue_name] + ' — ' + r.venue_name) : r.venue_name) : null, r.location].filter(Boolean).join(' · ') || '—',
                    pax: (r.department === 'Venue' || r.department === 'Catering') && r.total_plates != null ? r.total_plates : null,
                  }
                })
              }
              var functions = (selectedGroupRows && selectedGroupRows.length > 1) ? rowsToFunctions(selectedGroupRows) : []

              // LMS's own itemized Addons list on this Venue contract (e.g.
              // "L.L. ₹25,000") -- the same addons_json the on-screen detail
              // list already shows, not yet carried into the print.
              var addonItemsList = Array.isArray(selected.addons_json) ? selected.addons_json : []
              var addonItems = addonItemsList.map(function (it) { return { label: it.label, amountPaise: Number(it.amount_paise) || 0 } })
              var addonItemsTotalPaise = addonItems.reduce(function (s, it) { return s + it.amountPaise }, 0)

              var addonContracts = []
              ;['Decor', 'Entertainment'].forEach(function (dept) {
                var list = (selectedAddons && selectedAddons[dept]) || []
                list.forEach(function (g) {
                  var a = g.rows[0]
                  var pkgFromTotal = a.total_amount_paise > 0
                  var pkgRaw = pkgFromTotal ? a.total_amount_paise : (a.net_amount_paise || 0)
                  addonContracts.push({
                    chipLabel: 'Add-on ' + dept,
                    department: dept,
                    contractNo: a.contract_no || '—',
                    functionDate: a.function_date ? formatDate(a.function_date) : '—',
                    session: a.session || '—',
                    pkgPaise: pkgRaw * 2,
                    taxPaise: pkgFromTotal ? Number(a.tax_amount_paise || 0) : 0,
                    // Multi-function add-on (e.g. a Decor contract covering
                    // its own Wedding+Haldi+Sangeet) -- functionDate/session
                    // above are only ever rows[0]'s, same gap just fixed for
                    // the primary contract's own Functions table.
                    functions: g.rows.length > 1 ? rowsToFunctions(g.rows) : null,
                  })
                })
              })
              // Decor/Entertainment are the only real "add-on contract" types
              // this app folds under a Venue contract -- Catering is its own
              // standalone department contract (see ExtraPlateCollect.jsx /
              // StoreRequisitionForm.jsx grouping it with Venue, never as a
              // selectedAddons entry), so it has no "missing" note here.
              var missingAddonDepts = ['Decor', 'Entertainment'].filter(function (dept) {
                return !addonContracts.some(function (a) { return a.department === dept })
              })

              // Collection rows directly reference the event id; a cancelled
              // one is usually just that same row with status flipped
              // (confirmed live) -- the separate 'collection_cancel' reversal
              // leg (a different row, referencing the original row's own id,
              // not an event id) is fetched as a second pass so either
              // cancellation shape still shows up here.
              var collRes = await supabase.from('wallet_transactions')
                .select('id, reference_type, reference_id, payment_mode, amount_paise, status, created_at, performed_by')
                .in('reference_id', poolIds.map(String))
                .eq('reference_type', 'collection')
                .order('created_at', { ascending: true })
              var collRows = collRes.data || []
              var collById = {}
              collRows.forEach(function (w) { collById[String(w.id)] = w })
              var cancelRes = collRows.length > 0
                ? await supabase.from('wallet_transactions')
                    .select('id, reference_type, reference_id, payment_mode, amount_paise, status, created_at, performed_by')
                    .in('reference_id', collRows.map(function (w) { return String(w.id) }))
                    .eq('reference_type', 'collection_cancel')
                : { data: [] }
              var allRows = collRows.concat(cancelRes.data || []).sort(function (a, b) {
                return (a.created_at || '').localeCompare(b.created_at || '')
              })

              var performerIds = [...new Set(allRows.map(function (w) { return w.performed_by }).filter(Boolean))]
              var names = {}
              if (performerIds.length > 0) {
                var nameRes = await supabase.rpc('fn_profile_names', { p_ids: performerIds })
                ;(nameRes.data || []).forEach(function (p) { names[p.id] = p.name })
              }

              // A cancelled original (status flipped on its own row) is void --
              // it never happened, excluded from both In and Out. The
              // separate 'collection_cancel' reversal row is a real,
              // completed transaction in its own right (confirmed live: this
              // contract carries both for the same cancellation) -- money
              // that genuinely moved back out, so it's counted in Out, not
              // folded invisibly into "nothing happened" alongside the
              // original it reverses.
              var transactions = allRows.map(function (w) {
                var isCancelLeg = w.reference_type === 'collection_cancel'
                var original = isCancelLeg ? collById[String(w.reference_id)] : null
                var mode = (original && original.payment_mode) || w.payment_mode
                var voided = !isCancelLeg && w.status === 'cancelled'
                var dt = new Date(w.created_at)
                return {
                  date: formatDate(w.created_at),
                  time: isNaN(dt) ? '' : dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                  type: isCancelLeg ? 'Collection reversal' : 'Collection',
                  mode: mode === 'bank' ? 'Bank' : 'Cash',
                  amountPaise: Math.abs((original && original.amount_paise) || w.amount_paise || 0),
                  handledBy: names[w.performed_by] || null,
                  statusLabel: voided ? 'Cancelled' : (isCancelLeg ? 'Reversed' : 'Completed'),
                  voided: voided,
                  isReversal: isCancelLeg,
                  _sortKey: w.created_at || '',
                }
              })
              // LMS's own payment history (collected outside Ambria Ops'
              // wallet entirely -- same read the Wallet's Collect flow and
              // EventLedger's Transactions tab already use, see
              // fetchContractBalanceSummary/fetchLmsCollected in
              // contractBalance.js) -- without this, the print export only
              // ever showed money collected through this app's own wallet,
              // silently dropping anything collected straight into LMS even
              // though the Balance box above already folds it into Advance
              // received. One contract (Venue) + department can carry its own
              // LMS history; each add-on contract is its own separate
              // contract_no+department, so it's fetched for those too.
              async function fetchLmsRows(contractNo, department) {
                if (!contractNo) return []
                var sessionRes = await supabase.auth.getSession()
                var token = sessionRes.data && sessionRes.data.session ? sessionRes.data.session.access_token : null
                var res = await supabase.functions.invoke('lms-payment-collections', {
                  body: { contract_no: contractNo, department: department || '' },
                  headers: token ? { Authorization: 'Bearer ' + token } : {},
                })
                if (res.error) return []
                return (res.data && res.data.data) || []
              }
              var lmsTargets = [{ contractNo: selected.contract_no, department: selected.department }]
              ;['Decor', 'Entertainment'].forEach(function (dept) {
                ((selectedAddons && selectedAddons[dept]) || []).forEach(function (g) {
                  var a = g.rows[0]
                  if (a.contract_no) lmsTargets.push({ contractNo: a.contract_no, department: dept })
                })
              })
              var lmsRowsNested = await Promise.all(lmsTargets.map(function (t) { return fetchLmsRows(t.contractNo, t.department) }))
              var lmsRows = [].concat.apply([], lmsRowsNested)
              // LMS reports cash at the same hidden ÷10 scale as everywhere
              // else (see lms-payment-collections' own note) -- revealed here
              // the same way advCashPaise is above, so it lines up with the
              // rest of this (always fully revealed) statement; bank is
              // already true scale.
              var lmsTransactions = lmsRows.map(function (p) {
                var isCash = String(p.pay_mode || '').toLowerCase().indexOf('cash') !== -1
                var raw = Number(p.net_amount_paise || 0)
                var voided = String(p.status || '').toLowerCase().indexOf('cancel') !== -1
                var dt = p.date ? new Date(p.date) : null
                return {
                  date: formatDate(p.date),
                  time: '',
                  type: 'LMS Collection',
                  mode: isCash ? 'Cash' : 'Bank',
                  amountPaise: Math.abs(isCash ? raw * 10 : raw),
                  handledBy: p.entry_by || null,
                  statusLabel: voided ? 'Cancelled' : 'Completed',
                  voided: voided,
                  isReversal: false,
                  _sortKey: (dt && !isNaN(dt)) ? dt.toISOString() : '',
                }
              })
              transactions = transactions.concat(lmsTransactions).sort(function (a, b) {
                return (a._sortKey || '').localeCompare(b._sortKey || '')
              })

              // The table's own In/Out/Net, derived from exactly the rows it
              // lists, gross -- a voided original genuinely was collected
              // (it belongs in In) and its reversal genuinely paid that back
              // out (it belongs in Out); excluding the voided row from In
              // instead of letting its own reversal net it back out
              // understated In by the full cancelled amount, same gross/net
              // convention the in-app Transactions tab already uses. voided
              // only controls how a row is styled below, never whether it's
              // counted.
              var txInPaise = 0, txOutPaise = 0
              transactions.forEach(function (t) {
                if (t.isReversal) txOutPaise += t.amountPaise
                else txInPaise += t.amountPaise
              })

              await generateContractStatementPdf({
                contractNo: selected.contract_no,
                printedOn: formatDate(new Date().toISOString()),
                clientName: selected.client_name ? titleCase(selected.client_name) : '—',
                contact: selected.contact_number || '—',
                contractDate: selected.contract_date ? formatDate(selected.contract_date) : '—',
                functionDate: selected.function_date ? formatDate(selected.function_date) : '—',
                department: selected.department || '—',
                session: selected.session || '—',
                venue: selected.venue_name || '—',
                venueType: venueTypeLabel(selected.contract_type),
                location: selected.location || '—',
                address: selected.address || '—',
                totalPlates: (selected.department === 'Venue' || selected.department === 'Catering') ? selected.total_plates : null,
                pax: selected.pax != null ? selected.pax : (selected.total_plates != null && selected.complementary_plates != null ? selected.total_plates - selected.complementary_plates : null),
                extra: selected.complementary_plates,
                functions: functions,
                packageBreakdown: packageBreakdown,
                addonItems: addonItems,
                addonItemsTotalPaise: addonItemsTotalPaise,
                packageLines: packageLines,
                totalDealPaise: totalDealPaise,
                advCashPaise: advCashPaise,
                advBankPaise: advBankPaise,
                pendingCashPaise: pendingCashPaise,
                pendingBankPaise: pendingBankPaise,
                surplusPaise: surplusPaise,
                status: isSettled ? 'Settled' : null,
                addonContracts: addonContracts,
                missingAddonDepts: missingAddonDepts,
                transactions: transactions,
                totals: { inPaise: txInPaise, outPaise: txOutPaise, netPaise: txInPaise - txOutPaise },
              })
            } catch (e) {
              alert('Could not generate the statement: ' + e.message)
            } finally {
              setPrinting(false)
            }
          }

          return (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                {selected.is_tentative && <Badge color="amber">Tentative — no LMS contract yet</Badge>}
                {selected.department && <Badge color="indigo">{selected.department}</Badge>}
                {selected.status && <Badge color="gray">{selected.status}</Badge>}
              </div>
              {isAdmin && liveBalance && (
                <button type="button" disabled={printing}
                  onClick={printStatement}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:cursor-wait transition-colors">
                  <Icon name="download" size={13} />
                  {printing ? 'Preparing…' : 'Print statement'}
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {[
                ['Contract #', selected.contract_no],
                ['LMS Event ID', selected.lms_event_id],
                ['Client', selected.client_name ? titleCase(selected.client_name) : null],
                ['Contact person', selected.contact_person],
                ['Contact number', selected.contact_number],
                ['Secondary contact', selected.secondary_contact],
                ['Contract date', selected.contract_date ? formatDate(selected.contract_date) : null],
                ['Tentative created', selected.is_tentative && selected.tentative_created_at ? formatDate(selected.tentative_created_at) : null],
                ['Function date', selected.function_date ? formatDate(selected.function_date) : null],
                ['Venue type', venueTypeLabel(selected.contract_type)],
                ['Function type', selected.function_type],
                ['Venue', selected.venue_name ? (venueMap[selected.venue_name] ? (venueMap[selected.venue_name] + ' — ' + selected.venue_name) : selected.venue_name) : null],
                ['Location', selected.location],
                ['Address', selected.address],
                ['Session', selected.session],
                ['Catering', selected.catering],
                // Decor/Entertainment contracts carry no plate data at all in
                // LMS (sync-events' dep.pax/freePax/extraPlate are null for
                // both) -- total_plates/complementary_plates land as a bare 0
                // rather than null, so without this department gate every
                // Decor/Entertainment contract would show a false "0 Pax".
                ...(selected.department === 'Venue' || selected.department === 'Catering' ? [
                  ['Total plates', selected.total_plates],
                  // selected.pax is only ever set on a manually-created
                  // tentative contract (no LMS data yet) -- every synced LMS
                  // contract leaves it null, so the paying count is derived
                  // here instead: total_plates already includes the free/extra
                  // quota (see sync-events' mapRow), so subtracting it back out
                  // recovers the base Pax LMS itself shows for the contract.
                  ['Pax', selected.pax != null ? selected.pax : (selected.total_plates != null && selected.complementary_plates != null ? selected.total_plates - selected.complementary_plates : null)],
                  ['Extra', selected.complementary_plates],
                ] : []),
                // extra_plates_charge is LMS's per-plate RATE -- complementary_
                // plates ("Extra" above) is a free-pax allowance baked into the
                // package, not a count of plates actually served/charged past
                // it, so multiplying the two together (as this used to do) can
                // produce a real-looking total even when the Extra Plate
                // Collect system (ExtraPlateCollect.jsx) shows no charge was
                // ever made for this event -- confirmed live, contract #00568:
                // rate 1,000 × 25 "free" pax showed a phantom ₹25,000 charge
                // with zero actual Extra Plate Collect transactions behind it.
                // Just the rate, for reference -- the real charged amount (if
                // any) lives in extra_plate_collections, not here.
                ['Extra Plate Rate', selected.extra_plates_charge > 0 ? formatPaise(selected.extra_plates_charge) : null],
                ['Menu rate', selected.menu_rate_paise > 0 ? formatPaise(selected.menu_rate_paise) : null],
                ['Venue rental', selected.venue_rental_paise != null ? formatPaise(selected.venue_rental_paise) : null],
                ['Venue + Menu', selected.venue_menu_paise != null ? formatPaise(selected.venue_menu_paise) : null],
                ['Decor amount', selected.decor_amount_paise > 0 ? formatPaise(selected.decor_amount_paise) : null],
                ['Entertainment amount', selected.entertainment_amount_paise > 0 ? formatPaise(selected.entertainment_amount_paise) : null],
                ['Enquiry mode', selected.enquiry_mode],
                ['Priority', selected.priority],
                ['Created by (LMS)', selected.created_user_name],
                ['Last synced', selected.synced_at ? formatDate(selected.synced_at) : null],
              ].filter(function (row) { return row[1] != null && row[1] !== '' }).map(function (row) {
                return (
                  <div key={row[0]} className="flex justify-between gap-3">
                    <span className="text-gray-500 flex-shrink-0">{row[0]}</span>
                    <span className="font-medium text-gray-800 text-right">{row[1]}</span>
                  </div>
                )
              })}
            </div>

            {/* LMS's own itemized Addons list on this Venue contract (e.g.
                "L.L. ₹25,000") — distinct from Decor amount/Entertainment
                amount above, which are each their own lumpsum split field,
                not an itemized list. */}
            {Array.isArray(selected.addons_json) && selected.addons_json.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">Add-ons</p>
                <div className="space-y-1">
                  {selected.addons_json.map(function (it, i) {
                    return (
                      <div key={i} className="flex justify-between gap-3 text-xs">
                        <span className="text-gray-600">{it.label}</span>
                        <span className="font-semibold text-gray-800">{formatPaise(it.amount_paise)}</span>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between gap-3 mt-1.5 pt-1.5 border-t border-gray-100 text-xs font-bold">
                  <span className="text-indigo-700">Total add-ons</span>
                  <span className="text-indigo-700">
                    {formatPaise(selected.addons_json.reduce(function (s, it) { return s + (Number(it.amount_paise) || 0) }, 0))}
                  </span>
                </div>
              </div>
            )}

            {(selected.tally_entered_by || canMarkEntered) && (
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-xs font-semibold text-gray-500">Entered in Tally</span>
                <EnteredMark
                  entered={!!selected.tally_entered_by}
                  enteredByName={enteredNames[selected.tally_entered_by]}
                  enteredAt={selected.tally_entered_at}
                  canToggle={canMarkEntered}
                  canUnenter={selected.tally_entered_by === profile.id || isSysAdmin}
                  busy={enteringId === selected.id}
                  onToggle={function () { toggleContractEntered(selected.id) }}
                />
              </div>
            )}

            {(selected.pdf_link || selected.ppt_link) && (
              <div className="flex gap-3">
                {selected.pdf_link && (
                  <a href={selected.pdf_link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                    {selected.department === 'Catering' ? 'View menu PDF' : 'View contract PDF'} ↗
                  </a>
                )}
                {selected.ppt_link && <a href={selected.ppt_link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">View PPT ↗</a>}
              </div>
            )}

            {/* Add-on Decor / Add-on Ent — the matched standalone Decor and/or
                Entertainment contract(s) for this same guest+venue (see the
                consolidation pass above), folded in here rather than shown as
                their own separate top-level rows. Package is read from each
                contract's OWN total — independently of this Venue contract's
                own Decor amount/Entertainment amount fields above, which are
                a different, earlier-set split field on this contract, not a
                mirror of the standalone one. They should normally agree (same
                real booking); showing both lets a mismatch actually surface
                instead of silently overwriting one with the other. Placed
                before the Balance box so the add-on contracts themselves are
                visible before the pooled numbers that fold them in. */}
            {hasAddons && ['Decor', 'Entertainment'].map(function (dept) {
              return (selectedAddons[dept] || []).map(function (g) {
                var a = g.rows[0]
                // total_amount_paise is the "Total Deal Amount" LMS itself
                // shows for this contract -- preferred whenever it's set.
                // net_amount_paise is only a fallback for the rare contract
                // where total_amount_paise is genuinely 0 (no Deal Amount
                // entered at all); it's LMS's own cash+bank+tax composite,
                // already mixing a hidden-scale cash figure with full-scale
                // ones, so it isn't eligible for the ×2 reveal below.
                var pkgFromTotal = a.total_amount_paise > 0
                var pkgRaw = pkgFromTotal ? a.total_amount_paise : a.net_amount_paise
                var pkg = pkgFromTotal && pkgX2 ? pkgRaw * 2 : pkgRaw
                return (
                  <div key={dept + a.id} className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 border-b border-slate-200">
                      <span className="inline-flex items-center gap-2">
                        <Badge color={dept === 'Decor' ? 'purple' : 'pink'}>Add-on &middot; {dept === 'Entertainment' ? 'Ent' : dept}</Badge>
                        <span className="font-mono text-xs text-slate-600">#{a.contract_no}</span>
                      </span>
                      <span className="inline-flex items-center gap-2">
                        {(a.tally_entered_by || canMarkEntered) && (
                          <EnteredMark
                            entered={!!a.tally_entered_by}
                            enteredByName={enteredNames[a.tally_entered_by]}
                            enteredAt={a.tally_entered_at}
                            canToggle={canMarkEntered}
                            canUnenter={a.tally_entered_by === profile.id || isSysAdmin}
                            busy={enteringId === a.id}
                            onToggle={function () { toggleContractEntered(a.id) }}
                          />
                        )}
                        {/* Only a manual link (fn_link_addon_contract) is ever
                            reversible here -- an automatic guest+venue+date
                            match has no row to clear, it just stops matching
                            the moment one of those fields changes. */}
                        {canLinkAddon && a.manual_addon_contract_no === selected.contract_no && a.manual_addon_department === selected.department && (
                          <button type="button" disabled={unlinkingAddon}
                            onClick={function () { unlinkAddon(a.id) }}
                            className="text-[11px] font-semibold text-slate-400 hover:text-red-600 disabled:opacity-50 transition-colors">
                            Unlink
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="px-3 py-2.5 space-y-1">
                      {[
                        ['Contract date', a.contract_date ? formatDate(a.contract_date) : null],
                        ['Function date', a.function_date ? formatDate(a.function_date) : null],
                        ['Session', a.session],
                        ['Venue type', venueTypeLabel(a.contract_type)],
                        ['Priority', a.priority],
                        ['Created by (LMS)', a.created_user_name],
                        [pkgFromTotal ? (
                          <>Package<button type="button"
                            title={pkgX2 ? 'Showing true package amount — click to hide' : 'Show true package amount'}
                            onClick={function (e) { e.stopPropagation(); setPkgX2(function (v) { return !v }) }}
                            className={'ml-1.5 inline-block w-2 h-2 align-middle rounded-full transition-colors ' + (pkgX2 ? 'bg-amber-400' : 'bg-slate-200 opacity-25 hover:opacity-50')} /></>
                        // pkg itself can be a real, deliberate 0 (a contract
                        // genuinely written up with no package value) -- only
                        // hide the row when there's no figure at all to show.
                        ) : 'Package', pkg != null ? formatPaise(pkg) : null],
                      ].filter(function (row) { return row[1] != null && row[1] !== '' }).map(function (row, ri) {
                        return (
                          <div key={ri} className="flex justify-between gap-3 text-xs">
                            <span className="text-gray-500">{row[0]}</span>
                            <span className="font-medium text-gray-800 text-right">{row[1]}</span>
                          </div>
                        )
                      })}
                      {isAdmin && (
                        <div className="flex justify-between gap-3 text-xs pt-1 border-t border-gray-100">
                          <span className="text-gray-500">Balance</span>
                          {a.balance_amount != null ? (
                            a.balance_amount === 0 ? (
                              <span className="font-bold text-emerald-600">{formatPaise(0)} <span className="font-semibold opacity-80">settled</span></span>
                            ) : (
                              <span className={'font-bold ' + (a.balance_amount < 0 ? 'text-red-600' : 'text-emerald-600')}>
                                {formatPaise(Math.abs(a.balance_amount))} <span className="font-semibold opacity-80">{a.balance_amount < 0 ? 'due' : 'adv'}</span>
                              </span>
                            )
                          ) : <span className="text-gray-300">—</span>}
                        </div>
                      )}
                      {a.pdf_link && (
                        <div className="pt-1">
                          <a href={a.pdf_link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">View contract PDF ↗</a>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            })}

            {/* The real, reconciled balance — every function under this
                contract pooled together and LMS's own payment history
                folded in, the same numbers "Show financials" shows in full
                below — not events.balance_received/balance_bank/balance_amount,
                which are only ever whatever LMS last synced onto this one
                row and go stale the moment a resync replaces it or someone
                collects straight into LMS. */}
            {isAdmin && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Balance</p>
                  {liveBalance && Number(liveBalance.pending_cash_paise || 0) <= 0 &&
                    (Number(liveBalance.pending_bank_paise || 0) + Number(liveBalance.pending_tax_paise || 0)) <= 0 && (
                    <span className="inline-flex items-center text-[10.5px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-wide">Settled</span>
                  )}
                </div>
                {liveBalanceLoading || !liveBalance ? (
                  <p className="text-xs text-gray-400">{liveBalanceLoading ? 'Loading…' : 'Not available'}</p>
                ) : (function () {
                  // Same package figure as each Add-on card's own (total_amount_paise,
                  // falling back to net_amount_paise only when total is genuinely 0 --
                  // see the Add-on card above for why), summed across however many
                  // Decor/Entertainment add-ons matched this Venue contract. pkgX2
                  // shared with the Add-on cards' own reveal toggle so the two stay
                  // in sync rather than needing a second click to line up.
                  // tax only folded in when the package itself came from
                  // total_amount_paise -- net_amount_paise is already LMS's
                  // own cash+bank+tax composite (see the Add-on card above),
                  // so adding tax_amount_paise on top of that would double it.
                  function addonPkgTax(dept) {
                    var list = (selectedAddons && selectedAddons[dept]) || []
                    var pkg = 0, tax = 0
                    list.forEach(function (g) {
                      var a = g.rows[0]
                      var pkgFromTotal = a.total_amount_paise > 0
                      var pkgRaw = pkgFromTotal ? a.total_amount_paise : (a.net_amount_paise || 0)
                      pkg += pkgFromTotal && pkgX2 ? pkgRaw * 2 : pkgRaw
                      if (pkgFromTotal) tax += Number(a.tax_amount_paise || 0)
                    })
                    return { pkg: pkg, tax: tax }
                  }
                  var venuePkg = Number(selected.total_amount_paise || 0)
                  var venueTax = Number(selected.tax_amount_paise || 0)
                  var decor = addonPkgTax('Decor')
                  var ent = addonPkgTax('Entertainment')
                  var hasDecorAddon = ((selectedAddons && selectedAddons.Decor) || []).length > 0
                  var hasEntAddon = ((selectedAddons && selectedAddons.Entertainment) || []).length > 0
                  var pendingCash = Number(liveBalance.pending_cash_paise || 0)
                  // Tax is an agreed-bank item, not its own collection channel
                  // -- clubbed into Pending bank here rather than shown as a
                  // separate Pending tax line (effective agreed bank = agreed
                  // bank + agreed tax, per the user's own framing).
                  var pendingBank = Number(liveBalance.pending_bank_paise || 0) + Number(liveBalance.pending_tax_paise || 0)
                  // What finance actually means by "the LMS package" is this
                  // package+tax total, not LMS's own agreed_cash/agreed_bank
                  // fields that pending_cash/bank_paise above are settled
                  // against -- those can quietly drift from the package (an
                  // LMS-side edit to one and not the other), so a real contract
                  // was seen fully "Settled" against agreed_cash/bank while
                  // still having collected far more than this package total.
                  // Surplus can't be read off venuePkg/decor.pkg/ent.pkg and
                  // collected_cash_paise directly -- those mix whatever scale
                  // each line happens to be shown at (venuePkg masked ÷2,
                  // decor/ent only ×2'd when the
                  // pkgX2 toggle is on, collected_cash_paise always masked ÷10),
                  // so subtracting them produced a number that was neither the
                  // masked nor the true surplus -- confirmed live, it didn't
                  // match the real figure once cash and package happened to be
                  // masked by two different factors. Surplus is always computed
                  // fully revealed instead, independent of what the lines above
                  // it are showing.
                  var decorTrue = (function () {
                    var list = (selectedAddons && selectedAddons.Decor) || []
                    var pkg = 0, tax = 0
                    list.forEach(function (g) {
                      var a = g.rows[0]
                      var pkgFromTotal = a.total_amount_paise > 0
                      pkg += (pkgFromTotal ? a.total_amount_paise : (a.net_amount_paise || 0)) * 2
                      if (pkgFromTotal) tax += Number(a.tax_amount_paise || 0)
                    })
                    return { pkg: pkg, tax: tax }
                  })()
                  var entTrue = (function () {
                    var list = (selectedAddons && selectedAddons.Entertainment) || []
                    var pkg = 0, tax = 0
                    list.forEach(function (g) {
                      var a = g.rows[0]
                      var pkgFromTotal = a.total_amount_paise > 0
                      pkg += (pkgFromTotal ? a.total_amount_paise : (a.net_amount_paise || 0)) * 2
                      if (pkgFromTotal) tax += Number(a.tax_amount_paise || 0)
                    })
                    return { pkg: pkg, tax: tax }
                  })()
                  var trueTotalDealPaise = (venuePkg * 2) + venueTax + decorTrue.pkg + decorTrue.tax + entTrue.pkg + entTrue.tax
                  var trueTotalCollectedPaise = Number(liveBalance.collected_cash_paise || 0) * 10 + Number(liveBalance.collected_bank_paise || 0)
                  var surplusVsPackage = trueTotalCollectedPaise > trueTotalDealPaise ? trueTotalCollectedPaise - trueTotalDealPaise : 0
                  function pkgCell(pkg, tax) {
                    if (tax > 0) {
                      return (
                        <span className="font-medium text-gray-800 text-right">
                          {formatPaise(pkg)} <span className="text-gray-400 font-normal">+</span> {formatPaise(tax)}<span className="text-gray-400 font-normal text-[11px]"> tax</span> <span className="text-gray-400 font-normal">=</span> <span className="font-bold text-gray-900">{formatPaise(pkg + tax)}</span>
                        </span>
                      )
                    }
                    return <span className="font-medium text-gray-800">{formatPaise(pkg)}</span>
                  }
                  return (
                    <>
                      {/* "Venue Contract package" by name only when this really
                          is one — hasDecorAddon/hasEntAddon can only be true on
                          a Venue contract (see the consolidation pass above),
                          but this same box also renders for a standalone
                          Decor/Entertainment/Catering contract opened directly,
                          where that label would be wrong. */}
                      <div className="flex justify-between"><span className="text-gray-500">{selected.department === 'Venue' ? 'Venue Contract package' : selected.department + ' Contract package'}</span>{pkgCell(venuePkg, venueTax)}</div>
                      {hasDecorAddon && (
                        <div className="flex justify-between"><span className="text-gray-500">Add-on Decor package</span>{pkgCell(decor.pkg, decor.tax)}</div>
                      )}
                      {hasEntAddon && (
                        <div className="flex justify-between"><span className="text-gray-500">Add-on Entertainment package</span>{pkgCell(ent.pkg, ent.tax)}</div>
                      )}
                      {(hasDecorAddon || hasEntAddon) && (
                        <div className="flex justify-between pt-1 border-t border-gray-200">
                          <span className="text-gray-700 font-semibold">Total Deal</span>
                          <span className="font-bold text-gray-900">{formatPaise(venuePkg + venueTax + decor.pkg + decor.tax + ent.pkg + ent.tax)}</span>
                        </div>
                      )}
                      <div className="flex justify-between pt-1 border-t border-gray-200"><span className="text-gray-500">Advance received — cash</span><span className="font-medium text-gray-800">{formatPaise(liveBalance.collected_cash_paise)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Advance received — bank</span><span className="font-medium text-gray-800">{formatPaise(liveBalance.collected_bank_paise)}</span></div>
                      {extraPlateCollected && (extraPlateCollected.cash > 0 || extraPlateCollected.bank > 0) && (
                        <div className="flex justify-between gap-3 text-[11px] text-gray-400">
                          <span>↳ incl. Extra plates collected</span>
                          <span className="text-right">
                            {[
                              extraPlateCollected.cash > 0 ? formatPaise(extraPlateCollected.cash) + ' cash' : null,
                              extraPlateCollected.bank > 0 ? formatPaise(extraPlateCollected.bank) + ' bank' : null,
                            ].filter(Boolean).join(' + ')}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between pt-1 border-t border-gray-200">
                        <span className="text-gray-500">Pending — cash</span>
                        <span className={"font-bold " + (pendingCash > 0 ? "text-red-600" : "text-green-600")}>{formatPaise(pendingCash > 0 ? pendingCash : 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Pending — bank</span>
                        <span className={"font-bold " + (pendingBank > 0 ? "text-red-600" : "text-green-600")}>{formatPaise(pendingBank > 0 ? pendingBank : 0)}</span>
                      </div>
                      {/* Real cash+bank collected beyond this package's own
                          total -- not folded into "Pending — cash" as a green
                          number (that line settles against LMS's separate
                          agreed_cash/agreed_bank fields, which can drift from
                          the package shown above), so finance notices and goes
                          back to correct the LMS contract. */}
                      {surplusVsPackage > 0 && (
                        <div className="flex justify-between pt-1 border-t border-amber-200">
                          <span className="text-amber-700 font-semibold">Surplus (over LMS total)</span>
                          <span className="font-bold text-amber-700">{formatPaise(surplusVsPackage)}</span>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            {/* Showing up here at all means this Decor/Entertainment contract
                isn't currently folded under any Venue contract as an add-on
                (one that is never gets its own card in the list -- see the
                grouping pass above) -- either nothing matched, or a manual
                link points at a Venue contract that isn't in view right now
                (e.g. aged past the list's date floor). */}
            {canLinkAddon && (selected.department === 'Decor' || selected.department === 'Entertainment') && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-2">
                {selected.manual_addon_contract_no ? (
                  <>
                    <p className="text-xs text-indigo-700">
                      Manually linked to {selected.manual_addon_department || 'Venue'} contract #{selected.manual_addon_contract_no} — not showing here because that contract isn't in the current list (check its own date range/filters).
                    </p>
                    <button type="button" disabled={unlinkingAddon}
                      onClick={function () { unlinkAddon(selected.id) }}
                      className="w-full py-2 text-sm font-semibold text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                      {unlinkingAddon ? 'Unlinking…' : 'Unlink'}
                    </button>
                  </>
                ) : (
                  <>
                    <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Link to a Venue contract</h4>
                    <p className="text-xs text-indigo-600">For when this is really the same guest's Venue booking, just not auto-matched (a different name spelling, no overlapping date, etc.) — search for it and link, no history moves, and the two Balance boxes fold into one.</p>
                    <input type="text" value={linkSearch}
                      onChange={function (e) { searchLinkTargets(e.target.value) }}
                      placeholder="Search guest name..."
                      className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    {linkSearching && <p className="text-xs text-indigo-400">Searching...</p>}
                    {!linkSearching && linkResults.length > 0 && (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {linkResults.map(function (r) {
                          var picked = linkTargetId === r.id
                          return (
                            <div key={r.id} role="button" tabIndex={0}
                              onClick={function () { setLinkTargetId(r.id) }}
                              onKeyDown={function (e) { if (e.key === 'Enter') setLinkTargetId(r.id) }}
                              className={"px-3 py-2 rounded-lg border cursor-pointer text-sm " +
                                (picked ? "border-indigo-600 bg-indigo-100" : "border-gray-200 bg-white hover:border-gray-300")}>
                              <div className="font-medium text-gray-900">{r.event_name}{r.client_name ? ' — ' + r.client_name : ''}</div>
                              <div className="text-xs text-gray-500">{r.venue_name || ''}{r.function_date ? ' · ' + formatDate(r.function_date) : ''}{r.contract_no ? ' · #' + r.contract_no : ''}</div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {!linkSearching && linkSearch.trim().length >= 2 && linkResults.length === 0 && (
                      <p className="text-xs text-gray-400">No matching Venue contracts found.</p>
                    )}
                    <button type="button" onClick={submitLinkAddon} disabled={!linkTargetId || linking}
                      className="w-full py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {linking ? 'Linking...' : 'Link as add-on'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* One disclosure, one list: past collections (whatever LMS has
                on record, collected outside Ambria Ops entirely) sit right
                above the new ones (collected through this app's own wallet,
                deduped across any LMS resync duplicates — see
                EventLedger._buildContractGroup) instead of behind two
                separate toggles a reader had to find and open one at a time. */}
            {isAdmin && (
              <div>
                <button type="button"
                  onClick={function () { setShowFinancials(!showFinancials) }}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  {showFinancials ? '− Hide financials' : '+ Show financials'}
                </button>
                {showFinancials && (
                  <div className="mt-3">
                    {/* EventLedger's own Transactions tab now folds in LMS's
                        payment history alongside Ambria Ops' own wallet
                        collections — one list, one place, markable the same
                        way — so there's nothing left to render here. */}
                    <EventLedger profile={profile} eventId={selected.id} extraEventIds={addonEventIds} />
                  </div>
                )}
              </div>
            )}

          </div>
          )
        })()}
      </Modal>
    </div>
  )
}

export default ContractList
