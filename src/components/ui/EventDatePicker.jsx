import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import Icon from './Icon'
import { venueColor, VENUE_LEGEND } from '../../lib/venueColors'

var DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']


function EventDatePicker({ value, onChange, label, collapsible, includePast, triggerStyle, plain, neutral, placeholder }) {
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
          className={"bg-white border border-slate-200 rounded-2xl p-3.5" + (collapsible ? " shadow-xl" : "")}
          style={collapsible ? {
            position: 'fixed', zIndex: 9999, width: pos ? pos.width : 300,
            top: pos ? pos.top : -9999, left: pos ? pos.left : -9999,
            visibility: pos ? 'visible' : 'hidden',
            maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          } : undefined}>
        {/* Month nav */}
        <div className="flex items-center justify-between mb-2.5">
          <button type="button" onClick={prevMonth} aria-label="Previous month"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors">
            <Icon name="chevronRight" size={16} className="rotate-180" />
          </button>
          <span className="text-[14.5px] font-bold text-slate-900">{monthNames[viewMonth] + ' ' + viewYear}</span>
          <button type="button" onClick={nextMonth} aria-label="Next month"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors">
            <Icon name="chevronRight" size={16} />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_NAMES.map(function (dn) {
            return <div key={dn} className="text-center text-[10.5px] font-semibold text-slate-500 uppercase tracking-[0.04em] py-1">{dn}</div>
          })}
        </div>

        {/* Date cells */}
        <div className="grid grid-cols-7">
          {cells.map(function (cell, idx) {
            if (!cell.current) {
              return <div key={'e' + idx} className="h-10 flex items-center justify-center"><span className="text-[12.5px] text-slate-300">{cell.day}</span></div>
            }

            var isSelected = value === cell.dateStr
            var isToday = cell.dateStr === todayStr
            var venues = eventDates[cell.dateStr] || []
            var hasEvent = venues.length > 0

            // A day with functions is its number in full weight with a dot
            // per venue under it — not a filled disc. Filled, most of a busy
            // month turned into a sheet of blue and the selected day had to
            // shout over it. Now the only filled day is the one you picked.
            var baseClass = "mx-auto w-10 h-10 flex flex-col items-center justify-center gap-[3px] rounded-xl text-[13px] cursor-pointer transition-colors "

            var colorClass
            if (isSelected) {
              colorClass = "bg-indigo-600 text-white font-bold shadow-[0_2px_8px_rgba(79,70,229,0.35)]"
            } else if (hasEvent) {
              colorClass = "text-slate-900 font-semibold hover:bg-slate-100"
            } else {
              colorClass = "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }

            if (isToday && !isSelected) {
              baseClass += "ring-1 ring-inset ring-indigo-400 text-indigo-700 font-semibold "
            }

            return (
              <div key={cell.dateStr} className="py-0.5">
                <button type="button" onClick={function () { selectDate(cell.dateStr) }}
                  className={baseClass + colorClass}>
                  <span className="leading-none">{cell.day}</span>
                  {/* The dot row keeps its height with or without dots, so a
                      day with functions sits at the same height as one without. */}
                  {!plain && (
                    <span className="h-[5px] flex gap-[2px] justify-center">
                      {venues.slice(0, 3).map(function (v, vi) {
                        return <span key={vi} className="w-[5px] h-[5px] rounded-full" style={{ background: isSelected ? 'rgba(255,255,255,0.95)' : venueColor(v) }} />
                      })}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Legend + clear. In plain mode there are no dots to explain, so the
            footer is only worth drawing when there is a date to clear. */}
        {(!plain || value) && (
        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-slate-100">
          <div className="flex items-center gap-3 flex-wrap">
            {!plain && <>
            {VENUE_LEGEND.map(function (l) {
              return (
                <span key={l.code} title={l.name} className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: venueColor(l.name) }} />
                  <span className="text-[11px] font-semibold text-slate-600">{l.code}</span>
                </span>
              )
            })}
            {loading && <span className="text-[11px] text-slate-400 ml-1">...</span>}</>}
          </div>
          {value && (
            <button type="button" onClick={function () { onChange('') }}
              className="h-7 px-2 -mr-2 rounded-lg text-[12px] font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 transition-colors">Clear</button>
          )}
        </div>
        )}
        </div>
      )
      return collapsible ? createPortal(panel, document.body) : panel
      })()}
    </div>
  )
}

export default EventDatePicker