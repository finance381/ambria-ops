import { useState, useRef, useEffect } from 'react'
import Icon from './Icon'

function MultiSearchDropdown({ items, values, onChange, placeholder }) {
  var [query, setQuery] = useState('')
  var [open, setOpen] = useState(false)
  var [hlIdx, setHlIdx] = useState(-1)
  var containerRef = useRef(null)
  var inputRef = useRef(null)

  var selected = values || []

  useEffect(function () {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false); setQuery(''); setHlIdx(-1)
      }
    }
    document.addEventListener('click', handleClick)
    return function () { document.removeEventListener('click', handleClick) }
  }, [])

  var filtered = (items || []).filter(function (i) {
    if (selected.indexOf(i.value) !== -1) return false
    if (!query) return true
    return i.label.toLowerCase().indexOf(query.toLowerCase()) !== -1
  })

  function toggle(val) {
    var next
    if (selected.indexOf(val) === -1) next = selected.concat([val])
    else next = selected.filter(function (v) { return v !== val })
    onChange(next)
    setQuery('')
    setHlIdx(-1)
    if (inputRef.current) inputRef.current.focus()
  }

  function removeChip(val, ev) {
    ev.stopPropagation()
    onChange(selected.filter(function (v) { return v !== val }))
  }

  function clearAll(ev) {
    ev.stopPropagation()
    onChange([])
    setQuery('')
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx(function (p) { return Math.min(p + 1, filtered.length - 1) }); setOpen(true) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHlIdx(function (p) { return Math.max(p - 1, 0) }) }
    else if (e.key === 'Enter' && hlIdx >= 0 && filtered[hlIdx]) { e.preventDefault(); toggle(filtered[hlIdx].value) }
    else if (e.key === 'Backspace' && !query && selected.length > 0) { onChange(selected.slice(0, -1)) }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  function labelFor(val) {
    var m = (items || []).find(function (i) { return i.value === val })
    return m ? m.label : val
  }

  return (
    <div ref={containerRef} className="relative">
      <div onClick={function () { setOpen(true); if (inputRef.current) inputRef.current.focus() }}
        className={"flex flex-wrap items-center gap-1 px-2.5 py-1.5 border rounded-xl bg-white cursor-text min-h-[40px] transition-colors " +
          (open ? "border-indigo-500 ring-2 ring-indigo-500/20"
            : selected.length > 0 ? "border-indigo-300" : "border-slate-300 hover:border-slate-400")}>
        {selected.map(function (v) {
          return (
            <span key={v} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11.5px] font-bold">
              {labelFor(v)}
              {/* A glyph with a box around it, rather than a × sitting in the
                  text — at this size the character was a two-pixel target. */}
              <button type="button" onClick={function (e) { removeChip(v, e) }}
                aria-label={'Remove ' + labelFor(v)}
                className="shrink-0 w-4 h-4 inline-flex items-center justify-center rounded text-indigo-400 hover:text-indigo-800 hover:bg-indigo-100 transition-colors">
                <Icon name="close" size={10} strokeWidth={3} />
              </button>
            </span>
          )
        })}
        <input ref={inputRef} type="text" value={query}
          onChange={function (e) { setQuery(e.target.value); setOpen(true); setHlIdx(-1) }}
          onFocus={function () { setOpen(true) }}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? (placeholder || 'Search...') : ''}
          style={{ fontSize: '16px' }}
          className="flex-1 min-w-[80px] border-none outline-none text-[13px] bg-transparent placeholder:text-slate-400" />
        {selected.length > 0 && (
          <button type="button" onClick={clearAll} aria-label="Clear this filter"
            className="shrink-0 ml-auto w-5 h-5 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <Icon name="close" size={12} strokeWidth={2.6} />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1.5 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] py-1">
          {filtered.slice(0, 100).map(function (i, idx) {
            var isHl = idx === hlIdx
            return (
              <div key={i.value}
                onClick={function () { toggle(i.value) }}
                onMouseEnter={function () { setHlIdx(idx) }}
                className={"mx-1 px-2.5 py-2 text-[13px] rounded-lg cursor-pointer transition-colors " +
                  (isHl ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700 hover:bg-slate-50")}>
                {i.label}
              </div>
            )
          })}
          {filtered.length > 100 && (
            <div className="mt-1 px-3 py-1.5 text-[10.5px] font-bold text-slate-400 bg-slate-50 border-t border-slate-100">
              Showing first 100. Keep typing to narrow.
            </div>
          )}
        </div>
      )}
      {open && filtered.length === 0 && query && (
        <div className="absolute z-30 left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] px-3 py-2.5 text-[13px] font-medium text-slate-400">
          No matches
        </div>
      )}
    </div>
  )
}

export default MultiSearchDropdown