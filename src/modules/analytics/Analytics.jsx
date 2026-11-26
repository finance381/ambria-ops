import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase, edgeFnErrorMessage } from '../../lib/supabase'
import { formatDate, formatDateTime } from '../../lib/format'
import Icon from '../../components/ui/Icon'
import EventDatePicker from '../../components/ui/EventDatePicker'

// Analytics -- two levels, each with its own filters.
//
// Leads: public.lms_leads, a mirror of LMS leads (one row per lead entry,
// all four departments) kept fresh by the lms-leads-sync edge function.
// Contracts: fn_analytics_contracts, one row per contract built from events
// (money taken once per contract, never per function -- LMS copies the
// contract's header amounts onto every function row).
//
// Chart choice, by what the reader must see:
//   headline numbers        -> stat tiles
//   status / dept split     -> donut + legend with count and %
//   change over time        -> columns (day / week / month buckets)
//   compare names (source, salesperson, venue) -> horizontal bars, ranked
//   leads vs won per name   -> paired horizontal bars (2 series, legend)
//   ratios (visit %, tasting %, conversion %) -> meter rows
//   per-user detail         -> table
// Colours are the validated reference categorical slots, in their fixed
// order (passes the CVD and normal-vision checks); every coloured mark also
// carries a visible label or legend, so colour never works alone.

var DEPTS = ['Venue', 'Catering', 'Decor', 'Entertainment']
var S = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6']
var GRAY = '#94a3b8'
var NAVY = '#0f1f45'
var DEPT_COLOR = { Venue: S[0], Catering: S[1], Decor: S[2], Entertainment: S[3] }
// Lead statuses. LMS's lead API lists OPEN leads only (blank = Open, mild,
// warm, hot); Confirmed / Dead / Waste leads drop out of it. lms-leads-sync
// marks a lead `closed` once it has left the list, and it reads as
// Confirmed when a contract exists for it, else Dead / Waste (the API can't
// say which of the two). Slots 1-6 in palette order (validated).
// Dead / Waste leads are left out of Analytics altogether (by choice): the
// lead count is open leads + converted leads. Slots 1-4 + 6 (validated).
var STATUS_ORDER = ['Open', 'Hot', 'Warm', 'Mild', 'Confirmed']
var STATUS_COLOR = { Open: S[0], Hot: S[1], Warm: S[2], Mild: S[3], Confirmed: S[5], Other: GRAY }

var PRESETS = [
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'fy', label: 'This FY' },
  { key: 'custom', label: 'Custom' },
]

function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function presetRange(key, basis) {
  var now = new Date()
  if (key === 'last_month') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) }
  if (key === '90d') return { from: iso(new Date(now.getTime() - 89 * 86400000)), to: iso(now) }
  if (key === 'fy') {
    var fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    return { from: fyStart + '-04-01', to: iso(now) }
  }
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) }
}

function pct(a, b) { return b > 0 ? Math.round((a / b) * 1000) / 10 : 0 }
function num(n) { return Number(n || 0).toLocaleString('en-IN') }
// paise -> short rupees: ₹4.2 Cr / ₹18.5 L / ₹42,000
function money(p) {
  var r = Number(p || 0) / 100
  if (Math.abs(r) >= 1e7) return '₹' + (r / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr'
  if (Math.abs(r) >= 1e5) return '₹' + (r / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L'
  return '₹' + Math.round(r).toLocaleString('en-IN')
}
function sum(rows, k) { return rows.reduce(function (s, r) { return s + Number(r[k] || 0) }, 0) }
function count(rows, fn) { return rows.filter(fn).length }
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase() }) }

// PostgREST caps a response at 1000 rows -- page through.
async function fetchAll(makeQuery) {
  var out = []
  for (var from = 0; ; from += 1000) {
    var res = await makeQuery().range(from, from + 999)
    if (res.error) throw res.error
    out = out.concat(res.data || [])
    if (!res.data || res.data.length < 1000) break
  }
  return out
}

var LEAD_COLS = 'lead_key, department, entry_no, guest_name, entry_date, first_function_date, function_count, function_names, venue_name, lead_type, priority, enquiry_mode, status, assigned_lms_id, assigned_name, entry_by_lms_id, entry_by_name, followed_up, last_followup_date, next_followup_date, followup_status, visited, contract_no, closed, closed_at, forwarded_from, forwarded_contract_no, forwarded_by_lms_id'

// LMS user id -> profile name, loaded once (fn_analytics_lms_user_names), so a
// mapping made on the Users page shows at once. An id nobody is mapped to
// reads 'LMS user #<id>' -- that is the id to map.
var LMS_NAMES = {}
var lmsNamesLoaded = null
function loadLmsNames() {
  if (!lmsNamesLoaded) {
    var call = function () { return supabase.rpc('fn_analytics_lms_user_names') }
    // one quick retry before giving up, so the first load isn't left nameless
    lmsNamesLoaded = call().then(function (r) {
      return (r && !r.error && r.data && r.data.length) ? r : call()
    }).then(function (r) {
      var rows = (r && r.data) || []
      rows.forEach(function (u) { LMS_NAMES[String(u.lms_user_id)] = u.name })
      // a failed or empty read must not stick for the session -- try again
      // on the next load instead of showing 'LMS user #id' until a reload
      if (r && r.error) console.warn('LMS names:', r.error.message)
      if (!rows.length) lmsNamesLoaded = null
    }).catch(function () { lmsNamesLoaded = null })
  }
  return lmsNamesLoaded || Promise.resolve()
}
// fn_analytics_contracts names an unmapped creator 'LMS user #<id>'; the
// LMS user list (via LMS_NAMES) usually knows who that is.
function nameContracts(list) {
  return list.map(function (c) {
    var m = /^LMS user #(\d+)$/.exec(c.salesperson || '')
    return m && LMS_NAMES[m[1]] ? Object.assign({}, c, { salesperson: LMS_NAMES[m[1]] }) : c
  })
}
function salespersonOf(l) {
  var a = l.assigned_lms_id, e = l.entry_by_lms_id
  return (a && LMS_NAMES[a]) || l.assigned_name || (e && LMS_NAMES[e]) || l.entry_by_name ||
    (a ? 'LMS user #' + a : e ? 'LMS user #' + e : 'Unassigned')
}
function leadTypeLabel(t) { return t === 'I' ? 'In-house' : t === 'O' ? 'Outdoor' : (t || '—') }
function statusOf(l) {
  if (l.closed) return l.contract_no ? 'Confirmed' : 'Dead / Waste'
  var s = titleCase(l.status).trim()
  if (!s) return 'Open'
  return STATUS_ORDER.indexOf(s) !== -1 ? s : 'Other'
}
function firstFunction(r) { return (r.function_names || '').split(', ')[0] || null }

function groupBy(rows, fn) {
  var m = {}
  rows.forEach(function (r) { var k = fn(r) || 'Not set'; (m[k] = m[k] || []).push(r) })
  return Object.keys(m).map(function (k) { return { label: k, rows: m[k] } })
}
function uniq(rows, fn) {
  var s = {}
  rows.forEach(function (r) { var v = fn(r); if (v) s[v] = true })
  return Object.keys(s).sort()
}

// Time buckets: day up to 14 days, week up to ~4 months, month beyond.
function bucketsFor(from, to, noPartial) {
  var a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00')
  var days = Math.round((b - a) / 86400000) + 1
  var out = []
  var short = function (d) { return d.getDate() + ' ' + d.toLocaleString('en-IN', { month: 'short' }) }
  if (days <= 14) {
    for (var d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) out.push({ from: iso(d), to: iso(d), label: short(d) })
    return { unit: 'day', list: out }
  }
  if (days <= 120) {
    for (var w = new Date(a); w <= b; w.setDate(w.getDate() + 7)) {
      var end = new Date(w); end.setDate(end.getDate() + 6)
      if (end > b) end = new Date(b)
      out.push({ from: iso(w), to: iso(end), label: short(w) + '–' + short(end) })
    }
    if (!noPartial) markPartial(out)
    return { unit: 'week', list: out }
  }
  for (var m = new Date(a.getFullYear(), a.getMonth(), 1); m <= b; m.setMonth(m.getMonth() + 1)) {
    var mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0)
    out.push({ from: iso(m), to: iso(mEnd), label: m.toLocaleString('en-IN', { month: 'short' }) + ' ' + String(m.getFullYear()).slice(2) })
  }
  if (!noPartial) markPartial(out)
  return { unit: 'month', list: out }
}
// A bucket that runs past today is still filling up -- its dip is not a drop.
function markPartial(list) {
  var today = iso(new Date())
  var last = list[list.length - 1]
  if (last && last.to >= today && last.from !== last.to) { last.partial = true; last.label += ' (so far)' }
}
// The equal-length period just before [from, to] -- for "vs previous" deltas.
function prevRange(from, to) {
  var a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00')
  var days = Math.round((b - a) / 86400000) + 1
  var pt = new Date(a); pt.setDate(pt.getDate() - 1)
  var pf = new Date(pt); pf.setDate(pf.getDate() - days + 1)
  return { from: iso(pf), to: iso(pt) }
}
function inRange(d, from, to) { return !!d && d >= from && d <= to }

function bucketOf(buckets, date) {
  if (!date) return -1
  for (var i = 0; i < buckets.length; i++) if (date >= buckets[i].from && date <= buckets[i].to) return i
  return -1
}

// ── hover tooltip (one per chart) ──
function useTip() {
  var [tip, setTip] = useState(null)
  function bind(lines) {
    return {
      onMouseMove: function (e) { setTip({ x: e.clientX, y: e.clientY, lines: lines }) },
      onMouseLeave: function () { setTip(null) },
    }
  }
  // Portalled to <body>: each card's load-in animation gives it its own
  // stacking layer, which would otherwise trap the tooltip under the card
  // below. Flips left / up near the window's right / bottom edge.
  var el = tip && createPortal(
    <div className="fixed z-[1000] pointer-events-none rounded-lg bg-slate-900 text-white text-[12px] px-2.5 py-1.5 shadow-lg tabular-nums"
      style={{
        left: tip.x + 12, top: tip.y + 12, maxWidth: 260,
        transform: (tip.x > window.innerWidth - 280 ? 'translateX(calc(-100% - 24px))' : '') + (tip.y > window.innerHeight - 120 ? ' translateY(calc(-100% - 24px))' : ''),
      }}>
      {tip.lines.map(function (l, i) { return <div key={i} className={i === 0 ? 'font-semibold' : 'text-slate-300'}>{l}</div> })}
    </div>,
    document.body
  )
  return [el, bind]
}

// ── building blocks ──

// Change vs the previous equal-length period. kind 'pts' = a percentage
// figure, shown as a point difference; down = good flips the colours.
function Delta({ cur, prev, kind, downIsGood }) {
  if (prev == null) return null
  var diff, text
  if (kind === 'pts') {
    diff = Math.round((cur - prev) * 10) / 10
    text = (diff > 0 ? '+' : '') + diff + ' pts'
  } else {
    if (!prev) return cur ? <span className="text-[11px] font-semibold text-slate-400">new vs prev.</span> : null
    diff = Math.round(((cur - prev) / prev) * 1000) / 10
    text = (diff > 0 ? '+' : '') + diff + '%'
  }
  if (diff === 0) return <span className="text-[11px] font-semibold text-slate-400">= prev. period</span>
  var good = downIsGood ? diff < 0 : diff > 0
  return (
    <span className={'inline-flex items-center gap-0.5 text-[12.5px] font-extrabold ' + (good ? 'text-emerald-600' : 'text-red-600')} title="vs the previous period of the same length">
      {diff > 0 ? '▲' : '▼'} {text}
    </span>
  )
}

// Tiny trend line for a tile; no axes, just the shape.
function Spark({ values, color }) {
  var v = (values || []).map(function (x) { return x || 0 })
  if (v.length < 2) return null
  var max = Math.max.apply(null, v) || 1
  var pts = v.map(function (x, i) { return ((i / (v.length - 1)) * 100).toFixed(1) + ',' + (28 - (x / max) * 24).toFixed(1) }).join(' ')
  var c = color || S[0]
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="an-reveal w-20 h-8 shrink-0" aria-hidden="true">
      <polygon points={'0,30 ' + pts + ' 100,30'} fill={c} fillOpacity="0.12" />
      <polyline points={pts} fill="none" stroke={c} strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// Holds a card's motion until it scrolls into view (once), so charts grow as
// the reader reaches them rather than all at once off-screen on load.
function useInView() {
  var ref = useRef(null)
  var [seen, setSeen] = useState(false)
  useEffect(function () {
    if (seen || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting })) { setSeen(true); io.disconnect() }
    }, { threshold: 0.15 })
    io.observe(ref.current)
    return function () { io.disconnect() }
  }, [seen])
  return [ref, seen]
}

