import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { StatusBadge, Badge } from '../../components/ui/Badge'
import { formatDate } from '../../lib/format'

function Calendar() {
  var [events, setEvents] = useState([])
  var [loading, setLoading] = useState(true)
  var [currentDate, setCurrentDate] = useState(new Date())
  var [selectedDate, setSelectedDate] = useState(null)

  useEffect(function () {
    loadEvents()
  }, [])

  async function loadEvents() {
    var { data } = await supabase
      .from('events')
      .select('*, event_items(id, qty, item_id, department, inventory_items(name))')
      .order('event_date')
    setEvents(data || [])
    setLoading(false)
  }

  var year = currentDate.getFullYear()
  var month = currentDate.getMonth()
  var monthName = currentDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' })

  var firstDay = new Date(year, month, 1).getDay()
  var daysInMonth = new Date(year, month + 1, 0).getDate()
  var today = new Date()

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1))
    setSelectedDate(null)
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1))
    setSelectedDate(null)
  }

  function goToday() {
    setCurrentDate(new Date())
    setSelectedDate(null)
  }

  function getEventsForDate(day) {
    var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0')
    return events.filter(function (e) { return e.event_date === dateStr })
  }

  function getSelectedEvents() {
    if (!selectedDate) return []
    return getEventsForDate(selectedDate)
  }

  function detectConflicts(dayEvents) {
    var itemMap = {}
    dayEvents.forEach(function (event) {
      ;(event.event_items || []).forEach(function (ei) {
        if (!itemMap[ei.item_id]) itemMap[ei.item_id] = []
        itemMap[ei.item_id].push({ event: event.name, qty: ei.qty, itemName: ei.inventory_items?.name })
      })
    })
    var conflicts = []
    Object.keys(itemMap).forEach(function (itemId) {
      if (itemMap[itemId].length > 1) {
        conflicts.push(itemMap[itemId])
      }
    })
    return conflicts
  }

  // Build calendar grid
  var cells = []
  for (var i = 0; i < firstDay; i++) {
    cells.push(null)
  }
  for (var d = 1; d <= daysInMonth; d++) {
    cells.push(d)
  }

  var selectedEvents = getSelectedEvents()
  var selectedConflicts = selectedDate ? detectConflicts(selectedEvents) : []

  // Upcoming events (next 30 days)
  var todayStr = today.toISOString().split('T')[0]
  var thirtyDays = new Date(today)
  thirtyDays.setDate(thirtyDays.getDate() + 30)
  var thirtyStr = thirtyDays.toISOString().split('T')[0]
  var upcoming = events.filter(function (e) {
    return e.event_date >= todayStr && e.event_date <= thirtyStr
  })

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading calendar...</p>
  }

  return (
    <div className="space-y-4">
      {/* Month nav */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="px-3 py-1 text-sm bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">←</button>
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-800">{monthName}</h3>
          <button onClick={goToday} className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200 transition-colors">Today</button>
        </div>
        <button onClick={nextMonth} className="px-3 py-1 text-sm bg-gray-100 rounded-md hover:bg-gray-200 transition-colors">→</button>
      </div>

      <div className="flex gap-4 flex-col lg:flex-row">
        {/* Calendar grid */}
        <div className="flex-1">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (day) {
                return (
                  <div key={day} className="px-1 py-2 text-center text-xs font-medium text-gray-500">
                    {day}
                  </div>
                )
              })}
            </div>

            {/* Date cells */}
            <div className="grid grid-cols-7">
              {cells.map(function (day, idx) {
                if (!day) {
                  return <div key={'empty-' + idx} className="h-20 border-b border-r border-gray-100" />
                }

                var dayEvents = getEventsForDate(day)
                var isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
                var isSelected = day === selectedDate

                return (
                  <div
                    key={day}
                    onClick={function () { setSelectedDate(day) }}
                    className={
                      "h-20 p-1 border-b border-r border-gray-100 cursor-pointer transition-colors " +
                      (isSelected ? "bg-indigo-50" : "hover:bg-gray-50")
                    }
                  >
                    <span className={
                      "inline-block w-6 h-6 text-center text-xs leading-6 rounded-full " +
                      (isToday ? "bg-indigo-600 text-white font-bold" : "text-gray-700")
                    }>
                      {day}
                    </span>
                    <div className="mt-0.5 space-y-0.5">
                      {dayEvents.slice(0, 2).map(function (ev) {
                        return (
                          <div
                            key={ev.id}
                            className={
                              "text-xs truncate rounded px-1 py-0.5 " +
                              (ev.status === 'Confirmed' ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")
                            }
                          >
                            {ev.name}
                          </div>
                        )
                      })}
                      {dayEvents.length > 2 && (
                        <div className="text-xs text-gray-400 px-1">+{dayEvents.length - 2} more</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="lg:w-80">
          {selectedDate ? (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-800 mb-3">
                {new Date(year, month, selectedDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h4>

              {/* Conflict warnings */}
              {selectedConflicts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                  <p className="text-sm font-medium text-red-700">⚠️ Item Conflicts</p>
                  {selectedConflicts.map(function (conflict, i) {
                    return (
                      <div key={i} className="text-xs text-red-600 mt-1">
                        <span className="font-medium">{conflict[0].itemName}</span> blocked by:
                        {conflict.map(function (c, j) {
                          return <span key={j}> {c.event} ({c.qty}){j < conflict.length - 1 ? ',' : ''}</span>
                        })}
                      </div>
                    )
                  })}
                </div>
              )}

              {selectedEvents.length === 0 && (
                <p className="text-sm text-gray-400">No events on this date</p>
              )}

              {selectedEvents.map(function (event) {
                var depts = {}
                ;(event.event_items || []).forEach(function (ei) { depts[ei.department] = true })
                return (
                  <div key={event.id} className="mb-3 bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-800 text-sm">{event.name}</span>
                      <StatusBadge status={event.status} />
                    </div>
                    <p className="text-xs text-gray-500">{event.client} • 📦 {(event.event_items || []).length} items</p>
                    <div className="flex gap-1 flex-wrap mt-2">
                      {Object.keys(depts).map(function (dept) {
                        return <Badge key={dept} color="gray">{dept}</Badge>
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-800 mb-3">Upcoming Events</h4>
              {upcoming.length === 0 && (
                <p className="text-sm text-gray-400">No events in next 30 days</p>
              )}
              {upcoming.map(function (event) {
                return (
                  <div key={event.id} className="mb-2 flex items-center justify-between py-2 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{event.name}</p>
                      <p className="text-xs text-gray-500">{formatDate(event.event_date)}</p>
                    </div>
                    <StatusBadge status={event.status} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Calendar