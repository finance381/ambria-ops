import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import EventDatePicker from '../../components/ui/EventDatePicker'
import { useLang } from '../../lib/i18n.jsx'
import VoiceInput from '../../components/ui/VoiceInput'
import { hasPerm } from '../../lib/permissions'

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
var CAT_COLORS = ['#B45309', '#BE123C', '#475569']
var CAT_BG = ['#FFFBEB', '#FFF1F2', '#F1F5F9']
var FALLBACK_MODES = ['Walk-in', 'Phone', 'WhatsApp']
// Sidebar support card target. Set this to a real number to activate the button.
var SUPPORT_PHONE = ''
var FALLBACK_ET = [
  { label: 'Wedding', wedding: true },
  { label: 'Reception', wedding: false },
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
// Every colour resolves through a CSS variable, so the theme switch in the
// header only has to flip one attribute on the root element.
var C = {
  // legacy keys kept so every existing style reference still resolves
  maroon: 'var(--qc-text)', maroon2: 'var(--qc-primary)', gold: 'var(--qc-primary)',
  cream: 'var(--qc-primary-soft)', border: 'var(--qc-border)',
  muted: 'var(--qc-muted)', bg: 'var(--qc-bg)',
  fieldEdge: 'var(--qc-field-edge)',
  // new roles
  ink: '#1E293B', ink2: '#334155', ink3: '#4B5B70',
  violet: 'var(--qc-primary)', violetDeep: 'var(--qc-primary-deep)',
  violetSoft: 'var(--qc-primary-soft)', lavender: 'var(--qc-primary-soft)',
  text: 'var(--qc-text)', subtle: 'var(--qc-subtle)',
}

// One palette for the three price levels, so a tile carries the same meaning
// wherever it appears. Quote is the primary emerald, target the secondary teal,
// and floor an amber caution: it used to be a #E8EDF3 / #991B1B red, which read
// as an error next to the emerald UI, and a floor price is a limit, not a fault.
var RATE_TONES = {
  quote:  { fg: '#1E293B', bg: 'rgba(51,65,85,.10)', bd: 'rgba(51,65,85,.24)' },
  target: { fg: '#8F6A1C', bg: 'rgba(176,131,36,.08)', bd: 'rgba(176,131,36,.20)' },
  // Floor is the baseline, not a warning, so it gets a warm stone rather than a
  // third accent — and staying off slate keeps it from reading as the primary.
  floor:  { fg: '#78716C', bg: '#FAFAF9',              bd: '#E7E5E4' },
}
// On the ink Grand Total card the light tints go muddy and the amber fill glares,
// so each level gets a dark-surface pair: a low-alpha wash of its own hue and a
// light foreground that actually reads against ink.
// Deep emerald-to-teal wash for the two summary surfaces.
var BRAND_WASH = 'linear-gradient(135deg, #0F172A 0%, #1E293B 46%, #3B4A61 100%)'

var RATE_TONES_BRAND = {
  quote:  { fg: '#FFFFFF', lf: '#E8C57A',               bg: 'rgba(255,255,255,.12)', bd: 'rgba(232,197,122,.38)' },
  target: { fg: '#F1F5F9', lf: '#E2E8F0',               bg: 'rgba(255,255,255,.07)', bd: 'rgba(203,213,225,.24)' },
  floor:  { fg: '#F8FAFC', lf: 'rgba(255,255,255,.62)', bg: 'rgba(255,255,255,.05)', bd: 'rgba(255,255,255,.15)' },
}

// Movement against a reference price — used by the deal tiles and the banner.
var UP_FG = '#15803D'
var DOWN_FG = '#1E293B'

// ═══ GLASS SURFACES ═══
// One frosted recipe reused by every panel so the whole screen reads as one material.
// Inter is imported (self-hosted) in src/index.css.
// Inter covers latin only; the Devanagari fallbacks carry Hindi copy.
var FONT = "'Inter','Nirmala UI','Noto Sans Devanagari','Segoe UI',system-ui,-apple-system,sans-serif"

var GLASS = {
  background: 'linear-gradient(135deg, var(--qc-glass) 0%, rgba(51,65,85,.02) 100%)',
  backgroundImage: 'none',
  backdropFilter: 'none',
  WebkitBackdropFilter: 'none',
  border: '1px solid var(--qc-glass-edge)',
  boxShadow: '0 1px 2px rgba(0,0,0,.05)',
}
function glass(extra) { return Object.assign({}, GLASS, extra || {}) }

// Two-stop wash used by every filled surface, so nothing is a flat fill.
function grad(a, b, deg) { return 'linear-gradient(' + (deg == null ? 135 : deg) + 'deg,' + a + ',' + b + ')' }

// Primary accent — emerald. Solid, no gradient.
var RAMP = '#334155'
var RAMP_DEEP = '#1E293B'
var RAMP_SOFT = 'rgba(51,65,85,.08)'

// Secondary accent — teal. For highlights and complementary elements.
var TEAL = '#B08324'
var TEAL_SOFT = 'rgba(176,131,36,.08)'

// Page background: subtle gradient with green tones
var MESH = {
  background: 'linear-gradient(135deg, var(--qc-bg) 0%, rgba(51,65,85,.03) 100%)',
  backgroundImage: 'none',
}

// ═══ ICONS — inline SVG only, no emoji, no icon-font dependency ═══

var ICON_PATHS = {
  back: 'M19 12H5M12 19l-7-7 7-7',
  forward: 'M5 12h14M12 5l7 7-7 7',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2z',
  pin: 'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z',
  glass: 'M8 22h8M12 15v7M5 3h14l-2 7a5 5 0 0 1-10 0L5 3z',
  ring: 'M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM9 9 7.5 3h9L15 9',
  cake: 'M4 20h16M4 20v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6M12 8V5M8 8V6M16 8V6',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z',
  leaf: 'M11 20A7 7 0 0 1 4 13c0-5 4-9 16-9 0 12-4 16-9 16zM4 20c2-4 5-6 9-7',
  meat: 'M14.5 3a6.5 6.5 0 0 0-6.1 8.8L4 16.2a2.5 2.5 0 0 0 3.5 3.5l4.4-4.4A6.5 6.5 0 0 0 14.5 3z',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M2 21h20',
  flower: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 9V5a2.5 2.5 0 1 1 2.5 2.5M12 15v4a2.5 2.5 0 1 0 2.5-2.5M9 12H5a2.5 2.5 0 1 1 2.5-2.5M15 12h4a2.5 2.5 0 1 0-2.5 2.5',
  music: 'M9 18V6l12-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8z',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  chart: 'M3 3v18h18M7 15V9M12 17V7M17 13v-6',
  chevron: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6L9 17l-5-5',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  signout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  warn: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  cone: 'M12 3l7 18H5l7-18zM9 13h6M8 17h8',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 1 4 12.7V17H8v-2.3A7 7 0 0 1 12 2z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  grid: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM3 9h18M3 15h18M9 9v12M15 9v12',
  pie: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 12V2M12 12l8.5 5',
  chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L7 14.2l-5-4.9 6.9-1L12 2z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z',
  pencil: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  chevronRight: 'M9 18l6-6-6-6',
  headset: 'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z',
}

function Ic({ n, s, c, sw }) {
  var d = ICON_PATHS[n] || ICON_PATHS.sparkle
  return (
    <svg width={s || 16} height={s || 16} viewBox="0 0 24 24" fill="none"
      stroke={c || 'currentColor'} strokeWidth={sw || 1.7}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

// Event-type label → icon name. DB rows still carry an emoji `icon` field;
// it is ignored on purpose so the UI stays emoji-free without a migration.
var ET_ICONS = [
  [/wedding|shaadi|marriage/i, 'heart', '#4F46E5'],
  [/reception|cocktail/i, 'glass', '#B08324'],
  [/engage|ring|roka|sagai/i, 'ring', '#4FA3F7'],
  [/birth|anniv|cake/i, 'cake', '#F0A44E'],
  [/corporate|conference|meet/i, 'building', '#E879A6'],
]
function etIcon(label) {
  var l = label || ''
  for (var i = 0; i < ET_ICONS.length; i++) {
    if (ET_ICONS[i][0].test(l)) return ET_ICONS[i][1]
  }
  return 'sparkle'
}
// Icons stay tinted whether or not the chip is selected, as in the design.
function etTint(label) {
  var l = label || ''
  for (var i = 0; i < ET_ICONS.length; i++) {
    if (ET_ICONS[i][0].test(l)) return ET_ICONS[i][2]
  }
  return '#64748B'
}

// Theme choice is remembered per browser. localStorage throws in some private
// modes, so both helpers degrade to the light default instead of propagating.
var THEME_KEY = 'qc_theme'
function readTheme() {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}
function rememberTheme(val) {
  try { localStorage.setItem(THEME_KEY, val); return true } catch { return false }
}

// "2m ago" / "5h ago" / "3d ago" for the recent-leads rail
function timeAgo(val) {
  if (!val) return ''
  var t = new Date(val).getTime()
  if (isNaN(t)) return ''
  var mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return mins + 'm ago'
  var hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  var days = Math.floor(hrs / 24)
  if (days < 30) return days + 'd ago'
  return Math.floor(days / 30) + 'mo ago'
}

// ═══ FORM PRIMITIVES ═══

var LABEL_ST = { fontSize: 12.5, color: C.text, marginBottom: 7, fontWeight: 600 }

// A select showing its placeholder is greyed out, and Chrome hands that colour
// down to the <option>s in the open list. These give the list its own colours.
var OPT_ST = { color: C.text, background: '#fff' }
var PLACEHOLDER_OPT_ST = { color: C.subtle, background: '#fff' }

// Label + optional leading icon (and, for selects, a trailing chevron)
// wrapped around a control. `tint` colours the leading glyph.
function Field({ label, icon, tint, caret, children, style }) {
  return (
    <div style={style}>
      {label && <div style={LABEL_ST}>{label}</div>}
      <div style={{ position: 'relative' }}>
        {icon && (
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: tint || C.subtle, pointerEvents: 'none', zIndex: 1, display: 'flex',
          }}><Ic n={icon} s={15} /></span>
        )}
        {children}
        {caret && (
          <span style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            color: C.subtle, pointerEvents: 'none', zIndex: 1, display: 'flex',
          }}><Ic n="chevron" s={15} /></span>
        )}
      </div>
    </div>
  )
}

// Shared input/select skin — pass hasIcon to reserve room for the leading glyph.
function inputSt(hasIcon, active) {
  return {
    width: '100%', padding: hasIcon ? '12px 13px 12px 38px' : '12px 13px',
    borderRadius: 8, border: '1px solid ' + (active ? C.violet : C.fieldEdge),
    background: 'linear-gradient(135deg, #FFFFFF 0%, rgba(51,65,85,.015) 100%)',
    backgroundImage: 'none',
    fontSize: 14, fontWeight: 500, color: C.text,
    boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none',
    transition: 'all .2s cubic-bezier(.34,.1,.68,.55), background-color .15s ease',
  }
}

// ═══ COMPONENT ═══

// ═══ SUB-COMPONENTS (outside main — stable references) ═══

function SlotButton({ label, on, onClick }) {
  return (
    <button onClick={onClick} className="qc-press qc-opt" style={{
      flex: 1, padding: '11px 10px', borderRadius: 8,
      border: '1px solid ' + (on ? C.violet : C.border),
      background: on ? 'linear-gradient(135deg, ' + RAMP_SOFT + ' 0%, rgba(51,65,85,.04) 100%)' : 'linear-gradient(135deg, #FFFFFF 0%, rgba(51,65,85,.01) 100%)',
      color: on ? C.violetDeep : C.muted,
      fontSize: 13.5, fontWeight: on ? 700 : 600, textAlign: 'center',
      cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s cubic-bezier(.34,.1,.68,.55)',
    }}>{label}</button>
  )
}

function RateRow({ q, t, f, showAll, onBrand }) {
  var T = onBrand ? RATE_TONES_BRAND : RATE_TONES
  var arr = [{ val: q, label: 'QUOTE', tone: T.quote }]
  if (showAll) {
    arr.push({ val: t, label: 'TARGET', tone: T.target })
    arr.push({ val: f, label: 'FLOOR', tone: T.floor })
  }
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: showAll ? '1fr 1fr 1fr' : '1fr' }}>
      {arr.map(function (x) {
        return (
          <div key={x.label} style={{
            background: x.tone.bg, border: '1px solid ' + x.tone.bd,
            borderRadius: 10, padding: '9px 8px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 9.5, color: x.tone.lf || x.tone.fg, fontWeight: 700, letterSpacing: 0.7, marginBottom: 3, opacity: x.tone.lf ? 1 : 0.75 }}>{x.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: x.tone.fg }}>{x.val}</div>
          </div>
        )
      })}
    </div>
  )
}