function Tile({ icon, label, value, sub, tone, accent, delta, spark }) {
  var [ref, seen] = useInView()
  return (
    <div ref={ref} style={{ '--tile-accent': (accent || S[0]) + '66' }}
      className={'group an-rise bg-white border border-slate-200/80 rounded-2xl px-4 py-4 min-w-0 shadow-[0_1px_3px_rgba(15,23,42,0.07),0_8px_24px_rgba(15,23,42,0.09)] transition-[translate,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1 hover:border-[var(--tile-accent)] hover:shadow-[0_4px_8px_rgba(15,23,42,0.08),0_20px_40px_rgba(15,23,42,0.16)]' + (seen ? '' : ' an-wait')}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 w-8 h-8 rounded-xl inline-flex items-center justify-center transition-[scale] duration-200 group-hover:scale-110" style={{ background: (accent || S[0]) + '1f', color: accent || S[0] }}>
          <Icon name={icon} size={16} />
        </span>
        <p className="flex-1 min-w-0 text-[13px] font-bold leading-tight text-slate-700">{label}</p>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <p className={'font-display text-[30px] leading-none font-extrabold tabular-nums tracking-tight ' + (tone || 'text-slate-900')}>{value}</p>
        {spark && <Spark values={spark} color={accent} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-[18px]">
        {delta && <Delta cur={delta.cur} prev={delta.prev} kind={delta.kind} downIsGood={delta.downIsGood} />}
        {sub && <span className="text-[11.5px] text-slate-500 truncate">{sub}</span>}
      </div>
    </div>
  )
}

function SectionTitle({ title, sub, icon, right }) {
  return (
    <div className="pt-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <span className="shrink-0 mt-0.5 w-9 h-9 rounded-xl inline-flex items-center justify-center text-white shadow-sm" style={{ background: NAVY }}>
            <Icon name={icon} size={17} />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-display text-[20px] font-extrabold tracking-tight text-slate-900 leading-tight">{title}</h3>
          {sub && <p className="mt-0.5 text-[12.5px] text-slate-500">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

function Card({ title, sub, children, right, className }) {
  var [ref, seen] = useInView()
  return (
    <div ref={ref} className={'an-rise bg-white border border-slate-200/80 rounded-2xl min-w-0 shadow-[0_1px_3px_rgba(15,23,42,0.07),0_8px_24px_rgba(15,23,42,0.09)] transition-[box-shadow,border-color] duration-200 hover:border-slate-300/80 hover:shadow-[0_2px_6px_rgba(15,23,42,0.08),0_16px_36px_rgba(15,23,42,0.14)] ' + (className || '') + (seen ? '' : ' an-wait')}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <h3 className="font-display text-[16px] font-extrabold tracking-tight text-slate-900">{title}</h3>
          {sub && <p className="mt-0.5 text-[12px] text-slate-500">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </div>
  )
}

function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-600">
      {items.map(function (s) {
        return <span key={s.name} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>
      })}
    </div>
  )
}

function Empty() { return <p className="py-10 text-center text-[12.5px] text-slate-400">No data for these filters</p> }

// Donut with a legend that carries count and share for every slice.
function Donut({ parts, centerLabel, fmt }) {
  var [tipEl, bind] = useTip()
  var total = parts.reduce(function (s, p) { return s + p.value }, 0)
  if (total === 0) return <Empty />
  var R = 72, r = 50, cx = 80, cy = 80
  var a0 = -Math.PI / 2
  var shown = parts.filter(function (p) { return p.value > 0 })
  function arc(start, end) {
    if (end - start >= Math.PI * 2 - 1e-6) end = start + Math.PI * 2 - 1e-4
    var large = end - start > Math.PI ? 1 : 0
    var p = function (rad, ang) { return (cx + rad * Math.cos(ang)).toFixed(2) + ' ' + (cy + rad * Math.sin(ang)).toFixed(2) }
    return 'M ' + p(R, start) + ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p(R, end) +
      ' L ' + p(r, end) + ' A ' + r + ' ' + r + ' 0 ' + large + ' 0 ' + p(r, start) + ' Z'
  }
  var f = fmt || num
  return (
    <div className="flex flex-wrap items-center gap-6">
      {tipEl}
      <svg viewBox="0 0 160 160" width="160" height="160" className="an-spin shrink-0" role="img" aria-label={centerLabel}>
        {shown.map(function (p) {
          var start = a0
          var end = a0 + (p.value / total) * Math.PI * 2
          a0 = end
          return <path key={p.name} d={arc(start, end)} fill={p.color} stroke="#fff" strokeWidth="2"
            {...bind([p.name, f(p.value) + ' · ' + pct(p.value, total) + '%'])} />
        })}
        <text x="80" y="80" textAnchor="middle" className="fill-slate-900" style={{ fontSize: 24, fontWeight: 800 }}>{f(total)}</text>
        <text x="80" y="99" textAnchor="middle" className="fill-slate-500" style={{ fontSize: 11, fontWeight: 600 }}>{centerLabel}</text>
      </svg>
      <div className="flex-1 min-w-[160px] space-y-1.5">
        {parts.map(function (p) {
          return (
            <div key={p.name} className="flex items-center gap-2 text-[12.5px]">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} />
              <span className="flex-1 text-slate-700 truncate">{p.name}</span>
              <span className="tabular-nums font-semibold text-slate-900">{f(p.value)}</span>
              <span className="tabular-nums text-slate-400 w-12 text-right">{pct(p.value, total)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Columns over time; 1 or 2 series on one axis, value labels on top.
function Columns({ buckets, series, fmt, height }) {
  var [tipEl, bind] = useTip()
  var f = fmt || num
  var max = 0
  buckets.forEach(function (b, i) { series.forEach(function (s) { max = Math.max(max, s.values[i] || 0) }) })
  if (max === 0) return <Empty />
  var labelEvery = buckets.length > 16 ? Math.ceil(buckets.length / 8) : 1
  var showValues = buckets.length <= 16
  return (
    <div>
      {tipEl}
      {series.length > 1 && <div className="mb-3"><Legend items={series} /></div>}
      <div className="relative" style={{ height: height || 200 }}>
        {[0.25, 0.5, 0.75].map(function (g) {
          return <div key={g} className="absolute left-0 right-0 border-t border-dashed border-slate-100" style={{ bottom: (g * 100) + '%' }} />
        })}
        <div className="absolute inset-0 flex items-end gap-1 border-b border-slate-300">
          {buckets.map(function (b, i) {
            var lines = [b.label].concat(series.map(function (s) { return s.name + ': ' + f(s.values[i] || 0) }))
            return (
              <div key={b.from} className="flex-1 min-w-0 h-full flex items-end justify-center gap-[2px] rounded-t hover:bg-slate-50" {...bind(lines)}>
                {series.map(function (s) {
                  var v = s.values[i] || 0
                  var h = v > 0 ? Math.max(1.5, (v / max) * 88) : 0
                  return (
                    <div key={s.name} className="flex-1 max-w-[28px] flex flex-col items-center justify-end h-full">
                      {showValues && v > 0 && <span className="text-[10px] font-semibold text-slate-600 tabular-nums mb-0.5 whitespace-nowrap">{f(v)}</span>}
                      <div className="an-h w-full rounded-t" style={{ height: h + '%', background: s.color }} />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex gap-1 mt-1.5">
        {buckets.map(function (b, i) {
          return <div key={b.from} className="flex-1 min-w-0 text-center text-[10px] text-slate-400 truncate">{i % labelEvery === 0 ? b.label : ''}</div>
        })}
      </div>
    </div>
  )
}

// Ranked horizontal bars. Each item: { label, a, b? }; series names/colours
// given once. One series = plain ranking; two = paired (e.g. leads vs won).
// Top `limit` rows, with a Show all / Show less toggle so nobody past the
// cut-off (e.g. the 13th salesperson) is silently missing.
// 1 / 2 / 2.5 / 5 x 10^k at or above max -- clean axis tops
function niceMax(max) {
  if (max <= 0) return 1
  var e = Math.pow(10, Math.floor(Math.log10(max)))
  var steps = [1, 2, 2.5, 5, 10]
  for (var i = 0; i < steps.length; i++) if (steps[i] * e >= max) return steps[i] * e
  return 10 * e
}

// Line chart over time: one or two series on one axis, the first filled as
// an area. Hover anywhere in a column for a crosshair and the values.
function LineChart({ buckets, series, fmt, height, area }) {
  var [hover, setHover] = useState(null)
  var [gid] = useState(function () { return Math.random().toString(36).slice(2, 8) })
  var f = fmt || num
  var H = height || 200
  var n = buckets.length
  var max = 0
  series.forEach(function (s) { buckets.forEach(function (b, i) { max = Math.max(max, s.values[i] || 0) }) })
  if (!n || max === 0) return <Empty />
  var top = niceMax(max)
  var X = function (i) { return ((i + 0.5) / n) * 100 }
  var Y = function (v) { return 100 - ((v || 0) / top) * 100 }
  function line(s) { return buckets.map(function (b, i) { return (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + Y(s.values[i]).toFixed(2) }).join(' ') }
  // the last segment, into a still-filling bucket, is drawn dashed
  var partial = n > 1 && buckets[n - 1].partial
  function solid(s) { return buckets.slice(0, partial ? n - 1 : n).map(function (b, i) { return (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + Y(s.values[i]).toFixed(2) }).join(' ') }
  function tail(s) { return 'M' + X(n - 2).toFixed(2) + ' ' + Y(s.values[n - 2]).toFixed(2) + ' L' + X(n - 1).toFixed(2) + ' ' + Y(s.values[n - 1]).toFixed(2) }
  function areaPath(s) { return line(s) + ' L' + X(n - 1).toFixed(2) + ' 100 L' + X(0).toFixed(2) + ' 100 Z' }
  var labelEvery = n > 12 ? Math.ceil(n / 8) : 1
  return (
    <div>
      {series.length > 1 && <div className="mb-3"><Legend items={series} /></div>}
      <div className="flex gap-2">
        <div className="relative w-12 shrink-0 text-right text-[10px] text-slate-400 tabular-nums" style={{ height: H }}>
          {[1, 0.5, 0].map(function (g) {
            return <span key={g} className="absolute right-0 -translate-y-1/2" style={{ top: ((1 - g) * 100) + '%' }}>{f(top * g)}</span>
          })}
        </div>
        <div className="relative flex-1 min-w-0" style={{ height: H }} onMouseLeave={function () { setHover(null) }}>
          {[0, 0.5, 1].map(function (g) {
            return <div key={g} className={'absolute left-0 right-0 border-t ' + (g === 1 ? 'border-slate-300' : 'border-dashed border-slate-100')} style={{ top: (g * 100) + '%' }} />
          })}
          <div className="absolute inset-0 an-reveal">
          <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={'lg-' + gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={series[0].color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={series[0].color} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {area && <path d={areaPath(series[0])} fill={'url(#lg-' + gid + ')'} />}
            {series.map(function (s) {
              return (
                <g key={s.name}>
                  <path d={solid(s)} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                  {partial && <path d={tail(s)} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
                </g>
              )
            })}
          </svg>
          {series.map(function (s) {
            return buckets.map(function (b, i) {
              if (hover !== i && !(n <= 16)) return null
              return <span key={s.name + i} className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-white border-2"
                style={{ left: X(i) + '%', top: Y(s.values[i]) + '%', borderColor: s.color, opacity: hover === i || hover == null ? 1 : 0.35 }} />
            })
          })}
          </div>
          {hover != null && <div className="absolute top-0 bottom-0 w-px bg-slate-300" style={{ left: X(hover) + '%' }} />}
          <div className="absolute inset-0 flex">
            {buckets.map(function (b, i) { return <div key={b.from} className="flex-1 h-full" onMouseEnter={function () { setHover(i) }} /> })}
          </div>
          {hover != null && (
            <div className="absolute z-10 pointer-events-none rounded-lg bg-slate-900 text-white text-[12px] px-2.5 py-1.5 shadow-lg tabular-nums whitespace-nowrap"
              style={{ left: X(hover) + '%', top: 4, transform: X(hover) > 60 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
              <div className="font-semibold">{buckets[hover].label}</div>
              {series.map(function (s) {
                return <div key={s.name} className="flex items-center gap-1.5 text-slate-300"><span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />{s.name}: <span className="text-white font-semibold">{f(s.values[hover] || 0)}</span></div>
              })}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-1.5">
        <div className="w-12 shrink-0" />
        <div className="flex-1 min-w-0 flex">
          {buckets.map(function (b, i) {
            return <div key={b.from} className="flex-1 min-w-0 text-center text-[10px] text-slate-400 truncate">{i % labelEvery === 0 ? b.label : ''}</div>
          })}
        </div>
      </div>
    </div>
  )
}

var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function weekdayOf(d) { var w = new Date(d + 'T00:00:00').getDay(); return (w + 6) % 7 }

function ShowAll({ total, limit, all, setAll }) {
  if (total <= limit) return null
  return (
    <button type="button" onClick={function () { setAll(!all) }}
      className="mt-3 text-[12px] font-bold text-indigo-600 hover:text-indigo-800">
      {all ? 'Show top ' + limit : 'Show all ' + total}
    </button>
  )
}

var OVERLAY_COLS = 'minmax(110px, 24%) minmax(60px, 1fr) 56px 80px 64px'

// sorts: optional [{ value, label, cmp }] -- a small "Sort" switch above the
// bars. rateOf: optional series key whose value is also shown as a % of `a`.
function HBars({ items, series, fmt, limit, sorts, rateOf, overlay }) {
  var [tipEl, bind] = useTip()
  var [all, setAll] = useState(false)
  var [sortBy, setSortBy] = useState(sorts ? sorts[0].value : null)
  var f = fmt || num
  var lim = limit || 10
  var sortDef = sorts && (sorts.filter(function (o) { return o.value === sortBy })[0] || sorts[0])
  var ordered = sortDef ? items.slice().sort(sortDef.cmp) : items
  var list = all ? ordered : ordered.slice(0, lim)
  if (!list.length) return <Empty />
  var max = 0
  list.forEach(function (it) { series.forEach(function (s) { max = Math.max(max, it[s.key] || 0) }) })
  return (
    <div>
      {tipEl}
      {(series.length > 1 || sorts) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {series.length > 1 && !overlay ? <Legend items={series} /> : <span />}
          {sorts && (
            <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              Sort
              <div className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200">
                {sorts.map(function (o) {
                  var on = o.value === sortDef.value
                  return (
                    <button key={o.value} type="button" aria-pressed={on} onClick={function () { setSortBy(o.value) }}
                      className={'h-6 px-2 rounded-md text-[11px] font-semibold whitespace-nowrap ' + (on ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {overlay && series.length === 2 && (
        <div className="grid items-end gap-4 px-2 pb-2 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wide text-slate-400" style={{ gridTemplateColumns: OVERLAY_COLS }}>
          <span>Name</span>
          <span />
          <span className="text-right" style={{ color: series[0].color }}>{series[0].name}</span>
          <span className="text-right" style={{ color: series[1].color }}>{series[1].name}</span>
          <span className="text-right">Rate</span>
        </div>
      )}
      <div className={overlay ? 'divide-y divide-slate-100' : 'space-y-2.5'}>
        {list.map(function (it) {
          var lines = [it.label].concat(series.map(function (s) { return s.name + ': ' + f(it[s.key] || 0) })).concat(it.note ? [it.note] : [])
          if (overlay && series.length === 2) {
            // one row per name, table-like: bar (whole light, part solid
            // inside), then the whole, the part and the rate in their own
            // aligned columns under a header
            var whole = it[series[0].key] || 0, part = it[series[1].key] || 0
            var ww = max > 0 ? Math.max(whole > 0 ? 2 : 0, (whole / max) * 100) : 0
            var rate = pct(part, whole)
            return (
              <div key={it.label} className="grid items-center gap-4 px-2 py-2.5 rounded-lg hover:bg-slate-50" style={{ gridTemplateColumns: OVERLAY_COLS }} {...bind(lines)}>
                <span className="text-[13px] font-semibold text-slate-800 truncate" title={it.label}>{it.label}</span>
                <div className="min-w-0">
                  <div className="an-w relative h-3 rounded-full overflow-hidden" style={{ width: ww + '%', background: 'linear-gradient(90deg, ' + series[0].color + 'cc, ' + series[0].color + '80)' }}>
                    <div className="an-w absolute inset-y-0 left-0 rounded-full" style={{ width: (whole ? (part / whole) * 100 : 0) + '%', background: series[1].color, boxShadow: part > 0 && part < whole ? '2px 0 0 0 #fff' : 'none' }} />
                  </div>
                </div>
                <span className="text-right text-[13.5px] font-bold tabular-nums text-slate-800">{f(whole)}</span>
                <span className="text-right text-[13.5px] font-bold tabular-nums" style={{ color: part ? series[1].color : '#cbd5e1' }}>{f(part)}</span>
                <span className="text-right">
                  <span className={'inline-block min-w-[52px] px-2 py-1 rounded-lg text-[12px] font-bold tabular-nums text-center ' + (whole === 0 ? 'text-slate-300' : rate >= 30 ? 'bg-emerald-50 text-emerald-700' : rate >= 10 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500')}>{whole ? rate + '%' : '—'}</span>
                </span>
              </div>
            )
          }
          return (
            <div key={it.label} className="grid items-center gap-3" style={{ gridTemplateColumns: 'minmax(80px, 28%) 1fr' }} {...bind(lines)}>
              <span className="text-[12.5px] text-slate-700 truncate" title={it.label}>{it.label}</span>
              <div className="space-y-[3px]">
                {series.map(function (s) {
                  var v = it[s.key] || 0
                  return (
                    <div key={s.key} className="flex items-center gap-2 min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="an-w h-2.5 rounded-r" style={{ width: (max > 0 ? Math.max(v > 0 ? 1 : 0, (v / max) * 100) : 0) + '%', background: s.color }} />
                      </div>
                      <span className="shrink-0 text-[11.5px] font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                        {f(v)}{rateOf === s.key && it.a > 0 && <span className="ml-1 font-normal text-slate-400">({pct(v, it.a)}%)</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <ShowAll total={ordered.length} limit={lim} all={all} setAll={setAll} />
    </div>
  )
}

// Leads / Converted / Conversion % orderings for a leads-vs-converted chart.
// By %, names with under 3 leads go last so a 1-of-1 doesn't top the list.
function convRate(g) { return g.a >= 3 ? g.w / g.a : -1 + (g.a ? g.w / g.a : 0) / 10 }
var CONV_SORTS = [
  { value: 'a', label: 'Leads', cmp: function (x, y) { return y.a - x.a || y.w - x.w } },
  { value: 'w', label: 'Converted', cmp: function (x, y) { return y.w - x.w || y.a - x.a } },
  { value: 'rate', label: 'Conversion %', cmp: function (x, y) { return convRate(y) - convRate(x) || y.a - x.a } },
]

// One ratio per row against its own whole: name, track, percentage, counts.
function Meters({ items, limit }) {
  var [tipEl, bind] = useTip()
  var [all, setAll] = useState(false)
  var lim = limit || 10
  var list = all ? items : items.slice(0, lim)
  if (!list.length) return <Empty />
  return (
    <div className="space-y-2.5">
      {tipEl}
      {list.map(function (it) {
        var p = pct(it.part, it.whole)
        return (
          <div key={it.label} className="grid items-center gap-3" style={{ gridTemplateColumns: 'minmax(80px, 34%) 1fr 92px' }}
            {...bind([it.label, it.part + ' of ' + it.whole + ' (' + p + '%)'])}>
            <span className="text-[12.5px] text-slate-700 truncate">{it.label}</span>
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="an-w h-full rounded-full" style={{ width: Math.min(100, p) + '%', background: it.color || S[0] }} />
            </div>
            <span className="text-[12px] tabular-nums text-right"><span className="font-bold text-slate-900">{p}%</span> <span className="text-slate-400">{it.part}/{it.whole}</span></span>
          </div>
        )
      })}
      <ShowAll total={items.length} limit={lim} all={all} setAll={setAll} />
    </div>
  )
}

// Funnel: each stage against the first, with step-to-step conversion.
// One hue, dark to light down the stages (sequential, not categorical).
var FUNNEL_SHADES = ['#1e3a8a', '#2a78d6', '#7fb0ec', '#c7dcf7']
function Funnel({ stages }) {
  var first = stages[0] ? stages[0].value : 0
  if (!first) return <Empty />
  return (
    <div className="space-y-2">
      {stages.map(function (s, i) {
        var w = Math.max(3, (s.value / first) * 100)
        return (
          <div key={s.label}>
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-[13.5px] font-bold text-slate-800">{s.label}</span>
              <div className="flex-1 flex justify-center">
                <div className="an-w h-9 rounded-lg flex items-center justify-center text-[13.5px] font-extrabold tabular-nums"
                  style={{ width: w + '%', background: FUNNEL_SHADES[Math.min(i, FUNNEL_SHADES.length - 1)], color: i < 2 ? '#fff' : NAVY, minWidth: 48 }}>{num(s.value)}</div>
              </div>
              <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-slate-500">{i === 0 ? '100%' : pct(s.value, first) + '%'}</span>
            </div>
            {i < stages.length - 1 && (
              <p className="pl-[108px] text-[10.5px] text-slate-400 leading-5">↓ {pct(stages[i + 1].value, s.value)}% moved on</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// `left`: indexes of text columns (left-aligned); others are figures, right.
// Default: only the first column is text.
function Table({ head, rows, foot, maxHeight, left }) {
  var isLeft = function (i) { return left ? left.indexOf(i) !== -1 : i === 0 }
  return (
    <div className="overflow-auto -mx-5 px-5" style={maxHeight ? { maxHeight: maxHeight } : null}>
      <table className="w-full text-[12.5px] tabular-nums">
        <thead className="sticky top-0 bg-white">
          <tr className="text-left text-[11.5px] font-bold text-slate-600 border-b-2 border-slate-200">
            {head.map(function (h, i) { return <th key={h + i} className={'py-2 pr-4 whitespace-nowrap ' + (isLeft(i) ? '' : 'text-right')}>{h}</th> })}
          </tr>
        </thead>
        <tbody>
          {rows.map(function (r, ri) {
            return (
              <tr key={ri} className="border-b border-slate-100 last:border-0 hover:bg-amber-50/40 transition-colors">
                {r.map(function (c, i) { return <td key={i} className={'py-2.5 pr-4 whitespace-nowrap text-[13px] ' + (i === 0 ? 'font-semibold text-slate-900' : isLeft(i) ? 'text-slate-700' : 'text-right text-slate-700')}>{c}</td> })}
              </tr>
            )
          })}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t border-slate-300 font-bold text-slate-900">
              {foot.map(function (c, i) { return <td key={i} className={'py-2 pr-4 whitespace-nowrap ' + (isLeft(i) ? '' : 'text-right')}>{c}</td> })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ── filter panel (shared by both tabs) ──
// Row 1: period chips, the date range as one field, what the dates mean.
// Row 2: department chips. Row 3: the finer filters, compact, with a count
// of what is applied and one Clear.

function Segmented({ value, onChange, options, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex max-w-full overflow-x-auto p-1 rounded-xl bg-white border border-slate-200">
      {options.map(function (o) {
        var on = value === o.value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={function () { onChange(o.value) }}
            className={'h-9 px-3.5 rounded-[10px] text-[13px] font-bold whitespace-nowrap transition-colors ' + (on ? 'bg-amber-100 text-amber-900 shadow-sm ring-1 ring-amber-200' : 'text-slate-500 hover:text-slate-800')}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// From -> To as one field; the pickers' own triggers sit borderless inside it.
var RANGE_TRIGGER = { height: 34, border: 'none', background: 'transparent', borderRadius: 8, paddingTop: 0, paddingBottom: 0, paddingLeft: 8, paddingRight: 8 }
function DateRange({ f, setF }) {
  return (
    <div className="inline-flex items-center h-11 pl-3 pr-1 rounded-xl bg-white border border-slate-200 font-semibold">
      <Icon name="calendar" size={15} className="text-slate-500 shrink-0" />
      <div className="w-[132px]">
        <EventDatePicker value={f.from} placeholder="From" collapsible includePast plain neutral triggerStyle={RANGE_TRIGGER}
          onChange={function (v) { if (v) setF(Object.assign({}, f, { preset: 'custom', from: v })) }} />
      </div>
      <Icon name="arrowRight" size={13} className="text-slate-400 shrink-0" />
      <div className="w-[132px]">
        <EventDatePicker value={f.to} placeholder="To" collapsible includePast plain neutral triggerStyle={RANGE_TRIGGER}
          onChange={function (v) { if (v) setF(Object.assign({}, f, { preset: 'custom', to: v })) }} />
      </div>
    </div>
  )
}

function DeptChips({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {[''].concat(DEPTS).map(function (d) {
        var on = value === d
        return (
          <button key={d || 'all'} type="button" aria-pressed={on} onClick={function () { onChange(d) }}
            className={'h-9 px-3.5 inline-flex items-center gap-1.5 rounded-full text-[13px] font-bold border transition-colors ' +
              (on ? 'bg-[#0f1f45] border-[#0f1f45] text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50')}>
            {d && <span className="w-2 h-2 rounded-full" style={{ background: DEPT_COLOR[d], boxShadow: on ? '0 0 0 1.5px #fff' : 'none' }} />}
            {d || 'All departments'}
          </button>
        )
      })}
    </div>
  )
}

// Filter dropdown. Not a native <select>: the browser opens that upwards
// whenever the space below looks short, which it did right under the filter
// row. This one always drops down, gets a search box for long lists, and
// closes on Esc or a click outside.
function MiniSelect({ label, value, onChange, options, allLabel }) {
  var [open, setOpen] = useState(false)
  var [q, setQ] = useState('')
  var wrapRef = useRef(null)
  var active = value !== '' && value != null
  var opts = [{ value: '', label: allLabel }].concat(options.map(function (o) {
    return typeof o === 'string' ? { value: o, label: o } : o
  }))
  var cur = opts.filter(function (o) { return o.value === (value || '') })[0]
  var shown = q ? opts.filter(function (o) { return o.label.toLowerCase().indexOf(q.toLowerCase()) !== -1 }) : opts

  useEffect(function () {
    if (!open) return
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return function () { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  function pick(v) { onChange(v); setOpen(false); setQ('') }

  return (
    <div className="flex flex-col gap-1 min-w-0" ref={wrapRef}>
      {label && <span className="text-[12.5px] font-semibold text-slate-700">{label}</span>}
      <div className="relative">
        <button type="button" aria-label={label ? undefined : allLabel} aria-haspopup="listbox" aria-expanded={open} onClick={function () { setOpen(!open); setQ('') }}
          className={'w-full h-10 pl-3 pr-8 rounded-xl text-[13px] font-semibold border text-left truncate focus:outline-none focus:ring-2 focus:ring-amber-400/30 ' +
            (active ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300')}>
          {cur ? cur.label : allLabel}
        </button>
        <span className={'absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-transform ' + (open ? 'rotate-180 text-slate-600' : 'text-slate-400')}><Icon name="chevronDown" size={13} /></span>
        {open && (
          <div role="listbox" className="absolute left-0 top-full mt-1.5 z-[1000] w-full min-w-[220px] bg-white border border-slate-200 rounded-xl shadow-[0_12px_32px_rgba(15,23,42,0.16)] overflow-hidden">
            {opts.length > 8 && (
              <div className="p-2 border-b border-slate-100">
                <input autoFocus value={q} onChange={function (e) { setQ(e.target.value) }} placeholder="Search…"
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" />
              </div>
            )}
            <div className="max-h-64 overflow-y-auto py-1">
              {shown.length === 0 && <p className="px-3 py-3 text-[12.5px] text-slate-400">No match</p>}
              {shown.map(function (o) {
                var on = o.value === (value || '')
                return (
                  <button key={o.value || '__all'} type="button" role="option" aria-selected={on} onClick={function () { pick(o.value) }}
                    className={'w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[13px] ' + (on ? 'bg-amber-50 text-amber-900 font-semibold' : 'text-slate-700 hover:bg-slate-50')}>
                    <span className="truncate">{o.label}</span>
                    {on && <Icon name="check" size={13} className="shrink-0 text-amber-700" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

var QUICK = PRESETS.filter(function (p) { return p.key !== 'custom' }).map(function (p) { return { value: p.key, label: p.label } })
// same periods on every basis (ending today); dates ahead: pick a custom range
function quickFor() { return QUICK }
// switching what the dates mean re-reads the period on the new basis; a
// preset the new basis doesn't offer falls back to This month
function withBasis(f, basis) {
  var keys = quickFor(basis).map(function (o) { return o.value })
  var preset = f.preset === 'custom' ? 'custom' : (keys.indexOf(f.preset) !== -1 ? f.preset : 'month')
  return Object.assign({}, f, { basis: basis, preset: preset }, preset === 'custom' ? {} : presetRange(preset, basis))
}

// dims: [{ key, label, options, allLabel }] -- the finer filters
// Where the compact bar parks: just under the admin header (h-14, sticky).
var STICKY_TOP = 64

function FilterPanel({ f, setF, bases, dims, onReset, right, footer }) {
  function set(k, v) { var o = {}; o[k] = v; setF(Object.assign({}, f, o)) }
  var applied = dims.filter(function (d) { return f[d.key] }).length + (f.dept ? 1 : 0)
  // Once the full panel has scrolled up out of sight, a compact copy of the
  // main controls pins under the header (same left edge and width as the
  // panel), so filters change from anywhere down the page.
  var panelRef = useRef(null)
  var [box, setBox] = useState(null)        // { left, width } while pinned, else null
  var [more, setMore] = useState(false)     // compact bar's "Filters" drawer
  useEffect(function () {
    function check() {
      var el = panelRef.current
      if (!el) return
      var r = el.getBoundingClientRect()
      if (r.bottom < STICKY_TOP + 8) setBox({ left: r.left, width: r.width })
      else { setBox(null); setMore(false) }
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return function () { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [])

  var compact = box && createPortal(
    <div className="fixed z-[900] an-drop" style={{ top: STICKY_TOP, left: box.left, width: box.width }}>
      <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-2xl shadow-[0_10px_30px_rgba(15,23,42,0.14)] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented ariaLabel="Period" value={f.preset} options={quickFor(f.basis)}
            onChange={function (k) { setF(Object.assign({}, f, { preset: k }, presetRange(k, f.basis))) }} />
          <DateRange f={f} setF={setF} />
          {bases.length > 1 && <Segmented ariaLabel="Dates are" value={f.basis} options={bases} onChange={function (v) { setF(withBasis(f, v)) }} />}
          <div className="w-44">
            <MiniSelect label={null} value={f.dept} onChange={function (v) { set('dept', v) }} options={DEPTS} allLabel="All departments" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={function () { setMore(!more) }} aria-expanded={more}
              className={'h-10 px-3.5 inline-flex items-center gap-1.5 rounded-xl border text-[13px] font-bold ' + (more || applied ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300')}>
              <Icon name="filter" size={14} />Filters{applied ? ' (' + applied + ')' : ''}
              <Icon name="chevronDown" size={13} className={more ? 'rotate-180' : ''} />
            </button>
            <button type="button" onClick={function () { window.scrollTo({ top: 0, behavior: 'smooth' }) }} aria-label="Back to top"
              className="h-10 w-10 inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300">
              <Icon name="chevronUp" size={16} />
            </button>
          </div>
        </div>
        {more && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="grid gap-3 items-end" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))' }}>
              {dims.map(function (d) {
                return <MiniSelect key={d.key} label={d.label} value={f[d.key]} onChange={function (v) { set(d.key, v) }} options={d.options} allLabel={d.allLabel || 'All'} />
              })}
            </div>
            {applied > 0 && (
              <div className="mt-2 text-right">
                <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-[12px] font-bold text-indigo-600 hover:text-indigo-800">
                  <Icon name="close" size={12} />Clear {applied} filter{applied > 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )

  return (
    <>
    {compact}
    <div ref={panelRef} className="bg-white border border-slate-200/80 rounded-2xl px-5 py-4 space-y-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.07),0_8px_24px_rgba(15,23,42,0.09)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented ariaLabel="Period" value={f.preset} options={quickFor(f.basis)}
            onChange={function (k) { setF(Object.assign({}, f, { preset: k }, presetRange(k, f.basis))) }} />
          <DateRange f={f} setF={setF} />
          {bases.length > 1 && <Segmented ariaLabel="Dates are" value={f.basis} options={bases} onChange={function (v) { setF(withBasis(f, v)) }} />}
        </div>
        {right}
      </div>
      <DeptChips value={f.dept} onChange={function (v) { set('dept', v) }} />
      <div className="grid gap-3 items-end" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))' }}>
        {dims.map(function (d) {
          return <MiniSelect key={d.key} label={d.label} value={f[d.key]} onChange={function (v) { set(d.key, v) }} options={d.options} allLabel={d.allLabel || 'All'} />
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="min-w-0 flex-1">{footer}</div>
        {applied > 0 && (
          <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-[12px] font-bold text-indigo-600 hover:text-indigo-800">
            <Icon name="close" size={12} />Clear {applied} filter{applied > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
    </>
  )
}

var grid2 = { display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))' }
var tilesGrid = { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))' }
// card grid: 1 column on a phone, 2 on a laptop, 3 on a wide screen; a
// trend chart spans two (W2) so every row ends full
var G3 = 'grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'
var W2 = 'lg:col-span-2'

// ═════════════════════ Lead level ═════════════════════
//
// What is measured, and why (checked against LMS's own Lead View):
// - Leads: lms_leads by lead date (or function date). LMS's lead API lists
//   open leads only, so leads closed before our sync first saw them are not
//   in here; leads closed after that are kept and marked closed.
// - Contracts done: contracts signed in the period (fn_analytics_contracts),
//   exactly LMS's "Contract Done" -- matched 34 = 34 for Venue, Nov 2026.
// - Lead → contract = contracts done ÷ leads, same as LMS's conversion.
// - Attempted = a real follow-up entry exists (LMS "Attempted").

var LEAD_FILTER_DEFAULT = function () { return Object.assign({ preset: 'month', basis: 'entry', dept: '', venue: '', sales: '', priority: '', source: '', status: '', leadType: '' }, presetRange('month')) }

function LeadLevel() {
  var [fSel, setF] = useState(LEAD_FILTER_DEFAULT)
  var [rows, setRows] = useState([])
  var [contracts, setContracts] = useState([])
  var [convContracts, setConvContracts] = useState([])
  var [loading, setLoading] = useState(true)
  // after the first load, a filter change keeps the old charts on screen
  // (dimmed) instead of swapping them for 'Loading…' -- that shrank the page
  // and threw a scrolled-down user back to the top
  var [ready, setReady] = useState(false)
  var [error, setError] = useState('')
  var [syncState, setSyncState] = useState([])
  var [syncing, setSyncing] = useState(false)
  var [syncMsg, setSyncMsg] = useState('')
  var [reload, setReload] = useState(0)

  // the dates the charts' data was loaded for. While a new date range
  // loads, the old data is still on screen -- count it with its OWN dates,
  // not the new ones, or it flashes a wrong in-between number first
  var [shownRange, setShownRange] = useState(null)
  var f = loading && shownRange ? Object.assign({}, fSel, shownRange) : fSel

  useEffect(function () {
    var cancelled = false
    setLoading(true); setError('')
    var range = { from: fSel.from, to: fSel.to, basis: fSel.basis }
    var col = fSel.basis === 'function' ? 'first_function_date' : 'entry_date'
    // read the previous equal-length period too, for the tiles' deltas
    var from = prevRange(fSel.from, fSel.to).from
    Promise.all([
      loadLmsNames().then(function () { return fetchAll(function () {
        return supabase.from('lms_leads').select(LEAD_COLS).gte(col, from).lte(col, fSel.to).order(col, { ascending: true })
      }) }),
      fetchAll(function () { return supabase.rpc('fn_analytics_contracts', { p_from: from, p_to: fSel.to, p_basis: fSel.basis === 'function' ? 'function' : 'contract' }) })
        .catch(function () { return [] }),
      // contracts whose LEAD came in this period (or whose function falls in
      // it) -- the converted leads, which LMS's lead list no longer shows
      fetchAll(function () { return supabase.rpc('fn_analytics_contracts', { p_from: from, p_to: fSel.to, p_basis: fSel.basis === 'function' ? 'function' : 'lead' }) })
        .catch(function () { return [] }),
    ]).then(function (res) {
      if (!cancelled) { setRows(res[0]); setContracts(nameContracts(res[1])); setConvContracts(nameContracts(res[2])); setLoading(false); setReady(true); setShownRange(range) }
    }).catch(function (e) {
      if (!cancelled) { setError(e.message || 'Could not load leads'); setLoading(false) }
    })
    supabase.from('lms_leads_sync_state').select('*').then(function (r) { if (!cancelled) setSyncState(r.data || []) })
    return function () { cancelled = true }
  }, [fSel.from, fSel.to, fSel.basis, reload])

  // Each call works ~100s and saves its place; keep calling (only for the
  // departments not finished yet) until every one has read LMS's whole list.
  async function syncNow() {
    setSyncing(true)
    var left = null, pending = null
    var MAX_RUNS = 30
    for (var run = 1; run <= MAX_RUNS; run++) {
      setSyncMsg('Syncing leads from LMS… run ' + run + (pending ? ' · still reading: ' + pending : ''))
      // only the departments still unfinished; first run: the filtered
      // department if one is picked, else all four
      var body = left ? { departments: left.map(function (s) { return s.department }) } : (f.dept ? { departments: [f.dept] } : {})
      var res = await supabase.functions.invoke('lms-leads-sync', { body: body })
      if (res.error) { setSyncMsg('Sync failed: ' + await edgeFnErrorMessage(res.error)); break }
      var summary = (res.data && res.data.summary) || []
      setReload(function (n) { return n + 1 })
      var bad = summary.filter(function (s) { return s.error })
      if (bad.length) { setSyncMsg('Sync stopped: ' + bad.map(function (s) { return s.department + ' — ' + s.error }).join('; ') + ' · press Sync now to carry on.'); break }
      left = summary.filter(function (s) { return !s.done })
      if (!left.length) { setSyncMsg('All leads synced.'); break }
      pending = left.map(function (s) { return s.department + ' (page ' + s.next_page + ')' }).join(', ')
      if (run === MAX_RUNS) setSyncMsg('Synced part of the list — still reading: ' + pending + '. The hourly sync will carry on.')
    }
    setSyncing(false)
  }

  // LMS's lead list drops a lead once it converts, so each converted contract
  // (by its lead's date) stands in for its lead here: Confirmed, with the
  // contract's salesperson / source / venue. Decor contracts carry no lead
  // date in LMS, so Decor conversions come only from leads we saw close.
  var allLeads = useMemo(function () {
    // Function-date mode answers "what is on these dates" -- leads for those
    // dates and functions booked -- not conversion, so converted contracts
    // don't stand in for leads there.
    if (f.basis === 'function') return rows
    var pseudo = convContracts.map(function (c) {
      return {
        lead_key: 'contract_' + c.department + '_' + c.contract_no, department: c.department, entry_no: c.contract_no,
        guest_name: c.client_name, entry_date: c.lead_entry_date, first_function_date: c.first_function_date,
        function_names: c.function_names, venue_name: c.venue_name, lead_type: c.contract_type, priority: c.priority,
        enquiry_mode: c.enquiry_mode, status: 'confirmed', entry_by_name: c.salesperson,
        // a lead that converted was followed up and visited
        followed_up: true, visited: true, contract_no: c.contract_no, closed: true, fromContract: true,
      }
    })
    var have = {}
    pseudo.forEach(function (r) { have[r.department + '|' + r.contract_no] = true })
    return rows.filter(function (r) { return !(r.closed && r.contract_no && have[r.department + '|' + r.contract_no]) }).concat(pseudo)
  }, [rows, convContracts, f.basis])

  var opts = useMemo(function () {
    return {
      venue: uniq(allLeads, function (r) { return r.venue_name }),
      sales: uniq(allLeads.map(function (r) { return { s: salespersonOf(r) } }).concat(contracts.map(function (c) { return { s: c.salesperson || 'Unassigned' } })), function (x) { return x.s }),
      priority: uniq(allLeads, function (r) { return r.priority }),
      source: uniq(allLeads, function (r) { return r.enquiry_mode }),
    }
  }, [allLeads, contracts])

  function matchDims(r) {
    if (f.dept && r.department !== f.dept) return false
    if (f.venue && r.venue_name !== f.venue) return false
    if (f.sales && salespersonOf(r) !== f.sales) return false
    if (f.priority && r.priority !== f.priority) return false
    if (f.source && r.enquiry_mode !== f.source) return false
    if (f.leadType && r.lead_type !== f.leadType) return false
    return true
  }
  // Dead / Waste = a lead that left LMS's open list with no contract. Kept
  // out of every count above; shown on its own below, to see where they
  // come from. LMS can't say which of the two, nor share ones that closed
  // before tracking began.
  var isLost = function (r) { return !!(r.closed && !r.contract_no) }
  var pr = prevRange(f.from, f.to)
  var leadDate = function (r) { return f.basis === 'function' ? r.first_function_date : r.entry_date }
  var contractDate = function (c) { return f.basis === 'function' ? c.first_function_date : c.contract_date }
  function keptLead(r) {
    if (isLost(r)) return false
    if (f.status && statusOf(r) !== f.status) return false
    return matchDims(r)
  }
  var list = allLeads.filter(function (r) { return keptLead(r) && inRange(leadDate(r), f.from, f.to) })
  var listPrev = allLeads.filter(function (r) { return keptLead(r) && inRange(leadDate(r), pr.from, pr.to) })
  var lostList = allLeads.filter(function (r) { return isLost(r) && matchDims(r) && inRange(leadDate(r), f.from, f.to) })
  // contracts under the same filters (status has no meaning for a contract)
  function keptContract(c) {
    if (f.dept && c.department !== f.dept) return false
    if (f.venue && c.venue_name !== f.venue) return false
    if (f.sales && (c.salesperson || 'Unassigned') !== f.sales) return false
    if (f.priority && c.priority !== f.priority) return false
    if (f.source && c.enquiry_mode !== f.source) return false
    if (f.leadType && c.contract_type !== f.leadType) return false
    return true
  }
  var cList = contracts.filter(function (c) { return keptContract(c) && inRange(contractDate(c), f.from, f.to) })
  var cPrev = contracts.filter(function (c) { return keptContract(c) && inRange(contractDate(c), pr.from, pr.to) })

  var today = iso(new Date())
  var isOpen = function (r) { return !r.closed }
  var total = list.length
  var attempted = count(list, function (r) { return r.followed_up })
  var visited = count(list, function (r) { return r.visited })
  var openCount = count(list, isOpen)
  var overdue = count(list, function (r) { return isOpen(r) && r.next_followup_date && r.next_followup_date < today })
  var dueToday = count(list, function (r) { return isOpen(r) && r.next_followup_date === today })
  var done = cList.length
  // Lead -> conversion: of THESE leads, how many became a contract (left the
  // open list with a contract for their phone). Never above 100%, unlike
  // contracts signed in the period, which also come from older leads.
  var isWon = function (r) { return !!(r.closed && r.contract_no) }
  var won = count(list, isWon)
  var prev = {
    total: listPrev.length,
    attempted: count(listPrev, function (r) { return r.followed_up }),
    visited: count(listPrev, function (r) { return r.visited }),
    won: count(listPrev, isWon),
    done: cPrev.length,
  }
  prev.conv = pct(prev.won, prev.total)

  var statusParts = STATUS_ORDER.concat(['Other']).map(function (s) {
    return { name: s, color: STATUS_COLOR[s], value: count(list, function (r) { return statusOf(r) === s }) }
  }).filter(function (p) { return p.value > 0 || p.name !== 'Other' })

  var buckets = bucketsFor(f.from, f.to)
  var leadsB = [], doneB = [], wonB = [], visitB = [], realB = []
  var dow = [0, 0, 0, 0, 0, 0, 0]
  list.forEach(function (r) {
    var d = leadDate(r)
    var i = bucketOf(buckets.list, d)
    if (i >= 0) {
      leadsB[i] = (leadsB[i] || 0) + 1
      if (isWon(r)) wonB[i] = (wonB[i] || 0) + 1
      // visit rate only over leads LMS itself reports a visit status for --
      // a converted lead stood in from its contract has no real one
      if (!r.fromContract) {
        realB[i] = (realB[i] || 0) + 1
        if (r.visited) visitB[i] = (visitB[i] || 0) + 1
      }
    }
    if (d && !r.fromContract) dow[weekdayOf(d)]++
  })
  var convB = buckets.list.map(function (b, i) { return leadsB[i] ? pct(wonB[i] || 0, leadsB[i]) : 0 })
  var visitRateB = buckets.list.map(function (b, i) { return realB[i] ? pct(visitB[i] || 0, realB[i]) : 0 })
  cList.forEach(function (c) {
    var i = bucketOf(buckets.list, f.basis === 'function' ? c.first_function_date : c.contract_date)
    if (i >= 0) doneB[i] = (doneB[i] || 0) + 1
  })

  // leads (a) vs contracts done (b) per name, e.g. per source or salesperson
  function vsContracts(leadKey, contractKey) {
    var m = {}
    list.forEach(function (r) { var k = leadKey(r) || 'Not set'; (m[k] = m[k] || { label: k, a: 0, b: 0, w: 0, visits: 0, attempted: 0, rows: [] }); m[k].a++; m[k].rows.push(r); if (r.visited) m[k].visits++; if (r.followed_up) m[k].attempted++; if (isWon(r)) m[k].w++ })
    cList.forEach(function (c) { var k = contractKey(c) || 'Not set'; (m[k] = m[k] || { label: k, a: 0, b: 0, w: 0, visits: 0, attempted: 0, rows: [] }); m[k].b++ })
    // a name with contracts but no leads in the period has no ratio to show here
    return Object.keys(m).map(function (k) { var g = m[k]; g.note = 'Conversion ' + (g.a ? pct(g.w, g.a) + '%' : '—') + ' · ' + g.visits + ' visits · ' + g.b + ' contracts signed'; return g })
      .filter(function (g) { return g.a > 0 })
      .sort(function (x, y) { return y.a - x.a || y.w - x.w })
  }
  var bySource = vsContracts(function (r) { return r.enquiry_mode }, function (c) { return c.enquiry_mode })
  var bySales = vsContracts(salespersonOf, function (c) { return c.salesperson || 'Unassigned' })
  var byDept = DEPTS.filter(function (d) { return !f.dept || d === f.dept }).map(function (d) {
    var rs = list.filter(function (r) { return r.department === d })
    var b = cList.filter(function (c) { return c.department === d }).length
    var w = count(rs, isWon)
    return { label: d, rows: rs, a: rs.length, b: b, w: w, visits: count(rs, function (r) { return r.visited }), attempted: count(rs, function (r) { return r.followed_up }), note: 'Conversion ' + pct(w, rs.length) + '% · ' + b + ' contracts signed' }
  })
  var pairSeries = [{ key: 'a', name: 'Leads', color: S[0] }, { key: 'w', name: 'Converted', color: S[1] }]
  var leadSeries = [{ key: 'a', name: 'Leads', color: S[0] }]

  function stageBars() {
    return groupBy(list.filter(isOpen), function (r) { return r.followup_status || 'No stage yet' })
      .map(function (g) { return { label: g.label, a: g.rows.length } })
      .sort(function (x, y) { return y.a - x.a })
  }

  var isFn = f.basis === 'function'
  var fnBooked = sum(cList, 'function_count')
  var fnValue = sum(cList, 'package_paise')
  var bookedSeries = [{ key: 'a', name: 'Leads', color: S[0] }, { key: 'b', name: 'Contracts booked', color: S[1] }]

  function userRow(g, rank) {
    var rs = g.rows
    var od = count(rs, function (r) { return isOpen(r) && r.next_followup_date && r.next_followup_date < today })
    var name = rank ? (
      <span className="inline-flex items-center gap-2">
        <span className={'w-6 h-6 shrink-0 rounded-full inline-flex items-center justify-center text-[11px] font-extrabold ' + (rank <= 3 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500')}>{rank}</span>
        {g.label}
      </span>
    ) : g.label
    var row = [name, num(rs.length), num(count(rs, isOpen)), num(count(rs, function (r) { return r.followed_up })),
      num(count(rs, function (r) { return isOpen(r) && r.next_followup_date === today })),
      od > 0 ? <span className="font-bold text-red-600">{num(od)}</span> : '0',
      num(count(rs, function (r) { return r.visited }))]
    if (isFn) return row.concat([num(g.b)])
    var w = count(rs, isWon), rate = pct(w, rs.length)
    var pill = rs.length ? (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className="hidden md:inline-block w-14 h-1.5 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full rounded-full" style={{ width: Math.min(100, rate) + '%', background: S[5] }} /></span>
        <span className={'px-2 py-0.5 rounded-md text-[11.5px] font-bold ' + (rate >= 30 ? 'bg-emerald-50 text-emerald-700' : rate >= 10 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600')}>{rate}%</span>
      </span>
    ) : '—'
    return row.concat([w ? <span className="font-bold text-emerald-700">{num(w)}</span> : '0', pill, num(g.b)])
  }

  var lastSync = syncState.reduce(function (m, s) { return s.synced_at && (!m || s.synced_at > m) ? s.synced_at : m }, null)
  var syncErrors = syncState.filter(function (s) { return s.error })
  var unit = buckets.unit === 'day' ? 'daily' : buckets.unit === 'week' ? 'weekly' : 'monthly'

  return (
    <div className="space-y-4">
      <FilterPanel f={fSel} setF={setF} onReset={function () { setF(LEAD_FILTER_DEFAULT()) }}
        bases={[{ value: 'entry', label: 'Lead date' }, { value: 'function', label: 'Function date' }]}
        dims={[
          { key: 'venue', label: 'Venue', options: opts.venue, allLabel: 'All venues' },
          { key: 'sales', label: 'Salesperson', options: opts.sales, allLabel: 'Everyone' },
          { key: 'source', label: 'Source', options: opts.source, allLabel: 'All sources' },
          { key: 'priority', label: 'Priority', options: opts.priority },
          { key: 'status', label: 'Status', options: STATUS_ORDER },
          { key: 'leadType', label: 'Lead type', options: [{ value: 'I', label: 'In-house' }, { value: 'O', label: 'Outdoor' }] },
        ]}
        right={(
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-white border border-slate-200 text-[12.5px] font-semibold text-slate-600">
              <span className={'w-1.5 h-1.5 rounded-full ' + (syncErrors.length ? 'bg-amber-500' : lastSync ? 'bg-emerald-500' : 'bg-slate-300')} />
              {lastSync ? 'Synced ' + formatDateTime(lastSync) : 'Not synced yet'}
            </span>
            <button type="button" onClick={syncNow} disabled={syncing}
              className="h-10 px-4 inline-flex items-center gap-1.5 rounded-xl text-[13px] font-bold text-white bg-[#0f1f45] hover:bg-[#1a2f60] disabled:opacity-60 shadow-sm">
              <Icon name="refresh" size={13} className={syncing ? 'animate-spin' : ''} />{syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        )}
        footer={(
          <div className="space-y-1">
            <p className="inline-flex items-start gap-1.5 text-[11.5px] text-slate-500">
              <Icon name="info" size={13} className="shrink-0 mt-px text-slate-400" />
              <span>Leads = open leads + leads that converted to a contract. Dead / Waste leads are not counted.</span>
            </p>
            {syncMsg && <p className="text-[12px] text-slate-600">{syncMsg}</p>}
            {syncErrors.length > 0 && !syncMsg && (
              <div className="text-[12px] text-amber-700">
                {syncErrors.map(function (s) { return <p key={s.department}>Last sync — {s.department}: {s.error}</p> })}
              </div>
            )}
          </div>
        )} />

      {error ? <p className="text-[13px] text-red-600">{error}</p> : loading && !ready ? (
        <p className="py-16 text-center text-[13px] text-slate-400">Loading leads…</p>
      ) : (
        <div className="space-y-4" aria-busy={loading}
          key={shownRange ? shownRange.from + shownRange.to + shownRange.basis : 'first'}
          style={loading ? { visibility: 'hidden' } : null}>
          {loading && <UpdatingPill />}
          <SectionTitle icon="chart" title="Overview" sub="This period, and the change against the previous period of the same length" />
          <div style={tilesGrid}>
            <Tile icon="users" label={isFn ? 'Leads for these dates' : 'Total leads'} value={num(total)} sub={num(openCount) + ' still open'} accent={S[0]} delta={{ cur: total, prev: prev.total }} spark={leadsB} />
            <Tile icon="phone" label="Attempted" value={num(attempted)} sub={pct(attempted, total) + '% followed up'} accent={S[0]} delta={{ cur: attempted, prev: prev.attempted }} />
            <Tile icon="mapPin" label="Site visits" value={num(visited)} sub={pct(visited, total) + '% lead → visit'} accent={S[2]} delta={{ cur: visited, prev: prev.visited }} spark={visitB} />
            {isFn ? (
              <>
                <Tile icon="calendar" label="Functions booked" value={num(fnBooked)} sub={num(done) + ' contracts on these dates'} accent={S[5]} tone="text-emerald-700" delta={{ cur: done, prev: prev.done }} spark={doneB} />
                <Tile icon="rupee" label="Business on these dates" value={money(fnValue)} sub="package value of those contracts" accent={S[1]} />
              </>
            ) : (
              <>
                <Tile icon="checkCircle" label="Converted" value={num(won)} sub="leads that became a contract" accent={S[5]} tone="text-emerald-700" delta={{ cur: won, prev: prev.won }} spark={wonB} />
                <Tile icon="percent" label="Lead → conversion" value={total ? pct(won, total) + '%' : '—'} sub={num(won) + ' of ' + num(total) + ' leads'} accent={S[1]} delta={{ cur: pct(won, total), prev: prev.conv, kind: 'pts' }} spark={convB} />
                <Tile icon="fileText" label="Contracts signed" value={num(done)} sub="in this period, from any lead" accent={S[5]} delta={{ cur: done, prev: prev.done }} spark={doneB} />
              </>
            )}
            <Tile icon="clock" label="Follow-ups today" value={num(dueToday)} sub={num(overdue) + ' overdue'} accent={S[3]} tone={overdue > 0 ? 'text-red-600' : null} />
          </div>

          <div className={G3}>
            <Card className={W2} title={'Leads and contracts, ' + unit} sub={'Leads by ' + (f.basis === 'function' ? 'function date' : 'lead date') + ' · contracts by ' + (f.basis === 'function' ? 'function date' : 'contract date')}>
              <LineChart area buckets={buckets.list} series={[{ name: 'Leads', color: S[0], values: leadsB }, { name: isFn ? 'Contracts booked' : 'Contracts signed', color: S[1], values: doneB }]} />
            </Card>
            <Card title="Lead status" sub="Where every lead in this period stands">
              <Donut parts={statusParts} centerLabel="leads" />
            </Card>
            <Card title="Lead funnel" sub="How far these leads got (a converted lead counts as attempted and visited)">
              <Funnel stages={[
                { label: 'Leads', value: total },
                { label: 'Attempted', value: attempted },
                { label: 'Visited', value: visited },
              ].concat(isFn ? [] : [{ label: 'Converted', value: won }])} />
            </Card>
            {isFn ? (
              <Card className={W2} title="Functions booked by department" sub="Functions on these dates, per department">
                <Columns buckets={DEPTS.map(function (d) { return { from: d, label: d } })}
                  series={[{ name: 'Functions', color: S[0], values: DEPTS.map(function (d) { return sum(cList.filter(function (c) { return c.department === d }), 'function_count') }) }]} height={190} />
              </Card>
            ) : (
              <Card className={W2} title={'Conversion and visit rate, ' + unit} sub="Conversion: share of each week's leads that became a contract · Visit: share of LMS leads that had a site visit">
                <LineChart buckets={buckets.list} series={[{ name: 'Conversion %', color: S[5], values: convB }, { name: 'Visit %', color: S[2], values: visitRateB }]} fmt={function (v) { return Math.round(v * 10) / 10 + '%' }} />
              </Card>
            )}
          </div>

          <SectionTitle icon="list" title="Pipeline" sub="Where open leads stand, and when enquiries come in" />
          <div className={G3}>
            <Card title="Follow-up stage" sub="Open leads by their latest follow-up outcome">
              <HBars items={stageBars()} series={leadSeries} limit={8} />
            </Card>
            <Card title="Leads by day of week" sub="Which days enquiries come in">
              <Columns buckets={WEEKDAYS.map(function (d) { return { from: d, label: d } })} series={[{ name: 'Leads', color: S[0], values: dow }]} height={190} />
            </Card>
            {isFn ? (
              <Card title="Functions booked by venue">
                <HBars items={groupBy(cList, function (c) { return c.venue_name }).map(function (g) { return { label: g.label, a: sum(g.rows, 'function_count') } }).sort(function (x, y) { return y.a - x.a })} series={[{ key: 'a', name: 'Functions', color: S[1] }]} limit={8} />
              </Card>
            ) : (
              <Card title="Conversion rate by department" sub="Converted ÷ leads">
                <Meters items={byDept.filter(function (g) { return g.a > 0 }).map(function (g) { return { label: g.label, part: g.w, whole: g.a, color: DEPT_COLOR[g.label] } })} />
              </Card>
            )}
          </div>

          <SectionTitle icon="users" title="Sources & team" sub="Where leads come from, and who converts them" />
          <div className={G3}>
            <Card className={isFn ? W2 : 'lg:col-span-2 xl:col-span-3'} title={isFn ? 'Leads and bookings by source' : 'Leads by source & conversion'} sub={isFn ? 'Enquiry mode — leads and contracts for these dates' : 'Enquiry mode — leads, and how many of them converted'}>
              <HBars items={bySource} series={isFn ? bookedSeries : pairSeries} limit={8} sorts={isFn ? null : CONV_SORTS} rateOf={isFn ? null : 'w'} overlay={!isFn} />
            </Card>
            {isFn && (
              <Card title="Function type booked" sub="Functions on these dates">
                <HBars items={groupBy(cList, firstFunction).map(function (g) { return { label: g.label, a: sum(g.rows, 'function_count') } }).sort(function (x, y) { return y.a - x.a })} series={[{ key: 'a', name: 'Functions', color: S[1] }]} limit={8} />
              </Card>
            )}
            <Card className={W2} title={isFn ? 'Leads and bookings by salesperson' : 'Conversion by salesperson'} sub={isFn ? 'Leads and contracts for these dates' : 'Leads handled, and how many of them converted'}>
              <HBars items={bySales} series={isFn ? bookedSeries : pairSeries} limit={8} sorts={isFn ? null : CONV_SORTS} rateOf={isFn ? null : 'w'} overlay={!isFn} />
            </Card>
            <Card title="Lead → visit ratio by salesperson" sub="Visited ÷ leads">
              <Meters items={bySales.filter(function (g) { return g.a > 0 }).map(function (g) { return { label: g.label, part: g.visits, whole: g.a, color: S[2] } })} limit={8} />
            </Card>
            <Card title="Venue" sub="Leads per venue">
              <HBars items={groupBy(list, function (r) { return r.venue_name }).map(function (g) { return { label: g.label, a: g.rows.length } }).sort(function (x, y) { return y.a - x.a })} series={leadSeries} limit={8} />
            </Card>
            <Card title="Function type" sub="Leads per function">
              <HBars items={groupBy(list, firstFunction).map(function (g) { return { label: g.label, a: g.rows.length } }).sort(function (x, y) { return y.a - x.a })} series={leadSeries} limit={8} />
            </Card>
            <Card title="Priority" sub="Leads per priority">
              <HBars items={groupBy(list, function (r) { return r.priority }).map(function (g) { return { label: g.label, a: g.rows.length } }).sort(function (x, y) { return y.a - x.a })} series={leadSeries} limit={8} />
            </Card>
          </div>

          <ForwardedLeads list={list} />

          <LostLeads lostList={lostList} list={list} />

          <Card title="User-wise leads" sub="Per salesperson — follow-ups, visits and contracts signed">
            <Table maxHeight={420}
              head={isFn ? ['User', 'Leads', 'Open', 'Attempted', 'Today follow-up', 'Overdue', 'Visited', 'Contracts booked'] : ['User', 'Leads', 'Open', 'Attempted', 'Today follow-up', 'Overdue', 'Visited', 'Converted', 'Conversion %', 'Contracts signed']}
              rows={bySales.map(function (g, i) { return userRow(g, i + 1) })}
              foot={userRow({ label: 'Total', rows: list, b: done })} />
          </Card>
        </div>
      )}
    </div>
  )
}

// Leads one department passed to another -- mostly Venue contracts handing
// the client on to Decor ("Forwarded from Venue (00848) by Sahaj"). Counted
// over LMS's own lead rows only: a converted lead that stands in from its
// contract carries no forwarding record.
// shown while a filter change reloads -- the charts stay as they are
// (no dimming) and this small pill says new numbers are on the way
function UpdatingPill() {
  return createPortal(
    <div className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-none" style={{ top: STICKY_TOP + 70 }}>
      <div className="flex items-center gap-2 rounded-full bg-[#0f1f45] text-white text-[12.5px] font-semibold px-3.5 py-1.5 shadow-lg">
        <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        Updating…
      </div>
    </div>, document.body)
}

function ForwardedLeads({ list }) {
  var real = list.filter(function (r) { return !r.fromContract })
  var fwd = real.filter(function (r) { return r.forwarded_from })
  if (!fwd.length) return null
  var isWonR = function (r) { return !!(r.closed && r.contract_no) }
  var direct = real.length - fwd.length
  var froms = uniq(fwd, function (r) { return r.forwarded_from })
  var parts = [{ name: 'Direct', value: direct, color: S[0] }].concat(froms.map(function (d, i) {
    return { name: 'From ' + d, value: count(fwd, function (r) { return r.forwarded_from === d }), color: S[[1, 2, 3, 6][i % 4]] }
  }))
  function stats(rows) { return { a: rows.length, v: count(rows, function (r) { return r.visited }), w: count(rows, isWonR) } }
  var groups = [{ label: 'Direct', rows: real.filter(function (r) { return !r.forwarded_from }) }].concat(froms.map(function (d) {
    return { label: 'From ' + d, rows: fwd.filter(function (r) { return r.forwarded_from === d }) }
  }))
  // the sync already names each lead's owner / creator -- use those as a
  // fallback so a forwarder still gets a name if the LMS name list is empty
  var known = {}
  list.forEach(function (r) {
    if (r.assigned_lms_id && r.assigned_name) known[String(r.assigned_lms_id)] = r.assigned_name
    if (r.entry_by_lms_id && r.entry_by_name) known[String(r.entry_by_lms_id)] = r.entry_by_name
  })
  var forwarderOf = function (r) {
    var id = r.forwarded_by_lms_id
    return id ? (LMS_NAMES[id] || known[String(id)] || 'LMS user #' + id) : 'Unknown'
  }
  var byForwarder = groupBy(fwd, forwarderOf).map(function (g) {
    var st = stats(g.rows)
    return { label: g.label, a: st.a, w: st.w, note: st.v + ' visited · ' + st.w + ' converted · from ' + uniq(g.rows, function (r) { return r.forwarded_from }).join(', ') }
  }).sort(function (x, y) { return y.a - x.a })
  // every department, 0 included -- Venue forwards rather than receives, so
  // seeing its 0 next to Decor / Entertainment is the point
  var byDept = DEPTS.map(function (d) {
    var rows = fwd.filter(function (r) { return r.department === d })
    return { label: d, a: rows.length, note: rows.length ? uniq(rows, function (r) { return r.forwarded_from }).map(function (x) { return 'from ' + x }).join(', ') : 'none received' }
  }).sort(function (x, y) { return y.a - x.a })
  return (
    <div className="space-y-4">
      <SectionTitle icon="transfer" title="Forwarded leads"
        sub="Leads one department passed on to another — e.g. a Venue booking forwarded to Decor. Converted counts leads seen closing with a contract."
        right={(
          <span className="inline-flex items-baseline gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[12.5px] font-semibold text-amber-900">
            <span className="font-display text-[20px] font-extrabold tabular-nums">{num(fwd.length)}</span> forwarded · {pct(fwd.length, real.length)}% of LMS leads
          </span>
        )} />
      <div className={G3}>
        <Card title="Direct vs forwarded" sub="Where this period's LMS leads came from">
          <Donut parts={parts} centerLabel="leads" />
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
            {groups.map(function (g) {
              var st = stats(g.rows)
              return (
                <div key={g.label} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="text-slate-700">{g.label}</span>
                  <span className="tabular-nums text-slate-500">visit <span className="font-bold text-slate-800">{pct(st.v, st.a)}%</span> · converted <span className="font-bold text-slate-800">{pct(st.w, st.a)}%</span></span>
                </div>
              )
            })}
          </div>
        </Card>
        <Card className={W2} title="Who forwarded the most" sub="Salesperson on the contract each lead was forwarded from">
          <HBars items={byForwarder} series={[{ key: 'a', name: 'Forwarded', color: S[0] }, { key: 'w', name: 'Converted', color: S[1] }]} limit={8} sorts={CONV_SORTS} rateOf="w" overlay />
        </Card>
      </div>
      <div className={G3}>
        <Card title="Received by department" sub="Forwarded leads each department got">
          <HBars items={byDept} series={[{ key: 'a', name: 'Leads received', color: S[0] }]} />
        </Card>
      </div>
    </div>
  )
}

// Where Dead / Waste leads come from: by source, salesperson, venue, and the
// last follow-up stage they reached. "Rate" = lost ÷ (lost + the leads kept),
// per group, so a big source isn't flagged just for being big.
function LostLeads({ lostList, list }) {
  var total = lostList.length
  function by(fn) {
    var kept = {}
    list.forEach(function (r) { var k = fn(r) || 'Not set'; kept[k] = (kept[k] || 0) + 1 })
    return groupBy(lostList, fn).map(function (g) {
      var all = g.rows.length + (kept[g.label] || 0)
      return { label: g.label, a: g.rows.length, part: g.rows.length, whole: all, note: pct(g.rows.length, all) + '% of this group’s leads were lost', color: S[4] }
    }).sort(function (x, y) { return y.a - x.a })
  }
  var series = [{ key: 'a', name: 'Dead / Waste', color: S[4] }]
  var bySource = by(function (r) { return r.enquiry_mode })
  return (
    <div className="space-y-4">
      <SectionTitle icon="alert" title="Dead / Waste leads"
        sub="Leads that left LMS without a contract — not counted above. LMS doesn't say which were Dead and which Waste, and only leads closed since tracking began are here, so this grows with time."
        right={(
          <span className="inline-flex items-baseline gap-1.5 px-3.5 py-1.5 rounded-xl bg-pink-50 border border-pink-200 text-[12.5px] font-semibold text-pink-800">
            <span className="font-display text-[20px] font-extrabold tabular-nums">{num(total)}</span> lost · {pct(total, total + list.length)}% of all leads
          </span>
        )} />
      {total === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl"><Empty /></div>
      ) : (
        <>
          <div className={G3}>
            <Card title="By source" sub="Which enquiry modes lose the most leads"><HBars items={bySource} series={series} limit={8} /></Card>
            <Card title="Loss rate by source" sub="Lost ÷ all leads from that source (3+ leads)">
              <Meters items={bySource.filter(function (g) { return g.whole >= 3 })} limit={8} />
            </Card>
            <Card title="By salesperson"><HBars items={by(salespersonOf)} series={series} limit={8} /></Card>
            <Card title="Last stage before closing" sub="The follow-up outcome they ended on">
              <HBars items={by(function (r) { return r.followup_status || 'No stage recorded' })} series={series} />
            </Card>
            <Card title="By venue"><HBars items={by(function (r) { return r.venue_name })} series={series} /></Card>
            <Card title="By department"><HBars items={by(function (r) { return r.department })} series={series} /></Card>
          </div>
        </>
      )}
    </div>
  )
}

// ═════════════════════ Contract level ═════════════════════

var CONTRACT_FILTER_DEFAULT = function () { return Object.assign({ preset: 'month', basis: 'function', dept: '', venue: '', sales: '', priority: '', source: '', leadType: '' }, presetRange('month', 'function')) }

function ContractLevel() {
  var [fSel, setF] = useState(CONTRACT_FILTER_DEFAULT)
  var [rows, setRows] = useState([])
  var [leads, setLeads] = useState([])
  var [loading, setLoading] = useState(true)
  // after the first load, a filter change keeps the old charts on screen
  // (dimmed) instead of swapping them for 'Loading…' -- that shrank the page
  // and threw a scrolled-down user back to the top
  var [ready, setReady] = useState(false)
  var [error, setError] = useState('')

  // the dates the charts' data was loaded for. While a new date range
  // loads, the old data is still on screen -- count it with its OWN dates,
  // not the new ones, or it flashes a wrong in-between number first
  var [shownRange, setShownRange] = useState(null)
  var f = loading && shownRange ? Object.assign({}, fSel, shownRange) : fSel

  useEffect(function () {
    var cancelled = false
    setLoading(true); setError('')
    var range = { from: fSel.from, to: fSel.to, basis: fSel.basis }
    var from = prevRange(fSel.from, fSel.to).from
    Promise.all([
      loadLmsNames().then(function () { return fetchAll(function () { return supabase.rpc('fn_analytics_contracts', { p_from: from, p_to: fSel.to, p_basis: fSel.basis }) }) }),
      loadLmsNames().then(function () { return fetchAll(function () {
        return supabase.from('lms_leads').select('department, venue_name, assigned_lms_id, assigned_name, entry_by_lms_id, entry_by_name, priority, enquiry_mode, lead_type, cancelled, closed, contract_no, entry_date')
          .gte('entry_date', from).lte('entry_date', fSel.to).eq('cancelled', false)
      }) }).catch(function () { return [] }),
    ]).then(function (res) {
      if (!cancelled) { setRows(nameContracts(res[0])); setLeads(res[1].filter(function (r) { return !(r.closed && !r.contract_no) })); setLoading(false); setReady(true); setShownRange(range) }
    }).catch(function (e) {
      if (!cancelled) { setError(e.message || 'Could not load contracts'); setLoading(false) }
    })
    return function () { cancelled = true }
  }, [fSel.from, fSel.to, fSel.basis])

  var opts = useMemo(function () {
    return {
      venue: uniq(rows, function (r) { return r.venue_name }),
      sales: uniq(rows, function (r) { return r.salesperson || 'Unassigned' }),
      priority: uniq(rows, function (r) { return r.priority }),
      source: uniq(rows, function (r) { return r.enquiry_mode }),
    }
  }, [rows])

  function match(r, salesFn, typeKey) {
    if (f.dept && r.department !== f.dept) return false
    if (f.venue && r.venue_name !== f.venue) return false
    if (f.sales && salesFn(r) !== f.sales) return false
    if (f.priority && r.priority !== f.priority) return false
    if (f.source && r.enquiry_mode !== f.source) return false
    if (f.leadType && r[typeKey] !== f.leadType) return false
    return true
  }
  var salesOfC = function (x) { return x.salesperson || 'Unassigned' }
  var pr = prevRange(f.from, f.to)
  var cDate = function (r) { return f.basis === 'function' ? r.first_function_date : r.contract_date }
  var list = rows.filter(function (r) { return match(r, salesOfC, 'contract_type') && inRange(cDate(r), f.from, f.to) })
  var listPrev = rows.filter(function (r) { return match(r, salesOfC, 'contract_type') && inRange(cDate(r), pr.from, pr.to) })
  var leadList = leads.filter(function (r) { return match(r, salespersonOf, 'lead_type') && inRange(r.entry_date, f.from, f.to) })
  var leadPrev = leads.filter(function (r) { return match(r, salespersonOf, 'lead_type') && inRange(r.entry_date, pr.from, pr.to) })
  var prevN = listPrev.length, prevPkg = sum(listPrev, 'package_paise')

  var n = list.length
  var pkg = sum(list, 'package_paise')
  var fns = sum(list, 'function_count')
  var leadCount = leadList.length

  var buckets = bucketsFor(f.from, f.to)
  var cntB = [], valB = []
  list.forEach(function (r) {
    var i = bucketOf(buckets.list, f.basis === 'function' ? r.first_function_date : r.contract_date)
    if (i < 0) return
    cntB[i] = (cntB[i] || 0) + 1
    valB[i] = (valB[i] || 0) + Number(r.package_paise || 0)
  })

  // deal size distribution
  var BINS = [[0, 1e5, '< ₹1L'], [1e5, 2.5e5, '₹1–2.5L'], [2.5e5, 5e5, '₹2.5–5L'], [5e5, 10e5, '₹5–10L'], [10e5, 25e5, '₹10–25L'], [25e5, Infinity, '₹25L+']]
  var binCounts = BINS.map(function (b) { return count(list, function (r) { var v = Number(r.package_paise || 0) / 100; return v >= b[0] && v < b[1] }) })

  function perGroup(fn) {
    return groupBy(list, fn).map(function (g) {
      var p = sum(g.rows, 'package_paise')
      return { label: g.label, rows: g.rows, a: g.rows.length, v: p, note: g.rows.length + ' contracts · avg ' + money(p / g.rows.length) }
    }).sort(function (x, y) { return y.v - x.v })
  }
  var byDept = DEPTS.filter(function (d) { return !f.dept || d === f.dept }).map(function (d) {
    var rs = list.filter(function (r) { return r.department === d })
    var p = sum(rs, 'package_paise')
    return { label: d, rows: rs, a: rs.length, v: p, avg: rs.length ? p / rs.length : 0, leads: leadList.filter(function (r) { return r.department === d }).length, note: rs.length + ' contracts' }
  })
  var valueSeries = [{ key: 'v', name: 'Package value', color: S[0] }]
  var countSeries = [{ key: 'a', name: 'Contracts', color: S[0] }]

  function deptRow(g) {
    return [g.label, num(g.a), money(g.v), g.a ? money(g.v / g.a) : '—', num(g.leads), g.leads ? pct(g.a, g.leads) + '%' : '—']
  }

  return (
    <div className="space-y-4">
      <FilterPanel f={fSel} setF={setF} onReset={function () { setF(CONTRACT_FILTER_DEFAULT()) }}
        bases={[{ value: 'function', label: 'Function date' }, { value: 'contract', label: 'Contract date' }]}
        dims={[
          { key: 'venue', label: 'Venue', options: opts.venue, allLabel: 'All venues' },
          { key: 'sales', label: 'Salesperson', options: opts.sales, allLabel: 'Everyone' },
          { key: 'source', label: 'Source', options: opts.source, allLabel: 'All sources' },
          { key: 'priority', label: 'Priority', options: opts.priority },
          { key: 'leadType', label: 'Contract type', options: [{ value: 'I', label: 'In-house' }, { value: 'O', label: 'Outdoor' }] },
        ]} />

      {error ? <p className="text-[13px] text-red-600">{error}</p> : loading && !ready ? (
        <p className="py-16 text-center text-[13px] text-slate-400">Loading contracts…</p>
      ) : (
        <div className="space-y-4" aria-busy={loading}
          key={shownRange ? shownRange.from + shownRange.to + shownRange.basis : 'first'}
          style={loading ? { visibility: 'hidden' } : null}>
          {loading && <UpdatingPill />}
          <SectionTitle icon="chart" title="Overview" sub="This period, and the change against the previous period of the same length" />
          <div style={tilesGrid}>
            <Tile icon="fileText" label="Contracts" value={num(n)} sub={num(fns) + ' functions'} accent={S[0]} delta={{ cur: n, prev: prevN }} spark={cntB} />
            <Tile icon="rupee" label="Package value" value={money(pkg)} sub="LMS total package" accent={S[5]} delta={{ cur: pkg, prev: prevPkg }} spark={valB} />
            <Tile icon="chart" label="Average deal" value={n ? money(pkg / n) : '—'} accent={S[0]} delta={{ cur: n ? pkg / n : 0, prev: prevN ? prevPkg / prevN : null }} />
            <Tile icon="users" label="Leads received" value={num(leadCount)} sub="in the same period" accent={S[3]} delta={{ cur: leadCount, prev: leadPrev.length }} />
            <Tile icon="percent" label="Lead → contract" value={leadCount ? pct(n, leadCount) + '%' : '—'} sub={num(n) + ' ÷ ' + num(leadCount)} accent={S[1]} delta={{ cur: pct(n, leadCount), prev: pct(prevN, leadPrev.length), kind: 'pts' }} />
          </div>

          <div className={G3}>
            <Card className={W2} title={'Package value, ' + (buckets.unit === 'day' ? 'daily' : buckets.unit === 'week' ? 'weekly' : 'monthly')} sub={'By ' + (f.basis === 'function' ? 'function date' : 'contract date')}>
              <LineChart area buckets={buckets.list} series={[{ name: 'Package value', color: S[0], values: valB }]} fmt={money} />
            </Card>
            <Card title="Revenue share" sub="Department split of package value">
              <Donut parts={byDept.map(function (g) { return { name: g.label, value: g.v, color: DEPT_COLOR[g.label] } })} centerLabel="package" fmt={money} />
            </Card>
            <Card title={'Contracts, ' + (buckets.unit === 'day' ? 'daily' : buckets.unit === 'week' ? 'weekly' : 'monthly')} sub={'By ' + (f.basis === 'function' ? 'function date' : 'contract date')}>
              <LineChart area buckets={buckets.list} series={[{ name: 'Contracts', color: S[1], values: cntB }]} height={180} />
            </Card>
            <Card title="Deal size" sub="How many contracts fall in each package range">
              <Columns buckets={BINS.map(function (b) { return { from: b[2], label: b[2] } })} series={[{ name: 'Contracts', color: S[0], values: binCounts }]} height={180} />
            </Card>
            <Card title="Average deal by department" sub="Package value ÷ contracts">
              <HBars items={byDept.filter(function (g) { return g.a > 0 }).slice().sort(function (x, y) { return y.avg - x.avg })} series={[{ key: 'avg', name: 'Average deal', color: S[0] }]} fmt={money} />
            </Card>
          </div>

          <SectionTitle icon="users" title="Team & sources" sub="Who signs the business, and where it comes from" />
          <div className={G3}>
            <SalesByDept list={list} kind="revenue" />
            <SalesByDept list={list} kind="count" />
            <Card title="Lead → contract by department" sub="Contracts in this period ÷ leads received in it (can pass 100%: contracts also come from older leads)">
              <Meters items={byDept.map(function (g) { return { label: g.label, part: g.a, whole: g.leads, color: DEPT_COLOR[g.label] } })} />
            </Card>

            <Card title="Revenue by venue"><HBars items={perGroup(function (r) { return r.venue_name })} series={valueSeries} fmt={money} limit={8} /></Card>
            <Card title="Source" sub="Enquiry mode, by package value"><HBars items={perGroup(function (r) { return r.enquiry_mode })} series={valueSeries} fmt={money} limit={8} /></Card>
            <Card title="Function type" sub="Contracts per function"><HBars items={perGroup(firstFunction).sort(function (x, y) { return y.a - x.a })} series={countSeries} limit={8} /></Card>
          </div>

          <DataIssues list={list} />

          <Card title="By department" sub="Full figures">
            <Table head={['Department', 'Contracts', 'Package value', 'Avg deal', 'Leads', 'Lead → contract']}
              rows={byDept.map(deptRow)}
              foot={f.dept ? null : deptRow({ label: 'Total', a: n, v: pkg, leads: leadCount })} />
          </Card>

          <Card title="Top contracts" sub={'By package value' + (n > 50 ? ' · top 50 of ' + num(n) : '')}>
            <Table maxHeight={480} left={[0, 1, 2, 3, 5]} head={['Contract', 'Department', 'Client', 'Contract date', 'Functions', 'Salesperson', 'Package']}
              rows={list.slice().sort(function (a, b) { return Number(b.package_paise || 0) - Number(a.package_paise || 0) }).slice(0, 50).map(function (r) {
                return ['#' + r.contract_no, r.department, r.client_name || '—', r.contract_date ? formatDate(r.contract_date) : '—', num(r.function_count), r.salesperson || '—', money(r.package_paise)]
              })} />
          </Card>
        </div>
      )}
    </div>
  )
}

// Venue contracts whose amounts look keyed in wrong (flagged by
// fn_analytics_contracts.data_issues): a per-plate rate typed into the menu
// value, a per-pax rate in the venue rental, or neither amount at all. Shown
// with who entered it so it can be corrected in LMS.
function DataIssues({ list }) {
  var bad = list.filter(function (r) { return r.data_issues })
  if (!bad.length) return null
  var bySales = groupBy(bad, function (r) { return r.salesperson || 'Unassigned' })
    .map(function (g) { return { label: g.label, a: g.rows.length } }).sort(function (x, y) { return y.a - x.a })
  return (
    <div className="space-y-4">
      <SectionTitle icon="alert" title="Entries to check"
        sub="Venue contracts whose amounts look entered wrong in LMS. A menu value under ₹10,000 on a much bigger contract is counted as a per-plate rate × pax; fix these in LMS so every report agrees."
        right={(
          <span className="inline-flex items-baseline gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-50 border border-red-200 text-[12.5px] font-semibold text-red-800">
            <span className="font-display text-[20px] font-extrabold tabular-nums">{num(bad.length)}</span> to check
          </span>
        )} />
      <div className={G3}>
        <Card title="By salesperson" sub="Who entered them">
          <HBars items={bySales} series={[{ key: 'a', name: 'Entries', color: S[4] }]} />
        </Card>
        <Card className={W2} title="Contracts" sub="Correct these in LMS">
          <Table maxHeight={360} left={[0, 1, 2, 3, 4]}
            head={['Contract', 'Client', 'Salesperson', 'Function', 'What was entered, and how it was counted', 'Package']}
            rows={bad.slice().sort(function (a, b) { return String(a.salesperson || '').localeCompare(String(b.salesperson || '')) }).map(function (r) {
              return ['#' + r.contract_no, r.client_name || '—', r.salesperson || '—', r.first_function_date ? formatDate(r.first_function_date) : '—',
                <div className="space-y-1.5 whitespace-normal min-w-[320px] max-w-[560px]">
                  {String(r.data_issues).split(' || ').map(function (t, i) {
                    var cut = t.indexOf(': ')
                    return (
                      <div key={i} className="flex items-start gap-1.5 text-[12.5px] leading-snug">
                        <Icon name="alert" size={13} className="shrink-0 mt-0.5 text-red-600" />
                        <span className="text-slate-700">
                          {cut > 0 && <span className="font-bold text-slate-900">{t.slice(0, cut)}: </span>}
                          {(cut > 0 ? t.slice(cut + 2) : t).replace(/Rs /g, '₹')}
                        </span>
                      </div>
                    )
                  })}
                </div>,
                money(r.package_paise)]
            })} />
        </Card>
      </div>
    </div>
  )
}

// Salesperson revenue: Venue contracts by venue revenue (the rental, or on a
// "Venue + Menu" package the menu value less the kitchen's share -- see
// migration 00211), summed over the contract's functions; every other
// department by its package value. A department switch narrows it to a team.
function salesRevenue(r) {
  if (r.department !== 'Venue') return Number(r.package_paise || 0)
  return Number(r.venue_revenue_paise != null ? r.venue_revenue_paise : (r.venue_rental_paise || 0))
}
function SalesByDept({ list, kind }) {
  var [dept, setDept] = useState('')
  var rows = dept ? list.filter(function (r) { return r.department === dept }) : list
  var items = groupBy(rows, function (r) { return r.salesperson || 'Unassigned' }).map(function (g) {
    var rev = g.rows.reduce(function (s2, r) { return s2 + salesRevenue(r) }, 0)
    var depts = uniq(g.rows, function (r) { return r.department })
    return { label: g.label, a: g.rows.length, v: rev, note: (kind === 'revenue' ? g.rows.length + ' contracts' : money(rev)) + ' · ' + depts.join(', ') }
  }).sort(function (x, y) { return kind === 'revenue' ? y.v - x.v : y.a - x.a || y.v - x.v })
  var present = DEPTS.filter(function (d) { return list.some(function (r) { return r.department === d }) })
  var tabs = [{ value: '', label: 'All' }].concat(present.map(function (d) { return { value: d, label: d } }))
  var sub = kind === 'revenue'
    ? (dept === 'Venue' ? 'Venue rental, or menu value less the kitchen share on Venue + Menu' : dept ? 'Package value signed' : 'Venue: venue revenue · other departments: package value')
    : 'Contracts signed'
  return (
    <Card title={kind === 'revenue' ? 'Revenue by salesperson' : 'Contracts by salesperson'} sub={sub}>
      {tabs.length > 2 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tabs.map(function (t) {
            var on = t.value === dept
            return (
              <button key={t.value || 'all'} type="button" aria-pressed={on} onClick={function () { setDept(t.value) }}
                className={'h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full text-[11.5px] font-bold border transition-colors ' +
                  (on ? 'bg-[#0f1f45] border-[#0f1f45] text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300')}>
                {t.value && <span className="w-1.5 h-1.5 rounded-full" style={{ background: DEPT_COLOR[t.value] }} />}
                {t.label}
              </button>
            )
          })}
        </div>
      )}
      <HBars items={items} series={kind === 'revenue' ? [{ key: 'v', name: 'Revenue', color: S[0] }] : [{ key: 'a', name: 'Contracts', color: S[0] }]} fmt={kind === 'revenue' ? money : null} limit={8} />
    </Card>
  )
}

// ═════════════════════ Page ═════════════════════

// Load-in motion: bars grow out to their value, columns rise, lines draw left
// to right, the donut turns in, cards ease up. A filter change after that
// slides the bars from their old value to the new one (width/height
// transition). Nothing moves for people who ask the system for less motion.
var MOTION_CSS = [
  '@keyframes anGrowW { from { width: 0 } }',
  '@keyframes anGrowH { from { height: 0 } }',
  '@keyframes anReveal { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }',
  '@keyframes anSpin { from { opacity: 0; transform: rotate(-90deg) scale(.85) } to { opacity: 1; transform: none } }',
  '@keyframes anRise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }',
  '@keyframes anDrop { from { opacity: 0; transform: translateY(-10px) } to { opacity: 1; transform: none } }',
  '.an-drop { animation: anDrop .25s ease-out both }',
  '.an-w { animation: anGrowW .9s cubic-bezier(.2,.8,.2,1) both; transition: width .5s cubic-bezier(.2,.8,.2,1) }',
  '.an-h { animation: anGrowH .9s cubic-bezier(.2,.8,.2,1) both; transition: height .5s cubic-bezier(.2,.8,.2,1) }',
  '.an-reveal { animation: anReveal 1.1s cubic-bezier(.3,.7,.2,1) both }',
  '.an-spin { animation: anSpin .8s cubic-bezier(.2,.8,.2,1) both; transform-origin: 50% 50% }',
  '.an-rise { animation: anRise .45s ease-out both }',
  '.an-wait, .an-wait .an-w, .an-wait .an-h, .an-wait .an-reveal, .an-wait .an-spin { animation-play-state: paused }',
  '@media (prefers-reduced-motion: reduce) { .an-w, .an-h, .an-reveal, .an-spin, .an-rise, .an-drop { animation: none !important; transition: none !important } }',
].join('\n')

function Analytics({ initialTab }) {
  var [tab, setTab] = useState(initialTab === 'contracts' ? 'contracts' : 'leads')
  return (
    <div className="space-y-4">
      <style>{MOTION_CSS}</style>
      <div className="inline-flex p-1 rounded-full bg-white border border-slate-200 shadow-sm" role="tablist">
        {[['leads', 'Lead level', 'users'], ['contracts', 'Contract level', 'fileText']].map(function (t) {
          var on = tab === t[0]
          return (
            <button key={t[0]} type="button" role="tab" aria-selected={on} onClick={function () { setTab(t[0]) }}
              className={'h-10 px-6 inline-flex items-center gap-2 rounded-full text-[14px] font-bold transition-colors ' + (on ? 'bg-[#0f1f45] text-white shadow' : 'text-slate-600 hover:text-slate-900')}>
              <Icon name={t[2]} size={15} />{t[1]}
            </button>
          )
        })}
      </div>
      {tab === 'leads' ? <LeadLevel /> : <ContractLevel />}
    </div>
  )
}

export default Analytics
