import { supabase } from './supabase'

// Same per-event plate math StoreRequisitionForm.jsx already uses to show
// each linked contract's Booking/Extra/Balance/Actual — summed here across
// every event tied to a requisition (event_ids), for a single aggregate
// figure for the whole period rather than one row per contract.
export async function computePlateSummary(eventIds) {
  if (!eventIds || eventIds.length === 0) return null

  var evRes = await supabase.from('events_safe').select('id, total_plates').in('id', eventIds)
  var events = evRes.data || []
  if (events.length === 0) return null

  var res = await Promise.all([
    supabase.from('extra_plate_issues').select('event_id, plates_count, status').in('event_id', eventIds),
    supabase.from('extra_plate_collections').select('event_id, extras_charged, plates_returned, status').in('event_id', eventIds),
  ])
  var issues = res[0].data || []
  var colls = res[1].data || []

  var booking = 0, extra = 0, balance = 0, actual = 0
  events.forEach(function (e) {
    var issued = issues.filter(function (i) { return i.event_id === e.id && i.status === 'active' })
      .reduce(function (s, i) { return s + Number(i.plates_count || 0) }, 0)
    var activeColls = colls.filter(function (c) { return c.event_id === e.id && (!c.status || c.status === 'active') })
    var charged = activeColls.reduce(function (s, c) { return s + Number(c.extras_charged || 0) }, 0)
    var returned = activeColls.reduce(function (s, c) { return s + Number(c.plates_returned || 0) }, 0)
    booking += e.total_plates || 0
    extra += issued
    balance += Math.max(0, issued - charged - returned)
    actual += (e.total_plates || 0) + charged
  })

  return { booking: booking, extra: extra, balance: balance, actual: actual }
}
