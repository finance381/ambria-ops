import { deptCls } from '../../lib/ui'
import { formatDate } from '../../lib/format'
import { VENUE_LEGEND } from '../../lib/venueColors'

// ═══ a grid of tiles, not a stack of bars ═════════════════════════
// Full-width rows spent the whole column on one function and pushed the
// amount and receipt fields a screen down. Four across, and the fifth
// starts a new row.
//
// A grid rather than a scrolling row: the count is whatever the date
// returns, and a row hides everything past the fourth tile behind a
// gesture — with six bookings you could not tell there were six.
//
// Column count is gated on the wide flag, not on lg alone. The phone shell
// is a 540px column inside whatever viewport the laptop happens to have, so
// a bare lg:grid-cols-4 fires inside it and hands the phone four 120px
// tiles.
function gridCls(wide) {
  return "grid gap-2 grid-cols-1 sm:grid-cols-2" + (wide ? " lg:grid-cols-4" : "")
}

// A booking's venue_name is normally one of the 4 main Ambria properties
// (VENUE_LEGEND) or sync-events' "Outdoor X" fallback — but a tentative
// event (fn_create_tentative_event) carries whatever name the venues master
// table has for the venue picked when it was created, which can be a
// custom one (e.g. a generic placeholder) that's in neither list. The
// venues table is the source of truth for those, each with its own `code`
// already shown everywhere else a venue is picked.
//
// "Outdoor Catering"/"Outdoor Decor"/etc aren't a real property -- they're
// the department-fallback venue name sync-events assigns when a booking has
// none, and the department chip already on the tile says as much. Spelling
// the whole word out here just ate the width the tile needs for the guest's
// actual address (location), which sits right after it on the same line --
// the code alone (when the venues master has one) carries the same
// information in a fifth of the space.
function venueLabel(venueName, venues) {
  if (!venueName) return null
  var leg = VENUE_LEGEND.find(function (l) { return venueName.indexOf(l.name) !== -1 })
  if (leg) return venueName + ' (' + leg.code + ')'
  var v = (venues || []).find(function (x) { return String(x.name || '').trim() === venueName.trim() })
  var code = v && v.code ? v.code : null
  if (/^Outdoor /.test(venueName)) return code || venueName
  return code ? venueName + ' (' + code + ')' : venueName
}

function FunctionTile(props) {
  var g = props.group
  var selected = props.selected
  var showDate = props.showDate
  var venues = props.venues
  var head = g.contracts[0]
  return (
    <button type="button" onClick={props.onClick}
      className={"text-left rounded-xl border px-2.5 py-2 transition-all duration-150 " +
        (selected
          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
          : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)]")}>
      <span className="flex items-start justify-between gap-1.5">
        <span className={"min-w-0 flex-1 block text-[11px] font-bold uppercase tracking-[0.03em] leading-snug truncate " +
          (selected ? "text-indigo-900" : "text-slate-900")}>
          {head.event_name}
        </span>
        {/* Which departments this evening is booked under — read only, and
            never wrapped: a second row of chips is what made these tall in
            the first place. */}
        <span className="shrink-0 flex flex-nowrap items-center gap-1">
          {g.contracts.map(function (c) {
            return (
              <span key={c.id}
                className={"text-[10px] font-bold uppercase tracking-[0.03em] leading-none px-1.5 py-[3px] rounded " + deptCls(c.department)}>
                {c.department}
              </span>
            )
          })}
        </span>
      </span>
      {head.client_name && (
        <span className={"block text-[11px] leading-snug truncate " + (selected ? "text-indigo-800" : "text-slate-700")}>
          {head.client_name}
        </span>
      )}
      {/* Venue and session stay. They are half of what tells two bookings on
          the same evening apart — funcKeyOf groups on them — so a tile
          without them can be a twin of the one beside it. Sub-venue
          (location) only shown when it adds information. Date only shown
          inside an opened contract, where two functions can fall on
          different days and the date is the thing that tells them apart. */}
      <span className={"block text-[10px] leading-snug truncate " + (selected ? "text-indigo-600" : "text-slate-500")}>
        {[showDate ? formatDate(head.function_date) : null,
          venueLabel(head.venue_name, venues),
          (head.location && head.location !== head.venue_name) ? head.location : null, head.session]
          .filter(Boolean).join(' · ')}
      </span>
      {head.created_user_name && (
        <span className={"block text-[10px] leading-snug truncate " + (selected ? "text-indigo-500" : "text-slate-400")}>
          By {head.created_user_name}
        </span>
      )}
    </button>
  )
}

