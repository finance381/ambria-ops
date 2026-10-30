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

// buckets: output of buildContractBuckets(allRows). eventId/onPick carry the
// single anchor every write path already expects — any one function in a
// contract rolls up to the same balance (fn_event_group_balance), so which
// one anchors it never matters financially. extraEventIds/onExtraChange are
// purely a traceability tag: more functions in the SAME open contract this
// entry also covers (e.g. a decor cost that touched both the Mehndi and the
// Reception setups) — optional, and only offered once a contract is open.
function FunctionPickerGrid(props) {
  var buckets = props.buckets || []
  var eventId = props.eventId
  var onPick = props.onPick
  var extraEventIds = props.extraEventIds || []
  var onExtraChange = props.onExtraChange || function () {}
  var wide = props.wide
  var [openContractKey, setOpenContractKey] = useState(null)
  // Once a function is chosen the other cards have done their job. Keeping
  // them on screen pushed the amount, category and receipt fields a full
  // phone-height down the form; the choice collapses to the picked cards,
  // with a way back beside them. Re-pressing that way back is the only
  // thing that reopens browsing.
  var [reopening, setReopening] = useState(false)

  var selectedIds = eventId ? [eventId].concat(extraEventIds) : extraEventIds.slice()

  function findFunc(id) {
    var found = null
    buckets.forEach(function (b) {
      b.functions.forEach(function (f) {
        if (f.contracts.some(function (c) { return String(c.id) === id })) found = f
      })
    })
    return found
  }

  // Add or remove one function from the pick, inside whichever contract is
  // open. The first one picked becomes the anchor (event_id); any picked
  // after it are tags only (extraEventIds). Removing the anchor promotes
  // the next tag to anchor, so there's never a tagged function floating
  // without one.
  function toggle(id) {
    if (selectedIds.indexOf(id) !== -1) {
      if (id === eventId) {
        var rest = extraEventIds.slice()
        var promoted = rest.shift()
        onPick(promoted || '')
        onExtraChange(rest)
      } else {
        onExtraChange(extraEventIds.filter(function (x) { return x !== id }))
      }
    } else if (!eventId) {
      onPick(id)
    } else {
      onExtraChange(extraEventIds.concat([id]))
    }
  }

  // A standalone function (no contract to tag siblings from) is still a
  // plain single pick — choosing a different one replaces it outright.
  function pickStandalone(id) {
    onPick(id)
    onExtraChange([])
    setOpenContractKey(null)
    setReopening(false)
  }

  var selectedFuncs = selectedIds.map(findFunc).filter(Boolean)

  if (selectedFuncs.length > 0 && !reopening) {
    return (
      <div className="space-y-2">
        <div className={gridCls(wide)}>
          {selectedFuncs.map(function (f) {
            var id = String(f.contracts[0].id)
            return (
              /* Pressing a picked tile again removes it — the one way back
                 to no selection at all (not just a different one), which a
                 write-your-own-detail fallback field needs to be able to
                 show. */
              <FunctionTile key={f.key} group={f} selected={true} showDate={true}
                onClick={function () { toggle(id) }} />
            )
          })}
        </div>
        {buckets.length > 1 && (
          <button type="button" onClick={function () { setReopening(true) }}
            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 px-1">
            {selectedFuncs.length > 1 ? 'Add or change functions' : 'Change function'}
          </button>
        )}
      </div>
    )
  }

  // Editing something already anchored inside a multi-function contract
  // should land straight on that contract's function list, not the
  // top-level tiles — same reason the single-function case lands straight
  // on its own tile(s) above.
  var activeBucket = buckets.find(function (b) {
    return b.isContract && b.functions.some(function (f) { return selectedFuncs.indexOf(f) !== -1 })
  })
  var openKey = openContractKey || (activeBucket ? activeBucket.key : null)
  var openBucket = openKey ? buckets.find(function (b) { return b.key === openKey }) : null

  if (openBucket) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={function () { setOpenContractKey(null); setReopening(false) }}
            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 px-1">
            ← All functions for {openBucket.clientName}
          </button>
          {selectedFuncs.length > 0 && (
            <button type="button" onClick={function () { setReopening(false) }}
              className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800 px-1">
              Done ({selectedFuncs.length} picked)
            </button>
          )}
        </div>
        <p className="text-[10.5px] text-slate-500 px-1">Pick every function this applies to.</p>
        <div className={gridCls(wide)}>
          {openBucket.functions.map(function (f) {
            var id = String(f.contracts[0].id)
            var sel = selectedIds.indexOf(id) !== -1
            return (
              <FunctionTile key={f.key} group={f} selected={sel} showDate={true}
                onClick={function () { toggle(id) }} />
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
          // reopening has to go true here too, not just from "Add or change
          // functions" below — otherwise the very first pick inside this
          // contract sets selectedFuncs.length to 1 while reopening is still
          // false from its initial state, and the collapse branch above
          // swallows the list after a single tap instead of staying open
          // for more.
          return <ContractTile key={b.key} bucket={b} onClick={function () { setOpenContractKey(b.key); setReopening(true) }} />
        }
        var f = b.functions[0]
        var id = String(f.contracts[0].id)
        var sel = id === eventId
        return (
          <FunctionTile key={f.key} group={f} selected={sel}
            onClick={function () { pickStandalone(id) }} />
        )
      })}
    </div>
  )
}

export default FunctionPickerGrid
