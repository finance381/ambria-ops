import { useState, useEffect } from 'react'

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
//   minRows           number, default 1. Remove disabled at this count.

var THEMES = {
  amber: {
    outer: 'border-amber-200 bg-amber-50/40',
    header: 'bg-amber-100/60 text-amber-800',
    btn: 'bg-amber-200/60 hover:bg-amber-200 text-amber-700 hover:text-amber-900',
    edit: 'border-amber-300',
  },
  indigo: {
    outer: 'border-indigo-200 bg-indigo-50/40',
    header: 'bg-indigo-100/60 text-indigo-800',
    btn: 'bg-indigo-200/60 hover:bg-indigo-200 text-indigo-700 hover:text-indigo-900',
    edit: 'border-indigo-300',
  },
  gray: {
    outer: 'border-gray-200 bg-gray-50',
    header: 'bg-gray-100 text-gray-700',
    btn: 'bg-gray-200 hover:bg-gray-300 text-gray-700 hover:text-gray-900',
    edit: 'border-indigo-300',
  },
}

function AllocationRows(props) {
  var t = THEMES[props.accent || 'amber'] || THEMES.amber
  var allocations = props.allocations || []
  var minRows = props.minRows || 1
  var [manualExpandedIdx, setManualExpandedIdx] = useState(-1)

  useEffect(function () {
    if (manualExpandedIdx >= allocations.length) setManualExpandedIdx(-1)
  }, [allocations.length])

  function isExpanded(idx, alloc) {
    if (!props.isComplete(alloc)) return true
    return idx === manualExpandedIdx
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
    if (manualExpandedIdx === idx) setManualExpandedIdx(-1)
    else if (manualExpandedIdx > idx) setManualExpandedIdx(manualExpandedIdx - 1)
  }

  function handleDone(idx) {
    if (idx === manualExpandedIdx) setManualExpandedIdx(-1)
  }

  return (
    <div className={"border rounded-lg overflow-hidden " + t.outer}>
      <div className={"flex items-center justify-between px-3 py-2 " + t.header}>
        <span className="text-[11px] font-bold uppercase tracking-wide">{props.title || 'Allocations'}</span>
        <div className="flex gap-1.5">
          {props.onDuplicate && allocations.length > 0 && (
            <button type="button" onClick={handleDuplicate}
              className={"text-[11px] font-bold px-2 py-0.5 rounded " + t.btn}
              title="Duplicate current row">⧉ Duplicate</button>
          )}
          <button type="button" onClick={handleAdd}
            className={"text-[11px] font-bold px-2 py-0.5 rounded " + t.btn}>+ Row</button>
        </div>
      </div>

      {props.headerWarning && <div className="px-2.5 pt-2">{props.headerWarning}</div>}

      <div className="p-2 space-y-1.5">
        {allocations.map(function (alloc, aIdx) {
          var expanded = isExpanded(aIdx, alloc)
          var complete = props.isComplete(alloc)
          var canRemove = allocations.length > minRows

          if (expanded) {
            return (
              <div key={aIdx} className={"border rounded-lg bg-white p-2.5 " + t.edit}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Row {aIdx + 1} · editing</span>
                  <div className="flex items-center gap-3">
                    {complete && (
                      <button type="button" onClick={function () { handleDone(aIdx) }}
                        className="text-[11px] font-semibold text-gray-500 hover:text-gray-800">Done ▲</button>
                    )}
                    {canRemove && (
                      <button type="button" onClick={function () { handleRemove(aIdx) }}
                        className="text-red-400 hover:text-red-600 text-sm" title="Remove">✕</button>
                    )}
                  </div>
                </div>
                {props.renderExpanded(alloc, aIdx)}
              </div>
            )
          }

          var chip = props.renderChip(alloc, aIdx)
          return (
            <div key={aIdx} className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white hover:border-gray-300 hover:bg-gray-50 transition-colors">
              <button type="button" onClick={function () { setManualExpandedIdx(aIdx) }}
                className="flex items-center justify-between gap-2 min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5 min-w-0 flex-1 text-xs">{chip.left}</div>
                <div className="text-xs font-semibold text-gray-700 shrink-0">{chip.right}</div>
              </button>
              <span className="text-gray-300 text-xs shrink-0" aria-hidden="true">✎</span>
              {canRemove && (
                <button type="button" onClick={function () { handleRemove(aIdx) }}
                  className="text-red-300 hover:text-red-500 text-sm shrink-0" title="Remove">✕</button>
              )}
            </div>
          )
        })}
      </div>
      {props.footer}
    </div>
  )
}

export default AllocationRows