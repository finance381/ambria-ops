import { useState, useRef, useEffect } from 'react'

function SearchDropdown({ items, value, onChange, onAdd, placeholder, allowAdd, label, required, error, voiceLang }) {
  var [query, setQuery] = useState('')
  var [open, setOpen] = useState(false)
  var [hlIdx, setHlIdx] = useState(-1)
  var [listening, setListening] = useState(false)
  var containerRef = useRef(null)
  var inputRef = useRef(null)
  var listRef = useRef(null)
  var recognitionRef = useRef(null)

  var isFocused = useRef(false)

  // Sync display text when value changes externally (not while typing)
  useEffect(function () {
    if (isFocused.current) return
    if (value) {
      var match = items.find(function (i) { return i.value === value })
      if (match) setQuery(match.label)
    } else {
      setQuery('')
    }
  }, [value, items])

  // Close on outside click
  useEffect(function () {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        isFocused.current = false
        setOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return function () { document.removeEventListener('click', handleClick) }
  }, [])

  var filtered = query
    ? items.filter(function (i) { return i.label.toLowerCase().includes(query.toLowerCase()) })
    : items

  var showAddOption = allowAdd && query.trim() &&
    !items.some(function (i) { return i.label.toLowerCase() === query.toLowerCase() })

  function handleSelect(item) {
    isFocused.current = false
    setQuery(item.label)
    onChange(item.value)
    setOpen(false)
    setHlIdx(-1)
  }

  function handleAdd() {
    if (onAdd && query.trim()) {
      onAdd(query.trim())
    }
  }

  function handleInputChange(e) {
    setQuery(e.target.value)
    onChange('')
    setOpen(true)
    setHlIdx(-1)
  }

  function handleFocus() {
    isFocused.current = true
    setOpen(true)
  }

  function handleClear() {
    isFocused.current = false
    setQuery('')
    onChange('')
    setOpen(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e) {
    if (!open) return
    var totalItems = filtered.length + (showAddOption ? 1 : 0)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHlIdx(function (prev) { return Math.min(prev + 1, totalItems - 1) })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHlIdx(function (prev) { return Math.max(prev - 1, 0) })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (hlIdx >= 0 && hlIdx < filtered.length) {
        handleSelect(filtered[hlIdx])
      } else if (showAddOption && hlIdx === filtered.length) {
        handleAdd()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  function startVoice() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Speech not supported'); return }

    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      return
    }

    var recognition = new SR()
    recognition.lang = voiceLang || 'en-IN'
    recognition.interimResults = false

    recognition.onresult = function (ev) {
      var transcript = ev.results[0][0].transcript
      setQuery(transcript)
      onChange('')
      setOpen(true)
      setListening(false)
      recognitionRef.current = null
    }
    recognition.onend = function () {
      setListening(false)
      recognitionRef.current = null
    }
    recognition.onerror = function () {
      setListening(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  // Scroll highlighted item into view
  useEffect(function () {
    if (listRef.current && hlIdx >= 0) {
      var el = listRef.current.children[hlIdx]
      if (el) el.scrollIntoView({ block: 'nearest' })
    }
  }, [hlIdx])

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div ref={containerRef} className="relative">
        <div className="flex gap-1">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleInputChange}
              onFocus={handleFocus}
              onKeyDown={handleKeyDown}
              placeholder={placeholder || 'Search or select...'}
              className={
                "w-full pl-3 pr-8 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 " +
                (error ? "border-red-300" : "border-gray-300")
              }
            />
            {query && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={startVoice}
            className={
              "px-2.5 py-2 rounded-md text-sm transition-colors flex-shrink-0 " +
              (listening
                ? "bg-red-500 text-white animate-pulse"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200")
            }
          >
            🎙️
          </button>
        </div>

        {open && (filtered.length > 0 || showAddOption) && (
          <div
            ref={listRef}
            className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto"
          >
            {filtered.map(function (item, idx) {
              return (
                <div
                  key={item.value}
                  onClick={function () { handleSelect(item) }}
                  className={
                    "px-3 py-2 text-sm cursor-pointer transition-colors " +
                    (idx === hlIdx ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-50")
                  }
                >
                  {item.label}
                  {item.pending && (
                    <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                      PENDING
                    </span>
                  )}
                </div>
              )
            })}
            {filtered.length === 0 && !showAddOption && (
              <div className="px-3 py-2 text-sm text-gray-400">No results</div>
            )}
            {showAddOption && (
              <div
                onClick={handleAdd}
                className={
                  "px-3 py-2 text-sm cursor-pointer font-medium transition-colors " +
                  (hlIdx === filtered.length ? "bg-green-50 text-green-700" : "text-green-600 hover:bg-green-50")
                }
              >
                ➕ Add "{query.trim()}"
              </div>
            )}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export default SearchDropdown