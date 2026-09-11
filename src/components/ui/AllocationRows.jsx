import { useState, useEffect } from 'react'
import Icon from './Icon'

// Shared allocation rows UI with collapse-when-complete UX.
// Rows where isComplete(row) is true render as a compact chip; incomplete rows
// stay expanded showing full field editors. Clicking a chip expands it for editing.
//
// Props:
//   allocations       array of row objects
//   isComplete        fn(row) → bool. True = row can collapse to chip.
//   renderChip        fn(row, idx) → { left, right }. JSX for collapsed chip content.
//   renderExpanded    fn(row, idx) → JSX for editable fields when expanded.
//   onAdd             fn() → void. Append a new blank row.
//   onRemove          fn(idx) → void.
//   onDuplicate       fn(idx) → void. Optional; hides button if omitted.
//   headerWarning     JSX. Optional banner above rows (e.g. dept mismatch).
//   title             string, default 'Allocations'.
//   accent            'amber' | 'indigo' | 'gray', default 'amber'.
//   onRemove          fn(idx) → void. Called for the last row too; the caller
//                     is expected to reset that row rather than drop it, so the
//                     list never goes empty.

// The shell is neutral in every variant -- a mustard card in the middle of a
// white form read as an error state. `accent` now only tints the row you are
// actually editing, which is the one thing on this card worth colouring.
var THEMES = {
  amber:  { edit: 'border-indigo-300 ring-1 ring-indigo-100' },
  indigo: { edit: 'border-indigo-300 ring-1 ring-indigo-100' },
  gray:   { edit: 'border-slate-400' },
}

function AllocationRows(props) {
  var t = THEMES[props.accent || 'amber'] || THEMES.amber
  var allocations = props.allocations || []
  // -1 means every row is collapsed. Row 0 starts open so a fresh list does not
  // greet you with a collapsed chip that has nothing in it yet.
  var [manualExpandedIdx, setManualExpandedIdx] = useState(0)

  useEffect(function () {
    if (manualExpandedIdx >= allocations.length) setManualExpandedIdx(-1)
  }, [allocations.length])

  // Exactly one row is open at a time, and only because the user opened it.
  // Two earlier rules are deliberately gone:
  //   - collapsing as soon as the last field validated, which yanked the card
  //     away mid-keystroke while you typed the amount;
  //   - force-expanding every incomplete row, which made an unfinished row
  //     impossible to fold. Incomplete rows now collapse like any other and
  //     carry an "Incomplete" badge on the chip so nothing hides silently.
  function isExpanded(idx) {
    return idx === manualExpandedIdx
  }

  function claim(idx) {
    if (manualExpandedIdx !== idx) setManualExpandedIdx(idx)
  }

  function handleAdd() {
    props.onAdd()
    setManualExpandedIdx(allocations.length)
  }

  function handleDuplicate() {
    if (!props.onDuplicate) return
    var srcIdx = manualExpandedIdx >= 0 ? manualExpandedIdx : allocations.length - 1
    if (srcIdx < 0) return
    props.onDuplicate(srcIdx)
    setManualExpandedIdx(allocations.length)
  }

  function handleRemove(idx) {
    props.onRemove(idx)
    // With one row left the caller resets it in place rather than dropping it,
    // so keep it open -- folding a freshly-blanked row away is not what you
    // asked for when you tapped delete.
    if (allocations.length <= 1) { setManualExpandedIdx(0); return }
    if (manualExpandedIdx === idx) setManualExpandedIdx(-1)
    else if (manualExpandedIdx > idx) setManualExpandedIdx(manualExpandedIdx - 1)
  }

  function handleDone(idx) {
    setManualExpandedIdx(-1)
  }

  return (
    <div className="border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border-b border-slate-200">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{props.title || 'Allocations'}</span>
        <div className="flex items-center gap-1.5">
          {props.onDuplicate && allocations.length > 0 && (
            <button type="button" onClick={handleDuplicate}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
              title="Duplicate current row">
              <Icon name="copy" className="w-3.5 h-3.5" />
              Duplicate
            </button>
          )}
          <button type="button" onClick={handleAdd}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-indigo-600 transition-colors">
            <Icon name="plus" className="w-3.5 h-3.5" />
            Row
          </button>
        </div>
      </div>

      {props.headerWarning && <div className="px-2.5 pt-2">{props.headerWarning}</div>}

      <div className="p-2 space-y-1.5">
        {allocations.map(function (alloc, aIdx) {
          var expanded = isExpanded(aIdx)
          var complete = props.isComplete(alloc)

          if (expanded) {
            return (
              <div key={aIdx} className={"ambria-rise border rounded-xl bg-white p-2.5 " + t.edit}
                onFocusCapture={function () { claim(aIdx) }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  {/* Number kept out of the translated node: "Row 3" can never
                      be a dictionary key, and the fallback translated it as
                      "area chart". */}
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    Row<span data-notranslate>{' ' + (aIdx + 1)}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    {/* Always offered: an unfinished row was previously stuck open. */}
                    <button type="button" onClick={function () { handleDone(aIdx) }}
                      className={"inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors " +
                        (complete
                          ? "text-emerald-700 bg-emerald-50 border-emerald-300 hover:bg-emerald-100"
                          : "text-slate-600 bg-white border-slate-300 hover:bg-slate-50 hover:text-slate-900")}>
                      <Icon name="chevronUp" className="w-3.5 h-3.5" />
                      {complete ? 'Done' : 'Collapse'}
                    </button>
                    <button type="button" onClick={function () { handleRemove(aIdx) }}
                      className="w-6 h-6 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                      title="Delete row" aria-label="Delete row"><Icon name="trash" className="w-4 h-4" /></button>
                  </div>
                </div>
                {props.renderExpanded(alloc, aIdx)}
              </div>
            )
          }

          var chip = props.renderChip(alloc, aIdx)
          return (
            <div key={aIdx} className={"flex items-center gap-2 px-3 py-2 border rounded-xl bg-white transition-colors " + (complete ? "border-slate-200 hover:border-slate-300" : "border-amber-300")}>
              <button type="button" onClick={function () { setManualExpandedIdx(aIdx) }}
                className="flex items-center justify-between gap-2 min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5 min-w-0 flex-1 text-[12px] text-slate-700">{chip.left}</div>
                {complete ? (
                  <div className="text-[13px] font-semibold text-slate-900 tabular-nums shrink-0">{chip.right}</div>
                ) : (
                  <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 ring-1 ring-amber-300/70">Incomplete</span>
                )}
                <Icon name="edit" className="w-3.5 h-3.5 shrink-0 text-slate-300" />
              </button>
              <button type="button" onClick={function () { handleRemove(aIdx) }}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                title="Delete row" aria-label="Delete row"><Icon name="trash" className="w-4 h-4" /></button>
            </div>
          )
        })}
      </div>
      {props.footer}
    </div>
  )
}

export default AllocationRows