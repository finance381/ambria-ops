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
//   startCollapsed    bool. Every row starts folded instead of the first open.
//   heading           JSX. Bare only: shown at the left of the top bar in
//                     place of the "N places" count.
//   bare              bool. For a list that already sits in a titled card:
//                     no box of its own and no title, so it is not a card in
//                     a card in a card — just the row buttons, then the rows.
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
  // greet you with a collapsed chip that has nothing in it yet — unless
  // startCollapsed, for a list of saved rows read before anything is edited.
  var [manualExpandedIdx, setManualExpandedIdx] = useState(props.startCollapsed ? -1 : 0)

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

  // Bare (inside a titled card): one list, rows ruled apart, instead of a
  // card per row — a numbered line per place with its quantity, and the row
  // being edited opening in place, tinted.
  if (props.bare) {
    var n = allocations.length
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-2.5">
          {props.heading || <span className="text-[12.5px] font-semibold text-slate-600"><span data-notranslate>{n}</span>{n === 1 ? ' place' : ' places'}</span>}
          <div className="flex items-center gap-1.5">
            {props.onDuplicate && n > 0 && (
              <button type="button" onClick={handleDuplicate} title="Duplicate the open row"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                <Icon name="copy" size={13} />Duplicate
              </button>
            )}
            <button type="button" onClick={handleAdd}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#3B4668] text-white text-[12.5px] font-semibold hover:bg-[#2F3854] transition-colors">
              <Icon name="plus" size={13} />Add place
            </button>
          </div>
        </div>

        {props.headerWarning && <div className="mb-2">{props.headerWarning}</div>}

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
          {allocations.map(function (alloc, aIdx) {
            var complete = props.isComplete(alloc)
            if (isExpanded(aIdx)) {
              return (
                <div key={aIdx} className="ambria-rise bg-[#F6F7FB] px-3.5 py-3" onFocusCapture={function () { claim(aIdx) }}>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="inline-flex items-center gap-2 text-[12px] font-bold text-slate-700">
                      <span className="w-6 h-6 rounded-md bg-[#3B4668] text-white inline-flex items-center justify-center text-[11px] tabular-nums" data-notranslate>{aIdx + 1}</span>
                      Editing place
                    </span>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={function () { handleDone(aIdx) }}
                        className={"inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[12.5px] font-semibold transition-colors " +
                          (complete ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50")}>
                        <Icon name={complete ? 'check' : 'chevronUp'} size={13} />{complete ? 'Done' : 'Collapse'}
                      </button>
                      <button type="button" onClick={function () { handleRemove(aIdx) }} title="Delete row" aria-label="Delete row"
                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                  {props.renderExpanded(alloc, aIdx)}
                </div>
              )
            }
            var chip = props.renderChip(alloc, aIdx)
            return (
              <div key={aIdx} className={"group flex items-center gap-3 px-3.5 py-2.5 transition-colors " + (complete ? "hover:bg-slate-50" : "bg-amber-50/50")}>
                <span className="shrink-0 w-6 text-[11.5px] font-bold text-slate-400 tabular-nums" data-notranslate>{aIdx + 1}</span>
                <button type="button" onClick={function () { setManualExpandedIdx(aIdx) }}
                  className="flex-1 min-w-0 flex items-center gap-3 text-left">
                  <span className="flex-1 min-w-0 flex items-center gap-2 text-[13px] text-slate-700">{chip.left}</span>
                  {complete
                    ? <span className="shrink-0 text-[14px] font-bold text-slate-900 tabular-nums">{chip.right}</span>
                    : <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Incomplete</span>}
                  <span className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 group-hover:text-[#3B4668] group-hover:bg-white transition-colors"><Icon name="edit" size={14} /></span>
                </button>
                <button type="button" onClick={function () { handleRemove(aIdx) }} title="Delete row" aria-label="Delete row"
                  className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )
          })}
        </div>
        {props.footer}
      </div>
    )
  }

  return (
    <div className={props.bare ? "" : "border border-slate-200 rounded-xl bg-slate-50 overflow-hidden"}>
      <div className={props.bare ? "flex items-center justify-between gap-2 mb-2.5" : "flex items-center justify-between gap-2 px-3 py-2 bg-white border-b border-slate-200"}>
        {props.bare
          ? <span className="text-[12.5px] font-medium text-slate-500"><span data-notranslate>{allocations.length}</span>{allocations.length === 1 ? ' row' : ' rows'}</span>
          : <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{props.title || 'Allocations'}</span>}
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

      <div className={props.bare ? "space-y-2" : "p-2 space-y-1.5"}>
        {allocations.map(function (alloc, aIdx) {
          var expanded = isExpanded(aIdx)
          var complete = props.isComplete(alloc)

          if (expanded) {
            return (
              <div key={aIdx} className={props.bare ? "ambria-rise border border-slate-200 rounded-xl bg-slate-50/70 p-3.5" : "ambria-rise border rounded-xl bg-white p-2.5 " + t.edit}
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
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 ring-1 ring-amber-300/70">Incomplete</span>
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