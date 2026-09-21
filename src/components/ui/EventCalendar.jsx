import Icon from './Icon'
import { venueColor, VENUE_LEGEND } from '../../lib/venueColors'

// A month that is the screen, not a dropdown.
//
// EventDatePicker answers "which date?" for a form, so it hides inside a field
// and gets out of the way. The Event ledger opens on the calendar: it is the
// first of three steps, and the question it answers is "which days had
// anything on them?" — which only a grid you can read at a glance answers. So
// the cells are square and every day carries a dot per venue with an event.
//
// The month's rows are the parent's, not this component's. The ledger needs
// the same rows to list the month beside the grid and to answer a date without
// another round trip, and two components fetching the same month twice would
// be one read too many and two chances to disagree.
var DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']

function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function EventCalendar({ value, onChange, year, month, onMonthChange, byDate, loading, total }) {
  var today = new Date()
  var todayStr = iso(today)
  var map = byDate || {}

  function step(delta) {
    var m = month + delta
    if (m < 0) onMonthChange(year - 1, 11)
    else if (m > 11) onMonthChange(year + 1, 0)
    else onMonthChange(year, m)
  }

  var firstDay = new Date(year, month, 1).getDay()
  var daysInMonth = new Date(year, month + 1, 0).getDate()
  var prevDays = new Date(year, month, 0).getDate()
  var cells = []
  for (var i = firstDay - 1; i >= 0; i--) cells.push({ day: prevDays - i, current: false })
  for (var d = 1; d <= daysInMonth; d++) cells.push({ day: d, current: true, dateStr: iso(new Date(year, month, d)) })
  var tail = cells.length % 7
  if (tail) for (var j = 1; j <= 7 - tail; j++) cells.push({ day: j, current: false })

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <p className="inline-flex items-center gap-2 font-display text-[14px] font-bold text-slate-900">
          <Icon name="calendar" size={15} className="text-indigo-500" />
          Event Date
        </p>
        <button type="button"
          onClick={function () {
            onMonthChange(today.getFullYear(), today.getMonth())
            if (onChange) onChange(todayStr)
          }}
          className="shrink-0 h-7 px-2.5 rounded-lg text-[12px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors">
          Today
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <button type="button" onClick={function () { step(-1) }} aria-label="Previous month"
          className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
          <Icon name="chevronRight" size={16} className="rotate-180" />
        </button>
        <p className="font-display text-[15px] font-bold text-slate-900" data-notranslate>{MONTHS[month] + ' ' + year}</p>
        <button type="button" onClick={function () { step(1) }} aria-label="Next month"
          className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
          <Icon name="chevronRight" size={16} />
        </button>
      </div>

      <div className="px-3 pb-3">
        <div className="grid grid-cols-7 mt-2 mb-1">
          {DAY_NAMES.map(function (dn) {
            return <div key={dn} className="text-center text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400 py-1">{dn}</div>
          })}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map(function (cell, idx) {
            if (!cell.current) {
              return (
                <div key={'e' + idx} className="aspect-square flex items-center justify-center">
                  <span className="text-[13px] text-slate-300" data-notranslate>{cell.day}</span>
                </div>
              )
            }
            var info = map[cell.dateStr]
            var hasEvent = !!info
            var isSelected = value === cell.dateStr
            var isToday = cell.dateStr === todayStr

            var tone
            if (isSelected) tone = 'bg-indigo-600 text-white shadow-[0_2px_8px_rgba(79,70,229,0.35)]'
            else if (hasEvent) tone = 'bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100'
            else tone = 'text-slate-600 hover:bg-slate-100'
            // Today is a ring rather than a fill, so it can sit under a
            // selection or under an event tint without either one losing.
            if (isToday && !isSelected) tone += ' ring-2 ring-indigo-400 ring-offset-1 ring-offset-white'

            return (
              <button key={cell.dateStr} type="button"
                onClick={function () { if (onChange) onChange(cell.dateStr) }}
                aria-pressed={isSelected}
                title={hasEvent ? info.count + (info.count === 1 ? ' event' : ' events') : undefined}
                className={'aspect-square w-full rounded-full flex flex-col items-center justify-center gap-[3px] text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ' + tone}>
                <span data-notranslate className="leading-none">{cell.day}</span>
                {/* The dot row keeps its height whether or not there are dots,
                    so a day with events is not a pixel taller than the one
                    beside it. */}
                <span className="h-1.5 flex items-center gap-[2px]">
                  {hasEvent && info.venues.slice(0, 3).map(function (v, vi) {
                    return (
                      <span key={vi} className="w-1.5 h-1.5 rounded-full"
                        style={{ background: isSelected ? 'rgba(255,255,255,0.9)' : venueColor(v) }} />
                    )
                  })}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2.5 flex-wrap">
          {VENUE_LEGEND.map(function (l) {
            return (
              <span key={l.code} title={l.name} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                <span className="w-2 h-2 rounded-full" style={{ background: venueColor(l.name) }} />
                {l.code}
              </span>
            )
          })}
        </div>
        <span className="shrink-0 text-[11px] font-semibold text-slate-400 tabular-nums" data-notranslate>
          {loading ? 'Loading…' : (total || 0) + ((total || 0) === 1 ? ' event' : ' events')}
        </span>
      </div>
    </div>
  )
}

export default EventCalendar