// A contract that runs more than one function reads as one tile — the guest
// and venue once, every department it's booked under as chips, and a count
// instead of a repeated row per function. Picking it picks the whole
// contract in one tap (see pickBucket below) rather than drilling into which
// function it covers -- financially they roll up identically either way.
function ContractTile(props) {
  var bucket = props.bucket
  var selected = props.selected
  var venues = props.venues
  var deptSeen = {}
  var deptList = []
  bucket.functions.forEach(function (f) {
    f.contracts.forEach(function (c) {
      if (!deptSeen[c.department]) { deptSeen[c.department] = true; deptList.push(c.department) }
    })
  })
  return (
    <button type="button" onClick={props.onClick}
      className={"text-left rounded-xl border px-2.5 py-2 transition-all duration-150 " +
        (selected
          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
          : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)]")}>
      <span className="flex items-start justify-between gap-1.5">
        <span className={"min-w-0 flex-1 block text-[11px] font-bold uppercase tracking-[0.03em] leading-snug truncate " +
          (selected ? "text-indigo-900" : "text-slate-900")}>
          {bucket.clientName || 'Contract'}
        </span>
        <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-[0.05em] leading-none px-1.5 py-[3px] rounded bg-indigo-100 text-indigo-600">
          {bucket.functions.length} functions
        </span>
      </span>
      <span className={"block text-[10px] leading-snug truncate " + (selected ? "text-indigo-600" : "text-slate-500")}>
        {[venueLabel(bucket.venueName, venues), (bucket.location && bucket.location !== bucket.venueName) ? bucket.location : null]
          .filter(Boolean).join(' · ')}
      </span>
      <span className="shrink-0 flex flex-nowrap items-center gap-1 mt-1">
        {deptList.map(function (d) {
          return (
            <span key={d} className={"text-[10px] font-bold uppercase tracking-[0.03em] leading-none px-1.5 py-[3px] rounded " + deptCls(d)}>
              {d}
            </span>
          )
        })}
      </span>
    </button>
  )
}

// buckets: output of buildContractBuckets(allRows). eventId/onPick carry the
// single anchor every write path already expects — any one function in a
// contract rolls up to the same balance (fn_event_group_balance), so which
// one anchors it never matters financially. Picking a multi-function
// contract tile therefore picks the whole contract in one tap: the anchor is
// just its earliest function, and extraEventIds/onExtraChange tag every
// other function in it purely for traceability (e.g. a decor cost that
// touched both the Mehndi and the Reception setups) — the user never has to
// choose which functions it covers, only which contract.
function FunctionPickerGrid(props) {
  var buckets = props.buckets || []
  var eventId = props.eventId
  var onPick = props.onPick
  var extraEventIds = props.extraEventIds || []
  var onExtraChange = props.onExtraChange || function () {}
  var wide = props.wide
  var venues = props.venues

  function pickBucket(b) {
    var ids = b.functions.map(function (f) { return String(f.contracts[0].id) })
    onPick(ids[0])
    onExtraChange(ids.slice(1))
  }

  // The one way back to no selection — pressing the picked tile again, same
  // as every other toggle-style pick in this app.
  function clearPick() {
    onPick('')
    onExtraChange([])
  }

  var selectedBucket = eventId ? buckets.find(function (b) {
    return b.functions.some(function (f) { return f.contracts.some(function (c) { return String(c.id) === eventId }) })
  }) : null

  if (selectedBucket) {
    return (
      <div className="space-y-2">
        <div className={gridCls(wide)}>
          {selectedBucket.isContract
            ? <ContractTile bucket={selectedBucket} selected={true} venues={venues} onClick={clearPick} />
            : <FunctionTile group={selectedBucket.functions[0]} selected={true} venues={venues} onClick={clearPick} />}
        </div>
        {buckets.length > 1 && (
          <button type="button" onClick={clearPick}
            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 px-1">
            Change
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={gridCls(wide)}>
      {buckets.map(function (b) {
        if (b.isContract) {
          return <ContractTile key={b.key} bucket={b} venues={venues} onClick={function () { pickBucket(b) }} />
        }
        var f = b.functions[0]
        return (
          <FunctionTile key={f.key} group={f} selected={false} venues={venues}
            onClick={function () { pickBucket(b) }} />
        )
      })}
    </div>
  )
}

export default FunctionPickerGrid
