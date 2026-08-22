import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'

var DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

var VENUE_COLORS = {
  'Ambria Pushpanjali': '#6B21A8',
  'Ambria Manaktala':   '#16A34A',
  'Ambria Exotica':     '#EA580C',
  'Ambria Restro':      '#DC2626',
  'Villa':              '#374151',
  'Ambria Design & Decor': '#CA8A04',
  'Ambria Cuisine':     '#0D9488',
  'Ambria Events':      '#DB2777',
  'Tender':             '#115E59',
  'Wedding Services':   '#3B82F6',
  'Outdoor Decor':      '#CA8A04',
  'Outdoor Catering':   '#0D9488',
  'Outdoor Venue':      '#374151',
  'Outdoor Entertainment': '#DB2777',
}
var DEFAULT_DOT_COLOR = '#6366F1'

function EventDatePicker({ value, onChange, label, collapsible, includePast, triggerStyle }) {
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

  useEffect(function () { fetchEventDates() }, [viewYear, viewMonth])
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
          className={"w-full flex items-center justify-between px-3 py-2 border rounded-lg text-sm " + (value ? "border-indigo-300 bg-indigo-50 text-gray-900 font-medium" : "border-gray-200 text-gray-400")}>
          <span>{value ? new Date(value + 'T00:00:00').getDate() + ' ' + shortMonths[new Date(value + 'T00:00:00').getMonth()] + ' ' + new Date(value + 'T00:00:00').getFullYear() : 'Select date'}</span>
          <span className="text-[10px] text-gray-400">{open ? '▲' : '▼'}</span>
        </button>
      )}
      {open && (function () {
      var panel = (
        <div ref={panelRef}
          className={"bg-white border border-gray-200 rounded-lg p-3" + (collapsible ? " shadow-xl" : "")}
          style={collapsible ? {
            position: 'fixed', zIndex: 9999, width: pos ? pos.width : 300,
            top: pos ? pos.top : -9999, left: pos ? pos.left : -9999,
            visibility: pos ? 'visible' : 'hidden',
            maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          } : undefined}>
        {/* Month nav */}
        <div className="flex items-center justify-between mb-3">
          <button type="button" onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors">‹</button>
          <span className="text-sm font-semibold text-gray-800">{monthNames[viewMonth] + ' ' + viewYear}</span>
          <button type="button" onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors">›</button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_NAMES.map(function (dn) {
            return <div key={dn} className="text-center text-[10px] font-bold text-gray-400 uppercase py-1">{dn}</div>
          })}
        </div>

        {/* Date cells */}
        <div className="grid grid-cols-7">
          {cells.map(function (cell, idx) {
            if (!cell.current) {
              return <div key={'e' + idx} className="text-center py-1.5"><span className="text-xs text-gray-300">{cell.day}</span></div>
            }

            var isSelected = value === cell.dateStr
            var isToday = cell.dateStr === todayStr
            var venues = eventDates[cell.dateStr] || []
            var hasEvent = venues.length > 0

            var baseClass = "relative mx-auto w-9 h-9 flex flex-col items-center justify-center rounded-full text-xs font-medium cursor-pointer transition-colors "

            var colorClass
            if (isSelected) {
              colorClass = "bg-indigo-600 text-white"
            } else if (hasEvent) {
              colorClass = "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold"
            } else if (isToday) {
              colorClass = "bg-gray-100 text-gray-900 font-semibold"
            } else {
              colorClass = "text-gray-600 hover:bg-gray-50"
            }

            if (isToday && !isSelected) {
              baseClass += "ring-2 ring-indigo-400 "
            }

            return (
              <div key={cell.dateStr} className="text-center py-0.5">
                <button type="button" onClick={function () { selectDate(cell.dateStr) }}
                  className={baseClass + colorClass}>
                  {cell.day}
                  {hasEvent && (
                    <span className="absolute bottom-0 flex gap-px justify-center">
                      {venues.slice(0, 3).map(function (v, vi) {
                        return <span key={vi} className="w-1.5 h-1.5 rounded-full" style={{ background: isSelected ? '#fff' : (VENUE_COLORS[v] || DEFAULT_DOT_COLOR) }} />
                      })}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Legend + clear */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#6B21A8' }} /><span className="text-[10px] text-gray-400">AP</span>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#16A34A' }} /><span className="text-[10px] text-gray-400">AM</span>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#EA580C' }} /><span className="text-[10px] text-gray-400">AE</span>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#DC2626' }} /><span className="text-[10px] text-gray-400">AR</span>
            {loading && <span className="text-[10px] text-gray-300 ml-1">...</span>}
          </div>
          {value && (
            <button type="button" onClick={function () { onChange('') }}
              className="text-[11px] text-red-500 font-medium hover:text-red-700 transition-colors">Clear</button>
          )}
        </div>
        </div>
      )
      return collapsible ? createPortal(panel, document.body) : panel
      })()}
    </div>
  )
}

export default EventDatePicker