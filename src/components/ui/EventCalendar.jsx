import Icon from './Icon'
import { venueColor } from '../../lib/venueColors'

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
var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']
var SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// "Ambria Manaktala" is AM on every board in the building, and the initials of
// the words give that for free — including for the venues nobody wrote a code
// down for, which a hand-kept map would have left out.
function venueCode(name) {
  var words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function EventCalendar({ value, onChange, year, month, onMonthChange, byDate, loading, total, venues }) {
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

  // The legend names every venue this month has a dot for. A fixed list of
  // four explained colours that were not on the grid and stayed silent about
  // the ones that were; capping it at five brought the same fault back in a
  // smaller way, with three colours on the grid and a "+3" that named none of
  // them. It wraps instead.
  var legend = (venues || []).slice().sort()

  var picked = value ? new Date(value + 'T00:00:00') : null

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.05)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <p className="inline-flex items-center gap-2 font-display text-[15px] font-bold text-slate-900">
          <Icon name="calendar" size={16} className="text-indigo-500" />
          Event Date
        </p>
        {/* The card says what it is currently answering, so it still makes
            sense stacked on a phone where the panel that repeats it has been
            pushed below the fold. */}
        {picked && !isNaN(picked) && (
          <span data-notranslate className="ml-auto h-6 px-2 inline-flex items-center rounded-lg bg-indigo-50 text-indigo-700 text-[11.5px] font-bold">
            {picked.getDate() + ' ' + SHORT_MONTHS[picked.getMonth()]}
          </span>
        )}
        <button type="button"
          onClick={function () {
            onMonthChange(today.getFullYear(), today.getMonth())
            if (onChange) onChange(todayStr)
          }}
          className="shrink-0 h-7 px-2.5 rounded-lg text-[12.5px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors">
          Today
        </button>
      </div>

      {/* Month left, its controls together on the right. Pinned to opposite
          edges the two arrows sat a card's width apart from each other and
          from the name of the thing they move. */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <p className="font-display text-[17px] font-bold text-slate-900 tracking-[-0.01em]" data-notranslate>{MONTHS[month] + ' ' + year}</p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={function () { step(-1) }} aria-label="Previous month"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            <Icon name="chevronRight" size={15} className="rotate-180" />
          </button>
          <button type="button" onClick={function () { step(1) }} aria-label="Next month"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            <Icon name="chevronRight" size={15} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="grid grid-cols-7 mt-3 mb-1">
          {DAY_NAMES.map(function (dn) {
            return <div key={dn} className="text-center text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500 py-1.5">{dn}</div>
          })}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map(function (cell, idx) {
            if (!cell.current) {
              return (
                <div key={'e' + idx} className="aspect-square flex items-center justify-center">
                  <span className="text-[14px] font-bold text-slate-200" data-notranslate>{cell.day}</span>
                </div>
              )
            }
            var info = map[cell.dateStr]
            var hasEvent = !!info
            var isSelected = value === cell.dateStr
            var isToday = cell.dateStr === todayStr

            var tone
            if (isSelected) tone = 'bg-indigo-600 text-white shadow-[0_2px_10px_rgba(79,70,229,0.4)]'
            else if (hasEvent) tone = 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:shadow-[0_1px_6px_rgba(79,70,229,0.15)]'
            else tone = 'text-slate-600 hover:bg-slate-100'
            // Today is a ring rather than a fill, so it can sit under a
            // selection or under an event tint without either one losing.
            if (isToday && !isSelected) tone += ' ring-2 ring-indigo-400'

            var when = new Date(cell.dateStr + 'T00:00:00')
            var label = when.getDate() + ' ' + SHORT_MONTHS[when.getMonth()] + ' ' + when.getFullYear() +
              (hasEvent ? ' — ' + info.count + (info.count === 1 ? ' event' : ' events') : ' — nothing booked')

            return (
              <button key={cell.dateStr} type="button"
                onClick={function () { if (onChange) onChange(cell.dateStr) }}
                aria-pressed={isSelected} aria-label={label} title={label}
                className={'aspect-square w-full rounded-full flex flex-col items-center justify-center gap-[3px] text-[14px] font-bold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ' + tone}>
                <span data-notranslate className="leading-none">{cell.day}</span>
                {/* The dot row keeps its height whether or not there are dots,
                    so a day with events is not a pixel taller than the one
                    beside it. */}
                <span className="h-1.5 flex items-center gap-[3px]">
                  {hasEvent && info.venues.slice(0, 3).map(function (v, vi) {
                    return (
                      <span key={vi} className="w-1.5 h-1.5 rounded-full"
                        style={{ background: isSelected ? 'rgba(255,255,255,0.92)' : venueColor(v) }} />
                    )
                  })}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap">
          {legend.map(function (v) {
            return (
              <span key={v} title={v} className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-slate-600">
                <span className="w-2 h-2 rounded-full" style={{ background: venueColor(v) }} />
                {venueCode(v)}
              </span>
            )
          })}
          {legend.length === 0 && !loading && (
            <span className="text-[11px] font-semibold text-slate-400">No venues booked</span>
          )}
        </div>
        <span className="shrink-0 text-[11.5px] font-bold text-slate-500 tabular-nums" data-notranslate>
          {loading ? 'Loading…' : (total || 0) + ((total || 0) === 1 ? ' event' : ' events')}
        </span>
      </div>
    </div>
  )
}

export default EventCalendar
