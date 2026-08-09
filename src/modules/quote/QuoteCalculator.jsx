import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import EventDatePicker from '../../components/ui/EventDatePicker'

/* ═══════════════════════════════════════════════════════
   AMBRIA QUOTE CALCULATOR — Server-Side Pricing
   
   All rate cards in quote_config table.
   calculate_quote RPC returns computed values.
   Client = pure input form + display layer.
   ═══════════════════════════════════════════════════════ */

// ── Non-sensitive UI labels ──
var VENUE_NAMES = [
  ['Ambria Pushpanjali', 'NH8', 'live'],
  ['Emerald Green', 'Manaktala', 'live'],
  ['Alstonia', 'Manaktala', 'placeholder'],
  ['The Aura', 'Dwarka Exp', 'live'],
  ['Valencia', 'Dwarka Exp', 'live'],
  ['Pool Side', 'Dwarka Exp', 'placeholder'],
]
var MENU_LABELS = ['Magnum', 'Double Magnum', 'Multi Cuisine', 'Luxury']
var DECOR_LABELS = ['Premium', 'Standard', 'Banquet']
var DJ_LABELS = ['Std DJ - No LED', 'DJ + LED']
var SLOTS = ['Dinner', 'Sundowner', 'Lunch']
var CAT_LABELS = ["King's Date", 'Perfect Comp', 'Filler']
var CAT_COLORS = ['#D4872C', '#8B2D2D', '#6B5B4E']
var CAT_BG = ['#FFF8F0', '#FDF2F2', '#F7F5F3']
var FALLBACK_MODES = ['Walk-in', 'Phone', 'WhatsApp']
var FALLBACK_ET = [
  { label: 'Wedding', icon: '💍', wedding: true },
  { label: 'Reception', icon: '🥂', wedding: false },
]

// venueIdx → LMS venue ID (null = placeholder, no LMS push)
var LMS_VENUE_IDS = [3, 6, 6, 19, 19, null]

// ── Date classification (non-financial, stays client-side) ──
var MONTHS = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',')
function classifyDate(val, seasonDates) {
  if (!val) return -1
  var d = new Date(val + 'T00:00:00')
  if (isNaN(d)) return -1
  var mm = d.getMonth(), dd = d.getDate()
  var key = (mm + 1 < 10 ? '0' : '') + (mm + 1) + '-' + (dd < 10 ? '0' : '') + dd
  if (seasonDates && seasonDates[key] != null) return seasonDates[key]
  return 2
}
function autoTtdIdx(eventDateStr) {
  if (!eventDateStr) return 0
  var now = new Date()
  var ev = new Date(eventDateStr + 'T00:00:00')
  if (isNaN(ev)) return 0
  var months = (ev.getFullYear() - now.getFullYear()) * 12 + ev.getMonth() - now.getMonth()
  if (ev.getDate() < now.getDate()) months--
  if (months >= 5) return 0
  if (months >= 4) return 1
  if (months >= 3) return 2
  return 3
}

function fmtDate(val) {
  if (!val) return ''
  var d = new Date(val + 'T00:00:00')
  return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
}

// ── Formatting ──
function fmtL(n) { return '\u20B9' + (n % 1 === 0 ? n : n.toFixed(2)) + 'L' }
function fmtRound(n) { return '\u20B9' + (Math.ceil(n * 2) / 2) + 'L' }
function fmtK(n) { return n >= 1 ? '\u20B9' + n + 'L' : '\u20B9' + Math.round(n * 100) + 'K' }
function fmtINR(n) { return '\u20B9' + Math.round(n * 100000).toLocaleString('en-IN') }
function rd(n) { return Math.round(n * 100) / 100 }

// ── Brand colors ──
var C = {
  maroon: '#4A1111', maroon2: '#8B2D2D', gold: '#D4872C',
  cream: '#F5E6D3', border: '#E8DDD0', muted: '#8B7355', bg: '#FAF7F5',
}

// ═══ COMPONENT ═══

// ═══ SUB-COMPONENTS (outside main — stable references) ═══

function SlotButton({ label, on, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: 10, borderRadius: 9, border: '2px solid ' + (on ? C.maroon2 : C.border),
      background: on ? 'linear-gradient(135deg,#4A1111,#8B2D2D)' : '#fff',
      color: on ? '#fff' : C.muted, fontSize: 13, fontWeight: 700, textAlign: 'center', cursor: 'pointer',
    }}>{label}</button>
  )
}

function RateRow({ q, t, f, showAll }) {
  var arr = [{ val: q, label: 'QUOTE', color: C.maroon, bg: C.cream }]
  if (showAll) {
    arr.push({ val: t, label: 'TARGET', color: '#0369A1', bg: '#E0F2FE' })
    arr.push({ val: f, label: 'FLOOR', color: '#991B1B', bg: '#FEE2E2' })
  }
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 10, gridTemplateColumns: showAll ? '1fr 1fr 1fr' : '1fr' }}>
      {arr.map(function (x) {
        return (
          <div key={x.label} style={{ background: x.bg, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: x.color, fontWeight: 700, marginBottom: 4 }}>{x.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: x.color }}>{x.val}</div>
          </div>
        )
      })}
    </div>
  )
}

function SectionCard({ title, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 18, marginBottom: 12, border: '1px solid ' + C.border }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.maroon2, textTransform: 'uppercase', letterSpacing: 1.5, paddingBottom: 8, borderBottom: '2px solid ' + C.cream, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

function CatPills({ items, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
      {items.map(function (label, idx) {
        var on = value === idx
        return (
          <button key={idx} onClick={function () { onChange(idx) }} style={{
            padding: '7px 12px', borderRadius: 9, border: '2px solid ' + (on ? C.maroon2 : C.border),
            background: on ? C.cream : '#fff', color: on ? C.maroon : C.muted,
            fontSize: 12, fontWeight: on ? 700 : 600, cursor: 'pointer',
          }}>{label}</button>
        )
      })}
    </div>
  )
}

function Toggle({ on, onToggle }) {
  return (
    <div onClick={onToggle} style={{
      width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
      background: on ? 'linear-gradient(135deg,#4A1111,#8B2D2D)' : '#D1D5DB',
      padding: 2, transition: 'background .2s',
    }}>
      <div style={{
        width: 16, height: 16, borderRadius: 8, background: '#fff',
        transform: on ? 'translateX(16px)' : 'translateX(0)',
        transition: 'transform .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </div>
  )
}

function StatusBar({ quoteStatus, onUpdate }) {
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.4, marginBottom: 6 }}>Status</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { key: 'draft', label: 'Draft', color: '#9CA3AF' },
          { key: 'sent', label: 'Sent', color: '#60A5FA' },
        ].map(function (st) {
          var isOn = quoteStatus === st.key
          return (
            <button key={st.key} onClick={function () { onUpdate(st.key) }} style={{
              padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700,
              border: '2px solid ' + (isOn ? st.color : 'rgba(255,255,255,.1)'),
              background: isOn ? st.color + '22' : 'transparent',
              color: isOn ? st.color : 'rgba(255,255,255,.35)', cursor: 'pointer',
            }}>{st.label}</button>
          )
        })}
      </div>
    </div>
  )
}

// ═══ COMPONENT ═══

