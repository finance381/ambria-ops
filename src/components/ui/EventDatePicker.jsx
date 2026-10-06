import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import Icon from './Icon'
import { venueColor, VENUE_LEGEND } from '../../lib/venueColors'

var DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']


// panelScope: a class for the panel when it is portalled to <body>, so a
// screen that re-themes its own tokens (Extra Plates' dark one) can carry
// the theme into the calendar, which otherwise renders outside it.
function EventDatePicker({ value, onChange, label, collapsible, includePast, triggerStyle, plain, neutral, placeholder, panelScope }) {
  var today = new Date()
  var initDate = value ? new Date(value + 'T00:00:00') : today
  var [viewYear, setViewYear] = useState(initDate.getFullYear())
  var [viewMonth, setViewMonth] = useState(initDate.getMonth())
  var [open, setOpen] = useState(!collapsible)
  var wrapRef = useRef(null)
  var btnRef = useRef(null)
  var panelRef = useRef(null)
  // The collapsible panel is portalled to <body> and positioned in viewport
  // coords: the cards it drops over sit in their own stacking contexts (the
  // entry animation creates one), so an in-flow z-index cannot win over them.
  var [pos, setPos] = useState(null)
  useEffect(function () {
    if (!collapsible || !open) return
    function handleClick(e) {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return
      if (panelRef.current && panelRef.current.contains(e.target)) return
      setOpen(false)
    }
    function handleKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', handleClick)
    document.addEventListener('keydown', handleKey)
    return function () {
      document.removeEventListener('pointerdown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [collapsible, open])

  useLayoutEffect(function () {
    if (!collapsible || !open) { setPos(null); return }
    function place() {
      if (!btnRef.current) return
      var r = btnRef.current.getBoundingClientRect()
      var w = Math.max(300, Math.round(r.width))
      var h = panelRef.current ? panelRef.current.offsetHeight : 340
      var left = Math.round(r.right - w)
      var maxLeft = window.innerWidth - w - 8
      if (left > maxLeft) left = maxLeft
      if (left < 8) left = 8
      var top = Math.round(r.bottom + 6)
      if (top + h > window.innerHeight - 8) {
        var above = Math.round(r.top - h - 6)
        top = above >= 8 ? above : Math.max(8, window.innerHeight - h - 8)
      }
      setPos({ top: top, left: left, width: w })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return function () {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [collapsible, open, viewYear, viewMonth, value])
  var [eventDates, setEventDates] = useState({})
  var [loading, setLoading] = useState(false)

  useEffect(function () { if (!plain) fetchEventDates() }, [viewYear, viewMonth, plain])
  useEffect(function () {
    if (value) { var d = new Date(value + 'T00:00:00'); if (!isNaN(d)) { setViewYear(d.getFullYear()); setViewMonth(d.getMonth()) } }
  }, [value])

  async function fetchEventDates() {
    setLoading(true)
    var startDate = new Date(viewYear, viewMonth, 1)
    var endDate = new Date(viewYear, viewMonth + 1, 0)
    var startStr = formatISO(startDate)
    var endStr = formatISO(endDate)

    var todayISO = formatISO(today)
    var fromStr = includePast ? startStr : (startStr > todayISO ? startStr : todayISO)
    var { data } = await supabase.from('events_safe')
      .select('function_date, venue_name')
      .not('function_date', 'is', null)
      .gte('function_date', fromStr)
      .lte('function_date', endStr)

    var map = {}
    ;(data || []).forEach(function (row) {
      var d = row.function_date?.slice(0, 10)
      if (!d) return
      if (!map[d]) map[d] = []
      var v = row.venue_name || 'Other'
      if (map[d].indexOf(v) === -1) map[d].push(v)
    })
    setEventDates(map)
    setLoading(false)
  }

  function formatISO(d) {
    var y = d.getFullYear()
    var m = String(d.getMonth() + 1).padStart(2, '0')
    var day = String(d.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + day
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) }
    else { setViewMonth(viewMonth - 1) }
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
    else { setViewMonth(viewMonth + 1) }
  }

  function selectDate(dateStr) {
    if (value === dateStr) { onChange(''); if (collapsible) setOpen(false); return }
    onChange(dateStr)
    if (collapsible) setOpen(false)
  }

  // Build calendar grid
  var firstDay = new Date(viewYear, viewMonth, 1).getDay()
  var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  var prevDays = new Date(viewYear, viewMonth, 0).getDate()

  var cells = []
  // Previous month trailing days
  for (var i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: prevDays - i, current: false, dateStr: null })
  }
  // Current month
  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = formatISO(new Date(viewYear, viewMonth, d))
    cells.push({ day: d, current: true, dateStr: dateStr })
  }
  // Next month leading days
  var remaining = 7 - (cells.length % 7)
  if (remaining < 7) {
    for (var j = 1; j <= remaining; j++) {
      cells.push({ day: j, current: false, dateStr: null })
    }
  }

  var todayStr = formatISO(today)
  // How many days this month have a function, for the line under the month.
  var fnDays = Object.keys(eventDates).length
  var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  var shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return (
    <div ref={wrapRef} className={collapsible ? "relative" : ""}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      {collapsible && (
        <button type="button" ref={btnRef} onClick={function () { setOpen(!open) }}
          style={triggerStyle}
          /* Indigo marks a date that has been SET, which is what a filter
             wants: the control says a narrowing is in force. On a form
             field that is born with today in it, the same fill says the
             opposite — every other field on the form is white and this one
             looks picked. `neutral` is for those. */
          className={"w-full flex items-center justify-between gap-2 px-3 py-2.5 border rounded-xl text-[13px] transition-shadow " + ((value && !neutral) ? "border-indigo-300 bg-indigo-50 text-slate-900 font-semibold" : (value ? "border-slate-300 bg-white text-slate-900 font-semibold" : "border-slate-300 bg-white text-slate-500"))}>
          {/* placeholder, because a pair of these standing for a range needs to
              say which end each one is; on its own "Select date" is right. */}
          <span className="truncate">{value ? new Date(value + 'T00:00:00').getDate() + ' ' + shortMonths[new Date(value + 'T00:00:00').getMonth()] + ' ' + new Date(value + 'T00:00:00').getFullYear() : (placeholder || 'Select date')}</span>
          <span className={"shrink-0 " + ((value && !neutral) ? "text-indigo-500" : "text-slate-400")}><Icon name="calendar" size={14} /></span>
        </button>
      )}
      {open && (function () {
      var panel = (
        <div ref={panelRef}
          className={"bg-white border border-slate-200 rounded-2xl p-4" + (collapsible ? " shadow-[0_12px_40px_rgba(15,23,42,0.16)]" : "")}
          style={collapsible ? {
            position: 'fixed', zIndex: 9999, width: pos ? pos.width : 300,
            top: pos ? pos.top : -9999, left: pos ? pos.left : -9999,
            visibility: pos ? 'visible' : 'hidden',
            maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          } : undefined}>
        {/* Month nav: the month in the display face between two round
            buttons, and a Today shortcut once you have paged away from it. */}
        <div className="flex items-center gap-2 mb-3">
          <button type="button" onClick={prevMonth} aria-label="Previous month"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:scale-95 transition-all">
            <Icon name="chevronRight" size={16} className="rotate-180" />
          </button>
          <div className="min-w-0 flex-1 text-center leading-tight">
            <p className="font-display text-[16px] font-extrabold tracking-[-0.015em] text-slate-900">{monthNames[viewMonth] + ' ' + viewYear}</p>
            {!plain && (
              <p className="text-[11px] font-semibold text-slate-400">
                {loading ? 'Loading…' : (fnDays === 0 ? 'No functions' : fnDays + (fnDays === 1 ? ' day' : ' days') + ' with functions')}
              </p>
            )}
          </div>
          <button type="button" onClick={nextMonth} aria-label="Next month"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 active:scale-95 transition-all">
            <Icon name="chevronRight" size={16} />
          </button>
        </div>

        {/* Day headers — the weekend in a softer ink, as on a printed calendar. */}
        <div className="grid grid-cols-7 mb-1 rounded-lg bg-slate-50">
          {DAY_NAMES.map(function (dn, di) {
            return <div key={dn} className={"text-center text-[10.5px] font-extrabold uppercase tracking-[0.08em] py-1.5 " + (di === 0 || di === 6 ? "text-rose-400" : "text-slate-500")}>{dn}</div>
          })}
        </div>

        {/* Date cells. Square cells that fill the column, so the grid has no
            ragged gutters at any panel width. Days outside the month are left
            blank — greyed numbers from next month were noise. */}
        <div className="grid grid-cols-7 gap-y-0.5">
          {cells.map(function (cell, idx) {
            if (!cell.current) return <div key={'e' + idx} aria-hidden="true" />

            var isSelected = value === cell.dateStr
            var isToday = cell.dateStr === todayStr
            var isPast = cell.dateStr < todayStr
            var venues = eventDates[cell.dateStr] || []
            var hasEvent = venues.length > 0
            var weekend = (idx % 7 === 0) || (idx % 7 === 6)

            // The only filled day is the one you picked; today is a tinted
            // tile; a day with functions is its number in full weight with a
            // dot per venue under it. Past days without functions step back.
            var tone
            if (isSelected) tone = "bg-indigo-600 text-white font-extrabold shadow-[0_3px_10px_rgba(79,70,229,0.35)]"
            else if (isToday) tone = "bg-indigo-50 text-indigo-700 font-extrabold ring-1 ring-inset ring-indigo-300 hover:bg-indigo-100"
            else if (hasEvent) tone = "text-slate-900 font-bold hover:bg-slate-100"
            else if (isPast) tone = "text-slate-300 font-medium hover:bg-slate-50 hover:text-slate-500"
            else tone = (weekend ? "text-rose-400" : "text-slate-500") + " font-medium hover:bg-slate-100 hover:text-slate-900"

            return (
              <div key={cell.dateStr} className="flex justify-center">
                <button type="button" onClick={function () { selectDate(cell.dateStr) }}
                  aria-label={cell.day + ' ' + monthNames[viewMonth] + (hasEvent ? ', ' + venues.length + ' venue' + (venues.length === 1 ? '' : 's') + ' booked' : '')}
                  aria-pressed={isSelected}
                  className={"relative w-full max-w-[44px] aspect-square flex flex-col items-center justify-center gap-[3px] rounded-xl text-[14px] tabular-nums cursor-pointer transition-all active:scale-95 " + tone}>
                  <span className="leading-none">{cell.day}</span>
                  {/* The dot row keeps its height with or without dots, so
                      every number sits on the same line. */}
                  {!plain && (
                    <span className="h-[5px] flex gap-[2px] justify-center items-center">
                      {venues.slice(0, 3).map(function (v, vi) {
                        return <span key={vi} className="w-[5px] h-[5px] rounded-full" style={{ background: isSelected ? 'rgba(255,255,255,0.95)' : venueColor(v) }} />
                      })}
                      {venues.length > 3 && <span className={"text-[8px] font-extrabold leading-none " + (isSelected ? "text-white" : "text-slate-500")}>+</span>}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Legend, then Today and Clear. In plain mode there are no dots to
            explain, so the footer only carries the buttons. */}
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2.5">
          {!plain && (
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              {VENUE_LEGEND.map(function (l) {
                return (
                  <span key={l.code} title={l.name} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-slate-50 border border-slate-200">
                    <span className="w-2 h-2 rounded-full" style={{ background: venueColor(l.name) }} />
                    <span className="text-[11px] font-bold text-slate-600">{l.code}</span>
                  </span>
                )
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={function () { selectDate(todayStr) }} disabled={value === todayStr}
              className="flex-1 h-9 rounded-xl border border-slate-200 bg-white text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 inline-flex items-center justify-center gap-1.5 transition-colors">
              <Icon name="calendar" size={13} />Today
            </button>
            {value && (
              <button type="button" onClick={function () { onChange(''); if (collapsible) setOpen(false) }}
                className="flex-1 h-9 rounded-xl border border-red-200 bg-red-50/60 text-[12.5px] font-bold text-red-600 hover:bg-red-50 inline-flex items-center justify-center gap-1.5 transition-colors">
                <Icon name="close" size={12} />Clear
              </button>
            )}
          </div>
        </div>
        </div>
      )
      return collapsible ? createPortal(panelScope ? <div className={panelScope}>{panel}</div> : panel, document.body) : panel
      })()}
    </div>
  )
}

export default EventDatePicker