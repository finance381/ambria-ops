import { useState } from 'react'
import { deptCls } from '../../lib/ui'
import { formatDate } from '../../lib/format'

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

function FunctionTile(props) {
  var g = props.group
  var selected = props.selected
  var showDate = props.showDate
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
        {[showDate ? formatDate(head.function_date) : null, head.venue_name,
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
// instead of a repeated row per function. Tapping it opens the function
// list so the actual date/session still gets picked deliberately.
function ContractTile(props) {
  var bucket = props.bucket
  var deptSeen = {}
  var deptList = []
  bucket.functions.forEach(function (f) {
    f.contracts.forEach(function (c) {
      if (!deptSeen[c.department]) { deptSeen[c.department] = true; deptList.push(c.department) }
    })
  })
  return (
    <button type="button" onClick={props.onClick}
      className="text-left rounded-xl border px-2.5 py-2 transition-all duration-150 border-slate-200 bg-white hover:border-indigo-300 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
      <span className="flex items-start justify-between gap-1.5">
        <span className="min-w-0 flex-1 block text-[11px] font-bold uppercase tracking-[0.03em] leading-snug truncate text-slate-900">
          {bucket.clientName || 'Contract'}
        </span>
        <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-[0.05em] leading-none px-1.5 py-[3px] rounded bg-indigo-100 text-indigo-600">
          {bucket.functions.length} functions
        </span>
      </span>
      <span className="block text-[11px] leading-snug truncate text-slate-700">{bucket.venueName}</span>
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

// buckets: output of buildContractBuckets(allRows). eventId/onPick behave
// exactly as the old single-function picker did — picking a tile still only
// ever commits one function's anchor id, same write shape as before. A
// multi-function contract is a browsing step in front of that choice, not a
// new kind of selection.
function FunctionPickerGrid(props) {
  var buckets = props.buckets || []
  var eventId = props.eventId
  var onPick = props.onPick
  var wide = props.wide
  var [openContractKey, setOpenContractKey] = useState(null)
  // Once a function is chosen the other cards have done their job. Keeping
  // them on screen pushed the amount, category and receipt fields a full
  // phone-height down the form; the choice collapses to the one card that
  // matters, with a way back beside it. Re-pressing that way back is the
  // only thing that reopens browsing.
  var [reopening, setReopening] = useState(false)

  function pick(id) {
    onPick(id)
    setOpenContractKey(null)
    setReopening(false)
  }

  var pickedFunc = null
  buckets.forEach(function (b) {
    b.functions.forEach(function (f) {
      if (f.contracts.some(function (c) { return String(c.id) === eventId })) pickedFunc = f
    })
  })

  if (pickedFunc && !reopening) {
    return (
      <div className="space-y-2">
        <div className={gridCls(wide)}>
          {/* Pressing the picked tile again deselects it — the one way back
              to no selection at all (not just a different one), which a
              write-your-own-detail fallback field needs to be able to show. */}
          <FunctionTile group={pickedFunc} selected={true} showDate={true} onClick={function () { pick('') }} />
        </div>
        {buckets.length > 1 && (
          <button type="button" onClick={function () { setReopening(true) }}
            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 px-1">
            Change function
          </button>
        )}
      </div>
    )
  }

  // Editing something already anchored inside a multi-function contract
  // should land straight on that contract's function list, not the
  // top-level tiles — same reason the single-function case lands straight
  // on its own tile above.
  var activeBucket = buckets.find(function (b) {
    return b.isContract && b.functions.some(function (f) { return f === pickedFunc })
  })
  var openKey = openContractKey || (activeBucket ? activeBucket.key : null)
  var openBucket = openKey ? buckets.find(function (b) { return b.key === openKey }) : null

  if (openBucket) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={function () { setOpenContractKey(null) }}
          className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 px-1">
          ← All functions for {openBucket.clientName}
        </button>
        <div className={gridCls(wide)}>
          {openBucket.functions.map(function (f) {
            var sel = f.contracts.some(function (c) { return String(c.id) === eventId })
            return (
              <FunctionTile key={f.key} group={f} selected={sel} showDate={true}
                onClick={function () { pick(String(f.contracts[0].id)) }} />
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={gridCls(wide)}>
      {buckets.map(function (b) {
        if (b.isContract) {
          return <ContractTile key={b.key} bucket={b} onClick={function () { setOpenContractKey(b.key) }} />
        }
        var f = b.functions[0]
        var sel = f.contracts.some(function (c) { return String(c.id) === eventId })
        return (
          <FunctionTile key={f.key} group={f} selected={sel}
            onClick={function () { pick(String(f.contracts[0].id)) }} />
        )
      })}
    </div>
  )
}

export default FunctionPickerGrid
