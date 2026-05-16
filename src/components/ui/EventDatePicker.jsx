import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

var DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function EventDatePicker({ value, onChange, label, collapsible }) {
  var today = new Date()
  var initDate = value ? new Date(value + 'T00:00:00') : today
  var [viewYear, setViewYear] = useState(initDate.getFullYear())
  var [viewMonth, setViewMonth] = useState(initDate.getMonth())
  var [open, setOpen] = useState(!collapsible)
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

    var { data } = await supabase.from('events_safe')
      .select('function_date')
      .not('function_date', 'is', null)
      .gte('function_date', startStr)
      .lte('function_date', endStr)

    var map = {}
    ;(data || []).forEach(function (row) {
      var d = row.function_date?.slice(0, 10)
      if (d) map[d] = (map[d] || 0) + 1
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
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      {collapsible && (
        <button type="button" onClick={function () { setOpen(!open) }}
          className={"w-full flex items-center justify-between px-3 py-2 border rounded-lg text-sm " + (value ? "border-indigo-300 bg-indigo-50 text-gray-900 font-medium" : "border-gray-200 text-gray-400")}>
          <span>{value ? new Date(value + 'T00:00:00').getDate() + ' ' + shortMonths[new Date(value + 'T00:00:00').getMonth()] + ' ' + new Date(value + 'T00:00:00').getFullYear() : 'Select date'}</span>
          <span className="text-[10px] text-gray-400">{open ? '▲' : '▼'}</span>
        </button>
      )}
      {open && <div className={"bg-white border border-gray-200 rounded-lg p-3" + (collapsible ? " mt-2" : "")}>
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
            var eventCount = eventDates[cell.dateStr] || 0
            var hasEvent = eventCount > 0

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
                    <span className={"absolute bottom-0.5 w-1.5 h-1.5 rounded-full " + (isSelected ? "bg-white" : "bg-indigo-500")} />
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Legend + clear */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            <span className="text-[10px] text-gray-400">Has events</span>
            {loading && <span className="text-[10px] text-gray-300 ml-2">Loading...</span>}
          </div>
          {value && (
            <button type="button" onClick={function () { onChange('') }}
              className="text-[11px] text-red-500 font-medium hover:text-red-700 transition-colors">Clear</button>
          )}
        </div>
      </div>}
    </div>
  )
}

export default EventDatePicker