function QuoteCalculator({ profile }) {
  var isAdmin = profile.role === 'admin' || profile.role === 'auditor'

  var [page, setPage] = useState(0)
  var [guestName, setGuestName] = useState('')
  var [guestPhone, setGuestPhone] = useState('')
  var [guestAddress, setGuestAddress] = useState('')
  var [eventDate, setEventDate] = useState('')
  var [inquiryMode, setInquiryMode] = useState('')
  var [priority, setPriority] = useState('')
  var [etSearch, setEtSearch] = useState('')
  var [eventTypeIdx, setEventTypeIdx] = useState(0)
  var [venueId, setVenueId] = useState('')
  var [parentId, setParentId] = useState('')
  var [foodPref, setFoodPref] = useState(0)
  var [pax, setPax] = useState(400)
  var [slot, setSlot] = useState(0)
  var [catOverride, setCatOverride] = useState(2)
  var [menuIdx, setMenuIdx] = useState(3)
  var [decorIdx, setDecorIdx] = useState(0)
  var [djIdx, setDjIdx] = useState(1)
  var [ttdIdx, setTtdIdx] = useState(0)
  var [showProposal, setShowProposal] = useState(false)
  var [dealVm, setDealVm] = useState('')
  var [dealDecor, setDealDecor] = useState('')
  var [dealEnt, setDealEnt] = useState('')
  var [analysis, setAnalysis] = useState(null)
  var [analyzing, setAnalyzing] = useState(false)
  var [showAnalysis, setShowAnalysis] = useState(false)

  // Tax calc (pure GST math, stays client-side)
  var [dealVal, setDealVal] = useState(14)
  var [taxMode, setTaxMode] = useState(0)
  var [split5, setSplit5] = useState(50)

  // LMS push
  var [lmsRef, setLmsRef] = useState(null)
  var [pushing, setPushing] = useState(false)
  var [showLmsPush, setShowLmsPush] = useState(false)

  // Persistence
  var [savedId, setSavedId] = useState(null)
  var [quotes, setQuotes] = useState([])
  var [showQuotes, setShowQuotes] = useState(false)
  var [saving, setSaving] = useState(false)
  var [loadingQuotes, setLoadingQuotes] = useState(false)
  var [saveMsg, setSaveMsg] = useState('')
  var [quoteStatus, setQuoteStatus] = useState('draft')
  var [seasonDates, setSeasonDates] = useState(null)
  var [notes, setNotes] = useState('')
  var [includeMenu, setIncludeMenu] = useState(true)
  var [includeDecor, setIncludeDecor] = useState(true)
  var [includeDj, setIncludeDj] = useState(true)

  // Location (LMS hall/lawn)
  var [locationId, setLocationId] = useState('')
  var [locationName, setLocationName] = useState('')
  var [lmsLocations, setLmsLocations] = useState(null)

  // DB-driven lists
  var [inquiryModes, setInquiryModes] = useState(FALLBACK_MODES)
  var [eventTypes, setEventTypes] = useState(FALLBACK_ET)
  var [venueList, setVenueList] = useState(null)

  useEffect(function () {
    var CACHE_KEY = 'qc_config_v1'
    var TTL = 600000
    function apply(rows) {
      rows.forEach(function (row) {
        if (row.key === 'inquiry_modes' && Array.isArray(row.value)) setInquiryModes(row.value)
        if (row.key === 'event_types' && Array.isArray(row.value)) setEventTypes(row.value)
        if (row.key === 'season_dates' && row.value) setSeasonDates(row.value)
        if (row.key === 'venues' && Array.isArray(row.value)) setVenueList(row.value)
        if (row.key === 'lms_locations' && row.value) setLmsLocations(row.value)
      })
    }
    var fresh = false
    try {
      var raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        var c = JSON.parse(raw)
        if (c && c.data) { apply(c.data); fresh = Date.now() - c.t < TTL }
      }
    } catch (e) {}
    if (fresh) return
    supabase.from('quote_config').select('key, value').in('key', ['inquiry_modes', 'event_types', 'season_dates', 'venues', 'lms_locations']).then(function (res) {
      if (!res.data) return
      apply(res.data)
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data: res.data })) } catch (e) {}
    })
  }, [])

  // Server calc
  var [calcResult, setCalcResult] = useState(null)
  var [calcLoading, setCalcLoading] = useState(false)
  var debounceRef = useRef(null)
  var firstCall = useRef(true)
  var calcSeq = useRef(0)

  // Venues — build parents + flat leaves side-by-side
  var venues = []
  var parents = []
  ;(venueList || []).forEach(function (p) {
    var hasSubs = Array.isArray(p.sub_venues) && p.sub_venues.length > 0
    var liveSubs = hasSubs ? p.sub_venues.filter(function (s) { return s.status !== 'placeholder' }) : []
    parents.push({
      id: p.id, name: p.name, location: p.location, status: p.status,
      lms_venue_id: p.lms_venue_id, has_subs: hasSubs, live_subs: liveSubs
    })
    if (hasSubs) {
      p.sub_venues.forEach(function (s) {
        venues.push({
          id: s.id, name: s.name, location: p.location, status: s.status,
          parent_id: p.id, parent_name: p.name, lms_venue_id: p.lms_venue_id,
          decor_mode: s.decor_mode
        })
      })
    } else {
      venues.push({
        id: p.id, name: p.name, location: p.location, status: p.status,
        parent_id: p.id, parent_name: p.name, lms_venue_id: p.lms_venue_id,
        decor_mode: p.decor_mode
      })
    }
  })
  var currentParent = null
  for (var _pi = 0; _pi < parents.length; _pi++) { if (parents[_pi].id === parentId) { currentParent = parents[_pi]; break } }

  // Derived
  var currentET = eventTypes[eventTypeIdx] || eventTypes[0] || { label: 'Wedding', wedding: true }
  var isWedding = currentET.wedding
  var dc = classifyDate(eventDate, seasonDates)
  var ct = catOverride

  // ── RPC call ──
  async function fetchCalc() {
    if (!venueId) return
    var seq = ++calcSeq.current
    setCalcLoading(true)
    var { data, error } = await supabase.rpc('calculate_quote', {
      p_venue_id: venueId,
      p_pax: pax,
      p_slot: slot,
      p_date_category: ct,
      p_menu_idx: menuIdx,
      p_decor_idx: decorIdx,
      p_dj_idx: djIdx,
      p_ttd_idx: ttdIdx,
      p_is_wedding: isWedding,
      p_food_pref: foodPref,
    })
    if (seq !== calcSeq.current) return
    if (!error && data) setCalcResult(data)
    setCalcLoading(false)
  }

  // Auto-select first live parent once venues load; venueId stays empty until user picks a sub (or parent has none)
  useEffect(function () {
    if (!parentId && parents.length > 0) {
      var firstLive = null
      for (var i = 0; i < parents.length; i++) { if (parents[i].status === 'live') { firstLive = parents[i]; break } }
      if (firstLive) {
        setParentId(firstLive.id)
        if (!firstLive.has_subs) setVenueId(firstLive.id)
      }
    }
  }, [parents.length])

  // Keep parentId synced when venueId is set externally (loadQuote / legacy paths)
  useEffect(function () {
    if (!venueId || venues.length === 0) return
    for (var i = 0; i < venues.length; i++) {
      if (venues[i].id === venueId && venues[i].parent_id !== parentId) {
        setParentId(venues[i].parent_id)
        break
      }
    }
  }, [venueId, venues.length])

  useEffect(function () {
    if (firstCall.current) {
      firstCall.current = false
      fetchCalc()
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchCalc, 300)
    return function () { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [venueId, pax, slot, ct, menuIdx, decorIdx, djIdx, ttdIdx, foodPref, isWedding])

  // Safe accessors
  var r = calcResult || {}
  var vm = r.vm || {}
  var rental = r.rental || {}
  var decor = r.decor || {}
  var dj = r.dj || {}
  var total = r.total || {}
  var availMenus = r.available_menus || []
  var allMenus = r.all_menus || []
  var activeMenu = r.active_menu != null ? r.active_menu : menuIdx

  // Auto-shift menuIdx to first available when current selection becomes unavailable (venue change / new session)
  useEffect(function () {
    if (allMenus.length === 0) return
    var current = null
    for (var i = 0; i < allMenus.length; i++) { if (allMenus[i].idx === menuIdx) { current = allMenus[i]; break } }
    if (!current || current.available === false) {
      var firstAvail = null
      for (var j = 0; j < allMenus.length; j++) { if (allMenus[j].available !== false) { firstAvail = allMenus[j]; break } }
      if (firstAvail && firstAvail.idx !== menuIdx) setMenuIdx(firstAvail.idx)
    }
  }, [allMenus.length, venueId])
  var perHead = r.per_head || 0
  var menuCost = r.menu_cost || 0
  var ttdData = r.ttd || []
  var decorRel = r.decor_relevance || []
  var currentLeaf = null
  for (var _vi = 0; _vi < venues.length; _vi++) { if (venues[_vi].id === venueId) { currentLeaf = venues[_vi]; break } }
  var venName = r.venue_name || (currentLeaf ? currentLeaf.name : '')
  var isPlaceholder = r.is_placeholder || false
  var venDecorMode = r.venue_decor_mode || 'p'
  var isSummer = eventDate ? (function () { var m = new Date(eventDate + 'T00:00:00').getMonth(); return m >= 3 && m <= 7 })() : false

  // Adjusted values for custom combos (toggle menu/decor/dj)
  var adjVm = includeMenu ? vm : rental
  var adjDecor = includeDecor ? decor : { q: 0, t: 0, f: 0 }
  var adjDj = includeDj ? dj : { q: 0, t: 0, f: 0 }
  var adjTotal = {
    q: (adjVm.q || 0) + (adjDecor.q || 0) + (adjDj.q || 0),
    t: (adjVm.t || 0) + (adjDecor.t || 0) + (adjDj.t || 0),
    f: (adjVm.f || 0) + (adjDecor.f || 0) + (adjDj.f || 0)
  }

  // Negotiated deal total
  var dealTotal = (+dealVm || 0) + (+dealDecor || 0) + (+dealEnt || 0)
  var hasDeal = dealVm !== '' || dealDecor !== '' || dealEnt !== ''

  // Tax calc (client-side)
  var a5 = rd(dealVal * split5 / 100), a18 = rd(dealVal * (1 - split5 / 100))
  var t5 = rd(a5 * 0.05), t18 = rd(a18 * 0.18), ttx = rd(t5 + t18)
  var effRate = rd((ttx / dealVal) * 100)
  var guestPays = taxMode ? dealVal : rd(dealVal + ttx)
  var netToYou = taxMode ? rd(dealVal - ttx) : dealVal

  // Sync deal slider to negotiated total or quote total
  useEffect(function () {
    var val = hasDeal && dealTotal > 0 ? dealTotal : adjTotal.q
    if (val) {
      var rounded = Math.round(val * 2) / 2
      setDealVal(Math.max(5, Math.min(60, rounded)))
    }
  }, [adjTotal.q, dealTotal])

  // Handlers
  function handleEventType(idx) {
    setEventTypeIdx(idx)
    var wed = (eventTypes[idx] || {}).wedding
    if (wed && (decorIdx === 2 || decorIdx === 3)) setDecorIdx(0)
    if (!wed && (decorIdx === 0 || decorIdx === 1)) setDecorIdx(2)
  }

  function handleDateChange(val) {
    setEventDate(val)
    setTtdIdx(autoTtdIdx(val))
    var c = classifyDate(val, seasonDates)
    if (c >= 0) setCatOverride(c)
  }

  function handleFoodPref(fp) {
    setFoodPref(fp)
  }

  function handleWedToggle(idx) {
    var target = idx === 0
    for (var i = 0; i < eventTypes.length; i++) {
      if (eventTypes[i].wedding === target) { setEventTypeIdx(i); break }
    }
    if (target && (decorIdx === 2 || decorIdx === 3)) setDecorIdx(0)
    if (!target && (decorIdx === 0 || decorIdx === 1)) setDecorIdx(2)
  }

  

  // Proposal text
  var proposalLines = ['AMBRIA PROPOSAL', '========================', 'Venue: ' + venName,
    'Prepared by: ' + profile.name, 'Guest: ' + (guestName || '-') + ' | ' + (guestPhone || '-'),
    'Mode: ' + (inquiryMode || '-') + ' | Priority: ' + (priority || '-'), currentET.label + ' | ' + (foodPref === 0 ? 'Veg' : 'NV'),
    'Date: ' + fmtDate(eventDate) + ' (' + CAT_LABELS[ct] + ') | ' + SLOTS[slot] + ' | ' + pax + 'pax']
  if (includeMenu) proposalLines.push('Menu: ' + (r.menu_label || MENU_LABELS[activeMenu]) + ' Rs.' + perHead + '/hd')
  proposalLines.push('========================')
  proposalLines.push('1)' + (includeMenu ? 'V+M' : 'Rental') + ': ' + fmtRound(adjVm.q || 0) + ' > ' + fmtRound(adjVm.f || 0))
  if (includeDecor) proposalLines.push('2)Dec: ' + fmtRound(decor.q || 0) + ' > ' + fmtRound(decor.f || 0))
  if (includeDj) proposalLines.push('3)DJ: ' + fmtK(dj.q || 0) + ' > ' + fmtK(dj.f || 0))
  proposalLines.push('========================')
  proposalLines.push('QUOTE: ' + fmtRound(adjTotal.q || 0))
  proposalLines.push('TARGET: ' + fmtRound(adjTotal.t || 0))
  proposalLines.push('FLOOR: ' + fmtRound(adjTotal.f || 0))
  if (hasDeal) {
    proposalLines.push('========================')
    proposalLines.push('NEGOTIATED: ' + fmtRound(dealTotal))
    if (dealVm) proposalLines.push('  V+M: ₹' + dealVm + 'L')
    if (dealDecor) proposalLines.push('  Décor: ₹' + dealDecor + 'L')
    if (dealEnt) proposalLines.push('  Ent: ₹' + dealEnt + 'L')
  }
  proposalLines.push('========================')
  var proposalText = proposalLines.join('\n')

  // ── Persistence ──
  function toPaise(lakhs) { return Math.round(lakhs * 10000000) }

  function printQuote() {
    var ml = r.menu_label || MENU_LABELS[activeMenu]
    var fp = foodPref === 0 ? 'Veg' : 'Non-Veg'
    var dt = eventDate ? fmtDate(eventDate) : '-'
    var sl = SLOTS[slot] || '-'
    var et = currentET.label || '-'
    var today = new Date(); var dd = String(today.getDate()).padStart(2,'0'); var mm = String(today.getMonth()+1).padStart(2,'0'); var yy = today.getFullYear(); var todayStr = dd + '-' + mm + '-' + yy
    function fmtAmt(n) { var rounded = n >= 1 ? Math.ceil(n * 2) / 2 : n; var rupees = Math.round(rounded * 100000); return '\u20B9' + rupees.toLocaleString('en-IN') }

    var rows = []
    if (includeMenu) rows.push([1, 'Venue + Menu (' + ml + ' ' + fp + ', ' + pax + ' pax)', fmtAmt(adjVm.q || 0)])
    else if (rental.q) rows.push([1, 'Venue Rental', fmtAmt(rental.q || 0)])
    if (includeDecor) rows.push([1, 'Decoration - ' + DECOR_LABELS[decorIdx], fmtAmt(adjDecor.q || 0)])
    if (includeDj) rows.push([1, DJ_LABELS[djIdx] || 'DJ / Entertainment', fmtAmt(adjDj.q || 0)])
    var totalAmt = (includeMenu ? (adjVm.q || 0) : (rental.q || 0)) + (includeDecor ? (adjDecor.q || 0) : 0) + (includeDj ? (adjDj.q || 0) : 0)

    var html = '<!DOCTYPE html><html><head><title>Quote - ' + (guestName || 'Guest') + '</title>'
      + '<style>'
      + '*{margin:0;padding:0;box-sizing:border-box;}'
      + 'body{font-family:Helvetica,Arial,sans-serif;padding:40px 50px;color:#222;font-size:13px;}'
      + '.top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;}'
      + '.company{font-size:13px;line-height:1.6;}'
      + '.company strong{font-size:16px;}'
      + '.title{text-align:right;}'
      + '.title h1{font-size:32px;font-weight:900;letter-spacing:2px;line-height:1.1;}'
      + '.mid{display:flex;justify-content:space-between;margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid #222;}'
      + '.bill-to{}'
      + '.bill-to .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;border-bottom:2px solid #222;display:inline-block;padding-bottom:2px;}'
      + '.bill-to p{line-height:1.6;margin-top:4px;}'
      + '.meta{text-align:right;}'
      + '.meta table{margin-left:auto;}'
      + '.meta td{padding:2px 0;font-size:12px;}'
      + '.meta td:first-child{text-align:right;padding-right:12px;font-weight:700;}'
      + 'table.items{width:100%;border-collapse:collapse;margin-bottom:0;}'
      + 'table.items thead{background:#222;color:#fff;}'
      + 'table.items th{padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;}'
      + 'table.items th:first-child{width:40px;text-align:center;}'
      + 'table.items th:nth-child(3){text-align:right;}'
      + 'table.items td{padding:12px;border-bottom:1px solid #ddd;font-size:13px;}'
      + 'table.items td:first-child{text-align:center;}'
      + 'table.items td:nth-child(3){text-align:right;}'
      + '.totals{width:100%;margin-top:0;}'
      + '.totals td{padding:8px 12px;font-size:13px;}'
      + '.totals td:first-child{text-align:right;width:75%;}'
      + '.totals td:last-child{text-align:right;width:25%;}'
      + '.totals .grand{border-top:2px solid #222;font-size:15px;font-weight:900;}'
      + '.notes{margin-top:28px;}'
      + '.notes strong{font-size:12px;font-weight:700;}'
      + '.notes p{margin-top:6px;font-size:12px;line-height:1.7;color:#444;}'
      + '@media print{body{padding:30px 40px;}}'
      + '</style></head><body>'

      + '<div class="top">'
      + '<div class="company"></div>'
      + '<div class="title"><h1>EVENT<br/>QUOTE</h1></div>'
      + '</div>'

      + '<div class="mid">'
      + '<div class="bill-to"><div class="lbl">Bill To</div>'
      + '<p><strong>' + (guestName || '-') + '</strong><br/>'
      + (guestPhone || '-') + '<br/>'
      + (guestAddress || '-') + '</p></div>'
      + '<div class="meta"><table>'
      + '<tr><td>Quote date</td><td>' + todayStr + '</td></tr>'
      + '<tr><td>Event date</td><td>' + dt + '</td></tr>'
      + '<tr><td>Slot</td><td>' + sl + '</td></tr>'
      + '<tr><td>Event type</td><td>' + et + '</td></tr>'
      + '<tr><td>Pax</td><td>' + pax + '</td></tr>'
      + '</table></div></div>'

      + '<table class="items"><thead><tr><th>Qty</th><th>Description</th><th>Amount</th></tr></thead><tbody>'

    for (var i = 0; i < rows.length; i++) {
      html += '<tr><td>' + rows[i][0] + '</td><td>' + rows[i][1] + '</td><td>' + rows[i][2] + '</td></tr>'
    }

    html += '</tbody></table>'
      + '<table class="totals">'
      + '<tr><td>Subtotal</td><td>' + fmtAmt(totalAmt) + '</td></tr>'
      + '<tr><td>GST</td><td>As applicable</td></tr>'
      + '<tr class="grand"><td>Total</td><td>' + fmtAmt(totalAmt) + '</td></tr>'
      + '</table>'

      + '<div class="notes"><strong>Terms &amp; Conditions</strong>'
      + '<p>'
      + (notes ? notes.replace(/\n/g, '<br/>') + '<br/><br/>' : '')
      + 'All amounts exclusive of applicable GST.'
      + '</p></div>'

      + '<script>window.onload=function(){window.print()}<\/script>'
      + '</body></html>'

    var w = window.open('', '_blank')
    if (!w) { setSaveMsg('Allow pop-ups to print'); setTimeout(function () { setSaveMsg('') }, 3000); return }
    w.document.write(html)
    w.document.close()
  }
  function fromPaise(paise) { return paise / 10000000 }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () {
        setSaveMsg('Copied'); setTimeout(function () { setSaveMsg('') }, 2000)
      }).catch(function () {
        setSaveMsg('Copy failed — select manually'); setTimeout(function () { setSaveMsg('') }, 3000)
      })
    } else {
      setSaveMsg('Copy failed — select manually'); setTimeout(function () { setSaveMsg('') }, 3000)
    }
  }

  async function saveQuote() {
    if (saving || !calcResult) return
    setSaving(true); setSaveMsg('')
    var row = {
      created_by: profile.id, guest_name: guestName, guest_phone: guestPhone, guest_address: guestAddress || null,
      inquiry_mode: inquiryMode,
      priority: priority || null,
      event_type: currentET.label, event_date: eventDate || null,
      venue_id: venueId, venue_name: venName, food_pref: foodPref, pax: pax,
      slot: slot, date_category: ct, is_wedding: isWedding,
      menu_idx: activeMenu, menu_label: r.menu_label || MENU_LABELS[activeMenu],
      decor_idx: decorIdx, dj_idx: djIdx, ttd_idx: ttdIdx,
      per_head_rate: perHead * 100,
      menu_cost_paise: toPaise(menuCost),
      rental_q_paise: toPaise(rental.q || 0), rental_t_paise: toPaise(rental.t || 0), rental_f_paise: toPaise(rental.f || 0),
      vm_q_paise: toPaise(vm.q || 0), vm_t_paise: toPaise(vm.t || 0), vm_f_paise: toPaise(vm.f || 0),
      decor_q_paise: toPaise(decor.q || 0), decor_t_paise: toPaise(decor.t || 0), decor_f_paise: toPaise(decor.f || 0),
      dj_q_paise: toPaise(dj.q || 0), dj_t_paise: toPaise(dj.t || 0), dj_f_paise: toPaise(dj.f || 0),
      total_q_paise: toPaise(total.q || 0), total_t_paise: toPaise(total.t || 0), total_f_paise: toPaise(total.f || 0),
      proposal_text: proposalText,
      notes: notes.trim() || null,
      include_menu: includeMenu,
      include_decor: includeDecor,
      include_dj: includeDj,
      deal_value_paise: hasDeal ? toPaise(dealTotal) : null,
      deal_vm_paise: dealVm ? toPaise(+dealVm) : null,
      deal_decor_paise: dealDecor ? toPaise(+dealDecor) : null,
      deal_ent_paise: dealEnt ? toPaise(+dealEnt) : null,
      location_id: locationId || null,
      location_name: locationName || null,
    }
    if (taxMode !== 0 || split5 !== 50) {
      row.tax_mode = taxMode; row.split_5_pct = split5
      row.total_tax_paise = toPaise(ttx); row.guest_pays_paise = toPaise(guestPays); row.net_to_you_paise = toPaise(netToYou)
    }
    try {
      if (savedId) {
        var { error } = await supabase.from('quotes').update(row).eq('id', savedId)
        if (error) throw error
        setSaveMsg('Updated')
      } else {
        var { data, error } = await supabase.from('quotes').insert(row).select('id').single()
        if (error) throw error
        setSavedId(data.id); setQuoteStatus('draft'); setLmsRef(null); setSaveMsg('Saved')
      }
    } catch (e) { setSaveMsg('Error: ' + (e.message || 'Save failed')) }
    setSaving(false); setTimeout(function () { setSaveMsg('') }, 3000)
  }

  async function loadQuotes() {
    setLoadingQuotes(true)
    var cols = 'id,guest_name,guest_phone,guest_address,event_date,inquiry_mode,priority,event_type,venue_id,venue_idx,venue_name,food_pref,pax,slot,date_category,menu_idx,decor_idx,dj_idx,ttd_idx,total_q_paise,deal_vm_paise,deal_decor_paise,deal_ent_paise,deal_value_paise,tax_mode,split_5_pct,status,revision,notes,lms_ref,location_id,location_name,include_menu,include_decor,include_dj,updated_at'
    var { data } = await supabase.from('quotes').select(cols).order('updated_at', { ascending: false }).limit(50)
    setQuotes(data || []); setLoadingQuotes(false)
  }

  function loadQuote(q) {
    setGuestName(q.guest_name || ''); setGuestPhone(q.guest_phone || ''); setGuestAddress(q.guest_address || ''); setEventDate(q.event_date || '')
    setInquiryMode(q.inquiry_mode || '')
    setPriority(q.priority || '')
    var etIdx = 0
    for (var i = 0; i < eventTypes.length; i++) { if (eventTypes[i].label === q.event_type) { etIdx = i; break } }
    setEventTypeIdx(etIdx)
    var vid = q.venue_id
    if (!vid && q.venue_idx != null) {
      var LEGACY_IDX_TO_ID = { 0: 'pushpanjali', 1: 'emerald_green', 3: 'aura', 4: 'valencia' }
      vid = LEGACY_IDX_TO_ID[q.venue_idx] || ''
    }
    // Derive parentId from resolved leaf id for parent+sub selector
    var pidFromVid = ''
    if (vid) {
      for (var _lq = 0; _lq < (venueList || []).length; _lq++) {
        var _lqp = venueList[_lq]
        if (_lqp.id === vid) { pidFromVid = _lqp.id; break }
        if (Array.isArray(_lqp.sub_venues)) {
          var _hit = false
          for (var _sq = 0; _sq < _lqp.sub_venues.length; _sq++) {
            if (_lqp.sub_venues[_sq].id === vid) { pidFromVid = _lqp.id; _hit = true; break }
          }
          if (_hit) break
        }
      }
    }
    setParentId(pidFromVid || '')
    setVenueId(vid || '')
    setFoodPref(q.food_pref || 0); setPax(q.pax || 400); setSlot(q.slot || 0)
    setCatOverride(q.date_category || 2); setMenuIdx(q.menu_idx != null ? q.menu_idx : 3)
    setDecorIdx(q.decor_idx != null ? q.decor_idx : 0); setDjIdx(q.dj_idx != null ? q.dj_idx : 1); setTtdIdx(q.ttd_idx != null ? q.ttd_idx : autoTtdIdx(q.event_date)); setDealVm(''); setDealDecor(''); setDealEnt(''); setDealVal(14); setTaxMode(0); setSplit5(50)
    if (q.deal_vm_paise != null) setDealVm(String(fromPaise(q.deal_vm_paise)))
    if (q.deal_decor_paise != null) setDealDecor(String(fromPaise(q.deal_decor_paise)))
    if (q.deal_ent_paise != null) setDealEnt(String(fromPaise(q.deal_ent_paise)))
    if (q.deal_value_paise != null && !q.deal_vm_paise) { setDealVm(String(fromPaise(q.deal_value_paise))) }
    if (q.tax_mode != null) { setTaxMode(q.tax_mode); setSplit5(q.split_5_pct || 50) }
    setSavedId(q.id); setQuoteStatus(q.status || 'draft'); setNotes(q.notes || '')
    setLmsRef(q.lms_ref || null)
    setLocationId(q.location_id || ''); setLocationName(q.location_name || '')
    setShowQuotes(false); setShowProposal(false); setPage(0)
    setIncludeMenu(q.include_menu != null ? q.include_menu : true); setIncludeDecor(q.include_decor != null ? q.include_decor : true); setIncludeDj(q.include_dj != null ? q.include_dj : true)
  }

  function newQuote() {
    setGuestName(''); setGuestPhone(''); setGuestAddress(''); setEventDate(''); setInquiryMode(''); setPriority(''); setEventTypeIdx(0)
    var _npFirst = ''; var _npIsLeaf = false
    for (var _npi = 0; _npi < parents.length; _npi++) {
      if (parents[_npi].status === 'live') { _npFirst = parents[_npi].id; _npIsLeaf = !parents[_npi].has_subs; break }
    }
    setParentId(_npFirst); setVenueId(_npIsLeaf ? _npFirst : '')
    setFoodPref(0); setPax(400); setSlot(0); setCatOverride(2); setMenuIdx(3)
    setDecorIdx(0); setDjIdx(1); setTtdIdx(0); setDealVal(14); setTaxMode(0); setSplit5(50)
    setQuoteStatus('draft'); setSavedId(null); setNotes(''); setLmsRef(null)
    setLocationId(''); setLocationName('')
    setShowQuotes(false); setShowProposal(false); setPage(0)
    setIncludeMenu(true); setIncludeDecor(true); setIncludeDj(true)
    setDealVm(''); setDealDecor(''); setDealEnt('')
  }

  async function updateStatus(s) {
    if (!savedId) return
    if (s === 'sent') {
      if (lmsRef) { setSaveMsg('Already pushed as lead ' + lmsRef); setTimeout(function () { setSaveMsg('') }, 3000); return }
      if (!locationId) { setSaveMsg('Select a location first'); setTimeout(function () { setSaveMsg('') }, 3000); return }
      if (!guestName) { setSaveMsg('Guest name required'); setTimeout(function () { setSaveMsg('') }, 3000); return }
      if (!eventDate) { setSaveMsg('Event date required'); setTimeout(function () { setSaveMsg('') }, 3000); return }
      if (!profile.lms_user_id) { setSaveMsg('LMS user not mapped, contact admin'); setTimeout(function () { setSaveMsg('') }, 3000); return }
      setShowLmsPush(true)
      return
    }
    var { error } = await supabase.from('quotes').update({ status: s }).eq('id', savedId)
    if (error) { setSaveMsg('Error: ' + error.message); return }
    setQuoteStatus(s)
  }

  async function pushToLms() {
    if (pushing || !savedId) return
    setPushing(true); setShowLmsPush(false); setSaveMsg('')
    try {
      var res = await fetch(
        import.meta.env.VITE_SUPABASE_URL + '/functions/v1/lms-push',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (await supabase.auth.getSession()).data.session.access_token }, body: JSON.stringify({ quote_id: savedId }) }
      )
      var data = await res.json()
      if (data.error) throw new Error(data.error)
      setLmsRef(data.fis_entryno); setQuoteStatus('sent')
      setSaveMsg('Pushed to LMS — Lead #' + data.fis_entryno)
    } catch (e) {
      setSaveMsg('Error: ' + (e.message || 'LMS push failed'))
    }
    setPushing(false); setTimeout(function () { setSaveMsg('') }, 5000)
  }
  async function askAI() {
    if (analyzing || !calcResult) return
    setAnalyzing(true); setAnalysis(null); setShowAnalysis(true)
    try {
      var weekEnd = new Date(new Date(eventDate + 'T00:00:00').getTime() + 6*86400000).toISOString().split('T')[0]
      var { data: weekData } = await supabase
          .from('quotes')
          .select('id, venue_id, event_date')
          .gte('event_date', eventDate)
          .lte('event_date', weekEnd)
      var sameDate = (weekData || []).filter(function(q) { return q.event_date === eventDate })
      var quoteData = {
        venue: venName, date: fmtDate(eventDate), category: CAT_LABELS[ct],
        slot: SLOTS[slot], pax: pax, food: foodPref === 0 ? 'Veg' : 'Non-Veg',
        event_type: currentET.label, is_wedding: isWedding,
        menu: calcResult.menu_label, per_head: calcResult.per_head,
        rental: rental, vm: vm, decor: decor, dj: dj, total: total,
        ttd: ttdData[ttdIdx] || null,
        package_value: hasDeal ? dealTotal : null,
        package_breakdown: hasDeal ? { vm: +dealVm || 0, decor: +dealDecor || 0, ent: +dealEnt || 0 } : null,
        demand: {
          same_date: sameDate.length,
          same_date_same_venue: sameDate.filter(function(q) { return q.venue_id === venueId }).length,
          same_week: (weekData || []).length,
        },
        notes: notes.trim() || null,
      }
      var res = await fetch(
        import.meta.env.VITE_SUPABASE_URL + '/functions/v1/quote-assist',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + import.meta.env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify({ quote: quoteData }) }
      )
      var data = await res.json()
      if (data.error) throw new Error(data.error)
      setAnalysis(data)
    } catch (e) { setAnalysis({ error: e.message || 'Analysis failed' }) }
    setAnalyzing(false)
  }

  // ═══ SUB-COMPONENTS ═══

  

  // ═══ RENDER ═══

  var loadingDot = calcLoading ? (
    <div style={{ position: 'fixed', top: 60, right: 16, zIndex: 99, width: 8, height: 8, borderRadius: '50%', background: C.gold, animation: 'pulse 1s infinite' }} />
  ) : null

  return (
    <div style={{ fontFamily: 'Segoe UI, sans-serif', color: '#3D2B2B' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      {loadingDot}

      {/* Tab bar */}
      <div style={{ display: 'flex', marginBottom: 12, borderRadius: 12, overflow: 'hidden', border: '1px solid ' + C.border }}>
        {['Guest Info', 'Calculator'].map(function (label, idx) {
          return <SlotButton key={idx} label={label} on={page === idx} onClick={function () { setPage(idx) }} />
        })}
      </div>

      {/* Quotes toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={function () { if (!showQuotes) loadQuotes(); setShowQuotes(!showQuotes) }} style={{
          flex: 1, padding: '9px 12px', borderRadius: 9, border: '2px solid ' + (showQuotes ? C.gold : C.border),
          background: showQuotes ? '#FFF8F0' : '#fff', color: showQuotes ? C.gold : C.muted,
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>{showQuotes ? 'Hide Quotes' : 'My Quotes'}</button>
        {savedId && (<button onClick={newQuote} style={{
          padding: '9px 16px', borderRadius: 9, border: '2px solid ' + C.border,
          background: '#fff', color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>+ New</button>)}
      </div>

      {/* Quotes list */}
      {showQuotes && (
        <div style={{ marginBottom: 12 }}>
          {loadingQuotes ? (<div style={{ textAlign: 'center', padding: 20, color: C.muted, fontSize: 13 }}>Loading...</div>
          ) : quotes.length === 0 ? (<div style={{ textAlign: 'center', padding: 20, color: C.muted, fontSize: 13 }}>No saved quotes yet</div>
          ) : (<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {quotes.map(function (q) {
              var isActive = savedId === q.id
              var qTotal = q.total_q_paise / 10000000
              var d = new Date(q.updated_at)
              var ago = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
              return (<button key={q.id} onClick={function () { loadQuote(q) }} style={{
                width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 10,
                border: '2px solid ' + (isActive ? C.gold : C.border),
                background: isActive ? '#FFF8F0' : '#fff', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.maroon, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.guest_name || 'Untitled'}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{q.venue_name} · {q.pax}pax · {q.event_date ? fmtDate(q.event_date) : 'No date'}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.maroon }}>{fmtRound(qTotal)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', marginTop: 2 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
                      background: q.status === 'draft' ? '#F3F4F6' : q.status === 'sent' ? '#DBEAFE' : q.status === 'accepted' ? '#D1FAE5' : q.status === 'converted' ? '#FEF3C7' : '#FEE2E2',
                      color: q.status === 'draft' ? '#6B7280' : q.status === 'sent' ? '#1D4ED8' : q.status === 'accepted' ? '#059669' : q.status === 'converted' ? '#D97706' : '#DC2626',
                      textTransform: 'uppercase',
                    }}>{q.status}{q.revision > 1 ? ' v' + q.revision : ''}</span>
                    {q.lms_ref && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 8, background: '#DBEAFE', color: '#1D4ED8' }}>#{q.lms_ref}</span>}
                    <span style={{ fontSize: 10, color: '#9CA3AF' }}>{ago}</span>
                  </div>
                </div>
              </button>)
            })}
          </div>)}
        </div>
      )}

      {/* ═══ PAGE 0: GUEST INFO ═══ */}
      {page === 0 && (<>
        <SectionCard title="Guest / Lead Info">
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Guest Name</div>
          <input type="text" value={guestName} placeholder="Full name"
            onChange={function (e) { setGuestName(e.target.value) }}
            style={{ width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, marginBottom: 10 }} />

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Address</div>
          <input type="text" value={guestAddress} placeholder="Locality / Area"
            onChange={function (e) { setGuestAddress(e.target.value) }}
            style={{ width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, marginBottom: 10 }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Phone</div>
              <input type="tel" value={guestPhone} placeholder="+91 98765 43210"
                onChange={function (e) { setGuestPhone(e.target.value.replace(/[^0-9+\- ]/g, '').slice(0, 16)) }}
                style={{ width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, marginBottom: 10 }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Event Date</div>
              <EventDatePicker value={eventDate} onChange={handleDateChange} label="" collapsible />
              {dc >= 0 && (<div style={{ padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, background: CAT_BG[dc], color: CAT_COLORS[dc], border: '1px solid ' + C.border }}>
                {fmtDate(eventDate)} – {CAT_LABELS[dc]}
              </div>)}
              {isSummer && (<div style={{ padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, marginTop: 4, background: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}>
                ☀️ Summer – Consider Banquet
              </div>)}
            </div>
          </div>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Slot</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {SLOTS.map(function (s, idx) {
              return <SlotButton key={idx} label={s} on={slot === idx} onClick={function () { setSlot(idx) }} />
            })}
          </div>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Mode of Inquiry</div>
            <select value={inquiryMode} onChange={function (e) { setInquiryMode(e.target.value) }}
              style={{
                width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border,
                fontSize: 14, marginBottom: 10, background: '#fff', color: inquiryMode ? C.maroon : C.muted,
              }}>
              <option value="">Select mode...</option>
              {inquiryModes.map(function (m) { return <option key={m} value={m}>{m}</option> })}
            </select>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Priority</div>
            <select value={priority} onChange={function (e) { setPriority(e.target.value) }}
              style={{
                width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border,
                fontSize: 14, marginBottom: 10, background: '#fff', color: priority ? C.maroon : C.muted,
              }}>
              <option value="">Select priority...</option>
              <option value="Silver">Silver</option>
              <option value="Gold">Gold</option>
              <option value="Platinum">Platinum</option>
              <option value="Diamond">Diamond</option>
            </select>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Event Type</div>
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <input value={etSearch} placeholder={currentET.icon + ' ' + currentET.label}
                onChange={function (e) { setEtSearch(e.target.value) }}
                onFocus={function () { setEtSearch('') }}
                onBlur={function () { setTimeout(function () { setEtSearch('') }, 200) }}
                style={{
                  width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border,
                  fontSize: 14, background: '#fff', color: etSearch ? C.maroon : C.muted,
                  fontFamily: 'inherit', boxSizing: 'border-box',
                }} />
              {etSearch !== '' && (function () {
                var filtered = []
                for (var i = 0; i < eventTypes.length; i++) {
                  if (eventTypes[i].label.toLowerCase().indexOf(etSearch.toLowerCase()) >= 0) filtered.push({ et: eventTypes[i], idx: i })
                }
                if (filtered.length === 0) return null
                return (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    background: '#fff', border: '2px solid ' + C.border, borderRadius: 9,
                    maxHeight: 200, overflowY: 'auto', marginTop: 2,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}>
                    {filtered.map(function (f) {
                      return (
                        <button key={f.idx} onMouseDown={function () { handleEventType(f.idx); setEtSearch('') }}
                          style={{
                            width: '100%', padding: '10px 12px', border: 'none', background: eventTypeIdx === f.idx ? '#FFF8F0' : '#fff',
                            color: C.maroon, fontSize: 13, fontWeight: eventTypeIdx === f.idx ? 700 : 500,
                            cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                            borderBottom: '1px solid ' + C.border, display: 'flex', alignItems: 'center', gap: 6,
                          }}>{f.et.icon} {f.et.label} {f.et.wedding ? '💒' : ''}</button>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {eventTypes.map(function (et, idx) {
                if (!et.pinned) return null
                var on = eventTypeIdx === idx
                return (
                  <button key={idx} onClick={function () { handleEventType(idx) }} style={{
                    padding: '6px 14px', borderRadius: 20, border: '2px solid ' + (on ? C.gold : C.border),
                    background: on ? '#FFF8F0' : '#fff', color: on ? C.maroon : C.muted,
                    fontSize: 12, fontWeight: on ? 700 : 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    <span style={{ fontSize: 15 }}>{et.icon}</span>
                    {et.label}
                  </button>
                )
              })}
            </div>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Venue</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            {parents.map(function (p) {
              var on = parentId === p.id
              var isPh = p.status === 'placeholder'
              return (<button key={p.id} onClick={function () {
                if (isPh) return
                setParentId(p.id)
                setVenueId(p.has_subs ? '' : p.id)
                setLocationId(''); setLocationName('')
              }} style={{
                textAlign: 'left', width: '100%', padding: 11, borderRadius: 10,
                border: '2px solid ' + (on && !isPh ? C.gold : C.border), background: on && !isPh ? '#FFF8F0' : '#fff',
                color: isPh ? '#ccc' : on ? C.maroon : C.muted, fontSize: 12, fontWeight: on ? 700 : 600,
                cursor: isPh ? 'not-allowed' : 'pointer', opacity: isPh ? 0.5 : 1,
              }}><div>{isPh ? '🚧 ' : ''}{p.name}</div><div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{isPh ? 'Coming soon' : p.location}</div></button>)
            })}
          </div>

          {currentParent && currentParent.has_subs && currentParent.live_subs.length > 0 && (<>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Sub-venue</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              {currentParent.live_subs.map(function (s) {
                var on = venueId === s.id
                return (<button key={s.id} onClick={function () {
                  setVenueId(s.id); setLocationId(''); setLocationName('')
                }} style={{
                  textAlign: 'left', width: '100%', padding: 11, borderRadius: 10,
                  border: '2px solid ' + (on ? C.gold : C.border), background: on ? '#FFF8F0' : '#fff',
                  color: on ? C.maroon : C.muted, fontSize: 12, fontWeight: on ? 700 : 600, cursor: 'pointer',
                }}>{s.name}</button>)
              })}
            </div>
          </>)}

          {(function () {
            var locs = null
            if (lmsLocations && currentLeaf) {
              // Try new keying (parent_id, leaf id) then legacy numeric-idx keys
              locs = lmsLocations[currentLeaf.parent_id] || lmsLocations[currentLeaf.id] || null
              if (!locs) {
                var LEG_ID_TO_IDX = { pushpanjali: '0', manaktala: '1', emerald_green: '1', alstonia: '1', exotica: '3', aura: '3', valencia: '3', restro: '16', restro_lawn: '16', restro_banquet: '16' }
                var legKey = LEG_ID_TO_IDX[currentLeaf.parent_id] || LEG_ID_TO_IDX[currentLeaf.id]
                if (legKey) locs = lmsLocations[legKey] || null
              }
            }
            if (!locs || locs.length === 0) return null
            return (<>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Location / Hall</div>
              <select value={locationId} onChange={function (e) {
                var sel = locs.find(function (l) { return l.id === e.target.value })
                setLocationId(e.target.value)
                setLocationName(sel ? sel.name : '')
              }} style={{
                width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + (locationId ? C.gold : C.border),
                fontSize: 14, marginBottom: 10, background: '#fff', color: locationId ? C.maroon : C.muted,
              }}>
                <option value="">Select location...</option>
                {locs.map(function (l) { return <option key={l.id} value={l.id}>{l.name}</option> })}
              </select>
            </>)
          })()}

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Food</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {[['Veg', '#2D6A2E', '#E8F5E9'], ['Non-Veg', '#991B1B', '#FEF2F2']].map(function (f, idx) {
              var on = foodPref === idx
              return (<button key={idx} onClick={function () { handleFoodPref(idx) }} style={{
                flex: 1, padding: 11, borderRadius: 9, border: '2px solid ' + (on ? f[1] : C.border),
                background: on ? f[2] : '#fff', color: on ? f[1] : C.muted,
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>{f[0]}</button>)
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Pax:</div>
            <input type="number" inputMode="numeric" min={50} max={2000} value={pax}
              onChange={function (e) { var v = +e.target.value; if (v >= 0 && v <= 2000) setPax(v) }}
              onBlur={function (e) { var v = +e.target.value; if (v < 50) setPax(50); else if (v > 2000) setPax(2000) }}
              style={{ width: 64, padding: '4px 6px', borderRadius: 7, border: '1px solid ' + C.border, fontSize: 14, fontWeight: 700, textAlign: 'center', color: C.maroon, background: C.bg, fontFamily: 'inherit' }} />
          </div>
          <input type="range" min={50} max={2000} step={5} value={pax}
            onInput={function (e) { setPax(+e.target.value) }} style={{ width: '100%', accentColor: C.maroon2 }} />
        </SectionCard>

        <button onClick={function () { setTtdIdx(autoTtdIdx(eventDate)); setPage(1) }} style={{
          width: '100%', padding: 14, borderRadius: 12, border: 'none',
          background: 'linear-gradient(135deg,#4A1111,#8B2D2D)', color: '#fff',
          fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 10,
        }}>Continue to Calculator</button>
      </>)}

      {/* ═══ PAGE 1: CALCULATOR ═══ */}
      {page === 1 && (<>
        {/* Summary bar */}
        <div style={{ background: 'linear-gradient(135deg,#4A1111,#8B2D2D)', borderRadius: 12, padding: '11px 16px', marginBottom: 12, color: '#fff', fontSize: 13 }}>
          <strong>{guestName || 'Guest'}</strong> | {venName} | {dc >= 0 ? CAT_LABELS[dc] : ''} | {pax}pax
        </div>

        {/* Negotiation quick banner */}
        {hasDeal && adjTotal.q > 0 && (function () {
          var rCalc = Math.ceil(adjTotal.q * 2) / 2
          var rDeal = Math.ceil(dealTotal * 2) / 2
          var diff = rd(rDeal - rCalc)
          var pct = rd((diff / rCalc) * 100)
          var isUp = diff >= 0
          return (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 14px', borderRadius: 10, marginBottom: 10,
              background: isUp ? '#F0FDF4' : '#FEF2F2',
              border: '1px solid ' + (isUp ? '#BBF7D0' : '#FECACA'),
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>
                Calc {fmtRound(adjTotal.q)} → Deal {fmtRound(dealTotal)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: isUp ? '#166534' : '#DC2626' }}>
                {isUp ? '+' : ''}{diff}L ({isUp ? '+' : ''}{pct}%)
              </div>
            </div>
          )
        })()}

        {/* Venue selector (synced) — parent row + conditional sub row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + Math.max(parents.length, 1) + ', 1fr)', gap: 6, marginBottom: currentParent && currentParent.has_subs && currentParent.live_subs.length > 0 ? 6 : 12 }}>
          {parents.map(function (p) {
            var on = parentId === p.id
            var isPh = p.status === 'placeholder'
            return (<button key={p.id} onClick={function () {
              if (isPh) return
              setParentId(p.id)
              setVenueId(p.has_subs ? '' : p.id)
              setDecorIdx(0); setLocationId(''); setLocationName('')
            }} style={{
              padding: '8px 4px', borderRadius: 9, border: '2px solid ' + (on && !isPh ? C.gold : C.border),
              background: on && !isPh ? '#FFF8F0' : '#fff', color: isPh ? '#ccc' : on ? C.maroon : C.muted,
              fontSize: 11, fontWeight: on ? 700 : 600, cursor: isPh ? 'not-allowed' : 'pointer',
              opacity: isPh ? 0.5 : 1, textAlign: 'center',
            }}>{isPh ? '🚧' : (p.name || '').replace('Ambria ', '')}</button>)
          })}
        </div>
        {currentParent && currentParent.has_subs && currentParent.live_subs.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + currentParent.live_subs.length + ', 1fr)', gap: 6, marginBottom: 12 }}>
            {currentParent.live_subs.map(function (s) {
              var on = venueId === s.id
              return (<button key={s.id} onClick={function () {
                setVenueId(s.id); setDecorIdx(0); setLocationId(''); setLocationName('')
              }} style={{
                padding: '7px 4px', borderRadius: 8, border: '2px solid ' + (on ? C.gold : C.border),
                background: on ? '#FFF8F0' : '#fff', color: on ? C.maroon : C.muted,
                fontSize: 11, fontWeight: on ? 700 : 600, cursor: 'pointer', textAlign: 'center',
              }}>{s.name}</button>)
            })}
          </div>
        )}

        {isSummer && (<div style={{ padding: '7px 11px', borderRadius: 7, fontSize: 11, fontWeight: 600, marginBottom: 12, background: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}>
          ☀️ Summer – Consider Banquet
        </div>)}

        {isPlaceholder && (<div style={{ textAlign: 'center', padding: 40, color: C.muted, fontSize: 14 }}>
          🚧 Pricing coming soon for {venName}
        </div>)}

        {!isPlaceholder && <>
        {/* Wedding toggle */}
        <div style={{ display: 'flex', marginBottom: 12, borderRadius: 12, overflow: 'hidden', border: '2px solid ' + C.border }}>
          {['Wedding', 'Non-Wedding'].map(function (label, idx) {
            var eW = isWedding ? 0 : 1
            return <SlotButton key={idx} label={label} on={eW === idx} onClick={function () { handleWedToggle(idx) }} />
          })}
        </div>

        {/* VENUE + MENU */}
        <SectionCard title={'Venue + Menu \u00B7 ' + venName}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Date Category</div>
          {eventDate && (<div style={{
            padding: '7px 11px', borderRadius: 7, fontSize: 12, fontWeight: 600, marginBottom: 7,
            background: CAT_BG[ct], color: CAT_COLORS[ct], border: '1px solid ' + C.border,
          }}>{fmtDate(eventDate)} – {CAT_LABELS[ct]}{dc >= 0 && dc !== ct ? '  (auto: ' + CAT_LABELS[dc] + ')' : ''}</div>)}
          <CatPills items={CAT_LABELS} value={ct} onChange={setCatOverride} />

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Slot</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {SLOTS.map(function (s, idx) {
              return <SlotButton key={idx} label={s} on={slot === idx} onClick={function () { setSlot(idx) }} />
            })}
          </div>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Pax: {pax}</div>
          <input type="range" min={100} max={1000} step={50} value={pax}
            onInput={function (e) { setPax(+e.target.value) }} style={{ width: '100%', accentColor: C.maroon2, marginBottom: 10 }} />

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Food</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {[['Veg', '#2D6A2E', '#E8F5E9'], ['Non-Veg', '#991B1B', '#FEF2F2']].map(function (f, idx) {
              var on = foodPref === idx
              return (<button key={idx} onClick={function () { handleFoodPref(idx) }} style={{
                flex: 1, padding: 9, borderRadius: 9, border: '2px solid ' + (on ? f[1] : C.border),
                background: on ? f[2] : '#fff', color: on ? f[1] : C.muted,
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>{f[0]}</button>)
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Menu ({foodPref === 0 ? 'Veg' : 'NV'})</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: includeMenu ? '#166534' : C.muted }}>{includeMenu ? 'Included' : 'Off'}</span>
              <Toggle on={includeMenu} onToggle={function () { setIncludeMenu(!includeMenu) }} />
            </div>
          </div>
          <div style={{ opacity: includeMenu ? 1 : 0.3, pointerEvents: includeMenu ? 'auto' : 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {allMenus.map(function (m) {
              var midx = m.idx; var on = activeMenu === midx
              var unavail = m.available === false
              return (<button key={midx} onClick={function () { if (!unavail) setMenuIdx(midx) }} style={{
                textAlign: 'center', width: '100%', padding: '10px 8px', borderRadius: 9,
                border: '2px solid ' + (on && !unavail ? C.maroon2 : C.border),
                background: on && !unavail ? C.cream : '#fff',
                color: unavail ? '#ccc' : on ? C.maroon : C.muted,
                fontSize: 12, fontWeight: on ? 700 : 600,
                cursor: unavail ? 'not-allowed' : 'pointer',
                opacity: unavail ? 0.5 : 1,
              }}>
                {m.label}<br />
                <span style={{ fontSize: 10, opacity: 0.6 }}>Rs.{m.per_head}{m.flat_add ? ' +' + m.flat_add + 'L' : ''}</span>
                {unavail && m.reason && <><br /><span style={{ fontSize: 9, color: '#B45309' }}>{'🚫 ' + m.reason}</span></>}
                {!unavail && m.max_pax > 0 && pax > m.max_pax && <><br /><span style={{ fontSize: 9, color: '#B45309' }}>{'⚠ Max ' + m.max_pax + ' pax'}</span></>}
              </button>)
            })}
          </div>
          </div>

          <div style={{ background: C.cream, borderRadius: 10, padding: 13, border: '1px solid ' + C.border }}>
            {includeMenu && <div style={{ fontSize: 13, color: C.maroon, fontWeight: 700 }}>Rs.{perHead}/hd x {pax} = {fmtL(menuCost)}</div>}
            {!includeMenu && <div style={{ fontSize: 13, color: C.muted, fontWeight: 700 }}>Rental only</div>}
            {rental.q != null && (<div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              Rental: {fmtRound(rental.q || 0)} / {fmtRound(rental.t || 0)} / {fmtRound(rental.f || 0)}
            </div>)}
            <RateRow showAll={true} q={fmtRound(adjVm.q || 0)} t={fmtRound(adjVm.t || 0)} f={fmtRound(adjVm.f || 0)} />
          </div>

          {/* Time-to-date (admin only) */}
          {ttdData.length > 0 && (
            <div style={{ background: '#FFF8F0', borderRadius: 10, padding: 13, marginTop: 10, border: '1px solid #F5DEB3' }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Time to Date</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {ttdData.map(function (td, idx) {
                  var on = ttdIdx === idx
                  return (<button key={idx} onClick={function () { setTtdIdx(idx) }} style={{
                    textAlign: 'left', width: '100%', padding: 9, borderRadius: 9,
                    border: '2px solid ' + (on ? C.gold : C.border), background: on ? '#FFF8F0' : '#fff',
                    color: on ? C.gold : C.muted, fontSize: 12, fontWeight: on ? 700 : 600, cursor: 'pointer',
                  }}>{td.label}<br /><span style={{ fontSize: 10, opacity: 0.6 }}>{td.pct > 0 ? '-' + (td.pct * 100) + '%' : 'Full'}</span></button>)
                })}
              </div>
            </div>
          )}
        </SectionCard>

        {/* DÉCOR */}
        <SectionCard title="Décor">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: -8, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: includeDecor ? '#166534' : C.muted }}>{includeDecor ? 'Included' : 'Off'}</span>
              <Toggle on={includeDecor} onToggle={function () { setIncludeDecor(!includeDecor) }} />
            </div>
          </div>
          <div style={{ opacity: includeDecor ? 1 : 0.3, pointerEvents: includeDecor ? 'auto' : 'none' }}>
          {venDecorMode === 'p' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              {[0, 1, 2].map(function (dx) {
                var on = decorIdx === dx
                return (<button key={dx} onClick={function () { setDecorIdx(dx) }} style={{
                  textAlign: 'center', width: '100%', padding: 9, borderRadius: 9,
                  border: '2px solid ' + (on ? C.maroon2 : C.border), background: on ? C.cream : '#fff',
                  color: on ? C.maroon : C.muted, fontSize: 11, fontWeight: on ? 700 : 600,
                  cursor: 'pointer',
                }}>{DECOR_LABELS[dx]}</button>)
              })}
            </div>
          ) : venDecorMode === 'eg' ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {['Standard', 'Banquet'].map(function (label, idx) {
                var on = decorIdx === idx
                return (<button key={idx} onClick={function () { setDecorIdx(idx) }} style={{
                  flex: 1, textAlign: 'center', padding: 9, borderRadius: 9,
                  border: '2px solid ' + (on ? C.maroon2 : C.border), background: on ? C.cream : '#fff',
                  color: on ? C.maroon : C.muted, fontSize: 12, fontWeight: on ? 700 : 600, cursor: 'pointer',
                }}>{label}</button>)
              })}
            </div>
          ) : (
            <div style={{ padding: 10, background: C.cream, borderRadius: 9, fontSize: 13, color: C.maroon2, marginBottom: 10, border: '1px solid ' + C.border }}>
              <strong>{venName}</strong> | {isWedding ? 'Wedding' : 'Non-Wedding'}
            </div>
          )}
          </div>
          <RateRow showAll={true} q={fmtRound(adjDecor.q || 0)} t={fmtRound(adjDecor.t || 0)} f={fmtRound(adjDecor.f || 0)} />
        </SectionCard>

        {/* DJ */}
        <SectionCard title="DJ">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: -8, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: includeDj ? '#166534' : C.muted }}>{includeDj ? 'Included' : 'Off'}</span>
              <Toggle on={includeDj} onToggle={function () { setIncludeDj(!includeDj) }} />
            </div>
          </div>
          <div style={{ opacity: includeDj ? 1 : 0.3, pointerEvents: includeDj ? 'auto' : 'none' }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            {[1, 0].map(function (idx) {
              var on = djIdx === idx
              return (<button key={idx} onClick={function () { setDjIdx(idx) }} style={{
                flex: 1, textAlign: 'center', padding: '12px 8px', borderRadius: 10,
                border: '2px solid ' + (on ? C.maroon2 : C.border), background: on ? C.cream : '#fff',
                color: on ? C.maroon : C.muted, fontSize: 12, fontWeight: on ? 700 : 600, cursor: 'pointer',
              }}>{DJ_LABELS[idx]}</button>)
            })}
          </div>
          </div>
          <RateRow showAll={true} q={fmtK(adjDj.q || 0)} t={fmtK(adjDj.t || 0)} f={fmtK(adjDj.f || 0)} />
        </SectionCard>

        {/* GRAND TOTAL */}
        <div style={{ background: 'linear-gradient(135deg,#4A1111,#8B2D2D)', borderRadius: 14, padding: 18, marginBottom: 12, color: '#fff' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, marginBottom: 12 }}>Grand Total</div>
          <RateRow showAll={true} q={fmtRound(adjTotal.q || 0)} t={fmtRound(adjTotal.t || 0)} f={fmtRound(adjTotal.f || 0)} />
          {(<div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', textAlign: 'center', marginTop: 8 }}>
            Exact: {fmtL(adjTotal.q || 0)} / {fmtL(adjTotal.t || 0)} / {fmtL(adjTotal.f || 0)}
          </div>)}

          <button onClick={function () { setShowProposal(!showProposal) }} style={{
            width: '100%', marginTop: 12, padding: 13, borderRadius: 10,
            border: '2px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.08)',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>{showProposal ? 'Hide' : 'Proposal'}</button>

          <button onClick={printQuote} disabled={!calcResult} style={{
            width: '100%', marginTop: 8, padding: 13, borderRadius: 10,
            border: '2px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.08)',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            opacity: !calcResult ? 0.5 : 1,
          }}>🖨️ Print Quote</button>

          <button onClick={saveQuote} disabled={saving || pushing || !calcResult} style={{
            width: '100%', marginTop: 8, padding: 13, borderRadius: 10,
            border: '2px solid rgba(212,135,44,.4)', background: 'rgba(212,135,44,.15)',
            color: '#FBBF24', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            opacity: (saving || pushing || !calcResult) ? 0.5 : 1,
          }}>{saving ? 'Saving...' : savedId ? 'Update Quote' : 'Save Quote'}</button>
          <button onClick={askAI} disabled={analyzing || !calcResult} style={{
            width: '100%', marginTop: 8, padding: 13, borderRadius: 10,
            border: '2px solid rgba(99,202,253,.4)', background: 'rgba(99,202,253,.12)',
            color: '#7DD3FC', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            opacity: (analyzing || !calcResult) ? 0.5 : 1,
          }}>{analyzing ? 'Analyzing...' : '✨ AI Analysis'}</button>

          {saveMsg && (<div style={{ textAlign: 'center', marginTop: 6, fontSize: 12, color: saveMsg.startsWith('Error') ? '#FCA5A5' : '#86EFAC' }}>{saveMsg}</div>)}

          {savedId && <StatusBar quoteStatus={quoteStatus} onUpdate={updateStatus} />}
          {savedId && lmsRef && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: '#DBEAFE', border: '1px solid #93C5FD', fontSize: 12, fontWeight: 600, color: '#1D4ED8', textAlign: 'center' }}>
              LMS Lead #{lmsRef}
            </div>
          )}
          {pushing && (
            <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: '#FBBF24', fontWeight: 600 }}>Pushing to LMS...</div>
          )}
        </div>

        {showLmsPush && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: 20, maxWidth: 340, width: '100%' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.maroon, marginBottom: 10 }}>Send to LMS?</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 6 }}>
                This will create a venue lead in LMS under <strong>{profile.name}</strong>.
              </div>
              <div style={{ fontSize: 12, color: '#333', lineHeight: 1.6, marginBottom: 14, padding: 10, background: C.bg, borderRadius: 8, border: '1px solid ' + C.border }}>
                <div><strong>{guestName}</strong> · {guestPhone || 'No phone'}</div>
                <div>{venName} · {locationName}</div>
                <div>{fmtDate(eventDate)} · {SLOTS[slot]} · {pax}pax</div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={function () { setShowLmsPush(false) }} style={{
                  flex: 1, padding: 11, borderRadius: 9, border: '2px solid ' + C.border,
                  background: '#fff', color: C.muted, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>Cancel</button>
                <button onClick={pushToLms} style={{
                  flex: 1, padding: 11, borderRadius: 9, border: 'none',
                  background: 'linear-gradient(135deg,#1D4ED8,#2563EB)', color: '#fff',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>Push to LMS</button>
              </div>
            </div>
          </div>
        )}

        {/* NOTES */}
        <SectionCard title="Notes">
          <textarea value={notes} onChange={function(e){ setNotes(e.target.value) }}
            rows="3" maxLength="1000" placeholder="Remarks, special requests, negotiation context..."
            style={{ width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, fontFamily: 'inherit', color: '#3D2B2B', background: C.bg, resize: 'vertical', outline: 'none' }} />
          {notes.length > 0 && <div style={{ fontSize: 10, color: C.muted, textAlign: 'right', marginTop: 4 }}>{notes.length}/1000</div>}
        </SectionCard>

        {/* DEAL VALUE */}
        <SectionCard title="Deal Value">
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Enter negotiated amounts per component (₹L)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            {[
              { label: 'V+M', val: dealVm, set: setDealVm, ph: adjVm.q },
              { label: 'Décor', val: dealDecor, set: setDealDecor, ph: adjDecor.q },
              { label: 'Entertainment', val: dealEnt, set: setDealEnt, ph: adjDj.q },
            ].map(function (f) {
              return (
                <div key={f.label}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 4 }}>{f.label}</div>
                  <input type="number" inputMode="decimal" step="any" value={f.val}
                    placeholder={f.ph ? rd(f.ph) : '0'}
                    onInput={function (e) { f.set(e.target.value) }}
                    style={{ width: '100%', padding: '9px 6px', borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, fontWeight: 700, color: C.maroon, textAlign: 'center', boxSizing: 'border-box' }} />
                </div>
              )
            })}
          </div>
          {hasDeal && (
            <div style={{ background: 'linear-gradient(135deg,#4A1111,#8B2D2D)', borderRadius: 10, padding: '10px 14px', color: '#fff', textAlign: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, letterSpacing: 1, marginBottom: 2 }}>NEGOTIATED TOTAL</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtRound(dealTotal)}</div>
            </div>
          )}
          {hasDeal && adjTotal.q > 0 && (<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            {[
              { label: 'vs QUOTE', val: adjTotal.q, color: C.maroon, bg: C.cream },
              { label: 'vs TARGET', val: adjTotal.t, color: '#0369A1', bg: '#E0F2FE' },
              { label: 'vs FLOOR', val: adjTotal.f, color: '#991B1B', bg: '#FEE2E2' },
            ].map(function (x) {
              var diff = rd(dealTotal - x.val)
              var pct = rd((diff / x.val) * 100)
              return (<div key={x.label} style={{ background: x.bg, borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: x.color, marginBottom: 2 }}>{x.label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: diff >= 0 ? '#166534' : '#DC2626' }}>{diff >= 0 ? '+' : ''}{rd(diff)}L</div>
                <div style={{ fontSize: 10, color: x.color, opacity: 0.6 }}>{pct >= 0 ? '+' : ''}{pct}%</div>
              </div>)
            })}
          </div>)}
          {hasDeal && (<button onClick={function () {
            var txt = 'AMBRIA DEAL\n' + venName + ' | ' + (guestName || 'Guest') + '\n' +
              currentET.label + ' | ' + fmtDate(eventDate) + ' | ' + pax + 'pax\n' +
              '========================\n' +
              'V+M: ₹' + (dealVm || 0) + 'L | Décor: ₹' + (dealDecor || 0) + 'L | Ent: ₹' + (dealEnt || 0) + 'L\n' +
              'TOTAL: ₹' + rd(dealTotal) + 'L\n========================'
            copyText(txt)
          }} style={{
            width: '100%', marginTop: 4, padding: 12, borderRadius: 10, border: 'none',
            background: 'linear-gradient(135deg,#4A1111,#8B2D2D)', color: '#fff',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>Copy Deal Summary</button>)}
        </SectionCard>
        {showAnalysis && (
          <SectionCard title="AI Analysis">
            {analyzing && <div style={{ textAlign: 'center', padding: 20, color: C.muted, fontSize: 13 }}>Analyzing quote...</div>}
            {analysis && analysis.error && <div style={{ color: '#DC2626', fontSize: 12, padding: 10 }}>{analysis.error}</div>}
            {analysis && !analysis.error && (<div style={{ fontSize: 12, lineHeight: 1.8, color: '#333' }}>
              <div style={{ fontWeight: 700, color: C.maroon, marginBottom: 8 }}>{analysis.summary}</div>
              {analysis.strengths && (<div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: '#166534' }}>Strengths: </span>
                {analysis.strengths.join(' · ')}
              </div>)}
              {analysis.risks && (<div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: '#991B1B' }}>Risks: </span>
                {analysis.risks.join(' · ')}
              </div>)}
              {analysis.suggestions && (<div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: '#0369A1' }}>Suggestions: </span>
                {analysis.suggestions.join(' · ')}
              </div>)}
              {analysis.closing_tip && (<div style={{ marginTop: 8, padding: 10, background: '#FFF8F0', borderRadius: 8, fontWeight: 600, color: C.gold }}>
                💡 {analysis.closing_tip}
              </div>)}
            </div>)}
            <button onClick={function () { setShowAnalysis(false) }} style={{
              width: '100%', marginTop: 10, padding: 10, borderRadius: 8, border: '1px solid ' + C.border,
              background: '#fff', color: C.muted, fontSize: 12, cursor: 'pointer',
            }}>Close</button>
          </SectionCard>
        )}

        {/* PROPOSAL */}
        {showProposal && (
          <SectionCard title="Proposal">
            <pre style={{ fontSize: 11, lineHeight: 1.7, background: C.bg, borderRadius: 9, padding: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace', border: '1px solid ' + C.border, overflow: 'auto' }}>{proposalText}</pre>
            <button onClick={function () { copyText(proposalText) }} style={{
              width: '100%', padding: 14, borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg,#4A1111,#8B2D2D)', color: '#fff',
              fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8,
            }}>Copy</button>
          </SectionCard>
        )}

        {/* TAX CALCULATOR (admin only, client-side GST math) */}
        {<SectionCard title="Tax Calculator">
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Deal: Rs.{dealVal}L</div>
          <input type="range" min={5} max={60} step={0.5} value={dealVal}
            onInput={function (e) { setDealVal(+e.target.value) }} style={{ width: '100%', accentColor: C.maroon2, marginBottom: 10 }} />

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Type</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            {['+ Tax', 'All-In'].map(function (label, idx) {
              var on = taxMode === idx
              return (<button key={idx} onClick={function () { setTaxMode(idx) }} style={{
                flex: 1, padding: 10, borderRadius: 9, border: '2px solid ' + (on ? C.gold : C.border),
                background: on ? '#FFF8F0' : '#fff', color: on ? C.gold : C.muted,
                fontSize: 14, fontWeight: 700, textAlign: 'center', cursor: 'pointer',
              }}>{label}</button>)
            })}
          </div>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>5:18 = {split5}:{100 - split5}</div>
          <input type="range" min={10} max={90} step={5} value={split5}
            onInput={function (e) { setSplit5(+e.target.value) }} style={{ width: '100%', accentColor: C.gold, marginBottom: 10 }} />

          <div style={{ background: C.bg, borderRadius: 10, padding: 11, marginBottom: 10, fontSize: 13, border: '1px solid ' + C.border }}>
            {[['Deal', fmtL(dealVal), C.maroon], ['@5%', fmtL(a5), '#0369A1'], ['@18%', fmtL(a18), C.maroon2],
              ['Tax@5', fmtINR(t5), '#0369A1'], ['Tax@18', fmtINR(t18), C.maroon2]].map(function (row) {
              return (<div key={row[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid ' + C.border }}>
                <span style={{ color: C.muted }}>{row[0]}</span>
                <span style={{ fontWeight: 700, color: row[2] }}>{row[1]}</span>
              </div>)
            })}
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 10, gridTemplateColumns: '1fr 1fr 1fr' }}>
            {[
              { val: fmtL(ttx) + ' (' + effRate + '%)', label: 'TOTAL TAX', color: C.maroon, bg: C.cream },
              { val: fmtL(guestPays), label: 'GUEST PAYS', color: '#0369A1', bg: '#E0F2FE' },
              { val: fmtL(netToYou), label: 'NET TO YOU', color: '#991B1B', bg: '#FEE2E2' },
            ].map(function (x) {
              return (<div key={x.label} style={{ background: x.bg, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: x.color, fontWeight: 700, marginBottom: 4 }}>{x.label}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: x.color }}>{x.val}</div>
              </div>)
            })}
          </div>
        </SectionCard>}

        </>}
        <button onClick={function () { setPage(0) }} style={{
          width: '100%', padding: 12, borderRadius: 10, border: '2px solid ' + C.border,
          background: '#fff', color: C.muted, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 10,
        }}>Back to Guest Info</button>
      </>)}
    </div>
  )
}

export default QuoteCalculator
