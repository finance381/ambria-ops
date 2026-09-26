import { useState, useRef, useEffect } from 'react'

// compact: 13px, for a row it shares with the date pickers (13px too). The
// default keeps the 16px the expense filters were built around.
function FilterDropdown({ value, onChange, options, placeholder, compact }) {
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
      {/* h-10 and rounded-xl, to match the plain fields and the date pickers
          this sits in a row with — py-2 on a 16px line left it a few pixels
          short of all of them. The resting text is a shade darker for the same
          reason the labels above it are: gray-500 on white is a weight for
          something you glance past. */}
      <button type="button" onClick={function () { setOpen(!open); setQ('') }}
        className={"h-10 px-3 border rounded-xl text-left w-full truncate transition-shadow focus:outline-none focus:ring-2 focus:ring-indigo-500/20 " + (hasValue ? "border-indigo-400 bg-indigo-50 text-indigo-700 font-semibold" : "border-slate-300 text-slate-600 bg-white focus:border-indigo-500")}
        style={{ fontSize: compact ? '13px' : '16px' }}>
        {displayLabel}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg" style={{ maxHeight: 320, display: 'flex', flexDirection: 'column' }}>
          <div className="p-1.5 border-b border-gray-100">
            <input type="text" value={q} onChange={function (e) { setQ(e.target.value) }} placeholder="Type to filter..."
              autoFocus className="w-full px-2.5 py-1.5 text-[13px] text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
            <button type="button" onClick={clearAll}
              className={"w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 transition-colors " + (!hasValue ? "font-bold text-indigo-600" : "text-slate-500")}>
              {placeholder || 'All'}
            </button>
            {filtered.map(function (o) {
              var isOn = value === o.value
              return (
                <button type="button" key={o.value} onClick={function () { pick(o.value) }}
                  className={"w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 truncate transition-colors " + (isOn ? "font-bold text-indigo-700 bg-indigo-50" : "text-slate-700")}>
                  {o.label}
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-slate-500">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default FilterDropdown