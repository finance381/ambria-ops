import { useState, useRef, useEffect } from 'react'

function FilterDropdown({ value, onChange, options, placeholder }) {
  var [open, setOpen] = useState(false)
  var [q, setQ] = useState('')
  var wrapRef = useRef(null)

  useEffect(function () {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return function () { document.removeEventListener('click', onDocClick) }
  }, [])

  var qLower = q.toLowerCase()
  var filtered = q ? options.filter(function (o) { return o.label.toLowerCase().indexOf(qLower) !== -1 }) : options
  var selected = options.find(function (o) { return o.value === value })
  var displayLabel = selected ? selected.label : (placeholder || 'All')
  var hasValue = !!value

  function pick(v) { onChange(v); setOpen(false); setQ('') }
  function clearAll() { onChange(''); setOpen(false); setQ('') }

  return (
    <div className="relative" ref={wrapRef}>
      <button type="button" onClick={function () { setOpen(!open); setQ('') }}
        className={"px-3 py-2 border rounded-lg text-sm text-left w-full truncate focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (hasValue ? "border-indigo-400 bg-indigo-50 text-indigo-700 font-medium" : "border-gray-300 text-gray-500 bg-white")}
        style={{ fontSize: '16px' }}>
        {displayLabel}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg" style={{ maxHeight: 320, display: 'flex', flexDirection: 'column' }}>
          <div className="p-1.5 border-b border-gray-100">
            <input type="text" value={q} onChange={function (e) { setQ(e.target.value) }} placeholder="Type to filter..."
              autoFocus className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
            <button type="button" onClick={clearAll}
              className={"w-full text-left px-3 py-2 text-sm hover:bg-gray-50 " + (!hasValue ? "font-bold text-indigo-600" : "text-gray-400")}>
              {placeholder || 'All'}
            </button>
            {filtered.map(function (o) {
              var isOn = value === o.value
              return (
                <button type="button" key={o.value} onClick={function () { pick(o.value) }}
                  className={"w-full text-left px-3 py-2 text-sm hover:bg-gray-50 truncate " + (isOn ? "font-bold text-indigo-700 bg-indigo-50" : "text-gray-700")}>
                  {o.label}
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default FilterDropdown