function SectionCard({ title, children }) {
  return (
    <div className="qc-up" style={glass({ borderRadius: 12, padding: 18, marginBottom: 12 })}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#1E293B', textTransform: 'uppercase', letterSpacing: 1, paddingBottom: 10, borderBottom: '2px solid ' + TEAL, marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  )
}

// Compact oval choice. The calculator step used to lay its options out as
// full-bleed bars (four venue buttons stretched across the card, a two-button
// wedding toggle the width of the page); these size to their label instead and
// wrap, so a row of choices reads as a row of choices.
function Pill({ label, on, onClick, disabled, icon, tint, sm }) {
  var fg = disabled ? C.subtle : on ? (tint ? tint[0] : C.violetDeep) : C.text
  return (
    <button type="button" onClick={disabled ? undefined : onClick}
      className={disabled ? '' : 'qc-press qc-opt'}
      style={{
        padding: sm ? '6px 13px' : '8px 15px', borderRadius: 999,
        minHeight: sm ? 30 : 36,
        border: '1px solid ' + (on && !disabled ? (tint ? tint[0] : C.violet) : C.border),
        background: on && !disabled ? (tint ? tint[1] : RAMP_SOFT) : '#fff',
        backgroundImage: 'none',
        color: fg, fontSize: sm ? 11.5 : 12.5, fontWeight: on ? 700 : 600,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
        fontFamily: 'inherit', whiteSpace: 'nowrap',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>{icon}{label}</button>
  )
}

// Wrapping row of pills — the standard shape of a choice group on page 1.
var PILL_ROW = { display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12, alignItems: 'center' }

function CatPills({ items, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {items.map(function (label, idx) {
        var on = value === idx
        return (
          <button key={idx} onClick={function () { onChange(idx) }} style={{
            padding: '8px 15px', borderRadius: 999, minHeight: 36, border: '1px solid ' + (on ? C.violet : C.border),
            background: on ? 'linear-gradient(135deg, ' + RAMP_SOFT + ' 0%, rgba(51,65,85,.04) 100%)' : 'linear-gradient(135deg, #FFFFFF 0%, rgba(51,65,85,.01) 100%)',
            color: on ? C.violetDeep : C.muted,
            fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: 'pointer', fontFamily: 'inherit',
            transition: 'all .15s cubic-bezier(.34,.1,.68,.55)',
          }} className="qc-press">{label}</button>
        )
      })}
    </div>
  )
}

function Toggle({ on, onToggle }) {
  return (
    <div onClick={onToggle} style={{
      width: 38, height: 22, borderRadius: 11, cursor: 'pointer',
      background: on ? C.violet : '#D8DCE0',
      padding: 2, transition: 'background .2s ease',
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: 9, background: '#FFFFFF',
        transform: on ? 'translateX(16px)' : 'translateX(0)',
        transition: 'transform .2s ease', boxShadow: '0 1px 3px rgba(0,0,0,.15)',
      }} />
    </div>
  )
}

function StatusBar({ quoteStatus, onUpdate }) {
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,.22)', paddingTop: 11 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,.72)', marginBottom: 7 }}>Status</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          // no per-status colour any more: on the emerald wash the chips read by
          // fill weight, and a teal 'sent' chip had almost no contrast against it
          { key: 'draft', label: 'Draft' },
          { key: 'sent', label: 'Sent' },
        ].map(function (st) {
          var isOn = quoteStatus === st.key
          return (
            <button key={st.key} className="qc-press" onClick={function () { onUpdate(st.key) }} style={{
              padding: '6px 14px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              border: '1px solid ' + (isOn ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.22)'),
              background: isOn ? 'rgba(255,255,255,.22)' : 'transparent',
              color: isOn ? '#fff' : 'rgba(255,255,255,.7)', cursor: 'pointer',
              fontFamily: 'inherit',
            }}>{st.label}</button>
          )
        })}
      </div>
    </div>
  )
}

var AVATAR_TINTS = [
  ['#64748B', '#4B5B70'], ['#6366F1', '#4F46E5'], ['#F59E0B', '#D97706'],
  ['#EC4899', '#DB2777'], ['#64748B', '#64748B'], ['#14B8A6', '#0D9488'],
]

function Sidebar({ page, setPage, quotes, savedId, onLoadQuote, loadingQuotes, profile, onNewQuote }) {
  // The rail used to render a flat top-12. It now shows a short list and pages
  // through what loadQuotes already fetched, so no extra queries are involved.
  var PAGE = 6
  var [shown, setShown] = useState(PAGE)
  var [search, setSearch] = useState('')
  // name, venue, event type, phone and LMS ref are all worth matching: the rail
  // is how a saved quote gets found again.
  var needle = search.trim().toLowerCase()
  var matches = needle === '' ? quotes : quotes.filter(function (q) {
    return [q.guest_name, q.venue_name, q.event_type, q.guest_phone, q.lms_ref]
      .some(function (f) { return f && String(f).toLowerCase().indexOf(needle) >= 0 })
  })
  var visible = matches.slice(0, shown)
  var steps = [
    { key: 0, label: 'Lead / Guest Info', icon: 'user' },
    { key: 1, label: 'Calculator', icon: 'chart' },
  ]
  var initial = ((profile && profile.name) || '?').charAt(0).toUpperCase()
  var railLabel = {
    fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
    color: 'var(--qc-rail-label,rgba(255,255,255,.34))', margin: '0 4px 10px',
  }
  return (
    <aside style={{
      width: 'clamp(232px, 16.5vw, 296px)', flexShrink: 0, alignSelf: 'stretch',
      height: '100%', minHeight: 0, overflow: 'hidden',
      background: 'var(--qc-rail)',
      color: '#fff', padding: '18px 14px', fontFamily: FONT,
      display: 'flex', flexDirection: 'column', gap: 20,
      borderRight: '1px solid rgba(255,255,255,.09)',
      boxShadow: '2px 0 8px rgba(0,0,0,.08)',
      zIndex: 30,
    }}>
      {/* Brand */}
      <div className="qc-slide" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '0 4px' }}>
        <span style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: RAMP,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,.20)',
        }}><span style={{ fontSize: 19, fontWeight: 800, color: '#fff', lineHeight: 1 }}>Q</span></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Quote Calc</div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.45)', marginTop: 1 }}>Ambria</div>
        </div>
      </div>

      {/* Workflow */}
      <div>
        <div style={railLabel}>Workflow</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {steps.map(function (st, i) {
            var active = page === st.key
            return (
              <button key={st.key} className="qc-press qc-slide qc-opt" onClick={function () { setPage(st.key) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 12px', borderRadius: 12,
                  background: active ? RAMP : 'transparent',
                  border: 'none', color: active ? '#fff' : 'rgba(255,255,255,.55)',
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  fontSize: 13.5, fontWeight: active ? 700 : 600, fontFamily: 'inherit',
                  boxShadow: active ? '0 2px 8px rgba(100,116,139,.30)' : 'none',
                  animationDelay: 60 + i * 50 + 'ms',
                }}>
                <span style={{
                  width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                  background: active ? 'rgba(255,255,255,.18)' : 'rgba(100,116,139,.15)',
                  color: active ? '#fff' : '#CBD5E1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><Ic n={st.icon} s={15} /></span>
                {st.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Recent leads */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={railLabel}>Recent leads</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8,
          padding: '7px 11px', borderRadius: 999,
          background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
        }}>
          <Ic n="search" s={13} c="rgba(255,255,255,.45)" />
          <input value={search} placeholder="Search leads"
            onChange={function (e) { setSearch(e.target.value); setShown(PAGE) }}
            style={{
              flex: 1, minWidth: 0, border: 'none', background: 'transparent',
              color: '#fff', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
              outline: 'none', boxShadow: 'none', padding: 0,
            }} />
          {search !== '' && (
            <button onClick={function () { setSearch(''); setShown(PAGE) }}
              aria-label="Clear search" title="Clear search" style={{
                border: 'none', background: 'transparent', padding: 0, lineHeight: 1,
                color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
              }}>{'\u00D7'}</button>
          )}
        </div>
        <div className="qc-noscroll" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {loadingQuotes ? (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', padding: '6px 8px' }}>Loading...</div>
          ) : quotes.length === 0 ? (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', padding: '6px 8px' }}>No saved quotes</div>
          ) : matches.length === 0 ? (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', padding: '6px 8px' }}>No leads match "{search.trim()}"</div>
          ) : visible.map(function (q, i) {
            var isActive = savedId === q.id
            var nm = q.guest_name || 'Untitled'
            var venue = q.venue_name || q.event_type || ''
            var tint = AVATAR_TINTS[i % AVATAR_TINTS.length]
            return (
              <button key={q.id} className="qc-press qc-in qc-opt" onClick={function () { onLoadQuote(q) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  textAlign: 'left', padding: '7px 8px', borderRadius: 11,
                  background: isActive ? 'rgba(100,116,139,.18)' : 'transparent',
                  border: 'none', color: '#fff', cursor: 'pointer',
                  fontFamily: 'inherit', width: '100%',
                  animationDelay: 120 + i * 35 + 'ms',
                }}>
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: tint[0], color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  boxShadow: '0 1px 4px rgba(0,0,0,.15)',
                }}>{nm.charAt(0).toUpperCase()}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nm}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'rgba(255,255,255,.42)', marginTop: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{venue}</span>
                </span>
                {/* one right-hand column: age over pax, both right-aligned, so the
                    numbers stack straight down the rail instead of stepping about */}
                <span style={{ flexShrink: 0, width: 54, textAlign: 'right' }}>
                  <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,.4)' }}>{timeAgo(q.updated_at)}</span>
                  <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,.72)', marginTop: 1.5 }}>{q.pax ? q.pax + 'pax' : ''}</span>
                </span>
              </button>
            )
          })}
          {matches.length > shown && (
            <button className="qc-press" onClick={function () { setShown(shown + PAGE) }} style={{
              marginTop: 6, padding: '8px 10px', borderRadius: 999,
              border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.05)',
              color: 'rgba(255,255,255,.72)', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              Load more
              <span style={{ color: 'rgba(255,255,255,.45)', fontWeight: 600 }}>
                {'(' + (matches.length - shown) + ')'}
              </span>
            </button>
          )}
          {shown > PAGE && matches.length <= shown && (
            <button className="qc-press" onClick={function () { setShown(PAGE) }} style={{
              marginTop: 6, padding: '8px 10px', borderRadius: 999,
              border: '1px solid rgba(255,255,255,.12)', background: 'transparent',
              color: 'rgba(255,255,255,.55)', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>Show less</button>
          )}
        </div>
      </div>

      {/* Support card */}

      {/* User row removed, new quote button removed */}

    </aside>
  )
}

function LivePreview({ page, guestName, venName, etLabel, pax, slotLabel, effVm, effDecor, effEnt, effTotal, adjTotalQ, adjTotalT, adjTotalF, hasDeal, savedId, lmsRef, discountAmt, isDesktop }) {
  var isP0 = page === 0
  function lineVal(v) { return isP0 ? '' : ('\u20B9' + (Math.round(v * 10) / 10) + 'L') }

  var rows = [
    { label: 'Venue + Menu', icon: 'building', val: effVm },
    { label: 'D\u00E9cor', icon: 'flower', val: effDecor },
    { label: 'Entertainment', icon: 'music', val: effEnt },
  ]

  return (
    <div style={Object.assign(
      { display: 'flex', flexDirection: 'column', gap: 12 },
      isDesktop ? { position: 'sticky', top: 12, alignSelf: 'start' } : { marginTop: 12 }
    )}>
      <div className="qc-up" style={glass({
        borderRadius: 16, overflow: 'hidden',
        backgroundImage: 'none',
      })}>
        {/* Header band */}
        <div style={{
          background: '#F9FAFB',
          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: '1px solid #E5E7EB',
        }}>
          <span style={{
            width: 28, height: 28, borderRadius: 9, flexShrink: 0,
            background: '#F3F4F6', color: '#4B5B70',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'none',
          }}><Ic n="activity" s={15} sw={2} /></span>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>Live Preview</div>
        </div>

        <div style={{ padding: 16 }}>
          {/* Guest summary */}
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.muted, marginBottom: 6 }}>Guest</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: '-0.015em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {guestName || 'Guest'}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[venName, etLabel, pax + 'pax', slotLabel].filter(function (x) { return x }).join(' \u00B7 ')}
          </div>

          {/* Line items */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
            {rows.map(function (r, i) {
              return (
                <div key={r.label} className="qc-row qc-opt" style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '11px 8px', margin: '0 -8px', borderRadius: 10,
                  borderTop: i === 0 ? 'none' : '1px solid rgba(30,27,57,.06)',
                }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 9,
                    background: RAMP_SOFT,
                    color: C.violetDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}><Ic n={r.icon} s={14} /></span>                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.text }}>{r.label}</span>
                  {!isP0 && <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{lineVal(r.val)}</span>}
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: C.violet, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: 'none',
                  }}><Ic n="chevronRight" s={12} sw={2.4} /></span>
                </div>
              )
            })}
          </div>

          {/* Q / T / F tiles — only once pricing exists */}
          {!isP0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 12 }}>
              {[
                { label: 'Quote', val: '\u20B9' + (Math.ceil(adjTotalQ * 2) / 2) + 'L', tone: RATE_TONES.quote },
                { label: 'Target', val: '\u20B9' + (Math.ceil(adjTotalT * 2) / 2) + 'L', tone: RATE_TONES.target },
                { label: 'Floor', val: '\u20B9' + (Math.ceil(adjTotalF * 2) / 2) + 'L', tone: RATE_TONES.floor },
              ].map(function (t) {
                return (
                  <div key={t.label} className="qc-opt" style={{
                    background: t.tone.bg, backgroundImage: 'none',
                    border: '1px solid ' + t.tone.bd,
                    borderRadius: 11, padding: '9px 4px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: t.tone.fg, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 3, opacity: 0.75 }}>{t.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: t.tone.fg }}>{t.val}</div>
                  </div>
                )
              })}
            </div>
          )}

        </div>
      </div>

      {/* Hint / status */}
      {isP0 ? (
        <div className="qc-up" style={{
          display: 'flex', gap: 10, background: '#FFFBEB',
          backgroundImage: 'none',
          backdropFilter: 'none', WebkitBackdropFilter: 'none',
          borderRadius: 10, padding: 12, border: '1px solid #FDE68A',
          fontSize: 11.5, color: '#92400E', lineHeight: 1.5,
          boxShadow: '0 6px 22px rgba(180,120,20,.10)', animationDelay: '160ms',
        }}>
          <span style={{
            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
            background: '#FEF9C3', color: '#B45309',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Ic n="bulb" s={14} /></span>
          <span>Fill guest info, then continue to the calculator to see live pricing.</span>
        </div>
      ) : (
        <div className="qc-up" style={glass({ borderRadius: 16, padding: 14, animationDelay: '160ms' })}>
          {hasDeal && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: C.subtle, marginBottom: 4 }}>Negotiated total</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: C.violetDeep }}>{'\u20B9' + (Math.ceil(effTotal * 2) / 2) + 'L'}</div>
              {discountAmt > 0 && (
                <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{'Discount: -\u20B9' + discountAmt + 'L'}</div>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: lmsRef ? '#22C55E' : savedId ? C.violet : '#9CA3AF' }}></span>
            {lmsRef ? 'Sent \u00B7 LMS #' + lmsRef : savedId ? 'Saved \u00B7 not pushed' : 'Draft \u00B7 not saved'}
          </div>
        </div>
      )}
    </div>
  )
}

