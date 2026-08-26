import { useState, useRef, useEffect } from 'react'

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
        className="flex flex-wrap items-center gap-1 px-2 py-1.5 border border-gray-200 rounded-lg bg-white cursor-text min-h-[38px]">
        {selected.map(function (v) {
          return (
            <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded">
              {labelFor(v)}
              <button type="button" onClick={function (e) { removeChip(v, e) }}
                className="text-indigo-500 hover:text-indigo-800 leading-none">×</button>
            </span>
          )
        })}
        <input ref={inputRef} type="text" value={query}
          onChange={function (e) { setQuery(e.target.value); setOpen(true); setHlIdx(-1) }}
          onFocus={function () { setOpen(true) }}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? (placeholder || 'Search...') : ''}
          style={{ fontSize: '16px' }}
          className="flex-1 min-w-[80px] border-none outline-none text-sm bg-transparent" />
        {selected.length > 0 && (
          <button type="button" onClick={clearAll}
            className="text-[10px] text-gray-400 hover:text-gray-700 font-bold px-1">✕</button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {filtered.slice(0, 100).map(function (i, idx) {
            var isHl = idx === hlIdx
            return (
              <div key={i.value}
                onClick={function () { toggle(i.value) }}
                onMouseEnter={function () { setHlIdx(idx) }}
                className={"px-3 py-2 text-sm cursor-pointer " + (isHl ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-50")}>
                {i.label}
              </div>
            )
          })}
          {filtered.length > 100 && (
            <div className="px-3 py-1.5 text-[10px] text-gray-400 font-semibold bg-gray-50 border-t border-gray-100">
              Showing first 100. Keep typing to narrow.
            </div>
          )}
        </div>
      )}
      {open && filtered.length === 0 && query && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-400">
          No matches
        </div>
      )}
    </div>
  )
}

export default MultiSearchDropdown