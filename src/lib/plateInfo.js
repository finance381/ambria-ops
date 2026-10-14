import { supabase } from './supabase'

// Mirrors ExtraPlateCollect.jsx's own per-event KPI math (its "Manage" tab
// summary tiles — Quota/Issued/Returned/Used/Extras) — summed here across
// every event tied to a requisition (event_ids), for a single aggregate
// figure for the whole period rather than one row per contract.
//
// Confirmed wrong before this fix: "extra" was being set to the full
// issued count instead of only the part beyond the quota, and "actual" was
// booking+charged instead of issued-returned — so an event where 325 plates
// were issued against a 325 quota and 34 came back unused (extras=0,
// used=291) was showing Extra=325 and Actual=325, both equal to the
// booking, with the 34 returned plates folded into a meaningless "balance"
// (issued-charged-returned) instead of being shown as what was returned.
export async function computePlateSummary(eventIds) {
  if (!eventIds || eventIds.length === 0) return null

  var evRes = await supabase.from('events_safe').select('id, total_plates').in('id', eventIds)
  var events = evRes.data || []
  if (events.length === 0) return null

  var res = await Promise.all([
    supabase.from('extra_plate_issues').select('event_id, plates_count, status').in('event_id', eventIds),
    supabase.from('extra_plate_collections').select('event_id, plates_returned, status').in('event_id', eventIds),
  ])
  var issues = res[0].data || []
  var colls = res[1].data || []

  var booking = 0, extra = 0, balance = 0, actual = 0
  events.forEach(function (e) {
    var quota = e.total_plates || 0
    var issued = issues.filter(function (i) { return i.event_id === e.id && i.status === 'active' })
      .reduce(function (s, i) { return s + Number(i.plates_count || 0) }, 0)
    var returned = colls.filter(function (c) { return c.event_id === e.id && (!c.status || c.status === 'active') })
      .reduce(function (s, c) { return s + Number(c.plates_returned || 0) }, 0)
    var consumed = Math.max(0, issued - returned)
    booking += quota
    balance += returned
    actual += consumed
    extra += Math.max(0, consumed - quota)
  })

  return { booking: booking, extra: extra, balance: balance, actual: actual }
}