function StepCard({ step, title, subtitle, children }) {
  return (
    <div className="qc-up qc-step-card" style={glass({
      borderRadius: 16, padding: 20, marginBottom: 14,
      backgroundImage: 'none',
      animationDelay: (step - 1) * 70 + 'ms',
    })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
        <span style={{
          width: 28, height: 28, borderRadius: '50%',
          background: RAMP, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12.5, fontWeight: 700, flexShrink: 0,
          boxShadow: '0 2px 4px rgba(51,65,85,.25), 0 0 0 3px ' + TEAL_SOFT,
        }}>{step}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>{subtitle}</div>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

// In-page header. Deliberately local to the quote screen: Shell's own topbar
// is shared by every module and is left untouched.
// The quote screen's own topbar. Shell suppresses its narrow header for this
// tab, so the language switch and sign-out live here.
// One full-width gradient bar, as in the design: bare title on the left, a
// user card in the middle, and three control pills on the right. Shell hides
// its own header for this tab, so the language switch and sign-out live here.
function PageHeader({ page, onBack, profile, isDesktop, lang, onLang, onSignOut, theme, onToggleTheme }) {
  var [langOpen, setLangOpen] = useState(false)
  var name = (profile && profile.name) || 'User'
  var role = (profile && profile.role) || ''
  var email = (profile && profile.email) || ''
  var initials = name.split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase() }).join('')

  // Shared skin for the discrete controls sitting on the bar.
  var ctrl = {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    height: 36, padding: '0 12px', borderRadius: 8,
    background: '#F9FAFB', backgroundImage: 'none',
    border: '1px solid #E5E7EB',
    color: C.muted, fontSize: 12.5, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
    boxShadow: 'none',
  }

  return (
    <div className="qc-in" style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      padding: isDesktop ? '13px 20px' : '12px 14px',
      background: 'linear-gradient(90deg, #FFFFFF 0%, rgba(51,65,85,.015) 100%)',
      backdropFilter: 'none', WebkitBackdropFilter: 'none',
      borderBottom: '1px solid #E5E7EB',
      boxShadow: '0 1px 3px rgba(0,0,0,.05)',
      flexShrink: 0, zIndex: 60,
    }}>
      {/* Title — sits directly on the bar, no card around it */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <button onClick={onBack} className="qc-press" aria-label="Back" title="Back" style={{
          width: 34, height: 34, borderRadius: 8, flexShrink: 0,
          background: '#F9FAFB', backgroundImage: 'none',
          border: '1px solid #E5E7EB', color: C.muted,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontFamily: 'inherit',
        }}><Ic n="back" s={17} /></button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, lineHeight: 1.25 }}>
            {page === 0 ? 'New Quote' : 'Calculator'}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>
            {page === 0 ? 'Create and calculate live pricing' : 'Menu, decor and negotiated pricing'}
          </div>
        </div>
      </div>

      {/* User card */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 11, minWidth: 0,
        margin: isDesktop ? '0 auto' : '0',
        padding: '6px 12px', borderRadius: 8,
        background: '#F9FAFB', backgroundImage: 'none',
        border: '1px solid #E5E7EB',
        boxShadow: 'none',
      }}>
        <span style={{
          fontSize: 13, fontWeight: 800, color: C.violet,
          letterSpacing: 0.3, flexShrink: 0,
        }}>{initials || '?'}</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>{name}</span>
          {email && <span style={{ display: 'block', fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>{email}</span>}
        </span>
        {role && (
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase',
            background: RAMP_SOFT,
            color: '#4B5B70', padding: '4px 9px', borderRadius: 6, flexShrink: 0,
          }}>{role}</span>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: isDesktop ? 0 : 'auto' }}>
        {/* Language */}
        <div style={{ position: 'relative' }}>
          <button onClick={function () { setLangOpen(!langOpen) }} className="qc-press"
            aria-label="Language" title="Language" style={ctrl}>
            <Ic n="globe" s={15} />
            {lang === 'hi' ? '\u0939\u093F' : 'EN'}
            <Ic n="chevron" s={13} />
          </button>
          {langOpen && (
            <div className="qc-pop" style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 80,
              minWidth: 132, padding: 5, borderRadius: 10,
              background: '#FFFFFF', backgroundImage: 'none',
              backdropFilter: 'none', WebkitBackdropFilter: 'none',
              border: '1px solid #E5E7EB',
              boxShadow: '0 4px 12px rgba(0,0,0,.10)',
            }}>
              {[['en', 'English'], ['hi', '\u0939\u093F\u0902\u0926\u0940']].map(function (l) {
                var on = lang === l[0]
                return (
                  <button key={l[0]} className="qc-press"
                    onClick={function () { onLang && onLang(l[0]); setLangOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '8px 10px', borderRadius: 9, border: 'none',
                      background: on ? RAMP_SOFT : 'transparent',
                      color: on ? C.violetDeep : C.muted,
                      fontSize: 12.5, fontWeight: on ? 700 : 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {l[1]}{on && <Ic n="check" s={13} />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Theme toggle removed */}

        {/* Sign out */}
        <button onClick={onSignOut} className="qc-press" style={ctrl}>
          <Ic n="signout" s={15} /> Sign Out
        </button>
      </div>
    </div>
  )
}

function ActionBar({ page, savedId, lmsRef, pushing, saving, analyzing, calcResult, showProposal, showAnalysis, onSaveQuote, onPrint, onPushLms, onToggleProposal, onToggleAI, onContinue, onBack, onNewQuote }) {
  var isP0 = page === 0
  var btnSec = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '10px 14px', borderRadius: 8, border: '1px solid #D1D5DB',
    background: 'linear-gradient(135deg, #FFFFFF 0%, rgba(51,65,85,.02) 100%)',
    backgroundImage: 'none',
    color: C.muted, fontSize: 12, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
    transition: 'all .2s cubic-bezier(.34,.1,.68,.55)',
  }
  var btnPri = {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    padding: '11px 20px', borderRadius: 8, border: 'none',
    background: 'linear-gradient(135deg, #334155 0%, #1E293B 100%)', color: '#fff',
    fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
    boxShadow: '0 4px 12px rgba(51,65,85,.25)',
    transition: 'all .2s cubic-bezier(.34,.1,.68,.55)',
  }
  var barSt = isP0 ? {
    // Guest step: only the primary call to action, floating over the content so
    // it takes no layout height of its own.
    position: 'absolute', right: 22, bottom: 20, zIndex: 90,
    display: 'flex', alignItems: 'center', gap: 8,
    pointerEvents: 'none',
  } : {
    position: 'sticky', bottom: 0, zIndex: 90,
    background: 'linear-gradient(90deg, #FFFFFF 0%, rgba(51,65,85,.01) 100%)',
    backdropFilter: 'none', WebkitBackdropFilter: 'none',
    borderTop: '1px solid #E5E7EB', borderRadius: '0',
    padding: '12px 20px', marginTop: 14,
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    boxShadow: '0 -1px 0 #E5E7EB',
  }
  return (
    <div style={barSt}>
      {!isP0 && (
        <button onClick={onBack} className="qc-press qc-opt" style={btnSec}><Ic n="back" s={14} /> <span className="max-[400px]:hidden">Back</span></button>
      )}

      <div style={{ flex: 1 }} />

      {isP0 && savedId && (
        <button onClick={onNewQuote} className="qc-press qc-opt" style={Object.assign({}, btnSec, { pointerEvents: 'auto' })}><Ic n="plus" s={14} /> New</button>
      )}

      {!isP0 && (
        <button onClick={onToggleProposal} className="qc-press qc-opt" style={Object.assign({}, btnSec, showProposal ? { backgroundImage: RAMP_SOFT, color: C.violetDeep, borderColor: C.violet } : {})}>
          <Ic n="doc" s={14} /> <span className="max-[400px]:hidden">{showProposal ? 'Hide proposal' : 'Proposal'}</span>
        </button>
      )}

      {!isP0 && (
        <button onClick={onPrint} disabled={!calcResult} className={calcResult ? 'qc-press qc-opt' : ''}
          style={Object.assign({}, btnSec, { opacity: !calcResult ? 0.5 : 1, cursor: !calcResult ? 'not-allowed' : 'pointer' })}>
          <Ic n="printer" s={14} /> <span className="max-[400px]:hidden">Print</span>
        </button>
      )}

      {!isP0 && (
        <button onClick={onToggleAI} disabled={analyzing || !calcResult}
          className={(analyzing || !calcResult) ? '' : 'qc-press qc-opt'}
          style={Object.assign({}, btnSec,
            showAnalysis ? { background: '#EFF6FF', color: '#1D4ED8' } : {},
            { opacity: (analyzing || !calcResult) ? 0.5 : 1, cursor: (analyzing || !calcResult) ? 'not-allowed' : 'pointer' })}>
          <Ic n="sparkle" s={14} /> <span className="max-[400px]:hidden">{analyzing ? 'Analyzing...' : 'AI'}</span>
        </button>
      )}

      {!isP0 && (
        <button onClick={onSaveQuote} disabled={saving || pushing || !calcResult}
          className={(saving || pushing || !calcResult) ? '' : 'qc-lift qc-opt'}
          style={Object.assign({}, btnPri, {
          padding: '10px 18px', fontSize: 13,
          cursor: (saving || pushing || !calcResult) ? 'not-allowed' : 'pointer',
          opacity: (saving || pushing || !calcResult) ? 0.5 : 1,
        })}><Ic n="check" s={15} /> <span className="max-[400px]:hidden">{saving ? 'Saving...' : savedId ? 'Update quote' : 'Save quote'}</span></button>
      )}

      {!isP0 && savedId && !lmsRef && (
        <button onClick={onPushLms} disabled={pushing} className={pushing ? '' : 'qc-lift qc-opt'} style={Object.assign({}, btnPri, {
          padding: '10px 18px', fontSize: 13, background: '#1D4ED8',
          cursor: pushing ? 'not-allowed' : 'pointer', opacity: pushing ? 0.5 : 1,
        })}><Ic n="share" s={15} /> <span className="max-[400px]:hidden">{pushing ? 'Pushing...' : 'Push to LMS'}</span></button>
      )}

      {isP0 && (
        <button onClick={onContinue} className="qc-lift qc-opt" style={Object.assign({}, btnPri, { pointerEvents: 'auto', textDecoration: 'none' })}>
          Continue to Calculator <Ic n="forward" s={15} />
        </button>
      )}
    </div>
  )
}

// ═══ COMPONENT ═══

function QuoteCalculator({ profile, onExit, onSignOut }) {
  var { lang, switchLang } = useLang()
  var [theme, setTheme] = useState(readTheme)
  function toggleTheme() {
    var next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    rememberTheme(next)
  }
  var isAdmin = hasPerm(profile?.permsNew, 'events.quote')

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
  // While the pax field is focused it holds its own string, so a half-typed or
  // cleared value never becomes a number in state (that is what produced '08').
  var [paxDraft, setPaxDraft] = useState(null)
  var paxInputRef = useRef(null)
  function focusPax() {
    var el = paxInputRef.current
    if (!el) return
    el.focus()
    // caret at the end rather than a full selection, so backspace trims the
    // last digit instead of wiping the whole number
    var end = el.value.length
    try { el.setSelectionRange(end, end) } catch { /* inputs without selection support */ }
  }
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
  var [dealDiscount, setDealDiscount] = useState('')
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
  var [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 1024 : false)
  useEffect(function () {
    function onResize() { setIsDesktop(window.innerWidth >= 1024) }
    window.addEventListener('resize', onResize)
    return function () { window.removeEventListener('resize', onResize) }
  }, [])
  useEffect(function () {
    if (!isDesktop) return
    var html = document.documentElement
    var body = document.body
    var previousHtmlOverflow = html.style.overflow
    var previousBodyOverflow = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return function () {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [isDesktop])
  useEffect(function () {
    if (isDesktop) loadQuotes()
  }, [isDesktop])
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
  // Every priced combination the RPC has already answered for, keyed by its
  // arguments: toggling back to a menu or slot you had before is then instant
  // instead of another round trip.
  var calcCache = useRef({})
  var lastSig = useRef('')

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
  function calcSig() {
    return [venueId, pax, slot, ct, menuIdx, decorIdx, djIdx, ttdIdx, foodPref, isWedding ? 1 : 0].join('|')
  }

  async function fetchCalc() {
    if (!venueId) return
    var sig = calcSig()
    var cached = calcCache.current[sig]
    if (cached) { calcSeq.current++; setCalcResult(cached); setCalcLoading(false); return }
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
    if (!error && data) { calcCache.current[sig] = data; setCalcResult(data) }
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
    var sig = calcSig()
    var prev = lastSig.current
    lastSig.current = sig
    if (debounceRef.current) clearTimeout(debounceRef.current)

    // A cached combination, or a click on a discrete choice (venue, slot, menu,
    // decor, DJ, food, wedding), goes out at once. The 300ms wait was there for
    // the pax slider, which fires on every step of a drag — so only a pax-only
    // change is debounced now; everything else used to feel a beat late.
    var cur = sig.split('|')
    var was = prev.split('|')
    var paxOnly = prev !== '' && was.length === cur.length && cur.every(function (v, i) {
      return i === 1 || v === was[i]
    })

    if (firstCall.current) { firstCall.current = false; fetchCalc(); return }
    if (!paxOnly || calcCache.current[sig]) { fetchCalc(); return }
    debounceRef.current = setTimeout(fetchCalc, 250)
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

  // Negotiated deal — raw sum of typed components
  var dealTotal = (+dealVm || 0) + (+dealDecor || 0) + (+dealEnt || 0)
  var hasDealComponent = dealVm !== '' || dealDecor !== '' || dealEnt !== ''
  var hasDiscount = dealDiscount !== '' && (+dealDiscount || 0) > 0
  var hasDeal = hasDealComponent || hasDiscount

  // Effective per-line values (fallback to system-suggested when component blank)
  var effVm = hasDealComponent ? (dealVm !== '' ? (+dealVm || 0) : (adjVm.q || 0)) : (adjVm.q || 0)
  var effDecor = hasDealComponent ? (dealDecor !== '' ? (+dealDecor || 0) : (adjDecor.q || 0)) : (adjDecor.q || 0)
  var effEnt = hasDealComponent ? (dealEnt !== '' ? (+dealEnt || 0) : (adjDj.q || 0)) : (adjDj.q || 0)
  var discountAmt = +dealDiscount || 0
  var effSubtotal = (includeMenu ? effVm : (rental.q || 0)) + (includeDecor ? effDecor : 0) + (includeDj ? effEnt : 0)
  var effTotal = Math.max(0, effSubtotal - discountAmt)

  // Tax calc (client-side)
  var a5 = rd(dealVal * split5 / 100), a18 = rd(dealVal * (1 - split5 / 100))
  var t5 = rd(a5 * 0.05), t18 = rd(a18 * 0.18), ttx = rd(t5 + t18)
  var effRate = rd((ttx / dealVal) * 100)
  var guestPays = taxMode ? dealVal : rd(dealVal + ttx)
  var netToYou = taxMode ? rd(dealVal - ttx) : dealVal

  // Sync tax slider to effective total (post-discount) or quote total
  useEffect(function () {
    var val = effTotal > 0 ? effTotal : adjTotal.q
    if (val) {
      var rounded = Math.round(val * 2) / 2
      setDealVal(Math.max(5, Math.min(60, rounded)))
    }
  }, [adjTotal.q, effTotal])

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
    if (hasDealComponent) {
      if (dealVm) proposalLines.push('  V+M: ₹' + dealVm + 'L')
      if (dealDecor) proposalLines.push('  Décor: ₹' + dealDecor + 'L')
      if (dealEnt) proposalLines.push('  Ent: ₹' + dealEnt + 'L')
    }
    if (discountAmt > 0) proposalLines.push('  Discount: -₹' + discountAmt + 'L')
    proposalLines.push('NEGOTIATED: ' + fmtRound(effTotal))
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
    if (includeMenu) rows.push([1, 'Venue + Menu (' + ml + ' ' + fp + ', ' + pax + ' pax)', fmtAmt(effVm)])
    else if (rental.q) rows.push([1, 'Venue Rental', fmtAmt(rental.q || 0)])
    if (includeDecor) rows.push([1, 'Decoration - ' + DECOR_LABELS[decorIdx], fmtAmt(effDecor)])
    if (includeDj) rows.push([1, DJ_LABELS[djIdx] || 'DJ / Entertainment', fmtAmt(effEnt)])
    var subAmt = effSubtotal
    var totalAmt = effTotal

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
      + '<tr><td>Subtotal</td><td>' + fmtAmt(subAmt) + '</td></tr>'
      + (discountAmt > 0 ? '<tr><td>Discount</td><td>-' + fmtAmt(discountAmt) + '</td></tr>' : '')
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
      deal_value_paise: hasDeal ? toPaise(effTotal) : null,
      deal_vm_paise: dealVm ? toPaise(+dealVm) : null,
      deal_decor_paise: dealDecor ? toPaise(+dealDecor) : null,
      deal_ent_paise: dealEnt ? toPaise(+dealEnt) : null,
      deal_discount_paise: hasDiscount ? toPaise(discountAmt) : null,
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
    var cols = 'id,guest_name,guest_phone,guest_address,event_date,inquiry_mode,priority,event_type,venue_id,venue_idx,venue_name,food_pref,pax,slot,date_category,menu_idx,decor_idx,dj_idx,ttd_idx,total_q_paise,deal_vm_paise,deal_decor_paise,deal_ent_paise,deal_discount_paise,deal_value_paise,tax_mode,split_5_pct,status,revision,notes,lms_ref,location_id,location_name,include_menu,include_decor,include_dj,updated_at'
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
    setDecorIdx(q.decor_idx != null ? q.decor_idx : 0); setDjIdx(q.dj_idx != null ? q.dj_idx : 1); setTtdIdx(q.ttd_idx != null ? q.ttd_idx : autoTtdIdx(q.event_date)); setDealVm(''); setDealDecor(''); setDealEnt(''); setDealDiscount(''); setDealVal(14); setTaxMode(0); setSplit5(50)
    if (q.deal_vm_paise != null) setDealVm(String(fromPaise(q.deal_vm_paise)))
    if (q.deal_decor_paise != null) setDealDecor(String(fromPaise(q.deal_decor_paise)))
    if (q.deal_ent_paise != null) setDealEnt(String(fromPaise(q.deal_ent_paise)))
    if (q.deal_discount_paise != null) setDealDiscount(String(fromPaise(q.deal_discount_paise)))
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
    setDealVm(''); setDealDecor(''); setDealEnt(''); setDealDiscount('')
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
      var sess = await supabase.auth.getSession()
      var token = sess.data.session ? sess.data.session.access_token : import.meta.env.VITE_SUPABASE_ANON_KEY
      var res = await fetch(
        import.meta.env.VITE_SUPABASE_URL + '/functions/v1/quote-assist',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ quote: quoteData }) }
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
    <div className="qc-root" data-qc-theme={theme}
      style={Object.assign({
        fontFamily: FONT, color: C.text, letterSpacing: '-0.01em',
        height: isDesktop ? '100dvh' : 'auto',
        overflow: isDesktop ? 'hidden' : 'visible',
        overscrollBehavior: isDesktop ? 'none' : 'auto',
      }, MESH)}>
      <style>{`
        .qc-root{
          --qc-bg:#F7F9FC; --qc-text:#1E293B; --qc-muted:#64748B; --qc-subtle:#94A3B8;
          --qc-border:#DBE2EA; --qc-primary:#334155; --qc-primary-deep:#1E293B;
          --qc-primary-soft:rgba(51,65,85,.09); --qc-lavender:rgba(51,65,85,.05);
          --qc-glass:#FFFFFF;
          --qc-glass-edge:#E4EAF1;
          --qc-sheen:none;
          --qc-field:#FFFFFF;
          --qc-field-edge:#BFC9D9;
          --qc-bar:#FFFFFF;
          --qc-rail:#2E3B4E;
          --qc-rail-label:rgba(255,255,255,.52);
          --qc-w1:transparent; --qc-w2:transparent;
          --qc-w3:transparent; --qc-w4:transparent;
        }
        .qc-root[data-qc-theme="dark"]{
          --qc-bg:#0E141C;
          --qc-text:#F1F5F9; --qc-muted:#A3AFBF; --qc-subtle:#778393;
          --qc-border:#27313F; --qc-glass:#161E29; --qc-glass-edge:#27313F;
          --qc-field:#161E29; --qc-bar:#161E29; --qc-rail:#1A2331;
          --qc-field-edge:#3A4759;
        }
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes qcUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @keyframes qcIn{from{opacity:0}to{opacity:1}}
        @keyframes qcPop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
        @keyframes qcSlide{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
        @keyframes qcBounce{0%{transform:scale(1)}50%{transform:scale(1.05)}100%{transform:scale(1)}}
        @keyframes qcGlow{0%{box-shadow:0 0 0 0 rgba(51,65,85,.4)}to{box-shadow:0 0 0 8px rgba(51,65,85,0)}}
        @keyframes qcSlideUp{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        .qc-up{animation:qcUp .3s ease both}
        .qc-in{animation:qcIn .25s ease both}
        .qc-pop{animation:qcPop .2s ease both}
        .qc-slide{animation:qcSlide .25s ease both}
        .qc-lift{transition:all .2s cubic-bezier(.34,.1,.68,.55)}
        .qc-lift:hover{box-shadow:0 8px 16px rgba(0,0,0,.12);border-color:#9CA3AF;transform:translateY(-2px)}
        .qc-lift:active{transform:translateY(0) scale(.98)}
        .qc-press{transition:all .15s cubic-bezier(.4,.0,.2,1)}
        .qc-press:hover{background:rgba(0,0,0,.04);transform:scale(1.02)}
        .qc-press:active{transform:scale(.96)}
        .qc-glow{box-shadow:0 0 0 3px rgba(51,65,85,.2);transition:box-shadow .3s ease}
        .qc-glow-teal{box-shadow:0 0 0 3px rgba(176,131,36,.2);transition:box-shadow .3s ease}
        .qc-row{transition:all .15s ease}
        .qc-row:hover{background:rgba(0,0,0,.04);transform:translateX(2px)}
        .qc-calculator .qc-step-card{
          border-color:#D8E0E5;
          box-shadow:0 2px 8px rgba(26,32,44,.045);
        }
        .qc-calculator .qc-step-card:hover{
          border-color:#C7D4D8;
          box-shadow:0 5px 14px rgba(26,32,44,.07);
        }
        .qc-calculator .qc-opt:hover:not(:disabled){
          box-shadow:0 3px 10px rgba(51,65,85,.13);
        }
        .qc-calculator .qc-step-card > div[style*="background: rgb(17, 24, 39)"],
        .qc-calculator .qc-step-card > div[style*="background: #111827"]{
          border-radius:16px !important;
        }
        .qc-calculator input[type="range"]{accent-color:#334155 !important}
        .qc-opt{outline:2px solid transparent;outline-offset:2px;transition:outline-color .15s ease}
        .qc-opt:hover{outline-color:rgba(100,116,139,.5)}
        .qc-opt:focus-visible{outline-color:rgba(100,116,139,.75)}
        .qc-opt:disabled:hover{outline-color:transparent}
        .qc-noscroll{scrollbar-width:none;-ms-overflow-style:none}
        .qc-noscroll::-webkit-scrollbar{width:0;height:0;display:none}
        .qc-main-scroll{scrollbar-width:none;-ms-overflow-style:none}
        .qc-main-scroll::-webkit-scrollbar{width:0;height:0;display:none}
        .qc-range{-webkit-appearance:none;appearance:none;height:5px;border-radius:99px;outline:none;background:#D1D5DB;transition:background .2s ease}
        .qc-range:focus{background:#C4C9D0}
        .qc-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid #334155;box-shadow:0 1px 4px rgba(0,0,0,.15);cursor:pointer;transition:all .2s cubic-bezier(.34,.1,.68,.55)}
        .qc-range::-webkit-slider-thumb:hover{transform:scale(1.2);box-shadow:0 2px 8px rgba(51,65,85,.3)}
        .qc-range::-webkit-slider-thumb:active{transform:scale(1.15)}
        .qc-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #334155;cursor:pointer;transition:all .2s cubic-bezier(.34,.1,.68,.55)}
        .qc-range::-moz-range-thumb:hover{transform:scale(1.2);box-shadow:0 2px 8px rgba(51,65,85,.3)}
        /* focus: an ink-dark edge so it reads as active, over the soft green halo */
        input:focus,select:focus,textarea:focus{box-shadow:0 0 0 3px rgba(51,65,85,.14);border-color:rgba(26,32,44,.85)}
        .qc-root[data-qc-theme="dark"] input:focus,.qc-root[data-qc-theme="dark"] select:focus,.qc-root[data-qc-theme="dark"] textarea:focus{box-shadow:0 0 0 3px rgba(176,131,36,.15);border-color:rgba(243,244,246,.75)}
        label{transition:color .2s ease}
        input:focus ~ label,select:focus ~ label{color:#334155}
        @media (prefers-reduced-motion: reduce){
          .qc-up,.qc-in,.qc-pop,.qc-slide,.qc-bounce,.qc-glow,.qc-slide-up{animation:none}
          .qc-lift,.qc-press,.qc-row,.qc-range::-webkit-slider-thumb,.qc-range,.qc-glow,.qc-glow-teal{transition:none}
          .qc-lift:hover,.qc-press:active,.qc-lift:active,.qc-press:hover,.qc-row:hover{transform:none}
        }
      `}</style>
      {loadingDot}
      {saveMsg && (<div style={{
        position: 'fixed', top: 16, right: 16, zIndex: 200,
        padding: '12px 18px', borderRadius: 8,
        backdropFilter: 'none', WebkitBackdropFilter: 'none',
        animation: 'qcPop .3s cubic-bezier(.22,.85,.3,1) both',
        background: saveMsg.indexOf('Error') === 0 || saveMsg.indexOf('failed') !== -1 || saveMsg.indexOf('Allow') === 0 ? '#7F1D1D' : '#166534',
        color: '#fff', fontSize: 13, fontWeight: 700,
        boxShadow: '0 6px 20px rgba(0,0,0,.2)',
        maxWidth: 360, lineHeight: 1.4,
      }}>{saveMsg}</div>)}

      <div style={isDesktop ? { display: 'flex', alignItems: 'stretch', height: '100%', minHeight: 0 } : {}}>
        {isDesktop && (
          <Sidebar page={page} setPage={setPage} quotes={quotes} savedId={savedId}
            onLoadQuote={loadQuote} loadingQuotes={loadingQuotes} profile={profile}
            onNewQuote={newQuote} />
        )}
        <div style={isDesktop
          ? { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }
          : { padding: '0 14px' }}>

      <PageHeader page={page} profile={profile} isDesktop={isDesktop}
        lang={lang} onLang={switchLang} onSignOut={onSignOut}
        theme={theme} onToggleTheme={toggleTheme}
        onBack={function () { if (page === 1) { setPage(0) } else if (onExit) { onExit() } }} />

      <div className={isDesktop ? 'qc-main-scroll' : ''} style={isDesktop
        ? {
          flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
          display: 'grid', gridTemplateColumns: '1fr 322px', gap: 18,
          alignItems: 'start', padding: page === 0 ? '16px 22px 0' : '18px 22px 0',
        }
        : {}}>
        <div className={page === 1 ? 'qc-calculator' : undefined}
          style={isDesktop ? { minWidth: 0, paddingBottom: page === 0 ? 24 : 96 } : { minWidth: 0 }}>

      {/* Tab bar — mobile only */}
      {!isDesktop && (
      <div style={{ display: 'flex', marginBottom: 12, borderRadius: 12, overflow: 'hidden', border: '1px solid ' + C.border }}>
        {['Guest Info', 'Calculator'].map(function (label, idx) {
          return <SlotButton key={idx} label={label} on={page === idx} onClick={function () { setPage(idx) }} />
        })}
      </div>
      )}

      {/* Quotes toolbar — mobile only (desktop uses sidebar) */}
      {!isDesktop && (
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={function () { if (!showQuotes) loadQuotes(); setShowQuotes(!showQuotes) }} style={{
          flex: 1, padding: '9px 12px', borderRadius: 9, border: '2px solid ' + (showQuotes ? C.gold : C.border),
          background: showQuotes ? '#F1F5F9' : '#fff', color: showQuotes ? C.gold : C.muted,
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>{showQuotes ? 'Hide Quotes' : 'My Quotes'}</button>
        {savedId && (<button onClick={newQuote} style={{
          padding: '9px 16px', borderRadius: 9, border: '2px solid ' + C.border,
          background: '#fff', color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>+ New</button>)}
      </div>
      )}

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
                background: isActive ? '#F1F5F9' : '#fff', cursor: 'pointer',
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
                      background: q.status === 'draft' ? '#F3F4F6' : q.status === 'sent' ? '#DBEAFE' : q.status === 'accepted' ? '#E8EDF3' : q.status === 'converted' ? '#FEF3C7' : '#E8EDF3',
                      color: q.status === 'draft' ? '#6B7280' : q.status === 'sent' ? '#1D4ED8' : q.status === 'accepted' ? '#4B5B70' : q.status === 'converted' ? '#D97706' : '#334155',
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
        <StepCard step={1} title="Lead / Guest Information" subtitle="Basic contact and event information">
          <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(3, 1fr)' : '1fr', gap: 14, marginBottom: 14 }}>
            <Field label="Guest Name" icon="user">
              <input type="text" value={guestName} placeholder="Full name"
                onChange={function (e) { setGuestName(e.target.value) }}
                style={inputSt(true, !!guestName)} />
            </Field>
            <Field label="Phone" icon="phone">
              <input type="tel" value={guestPhone} placeholder="+91 98765 43210"
                onChange={function (e) { setGuestPhone(e.target.value.replace(/[^0-9+\- ]/g, '').slice(0, 16)) }}
                style={inputSt(true, !!guestPhone)} />
            </Field>
            <Field label="Address" icon="pin">
              <input type="text" value={guestAddress} placeholder="Locality / Area"
                onChange={function (e) { setGuestAddress(e.target.value) }}
                style={inputSt(true, !!guestAddress)} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(3, 1fr)' : '1fr', gap: 14, alignItems: 'start' }}>
            <div>
              <div style={LABEL_ST}>Event Date</div>
              <EventDatePicker value={eventDate} onChange={handleDateChange} label="" collapsible
                triggerStyle={Object.assign({}, inputSt(false, !!eventDate), {
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, textAlign: 'left', cursor: 'pointer',
                  color: eventDate ? C.text : C.subtle,
                  fontWeight: eventDate ? 600 : 500,
                })} />
              {dc >= 0 && (<div style={{ padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, marginTop: 4, background: CAT_BG[dc], color: CAT_COLORS[dc], border: '1px solid ' + C.border }}>
                {fmtDate(eventDate)} – {CAT_LABELS[dc]}
              </div>)}
              {isSummer && (<div style={{ padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, marginTop: 4, background: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ic n="sun" s={13} /> Summer &ndash; Consider Banquet</span>
              </div>)}
            </div>
            <Field label="Mode of Inquiry" icon="chat" caret>
              <select value={inquiryMode} onChange={function (e) { setInquiryMode(e.target.value) }}
                style={Object.assign({}, inputSt(true, !!inquiryMode), { color: inquiryMode ? C.text : C.subtle, appearance: 'none', WebkitAppearance: 'none', paddingRight: 34 })}>
                <option value="" style={PLACEHOLDER_OPT_ST}>Select mode</option>
                {inquiryModes.map(function (m) { return <option key={m} value={m} style={OPT_ST}>{m}</option> })}
              </select>
            </Field>
            <Field label="Priority" icon="star" caret>
              <select value={priority} onChange={function (e) { setPriority(e.target.value) }}
                style={Object.assign({}, inputSt(true, !!priority), { color: priority ? C.text : C.subtle, appearance: 'none', WebkitAppearance: 'none', paddingRight: 34 })}>
                <option value="" style={PLACEHOLDER_OPT_ST}>Select priority</option>
                <option value="Silver" style={OPT_ST}>Silver</option>
                <option value="Gold" style={OPT_ST}>Gold</option>
                <option value="Platinum" style={OPT_ST}>Platinum</option>
                <option value="Diamond" style={OPT_ST}>Diamond</option>
              </select>
            </Field>
          </div>
        </StepCard>

        <StepCard step={2} title="Event Details" subtitle="Specify event type, venue and preferences">
          {/* One grid, six cells. Each field is placed by column and row, so
              Slot / Location / Pax start on the same line whatever the cells
              above them end up measuring — three independently stacked
              columns drifted out of step. DOM order stays the reading order
              for the single-column mobile layout. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isDesktop ? '1.1fr 1fr 1fr' : '1fr',
            columnGap: 20, rowGap: 16, alignItems: 'start',
          }}>
            <div style={isDesktop ? { gridColumn: 1, gridRow: 1 } : null}>
              <div style={LABEL_ST}>Event Type</div>
              {eventTypes.filter(function (x) { return !x.pinned }).length > 0 && (
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input value={etSearch} placeholder={'Search ' + eventTypes.length + ' event types'}
                  onChange={function (e) { setEtSearch(e.target.value) }}
                  onFocus={function () { setEtSearch('') }}
                  onBlur={function () { setTimeout(function () { setEtSearch('') }, 200) }}
                  style={Object.assign({}, inputSt(false, !!etSearch), {
                    color: etSearch ? C.text : C.subtle,
                  })} />
                {etSearch !== '' && (function () {
                  var filtered = []
                  for (var i = 0; i < eventTypes.length; i++) {
                    if (eventTypes[i].label.toLowerCase().indexOf(etSearch.toLowerCase()) >= 0) filtered.push({ et: eventTypes[i], idx: i })
                  }
                  if (filtered.length === 0) return null
                  return (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                      background: '#fff', border: '1px solid ' + C.border, borderRadius: 8,
                      maxHeight: 220, overflowY: 'auto', marginTop: 4,
                      boxShadow: '0 8px 20px rgba(0,0,0,.12)',
                    }}>
                      {filtered.map(function (f) {
                        return (
                          <button key={f.idx} onMouseDown={function () { handleEventType(f.idx); setEtSearch('') }}
                            style={{
                              width: '100%', padding: '10px 12px', border: 'none', background: eventTypeIdx === f.idx ? RAMP_SOFT : '#fff',
                              color: eventTypeIdx === f.idx ? C.violetDeep : C.text, fontSize: 13, fontWeight: eventTypeIdx === f.idx ? 700 : 500,
                              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                              borderBottom: '1px solid ' + C.border, display: 'flex', alignItems: 'center', gap: 7,
                            }}><Ic n={etIcon(f.et.label)} s={14} c={etTint(f.et.label)} /> {f.et.label}</button>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
              )}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
                gap: 7,
              }}>
                {eventTypes.map(function (et, idx) {
                  if (!et.pinned) return null
                  var on = eventTypeIdx === idx
                  return (
                    <button key={idx} className="qc-press qc-opt" onClick={function () { handleEventType(idx) }} style={{
                      padding: '9px 12px', borderRadius: 999, border: '1px solid ' + (on ? C.violet : C.border),
                      background: on ? RAMP_SOFT : '#fff',
                      color: on ? C.violetDeep : C.text,
                      fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 7, fontFamily: 'inherit', minWidth: 0,
                    }}>
                      <Ic n={etIcon(et.label)} s={15} c={etTint(et.label)} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{et.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div style={isDesktop ? { gridColumn: 1, gridRow: 2 } : null}>
              <div style={LABEL_ST}>Slot</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {SLOTS.map(function (s, idx) {
                  return <SlotButton key={idx} label={s} on={slot === idx} onClick={function () { setSlot(idx) }} />
                })}
              </div>
            </div>
            <div style={isDesktop
              ? { gridColumn: 2, gridRow: 1, alignSelf: 'stretch', display: 'flex', flexDirection: 'column' }
              : null}>
              <div style={LABEL_ST}>Venue</div>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                flex: isDesktop ? 1 : 'none', gridAutoRows: isDesktop ? '1fr' : 'auto',
              }}>
                {parents.map(function (p) {
                  var on = parentId === p.id
                  var isPh = p.status === 'placeholder'
                  return (<button key={p.id} className="qc-opt" onClick={function () {
                    if (isPh) return
                    setParentId(p.id)
                    setVenueId(p.has_subs ? '' : p.id)
                    setLocationId(''); setLocationName('')
                  }} style={{
                    textAlign: 'center', width: '100%', padding: '6px 9px', borderRadius: 10,
                    minHeight: 42, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    border: '1px solid ' + (on && !isPh ? C.violet : C.border),
                    background: on && !isPh ? RAMP_SOFT : '#fff',
                    color: isPh ? C.subtle : on ? C.violetDeep : C.text, fontSize: 12.5, fontWeight: 700,
                    cursor: isPh ? 'not-allowed' : 'pointer', opacity: isPh ? 0.6 : 1,
                    fontFamily: 'inherit',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, maxWidth: '100%' }}>
                      {isPh && <Ic n="cone" s={12} />}
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    </div>
                    <div style={{ fontSize: 10, color: on && !isPh ? C.violet : C.muted, marginTop: 1, fontWeight: 500, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isPh ? 'Coming soon' : p.location}</div>
                  </button>)
                })}
              </div>

              {currentParent && currentParent.has_subs && currentParent.live_subs.length > 0 && (<>
                <div style={Object.assign({}, LABEL_ST, { marginTop: 10 })}>Sub-venue</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {currentParent.live_subs.map(function (s) {
                    var on = venueId === s.id
                    return (<button key={s.id} className="qc-opt" onClick={function () {
                      setVenueId(s.id); setLocationId(''); setLocationName('')
                    }} style={{
                      textAlign: 'center', width: '100%', padding: '6px 9px', borderRadius: 10,
                      minHeight: 42, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '1px solid ' + (on ? C.violet : C.border),
                      background: on ? RAMP_SOFT : '#fff',
                      color: on ? C.violetDeep : C.text, fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}>{s.name}</button>)
                  })}
                </div>
              </>)}
            </div>
            <div style={isDesktop ? { gridColumn: 2, gridRow: 2 } : null}>
              {(function () {
                var locs = null
                if (lmsLocations && currentLeaf) {
                  locs = lmsLocations[currentLeaf.parent_id] || lmsLocations[currentLeaf.id] || null
                  if (!locs) {
                    var LEG_ID_TO_IDX = { pushpanjali: '0', manaktala: '1', emerald_green: '1', alstonia: '1', exotica: '3', aura: '3', valencia: '3', restro: '16', restro_lawn: '16', restro_banquet: '16' }
                    var legKey = LEG_ID_TO_IDX[currentLeaf.parent_id] || LEG_ID_TO_IDX[currentLeaf.id]
                    if (legKey) locs = lmsLocations[legKey] || null
                  }
                }
                if (!locs || locs.length === 0) return null
                return (<>
                  <div style={LABEL_ST}>Location / Hall</div>
                  <select value={locationId} onChange={function (e) {
                    var sel = locs.find(function (l) { return l.id === e.target.value })
                    setLocationId(e.target.value)
                    setLocationName(sel ? sel.name : '')
                  }} style={Object.assign({}, inputSt(false, !!locationId), {
                    color: locationId ? C.text : C.subtle,
                    appearance: 'none', WebkitAppearance: 'none', paddingRight: 34,
                    backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%239A99B5\' stroke-width=\'1.7\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><path d=\'M6 9l6 6 6-6\'/></svg>")',
                    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 11px center',
                  })}>
                    <option value="" style={PLACEHOLDER_OPT_ST}>Select location / hall</option>
                    {locs.map(function (l) { return <option key={l.id} value={l.id} style={OPT_ST}>{l.name}</option> })}
                  </select>
                </>)
              })()}
            </div>
            {/* Food + Pax share a cell spanning both rows: this column is
                shorter than the other two, so letting it stack on its own pulls
                Pax up under Food instead of leaving a hole while it waits for
                row 1 to end elsewhere. */}
            <div style={isDesktop ? { gridColumn: 3, gridRow: '1 / span 2', alignSelf: 'stretch', display: 'flex', flexDirection: 'column' } : null}>
                  <div style={LABEL_ST}>Food</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['Veg', '#047857', '#F0FDF4', 'leaf'], ['Non-Veg', '#C2740B', '#FFF7ED', 'meat']].map(function (f, idx) {
                      var on = foodPref === idx
                      return (<button key={idx} className="qc-opt" onClick={function () { handleFoodPref(idx) }} style={{
                        flex: 1, padding: '10px 8px', borderRadius: 10, minHeight: 42,
                        border: '1px solid ' + (on ? f[1] : C.border),
                        background: on ? f[2] : '#fff',
                        backgroundImage: 'none',
                        color: on ? f[1] : C.text,
                        fontSize: 13, fontWeight: on ? 700 : 600, cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                        whiteSpace: 'nowrap',
                      }}><Ic n={f[3]} s={15} /> {f[0]}</button>)
                    })}
                  </div>
              <div style={{ marginTop: 16 }}>
                  <div style={LABEL_ST}>Pax</div>
                  <Field icon="users">
                    <input type="number" inputMode="numeric" min={50} max={2000} value={pax}
                      onChange={function (e) { var v = +e.target.value; if (v >= 0 && v <= 2000) setPax(v) }}
                      onBlur={function (e) { var v = +e.target.value; if (v < 50) setPax(50); else if (v > 2000) setPax(2000) }}
                      style={Object.assign({}, inputSt(true, true), { fontWeight: 700, color: C.text })} />
                  </Field>
              </div>
              {(function () {
                // Ticks are placed by value on the slider's own 50-2000 scale.
                // They used to be six flex items spread edge to edge while
                // reading 50/200/400/600/800/1000+, so a pax of 405 parked the
                // thumb at 18% of the track under a "400" label sitting at 40%.
                var PAX_MIN = 50, PAX_MAX = 2000
                var TICKS = [50, 500, 1000, 1500, 2000]
                function paxFrac(v) {
                  return Math.max(0, Math.min(1, (v - PAX_MIN) / (PAX_MAX - PAX_MIN)))
                }
                // The thumb's centre only travels between 8px and (track - 8px),
                // so the bubble and ticks carry the same correction or they drift
                // away from the thumb towards either end.
                function paxLeft(v) {
                  var f = paxFrac(v)
                  return 'calc(' + (f * 100) + '% + ' + (8 - f * 16) + 'px)'
                }
                var fillStop = paxLeft(pax)
                var nearest = TICKS.reduce(function (a, b) {
                  return Math.abs(b - pax) < Math.abs(a - pax) ? b : a
                })
                // only call a tick out when pax is actually on it
                if (Math.abs(nearest - pax) > 60) nearest = null
                // the slider is pushed to the bottom of the span, so its tick row
                // lands on the same line as the Slot buttons and Location select
                return (
                  <div style={isDesktop ? { position: 'relative', paddingTop: 22, marginTop: 'auto' } : { position: 'relative', paddingTop: 22, marginTop: 12 }}>
                    <span className="qc-pop" style={{
                      position: 'absolute', top: 0, left: paxLeft(pax), transform: 'translateX(-50%)',
                      background: RAMP, color: '#fff', fontSize: 11, fontWeight: 700,
                      padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap',
                      boxShadow: '0 2px 6px rgba(100,116,139,.30)', pointerEvents: 'none',
                    }}>{pax}</span>
                    <input className="qc-range" type="range" min={PAX_MIN} max={PAX_MAX} step={5} value={pax}
                      onInput={function (e) { setPax(+e.target.value) }}
                      style={{
                        width: '100%', accentColor: C.violet,
                        background: 'linear-gradient(90deg,#64748B 0%,#64748B ' + fillStop + ',#E5E7EB ' + fillStop + ')',
                      }} />
                    <div style={{ position: 'relative', height: 14, marginTop: 6 }}>
                      {TICKS.map(function (t, ti) {
                        var on = t === nearest
                        return <span key={t} style={{
                          position: 'absolute', left: paxLeft(t),
                          transform: ti === 0 ? 'translateX(0)' : ti === TICKS.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                          fontSize: 10, fontWeight: on ? 800 : 600,
                          color: on ? C.violet : C.subtle, whiteSpace: 'nowrap',
                        }}>{t}</span>
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </StepCard>

      </>)}

      {/* ═══ PAGE 1: CALCULATOR ═══ */}
      {page === 1 && (<>
        {/* Summary bar */}
        <div style={{
          // brand strip rather than the ink slab it used to be: it is the first
          // thing on the step, so it carries the accent instead of a black bar
          background: 'linear-gradient(90deg, ' + RAMP_DEEP + ' 0%, ' + RAMP + ' 58%, ' + TEAL + ' 100%)',
          borderRadius: 999, padding: '10px 18px', marginBottom: 14,
          color: '#fff', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          boxShadow: '0 3px 12px rgba(51,65,85,.20)',
        }}>
          <strong style={{ fontSize: 13.5 }}>{guestName || 'Guest'}</strong>
          {/* empty parts dropped, so a quote with no date category no longer
              renders a stray ' | | ' in the middle of the bar */}
          <span style={{ color: 'rgba(255,255,255,.78)' }}>
            {[venName, dc >= 0 ? CAT_LABELS[dc] : '', pax + 'pax'].filter(function (x) { return x }).join('  ·  ')}
          </span>
          {/* the numbers below are the previous ones until the RPC answers, so
              say so here rather than leaving a stale total looking settled */}
          {calcLoading && (
            <span style={{
              marginLeft: 'auto', flexShrink: 0,
              padding: '3px 10px', borderRadius: 999,
              background: 'rgba(255,255,255,.18)', color: '#fff',
              fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
              animation: 'pulse 1.1s infinite',
            }}>Updating…</span>
          )}
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
              background: isUp ? '#F0FDF4' : '#F1F5F9',
              border: '1px solid ' + (isUp ? '#BBF7D0' : '#E2E8F0'),
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>
                Calc {fmtRound(adjTotal.q)} → Deal {fmtRound(dealTotal)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: isUp ? UP_FG : DOWN_FG }}>
                {isUp ? '+' : ''}{diff}L ({isUp ? '+' : ''}{pct}%)
              </div>
            </div>
          )
        })()}

        {/* Venue selector (synced) — parent row + conditional sub row */}
        <div style={Object.assign({}, PILL_ROW, { marginBottom: currentParent && currentParent.has_subs && currentParent.live_subs.length > 0 ? 7 : 12 })}>
          {parents.map(function (p) {
            var isPh = p.status === 'placeholder'
            return <Pill key={p.id} on={parentId === p.id} disabled={isPh}
              icon={isPh ? <Ic n="cone" s={12} /> : null}
              label={(p.name || '').replace('Ambria ', '')}
              onClick={function () {
                setParentId(p.id)
                setVenueId(p.has_subs ? '' : p.id)
                setDecorIdx(0); setLocationId(''); setLocationName('')
              }} />
          })}
        </div>
        {currentParent && currentParent.has_subs && currentParent.live_subs.length > 0 && (
          <div style={PILL_ROW}>
            {currentParent.live_subs.map(function (sv) {
              return <Pill key={sv.id} sm on={venueId === sv.id} label={sv.name}
                onClick={function () { setVenueId(sv.id); setDecorIdx(0); setLocationId(''); setLocationName('') }} />
            })}
          </div>
        )}

        {isSummer && (<div style={{ padding: '7px 11px', borderRadius: 7, fontSize: 11, fontWeight: 600, marginBottom: 12, background: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ic n="sun" s={13} /> Summer &ndash; Consider Banquet</span>
        </div>)}

        {isPlaceholder && (<div style={{ textAlign: 'center', padding: 40, color: C.muted, fontSize: 14 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ic n="cone" s={13} /> Pricing coming soon for {venName}</span>
        </div>)}

        {!isPlaceholder && (<>
        {/* Wedding toggle */}
        <div style={PILL_ROW}>
          {['Wedding', 'Non-Wedding'].map(function (label, idx) {
            return <Pill key={idx} label={label} on={(isWedding ? 0 : 1) === idx}
              onClick={function () { handleWedToggle(idx) }} />
          })}
        </div>

        {/* VENUE + MENU */}
        <StepCard step={1} title="Venue + Menu" subtitle={venName}>
          {/* The four small choices used to stack full width down a very wide
              column, leaving the right half of the card empty. */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
            // groups keep their natural width and wrap as whole groups; the
            // wide gutter is what separates one group's pills from the next
            columnGap: 42, rowGap: 20, marginBottom: 16,
          }}>
            <div style={{ flex: '0 0 auto' }}>
          <div style={LABEL_ST}>Date Category</div>
          {eventDate && (<div style={{
            padding: '7px 11px', borderRadius: 7, fontSize: 12, fontWeight: 600, marginBottom: 7,
            background: CAT_BG[ct], color: CAT_COLORS[ct], border: '1px solid ' + C.border,
          }}>{fmtDate(eventDate)} – {CAT_LABELS[ct]}{dc >= 0 && dc !== ct ? '  (auto: ' + CAT_LABELS[dc] + ')' : ''}</div>)}
          <CatPills items={CAT_LABELS} value={ct} onChange={setCatOverride} />

            </div>
            <div style={{ flex: '0 0 auto' }}>
          <div style={LABEL_ST}>Slot</div>
          <div style={Object.assign({}, PILL_ROW, { flexWrap: 'nowrap', marginBottom: 0 })}>
            {SLOTS.map(function (sl, idx) {
              return <Pill key={idx} label={sl} on={slot === idx} onClick={function () { setSlot(idx) }} />
            })}
          </div>

            </div>
            <div style={{ flex: '1 1 260px', minWidth: 230 }}>
          {/* Pax can be typed as well as dragged. The slider spans the same
              50-2000 as the guest step (it used to stop at 1000, so a typed
              1200 had no position on the track). */}
          <div style={Object.assign({}, LABEL_ST, { display: 'flex', alignItems: 'center', gap: 8 })}>
            Pax
            <span onClick={focusPax} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 5px 3px 11px', borderRadius: 999,
              border: '1px solid ' + C.violet, background: RAMP_SOFT,
              cursor: 'text',
            }}>
              <input ref={paxInputRef} type="text" inputMode="numeric" value={paxDraft == null ? pax : paxDraft}
                aria-label="Pax" title="Type a pax count"
                onFocus={function () { setPaxDraft(String(pax)) }}
                onChange={function (e) {
                  var raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 4)
                  setPaxDraft(raw)
                  if (raw !== '') {
                    var v = +raw
                    if (v <= 2000) setPax(v)
                  }
                }}
                onKeyDown={function (e) { if (e.key === 'Enter') e.target.blur() }}
                onBlur={function () {
                  var v = paxDraft === '' || paxDraft == null ? pax : +paxDraft
                  if (v < 50) v = 50
                  if (v > 2000) v = 2000
                  setPax(v)
                  setPaxDraft(null)
                }}
                style={{
                  width: 42, padding: 0, border: 'none', background: 'transparent',
                  color: C.violetDeep, fontSize: 12, fontWeight: 700, textAlign: 'center',
                  fontFamily: 'inherit', outline: 'none', boxShadow: 'none',
                }} />
              <span style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: C.violet, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><Ic n="pencil" s={11} sw={2.2} /></span>
            </span>
          </div>
          <input className="qc-range" type="range" min={50} max={2000} step={5} value={pax}
            onInput={function (e) { setPax(+e.target.value) }}
            style={{
              width: '100%', accentColor: C.violet, marginBottom: 14,
              background: 'linear-gradient(90deg,#64748B 0%,#64748B ' + (((pax - 50) / 1950) * 100) + '%,#E5E7EB ' + (((pax - 50) / 1950) * 100) + '%)',
            }} />

            </div>
            <div style={{ flex: '0 0 auto' }}>
          <div style={LABEL_ST}>Food</div>
          <div style={Object.assign({}, PILL_ROW, { flexWrap: 'nowrap', marginBottom: 0 })}>
            {[['Veg', '#047857', '#F0FDF4', 'leaf'], ['Non-Veg', '#C2740B', '#FFF7ED', 'meat']].map(function (f, idx) {
              return <Pill key={idx} label={f[0]} on={foodPref === idx} tint={[f[1], f[2]]}
                icon={<Ic n={f[3]} s={14} />} onClick={function () { handleFoodPref(idx) }} />
            })}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: includeMenu ? '#166534' : C.muted }}>{includeMenu ? 'Included' : 'Off'}</span>
              <Toggle on={includeMenu} onToggle={function () { setIncludeMenu(!includeMenu) }} />
            </span>
          </div>
            </div>
          </div>

          {/* Menu list and its pricing sit side by side: the summary is short
              and the tiles are narrow, so stacking them wasted the width. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isDesktop ? 'minmax(0,1fr) 340px' : '1fr',
            columnGap: 16, rowGap: 14, alignItems: 'start',
          }}>
            <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 7, height: 18 }}>Menu ({foodPref === 0 ? 'Veg' : 'NV'})</div>
          <div style={{ opacity: includeMenu ? 1 : 0.3, pointerEvents: includeMenu ? 'auto' : 'none' }}>
          {/* two tiles per row: a fixed pair of columns keeps every tile the same
              width, which auto-fit did not once the labels varied in length */}
          <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: 8, marginBottom: 12 }}>
            {allMenus.map(function (m) {
              var midx = m.idx; var on = activeMenu === midx
              var unavail = m.available === false
              var over = !unavail && m.max_pax > 0 && pax > m.max_pax
              var note = unavail ? m.reason : over ? 'Max ' + m.max_pax + ' pax' : ''
              return (<button key={midx} className={unavail ? '' : 'qc-press qc-opt'}
                onClick={function () { if (!unavail) setMenuIdx(midx) }} style={{
                  width: '100%', padding: '11px 12px', borderRadius: 12, minHeight: 54,
                  border: '1px solid ' + (on && !unavail ? C.violet : C.border),
                  background: on && !unavail ? RAMP_SOFT : '#fff', backgroundImage: 'none',
                  color: unavail ? C.subtle : on ? C.violetDeep : C.text,
                  fontSize: 13.5, fontWeight: on ? 700 : 600,
                  cursor: unavail ? 'not-allowed' : 'pointer',
                  opacity: unavail ? 0.6 : 1, fontFamily: 'inherit',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, maxWidth: '100%' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, flexShrink: 0, color: unavail ? C.subtle : on ? C.violet : C.muted, whiteSpace: 'nowrap' }}>
                    Rs.{m.per_head}{m.flat_add ? ' +' + m.flat_add + 'L' : ''}
                  </span>
                </span>
                {note && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#B45309', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                    <Ic n={unavail ? 'ban' : 'warn'} s={12} /> {note}
                  </span>
                )}
              </button>)
            })}
          </div>
          </div>
            </div>
            <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 7, height: 18 }}>Pricing</div>
          <div style={{ background: C.cream, borderRadius: 10, padding: 13, border: '1px solid ' + C.border }}>
            {includeMenu && <div style={{ fontSize: 13, color: C.maroon, fontWeight: 700 }}>Rs.{perHead}/hd x {pax} = {fmtL(menuCost)}</div>}
            {!includeMenu && <div style={{ fontSize: 13, color: C.muted, fontWeight: 700 }}>Rental only</div>}
            {rental.q != null && (<div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              Rental: {fmtRound(rental.q || 0)} / {fmtRound(rental.t || 0)} / {fmtRound(rental.f || 0)}
            </div>)}
            <div style={{ marginTop: 10 }}>
              <RateRow showAll={true} q={fmtRound(adjVm.q || 0)} t={fmtRound(adjVm.t || 0)} f={fmtRound(adjVm.f || 0)} />
            </div>
          </div>

          {/* Time-to-date (admin only) */}
          {ttdData.length > 0 && (
            <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 13, marginTop: 10, border: '1px solid ' + C.border }}>
              <div style={LABEL_ST}>Time to Date</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                {ttdData.map(function (td, idx) {
                  var on = ttdIdx === idx
                  return (<button key={idx} className="qc-press qc-opt" onClick={function () { setTtdIdx(idx) }} style={{
                    width: '100%', padding: '8px 16px', borderRadius: 999, minHeight: 38,
                    border: '1px solid ' + (on ? C.violet : C.border),
                    background: on ? RAMP_SOFT : '#fff', backgroundImage: 'none',
                    color: on ? C.violetDeep : C.text, fontSize: 12, fontWeight: on ? 700 : 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{td.label}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: on ? C.violet : C.muted, whiteSpace: 'nowrap' }}>{td.pct > 0 ? '-' + (td.pct * 100) + '%' : 'Full'}</span>
                  </button>)
                })}
              </div>
            </div>
          )}
            </div>
          </div>
        </StepCard>

        {/* DÉCOR */}
        <StepCard step={2} title="Décor">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: -8, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: includeDecor ? '#166534' : C.muted }}>{includeDecor ? 'Included' : 'Off'}</span>
              <Toggle on={includeDecor} onToggle={function () { setIncludeDecor(!includeDecor) }} />
            </div>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: isDesktop ? 'minmax(0,1fr) 340px' : '1fr',
            columnGap: 16, rowGap: 10, alignItems: 'start',
          }}>
            <div style={{ minWidth: 0, opacity: includeDecor ? 1 : 0.3, pointerEvents: includeDecor ? 'auto' : 'none' }}>
            {venDecorMode === 'p' ? (
              <div style={Object.assign({}, PILL_ROW, { marginBottom: 0 })}>
                {[0, 1, 2].map(function (dx) {
                  return <Pill key={dx} label={DECOR_LABELS[dx]} on={decorIdx === dx}
                    onClick={function () { setDecorIdx(dx) }} />
                })}
              </div>
            ) : venDecorMode === 'eg' ? (
              <div style={Object.assign({}, PILL_ROW, { marginBottom: 0 })}>
                {['Standard', 'Banquet'].map(function (label, idx) {
                  return <Pill key={idx} label={label} on={decorIdx === idx}
                    onClick={function () { setDecorIdx(idx) }} />
                })}
              </div>
            ) : (
              <div style={{ padding: 10, background: C.cream, borderRadius: 9, fontSize: 13, color: C.maroon2, border: '1px solid ' + C.border }}>
                <strong>{venName}</strong> | {isWedding ? 'Wedding' : 'Non-Wedding'}
              </div>
            )}
            </div>
            <div style={{ minWidth: 0 }}>
              <RateRow showAll={true} q={fmtRound(adjDecor.q || 0)} t={fmtRound(adjDecor.t || 0)} f={fmtRound(adjDecor.f || 0)} />
            </div>
          </div>
        </StepCard>

        {/* DJ */}
        <StepCard step={3} title="DJ">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: -8, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: includeDj ? '#166534' : C.muted }}>{includeDj ? 'Included' : 'Off'}</span>
              <Toggle on={includeDj} onToggle={function () { setIncludeDj(!includeDj) }} />
            </div>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: isDesktop ? 'minmax(0,1fr) 340px' : '1fr',
            columnGap: 16, rowGap: 10, alignItems: 'start',
          }}>
            <div style={{ minWidth: 0, opacity: includeDj ? 1 : 0.3, pointerEvents: includeDj ? 'auto' : 'none' }}>
              <div style={Object.assign({}, PILL_ROW, { marginBottom: 0 })}>
                {[1, 0].map(function (idx) {
                  return <Pill key={idx} label={DJ_LABELS[idx]} on={djIdx === idx}
                    onClick={function () { setDjIdx(idx) }} />
                })}
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <RateRow showAll={true} q={fmtK(adjDj.q || 0)} t={fmtK(adjDj.t || 0)} f={fmtK(adjDj.f || 0)} />
            </div>
          </div>
        </StepCard>

        {/* GRAND TOTAL */}
        <div style={{
          background: BRAND_WASH,
          borderRadius: 16, padding: 18, marginBottom: 12, color: '#fff',
          border: '1px solid rgba(203,213,225,.16)',
          boxShadow: '0 8px 24px rgba(15,23,42,.30)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
            color: '#E2E8F0', marginBottom: 12,
          }}>Grand Total</div>
          <RateRow onBrand showAll={true} q={fmtRound(adjTotal.q || 0)} t={fmtRound(adjTotal.t || 0)} f={fmtRound(adjTotal.f || 0)} />
          {(<div style={{ fontSize: 10.5, color: 'rgba(226,232,240,.72)', textAlign: 'center', marginTop: 9 }}>
            Exact: {fmtL(adjTotal.q || 0)} / {fmtL(adjTotal.t || 0)} / {fmtL(adjTotal.f || 0)}
          </div>)}

          {savedId && <StatusBar quoteStatus={quoteStatus} onUpdate={updateStatus} />}
          {savedId && lmsRef && (
            <div style={{ marginTop: 9, padding: '8px 12px', borderRadius: 999, background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.28)', fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center' }}>
              LMS Lead #{lmsRef}
            </div>
          )}
          {pushing && (
            <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.85)', fontWeight: 600 }}>Pushing to LMS...</div>
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
                  background: '#1D4ED8', color: '#fff',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>Push to LMS</button>
              </div>
            </div>
          </div>
        )}

        {/* NOTES */}
        <StepCard step={4} title="Notes">
          <VoiceInput as="textarea" value={notes} onChange={function(e){ setNotes(e.target.value) }}
            rows="3" maxLength="1000" placeholder="Remarks, special requests, negotiation context..."
            style={{ width: '100%', padding: 11, paddingRight: 40, borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, fontFamily: 'inherit', color: C.text, background: C.bg, resize: 'vertical', outline: 'none' }} />
          {notes.length > 0 && <div style={{ fontSize: 10, color: C.muted, textAlign: 'right', marginTop: 4 }}>{notes.length}/1000</div>}
        </StepCard>

        {/* DEAL VALUE */}
        <StepCard step={5} title="Deal Value" subtitle="Negotiated pricing">
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Enter negotiated amounts per component (₹L). Blank fields fall back to the system-suggested value on print.</div>
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
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Discount on whole package (₹L)</div>
            <input type="number" inputMode="decimal" step="any" value={dealDiscount}
              placeholder="0"
              onInput={function (e) { setDealDiscount(e.target.value) }}
              style={{ width: '100%', padding: '9px 6px', borderRadius: 9, border: '2px solid ' + C.border, fontSize: 14, fontWeight: 700, color: '#991B1B', textAlign: 'center', boxSizing: 'border-box' }} />
          </div>
          {hasDeal && (
            <div style={{ background: '#111827', borderRadius: 10, padding: '10px 14px', color: '#fff', textAlign: 'center', marginBottom: 10 }}>
              {discountAmt > 0 && (
                <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>
                  Subtotal ₹{rd(effSubtotal)}L − Discount ₹{rd(discountAmt)}L
                </div>
              )}
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, letterSpacing: 1, marginBottom: 2 }}>NEGOTIATED TOTAL</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtRound(effTotal)}</div>
            </div>
          )}
          {hasDeal && adjTotal.q > 0 && (<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            {[
              { label: 'vs QUOTE', val: adjTotal.q, tone: RATE_TONES.quote },
              { label: 'vs TARGET', val: adjTotal.t, tone: RATE_TONES.target },
              { label: 'vs FLOOR', val: adjTotal.f, tone: RATE_TONES.floor },
            ].map(function (x) {
              var diff = rd(effTotal - x.val)
              var pct = x.val > 0 ? rd((diff / x.val) * 100) : 0
              return (<div key={x.label} style={{
                background: x.tone.bg, border: '1px solid ' + x.tone.bd,
                borderRadius: 10, padding: '8px 6px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: x.tone.fg, marginBottom: 2, opacity: 0.75 }}>{x.label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: diff >= 0 ? UP_FG : DOWN_FG }}>{diff >= 0 ? '+' : ''}{rd(diff)}L</div>
                <div style={{ fontSize: 10, color: x.tone.fg, opacity: 0.6 }}>{pct >= 0 ? '+' : ''}{pct}%</div>
              </div>)
            })}
          </div>)}
          {hasDeal && (<button onClick={function () {
            var lines = ['AMBRIA DEAL', venName + ' | ' + (guestName || 'Guest'),
              currentET.label + ' | ' + fmtDate(eventDate) + ' | ' + pax + 'pax',
              '========================',
              'V+M: ₹' + rd(effVm) + 'L | Décor: ₹' + rd(effDecor) + 'L | Ent: ₹' + rd(effEnt) + 'L']
            if (discountAmt > 0) lines.push('Discount: -₹' + rd(discountAmt) + 'L')
            lines.push('TOTAL: ₹' + rd(effTotal) + 'L')
            lines.push('========================')
            copyText(lines.join('\n'))
          }} style={{
            width: '100%', marginTop: 4, padding: 12, borderRadius: 999, border: 'none',
            background: RAMP, color: '#fff',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 3px 10px rgba(51,65,85,.25)', fontFamily: 'inherit',
          }}>Copy Deal Summary</button>)}
        </StepCard>
        {showAnalysis && (
          <StepCard step={6} title="AI Analysis">
            {analyzing && <div style={{ textAlign: 'center', padding: 20, color: C.muted, fontSize: 13 }}>Analyzing quote...</div>}
            {analysis && analysis.error && <div style={{ color: '#334155', fontSize: 12, padding: 10 }}>{analysis.error}</div>}
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
              {analysis.closing_tip && (<div style={{ marginTop: 8, padding: 10, background: '#F0FDF4', borderRadius: 8, fontWeight: 600, color: '#4B5B70', display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <span style={{ marginTop: 1 }}><Ic n="bulb" s={14} /></span>
                <span>{analysis.closing_tip}</span>
              </div>)}
            </div>)}
            <button onClick={function () { setShowAnalysis(false) }} style={{
              width: '100%', marginTop: 10, padding: 10, borderRadius: 8, border: '1px solid ' + C.border,
              background: '#fff', color: C.muted, fontSize: 12, cursor: 'pointer',
            }}>Close</button>
          </StepCard>
        )}

        {/* PROPOSAL */}
        {showProposal && (
          <SectionCard title="Proposal">
            <pre style={{ fontSize: 11, lineHeight: 1.7, background: C.bg, borderRadius: 9, padding: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace', border: '1px solid ' + C.border, overflow: 'auto' }}>{proposalText}</pre>
            <button onClick={function () { copyText(proposalText) }} style={{
              width: '100%', padding: 14, borderRadius: 12, border: 'none',
              background: '#111827', color: '#fff',
              fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 8,
            }}>Copy</button>
          </SectionCard>
        )}

        {/* TAX CALCULATOR (admin only, client-side GST math) */}
        {<StepCard step={7} title="Tax Calculator" subtitle="GST breakdown">
          <div style={Object.assign({}, LABEL_ST, { display: 'flex', alignItems: 'center', gap: 8 })}>
            Deal
            <span style={{ padding: '2px 9px', borderRadius: 999, background: RAMP_SOFT, color: C.violetDeep, fontSize: 11.5, fontWeight: 700 }}>{fmtL(dealVal)}</span>
          </div>
          <input className="qc-range" type="range" min={5} max={60} step={0.5} value={dealVal}
            onInput={function (e) { setDealVal(+e.target.value) }}
            style={{
              width: '100%', accentColor: C.violet, marginBottom: 14,
              background: 'linear-gradient(90deg,#64748B 0%,#64748B ' + (((dealVal - 5) / 55) * 100) + '%,#E5E7EB ' + (((dealVal - 5) / 55) * 100) + '%)',
            }} />

          <div style={LABEL_ST}>Type</div>
          <div style={PILL_ROW}>
            {['+ Tax', 'All-In'].map(function (label, idx) {
              return <Pill key={idx} label={label} on={taxMode === idx}
                onClick={function () { setTaxMode(idx) }} />
            })}
          </div>

          <div style={Object.assign({}, LABEL_ST, { display: 'flex', alignItems: 'center', gap: 8 })}>
            5% : 18% split
            <span style={{ padding: '2px 9px', borderRadius: 999, background: RAMP_SOFT, color: C.violetDeep, fontSize: 11.5, fontWeight: 700 }}>{split5} : {100 - split5}</span>
          </div>
          <input className="qc-range" type="range" min={10} max={90} step={5} value={split5}
            onInput={function (e) { setSplit5(+e.target.value) }}
            style={{
              width: '100%', accentColor: C.violet, marginBottom: 14,
              background: 'linear-gradient(90deg,#64748B 0%,#64748B ' + (((split5 - 10) / 80) * 100) + '%,#E5E7EB ' + (((split5 - 10) / 80) * 100) + '%)',
            }} />

          <div style={{ background: C.bg, borderRadius: 10, padding: 11, marginBottom: 10, fontSize: 13, border: '1px solid ' + C.border }}>
            {[['Deal', fmtL(dealVal), C.text], ['@5%', fmtL(a5), C.text], ['@18%', fmtL(a18), C.text],
              ['Tax@5', fmtINR(t5), C.violetDeep], ['Tax@18', fmtINR(t18), C.violetDeep]].map(function (row, ri) {
              return (<div key={row[0]} style={{
                display: 'flex', justifyContent: 'space-between', padding: '6px 0',
                borderBottom: ri === 4 ? 'none' : '1px solid ' + C.border,
              }}>
                <span style={{ color: C.muted }}>{row[0]}</span>
                <span style={{ fontWeight: 700, color: row[2] }}>{row[1]}</span>
              </div>)
            })}
          </div>

          <div style={{
            background: BRAND_WASH, borderRadius: 16, padding: 14, marginTop: 12,
            border: '1px solid rgba(203,213,225,.16)', boxShadow: '0 8px 24px rgba(15,23,42,.30)',
          }}>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr' }}>
              {[
                // net to you is the headline number, so it takes the mint tone;
                // total tax is the cost and stays the quiet neutral one
                { val: fmtL(ttx) + ' (' + effRate + '%)', label: 'TOTAL TAX', tone: RATE_TONES_BRAND.floor },
                { val: fmtL(guestPays), label: 'GUEST PAYS', tone: RATE_TONES_BRAND.target },
                { val: fmtL(netToYou), label: 'NET TO YOU', tone: RATE_TONES_BRAND.quote },
              ].map(function (x) {
                return (<div key={x.label} style={{
                  background: x.tone.bg, border: '1px solid ' + x.tone.bd,
                  borderRadius: 12, padding: '10px 8px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 9.5, color: x.tone.lf, fontWeight: 700, letterSpacing: 0.7, marginBottom: 3 }}>{x.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: x.tone.fg }}>{x.val}</div>
                </div>)
              })}
            </div>
          </div>
        </StepCard>}

        </>)}
      </>)}
        </div>
        {/* Sticks to the top of the scroller so the running totals stay in view
            while the form scrolls. alignSelf:start keeps the item content-sized
            (a stretched grid item cannot stick), and the max height plus its own
            scroll covers the calculator step, where the panel gets taller than
            the viewport. The floating CTA overlaps this column's tail on the
            guest step, so that keeps its own clearance. */}
        <div className={isDesktop ? 'qc-noscroll' : undefined} style={isDesktop
          ? {
            minWidth: 0, position: 'sticky', top: 0, alignSelf: 'start',
            maxHeight: 'calc(100dvh - 96px)', overflowY: 'auto',
            paddingBottom: page === 0 ? 58 : 0,
          }
          : { minWidth: 0 }}>
        <LivePreview
          page={page}
          guestName={guestName}
          venName={venName}
          etLabel={(currentET && currentET.label) || ''}
          pax={pax}
          slotLabel={SLOTS[slot] || ''}
          effVm={effVm}
          effDecor={effDecor}
          effEnt={effEnt}
          effTotal={effTotal}
          adjTotalQ={adjTotal.q || 0}
          adjTotalT={adjTotal.t || 0}
          adjTotalF={adjTotal.f || 0}
          hasDeal={hasDeal}
          savedId={savedId}
          lmsRef={lmsRef}
          discountAmt={discountAmt}
          isDesktop={isDesktop}
        />
        </div>
      </div>

      <ActionBar
        page={page}
        savedId={savedId}
        lmsRef={lmsRef}
        pushing={pushing}
        saving={saving}
        analyzing={analyzing}
        calcResult={calcResult}
        showProposal={showProposal}
        showAnalysis={showAnalysis}
        onSaveQuote={saveQuote}
        onPrint={printQuote}
        onPushLms={function () { updateStatus('sent') }}
        onToggleProposal={function () { setShowProposal(!showProposal) }}
        onToggleAI={function () { if (showAnalysis) { setShowAnalysis(false) } else { askAI() } }}
        onContinue={function () { setTtdIdx(autoTtdIdx(eventDate)); setPage(1) }}
        onBack={function () { setPage(0) }}
        onNewQuote={newQuote}
      />
        </div>
      </div>
    </div>
  )
}

export default QuoteCalculator
