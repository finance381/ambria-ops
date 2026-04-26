import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

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
function fmtRound(n) { return '\u20B9' + (Math.round(n * 2) / 2) + 'L' }
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

function StatusBar({ quoteStatus, onUpdate }) {
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.4, marginBottom: 6 }}>Status</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { key: 'draft', label: 'Draft', color: '#9CA3AF' },
          { key: 'sent', label: 'Sent', color: '#60A5FA' },
          { key: 'accepted', label: 'Accepted', color: '#34D399' },
          { key: 'rejected', label: 'Rejected', color: '#F87171' },
          { key: 'converted', label: 'Converted', color: '#FBBF24' },
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
  var [eventDate, setEventDate] = useState('')
  var [inquiryMode, setInquiryMode] = useState('')
  var [eventTypeIdx, setEventTypeIdx] = useState(0)
  var [venueIdx, setVenueIdx] = useState(0)
  var [foodPref, setFoodPref] = useState(0)
  var [pax, setPax] = useState(400)
  var [slot, setSlot] = useState(0)
  var [catOverride, setCatOverride] = useState(2)
  var [menuIdx, setMenuIdx] = useState(3)
  var [decorIdx, setDecorIdx] = useState(0)
  var [djIdx, setDjIdx] = useState(1)
  var [ttdIdx, setTtdIdx] = useState(0)
  var [showProposal, setShowProposal] = useState(false)
  var [packageVal, setPackageVal] = useState('')
  var [analysis, setAnalysis] = useState(null)
  var [analyzing, setAnalyzing] = useState(false)
  var [showAnalysis, setShowAnalysis] = useState(false)

  // Tax calc (pure GST math, stays client-side)
  var [dealVal, setDealVal] = useState(14)
  var [taxMode, setTaxMode] = useState(0)
  var [split5, setSplit5] = useState(50)

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

  // DB-driven lists
  var [inquiryModes, setInquiryModes] = useState(FALLBACK_MODES)
  var [eventTypes, setEventTypes] = useState(FALLBACK_ET)

  useEffect(function () {
    supabase.from('quote_config').select('key, value').in('key', ['inquiry_modes', 'event_types', 'season_dates']).then(function (res) {
      if (!res.data) return
      res.data.forEach(function (row) {
        if (row.key === 'inquiry_modes' && Array.isArray(row.value)) setInquiryModes(row.value)
        if (row.key === 'event_types' && Array.isArray(row.value)) setEventTypes(row.value)
        if (row.key === 'season_dates' && row.value) setSeasonDates(row.value)
      })
    })
  }, [])

  // Server calc
  var [calcResult, setCalcResult] = useState(null)
  var [calcLoading, setCalcLoading] = useState(false)
  var debounceRef = useRef(null)
  var firstCall = useRef(true)

  // Derived
  var currentET = eventTypes[eventTypeIdx] || eventTypes[0] || { label: 'Wedding', wedding: true }
  var isWedding = currentET.wedding
  var dc = classifyDate(eventDate, seasonDates)
  var ct = dc >= 0 ? dc : catOverride

  // ── RPC call ──
  async function fetchCalc() {
    setCalcLoading(true)
    var { data, error } = await supabase.rpc('calculate_quote', {
      p_venue_idx: venueIdx,
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
    if (!error && data) setCalcResult(data)
    setCalcLoading(false)
  }

  useEffect(function () {
    if (firstCall.current) {
      firstCall.current = false
      fetchCalc()
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchCalc, 300)
    return function () { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [venueIdx, pax, slot, ct, menuIdx, decorIdx, djIdx, ttdIdx, foodPref, eventTypeIdx])

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
  var perHead = r.per_head || 0
  var menuCost = r.menu_cost || 0
  var ttdData = r.ttd || []
  var decorRel = r.decor_relevance || []
  var venName = r.venue_name || VENUE_NAMES[venueIdx][0]
  var isPlaceholder = r.is_placeholder || false
  var venDecorMode = r.venue_decor_mode || 'p'
  var isSummer = eventDate ? (function () { var m = new Date(eventDate + 'T00:00:00').getMonth(); return m >= 3 && m <= 7 })() : false

  // Tax calc (client-side)
  var a5 = rd(dealVal * split5 / 100), a18 = rd(dealVal * (1 - split5 / 100))
  var t5 = rd(a5 * 0.05), t18 = rd(a18 * 0.18), ttx = rd(t5 + t18)
  var effRate = rd((ttx / dealVal) * 100)
  var guestPays = taxMode ? dealVal : rd(dealVal + ttx)
  var netToYou = taxMode ? rd(dealVal - ttx) : dealVal

  // Sync deal slider to quote total when calc result changes
  useEffect(function () {
    if (total.q) {
      var rounded = Math.round(total.q * 2) / 2
      setDealVal(Math.max(5, Math.min(60, rounded)))
    }
  }, [total.q])

  // Handlers
  function handleEventType(idx) {
    setEventTypeIdx(idx)
    var wed = (eventTypes[idx] || {}).wedding
  }

  function handleDateChange(val) {
    setEventDate(val)
    setTtdIdx(autoTtdIdx(val))
    var c = classifyDate(val, seasonDates)
    if (c >= 0) setCatOverride(c)
    if (c === 0) setMenuIdx(3)
  }

  function handleFoodPref(fp) {
    setFoodPref(fp)
    if (ct === 0) setMenuIdx(3)
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
  var proposalText = 'AMBRIA PROPOSAL\n========================\nVenue: ' + venName +
    '\nBy: ' + profile.name +
    '\nGuest: ' + (guestName || '-') + ' | ' + (guestPhone || '-') +
    '\nMode: ' + (inquiryMode || '-') +
    '\n' + currentET.label + ' | ' + (foodPref === 0 ? 'Veg' : 'NV') +
    '\nDate: ' + fmtDate(eventDate) + ' (' + CAT_LABELS[ct] + ') | ' + SLOTS[slot] + ' | ' + pax + 'pax' +
    '\nMenu: ' + (r.menu_label || MENU_LABELS[activeMenu]) + ' Rs.' + perHead + '/hd' +
    '\n========================' +
    '\n1)V+M: ' + fmtRound(vm.q || 0) + ' > ' + fmtRound(vm.f || 0) +
    '\n2)Dec: ' + fmtRound(decor.q || 0) + ' > ' + fmtRound(decor.f || 0) +
    '\n3)DJ: ' + fmtK(dj.q || 0) + ' > ' + fmtK(dj.f || 0) +
    '\n========================' +
    '\nQUOTE: ' + fmtRound(total.q || 0) +
    '\nTARGET: ' + fmtRound(total.t || 0) +
    '\nFLOOR: ' + fmtRound(total.f || 0) +
    '\n========================'

  // ── Persistence ──
  function toPaise(lakhs) { return Math.round(lakhs * 10000000) }
  function fromPaise(paise) { return paise / 10000000 }

  async function saveQuote() {
    if (saving || !calcResult) return
    setSaving(true); setSaveMsg('')
    var row = {
      created_by: profile.id, guest_name: guestName, guest_phone: guestPhone,
      inquiry_mode: inquiryMode,
      event_type: currentET.label, event_date: eventDate || null,
      venue_idx: venueIdx, venue_name: venName, food_pref: foodPref, pax: pax,
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
      deal_value_paise: packageVal ? Math.round(+packageVal * 10000000) : null,
    }
    if (taxMode !== 0 || split5 !== 50) {
      row.tax_mode = taxMode; row.split_5_pct = split5
      row.total_tax_paise = toPaise(ttx); row.guest_pays_paise = toPaise(guestPays); row.net_to_you_paise = toPaise(netToYou)
    }
    try {
      if (savedId) {
        var { data, error } = await supabase.from('quotes').update(Object.assign(row, { revision: undefined }))
          .eq('id', savedId).select('id, revision').single()
        if (error) throw error
        await supabase.from('quotes').update({ revision: (data.revision || 1) + 1 }).eq('id', savedId)
        setSaveMsg('Updated')
      } else {
        var { data, error } = await supabase.from('quotes').insert(row).select('id').single()
        if (error) throw error
        setSavedId(data.id); setQuoteStatus('draft'); setSaveMsg('Saved')
      }
    } catch (e) { setSaveMsg('Error: ' + (e.message || 'Save failed')) }
    setSaving(false); setTimeout(function () { setSaveMsg('') }, 3000)
  }

  async function loadQuotes() {
    setLoadingQuotes(true)
    var { data } = await supabase.from('quotes').select('*').order('updated_at', { ascending: false }).limit(50)
    setQuotes(data || []); setLoadingQuotes(false)
  }

  function loadQuote(q) {
    setGuestName(q.guest_name || ''); setGuestPhone(q.guest_phone || ''); setEventDate(q.event_date || '')
    setInquiryMode(q.inquiry_mode || '')
    var etIdx = 0
    for (var i = 0; i < eventTypes.length; i++) { if (eventTypes[i].label === q.event_type) { etIdx = i; break } }
    setEventTypeIdx(etIdx); setVenueIdx(q.venue_idx || 0)
    setFoodPref(q.food_pref || 0); setPax(q.pax || 400); setSlot(q.slot || 0)
    setCatOverride(q.date_category || 2); setMenuIdx(q.menu_idx != null ? q.menu_idx : 3)
    setDecorIdx(0); setDjIdx(1); setTtdIdx(q.ttd_idx != null ? q.ttd_idx : autoTtdIdx(q.event_date)); setPackageVal(''); setDealVal(14); setTaxMode(0); setSplit5(50)
    if (q.deal_value_paise != null) { setPackageVal(String(fromPaise(q.deal_value_paise))); setTaxMode(q.tax_mode || 0); setSplit5(q.split_5_pct || 50) }
    setSavedId(q.id); setQuoteStatus(q.status || 'draft'); setNotes(q.notes || '')
    setShowQuotes(false); setShowProposal(false); setPage(0)
  }

  function newQuote() {
    setGuestName(''); setGuestPhone(''); setEventDate(''); setInquiryMode(''); setEventTypeIdx(0)
    setVenueIdx(0); setFoodPref(0); setPax(400); setSlot(0); setCatOverride(2); setMenuIdx(3)
    setDecorIdx(0); setDjIdx(1); setTtdIdx(0); setDealVal(14); setTaxMode(0); setSplit5(50)
    setQuoteStatus('draft'); setSavedId(null); setNotes(''); setShowQuotes(false); setShowProposal(false); setPage(0)
  }

  async function updateStatus(s) {
    if (!savedId) return
    var { error } = await supabase.from('quotes').update({ status: s }).eq('id', savedId)
    if (error) { setSaveMsg('Error: ' + error.message); return }
    setQuoteStatus(s)
  }
  async function askAI() {
    if (analyzing || !calcResult) return
    setAnalyzing(true); setAnalysis(null); setShowAnalysis(true)
    try {
      var { data: demandData } = await supabase
          .from('quotes')
          .select('id, venue_idx, status')
          .eq('event_date', eventDate)
      var { data: weekData } = await supabase
          .from('quotes')
          .select('id')
          .gte('event_date', eventDate)
          .lte('event_date', new Date(new Date(eventDate + 'T00:00:00').getTime() + 6*86400000).toISOString().split('T')[0])
      var quoteData = {
        venue: venName, date: fmtDate(eventDate), category: CAT_LABELS[ct],
        slot: SLOTS[slot], pax: pax, food: foodPref === 0 ? 'Veg' : 'Non-Veg',
        event_type: currentET.label, is_wedding: isWedding,
        menu: calcResult.menu_label, per_head: calcResult.per_head,
        rental: rental, vm: vm, decor: decor, dj: dj, total: total,
        ttd: ttdData[ttdIdx] || null,
        package_value: packageVal ? +packageVal : null,
        demand: {
          same_date: (demandData || []).length,
          same_date_same_venue: (demandData || []).filter(function(q) { return q.venue_idx === venueIdx }).length,
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Phone</div>
              <input type="tel" value={guestPhone} placeholder="+91 98765 43210"
                onChange={function (e) { setGuestPhone(e.target.value.replace(/[^0-9+\- ]/g, '').slice(0, 16)) }}
                style={{ width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, marginBottom: 10 }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Event Date</div>
              <input type="date" value={eventDate} onChange={function (e) { handleDateChange(e.target.value) }}
                style={{ width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, marginBottom: 10 }} />
              {dc >= 0 && (<div style={{ padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, background: CAT_BG[dc], color: CAT_COLORS[dc], border: '1px solid ' + C.border }}>
                {fmtDate(eventDate)} – {CAT_LABELS[dc]}{dc === 0 ? (venueIdx === 0 ? ' | Luxury only' : ' | Lux/MC') : dc === 1 ? ' | Lux/MC' : ' | All'}
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

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Event Type</div>
            <select value={eventTypeIdx} onChange={function (e) { handleEventType(+e.target.value) }}
              style={{
                width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border,
                fontSize: 14, marginBottom: 6, background: '#fff', color: C.maroon,
              }}>
              {eventTypes.map(function (et, idx) {
                return <option key={idx} value={idx}>{et.icon} {et.label}</option>
              })}
            </select>
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
            {VENUE_NAMES.map(function (v, idx) {
              var on = venueIdx === idx
              var isPh = v[2] === 'placeholder'
              return (<button key={idx} onClick={function () { if (!isPh) setVenueIdx(idx) }} style={{
                textAlign: 'left', width: '100%', padding: 11, borderRadius: 10,
                border: '2px solid ' + (on && !isPh ? C.gold : C.border), background: on && !isPh ? '#FFF8F0' : '#fff',
                color: isPh ? '#ccc' : on ? C.maroon : C.muted, fontSize: 12, fontWeight: on ? 700 : 600,
                cursor: isPh ? 'not-allowed' : 'pointer', opacity: isPh ? 0.5 : 1,
              }}><div>{isPh ? '🚧 ' : ''}{v[0]}</div><div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{isPh ? 'Coming soon' : v[1]}</div></button>)
            })}
          </div>

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

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Pax: {pax}</div>
          <input type="range" min={100} max={1000} step={50} value={pax}
            onChange={function (e) { setPax(+e.target.value) }} style={{ width: '100%', accentColor: C.maroon2 }} />
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

        {/* Venue selector (synced) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 12 }}>
          {VENUE_NAMES.map(function (v, idx) {
            var on = venueIdx === idx
            var isPh = v[2] === 'placeholder'
            return (<button key={idx} onClick={function () { if (!isPh) { setVenueIdx(idx); setDecorIdx(0) } }} style={{
              padding: '8px 4px', borderRadius: 9, border: '2px solid ' + (on && !isPh ? C.gold : C.border),
              background: on && !isPh ? '#FFF8F0' : '#fff', color: isPh ? '#ccc' : on ? C.maroon : C.muted,
              fontSize: 11, fontWeight: on ? 700 : 600, cursor: isPh ? 'not-allowed' : 'pointer',
              opacity: isPh ? 0.5 : 1, textAlign: 'center',
            }}>{isPh ? '🚧' : v[0].replace('Ambria ', '')}</button>)
          })}
        </div>

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
          }}>{fmtDate(eventDate)} – {CAT_LABELS[ct]}</div>)}
          <CatPills items={CAT_LABELS} value={ct} onChange={setCatOverride} />

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Slot</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {SLOTS.map(function (s, idx) {
              return <SlotButton key={idx} label={s} on={slot === idx} onClick={function () { setSlot(idx) }} />
            })}
          </div>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Pax: {pax}</div>
          <input type="range" min={100} max={1000} step={50} value={pax}
            onChange={function (e) { setPax(+e.target.value) }} style={{ width: '100%', accentColor: C.maroon2, marginBottom: 10 }} />

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

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Menu ({foodPref === 0 ? 'Veg' : 'NV'})</div>
          {ct === 0 && (<div style={{ padding: '7px 11px', borderRadius: 7, fontSize: 11, marginBottom: 7, background: '#FFF8F0', color: C.gold, border: '1px solid ' + C.border }}>
            {"King's – Lux/MC only"}
          </div>)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {allMenus.map(function (m) {
              var midx = m.idx; var on = activeMenu === midx; var dis = !m.available
              return (<button key={midx} onClick={function () { if (!dis) setMenuIdx(midx) }} style={{
                textAlign: 'center', width: '100%', padding: '10px 8px', borderRadius: 9,
                border: '2px solid ' + (on ? C.maroon2 : C.border), background: on ? C.cream : '#fff',
                color: on ? C.maroon : C.muted, fontSize: 12, fontWeight: on ? 700 : 600,
                cursor: dis ? 'not-allowed' : 'pointer', opacity: dis ? 0.4 : 1,
              }}>
                {m.label}<br />
                <span style={{ fontSize: 10, opacity: 0.6 }}>Rs.{m.per_head}{m.flat_add ? ' +' + m.flat_add + 'L' : ''}</span>
                {dis && m.reason && <br />}
                {dis && m.reason && <span style={{ fontSize: 9, color: '#DC2626' }}>{m.reason}</span>}
              </button>)
            })}
          </div>

          <div style={{ background: C.cream, borderRadius: 10, padding: 13, border: '1px solid ' + C.border }}>
            <div style={{ fontSize: 13, color: C.maroon, fontWeight: 700 }}>Rs.{perHead}/hd x {pax} = {fmtL(menuCost)}</div>
            {rental.q != null && (<div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              Rental: {fmtRound(rental.q || 0)} / {fmtRound(rental.t || 0)} / {fmtRound(rental.f || 0)}
            </div>)}
            <RateRow showAll={true} q={fmtRound(vm.q || 0)} t={fmtRound(vm.t || 0)} f={fmtRound(vm.f || 0)} />
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
          <RateRow showAll={true} q={fmtRound(decor.q || 0)} t={fmtRound(decor.t || 0)} f={fmtRound(decor.f || 0)} />
        </SectionCard>

        {/* DJ */}
        <SectionCard title="DJ">
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
          <RateRow showAll={true} q={fmtK(dj.q || 0)} t={fmtK(dj.t || 0)} f={fmtK(dj.f || 0)} />
        </SectionCard>

        {/* GRAND TOTAL */}
        <div style={{ background: 'linear-gradient(135deg,#4A1111,#8B2D2D)', borderRadius: 14, padding: 18, marginBottom: 12, color: '#fff' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, marginBottom: 12 }}>Grand Total</div>
          <RateRow showAll={true} q={fmtRound(total.q || 0)} t={fmtRound(total.t || 0)} f={fmtRound(total.f || 0)} />
          {(<div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', textAlign: 'center', marginTop: 8 }}>
            Exact: {fmtL(total.q || 0)} / {fmtL(total.t || 0)} / {fmtL(total.f || 0)}
          </div>)}

          <button onClick={function () { setShowProposal(!showProposal) }} style={{
            width: '100%', marginTop: 12, padding: 13, borderRadius: 10,
            border: '2px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.08)',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>{showProposal ? 'Hide' : 'Proposal'}</button>

          <button onClick={saveQuote} disabled={saving || !calcResult} style={{
            width: '100%', marginTop: 8, padding: 13, borderRadius: 10,
            border: '2px solid rgba(212,135,44,.4)', background: 'rgba(212,135,44,.15)',
            color: '#FBBF24', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            opacity: (saving || !calcResult) ? 0.5 : 1,
          }}>{saving ? 'Saving...' : savedId ? 'Update Quote' : 'Save Quote'}</button>
          <button onClick={askAI} disabled={analyzing || !calcResult} style={{
            width: '100%', marginTop: 8, padding: 13, borderRadius: 10,
            border: '2px solid rgba(99,202,253,.4)', background: 'rgba(99,202,253,.12)',
            color: '#7DD3FC', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            opacity: (analyzing || !calcResult) ? 0.5 : 1,
          }}>{analyzing ? 'Analyzing...' : '✨ AI Analysis'}</button>

          {saveMsg && (<div style={{ textAlign: 'center', marginTop: 6, fontSize: 12, color: saveMsg.startsWith('Error') ? '#FCA5A5' : '#86EFAC' }}>{saveMsg}</div>)}

          {savedId && <StatusBar quoteStatus={quoteStatus} onUpdate={updateStatus} />}
        </div>

        {/* NOTES */}
        <SectionCard title="Notes">
          <textarea value={notes} onChange={function(e){ setNotes(e.target.value) }}
            rows="3" maxLength="1000" placeholder="Remarks, special requests, negotiation context..."
            style={{ width: '100%', padding: 11, borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, fontFamily: 'inherit', color: '#3D2B2B', background: C.bg, resize: 'vertical', outline: 'none' }} />
          {notes.length > 0 && <div style={{ fontSize: 10, color: C.muted, textAlign: 'right', marginTop: 4 }}>{notes.length}/1000</div>}
        </SectionCard>

        {/* DEAL VALUE */}
        <SectionCard title="Deal Value">
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 600 }}>Negotiated Package (₹L)</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" value={packageVal} placeholder={fmtL(total.q || 0).replace('₹', '').replace('L', '')}
              onInput={function (e) { setPackageVal(e.target.value) }}
              style={{ flex: 1, padding: 11, borderRadius: 9, border: '2px solid ' + C.border, fontSize: 16, fontWeight: 700, color: C.maroon }} />
            <span style={{ fontSize: 14, color: C.muted, fontWeight: 600 }}>₹L</span>
          </div>
          {packageVal && total.q && (<div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { label: 'vs QUOTE', val: total.q, color: C.maroon, bg: C.cream },
              { label: 'vs TARGET', val: total.t, color: '#0369A1', bg: '#E0F2FE' },
              { label: 'vs FLOOR', val: total.f, color: '#991B1B', bg: '#FEE2E2' },
            ].map(function (x) {
              var diff = rd(+packageVal - x.val)
              var pct = rd((diff / x.val) * 100)
              return (<div key={x.label} style={{ background: x.bg, borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: x.color, marginBottom: 2 }}>{x.label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: diff >= 0 ? '#166534' : '#DC2626' }}>{diff >= 0 ? '+' : ''}{diff}L</div>
                <div style={{ fontSize: 10, color: x.color, opacity: 0.6 }}>{pct >= 0 ? '+' : ''}{pct}%</div>
              </div>)
            })}
          </div>)}
          {packageVal && (<button onClick={function () {
            var txt = 'AMBRIA DEAL\n' + venName + ' | ' + (guestName || 'Guest') + '\n' +
              currentET.label + ' | ' + fmtDate(eventDate) + ' | ' + pax + 'pax\n' +
              '========================\nPackage: ₹' + packageVal + 'L\n========================'
            navigator.clipboard.writeText(txt)
          }} style={{
            width: '100%', marginTop: 10, padding: 12, borderRadius: 10, border: 'none',
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
            <button onClick={function () { navigator.clipboard.writeText(proposalText) }} style={{
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
