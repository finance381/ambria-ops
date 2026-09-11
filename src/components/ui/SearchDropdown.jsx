import { useState, useRef, useEffect, useId } from 'react'
import Icon from './Icon'

function SearchDropdown({ items, value, onChange, onAdd, onInputChange, placeholder, allowAdd, label, labelIcon, required, error, voiceLang, id }) {
  // Tie the label to the input so tapping the label focuses the field, and so a
  // screen reader announces which field it is reading. Nothing was associated
  // before, which on a phone is a daily miss -- the label is a big, obvious
  // target that simply did nothing.
  var autoId = useId()
  var inputId = id || autoId
  var [query, setQuery] = useState('')
  var [open, setOpen] = useState(false)
  var [hlIdx, setHlIdx] = useState(-1)
  var [listening, setListening] = useState(false)
  var containerRef = useRef(null)
  var inputRef = useRef(null)
  var listRef = useRef(null)
  var recognitionRef = useRef(null)

  var isFocused = useRef(false)
  // isDirty is a stronger signal than isFocused: it stays true while the user's typed
  // query hasn't yet matched a valid item, and self-clears when it does. This survives
  // the parent recreating the `items` array on every render (which was clobbering user typing).
  var isDirty = useRef(false)

  // Sync display text when value changes externally.
  useEffect(function () {
    var expected = ''
    if (value) {
      var match = items.find(function (i) { return i.value === value })
      expected = match ? match.label : value
    }
    setQuery(function (prev) {
      if (prev === expected) {
        // Query already reflects external state — clear dirty flag (they've aligned)
        isDirty.current = false
        return prev
      }
      if (isDirty.current) return prev  // user is mid-typing — don't overwrite
      return expected
    })
  }, [value, items])

  // Close on outside click
  useEffect(function () {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        isFocused.current = false
        isDirty.current = false  // Blur = end of typing session; allow sync to snap back to committed value
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

  async function handleAdd() {
    if (!onAdd || !query.trim()) return
    var result = onAdd(query.trim())
    // Async onAdd (e.g. DB insert): wait then close so parent-driven value sync fires
    if (result && typeof result.then === 'function') {
      try { await result } catch (_) {}
      isFocused.current = false
      setOpen(false)
    }
  }

  function handleInputChange(e) {
    var val = e.target.value
    isDirty.current = true
    setQuery(val)
    if (value) onChange('')
    setOpen(true)
    setHlIdx(-1)
    if (onInputChange) onInputChange(val)
  }

  function handleFocus() {
    isFocused.current = true
    setOpen(true)
  }

  function handleClear() {
    isFocused.current = false
    setQuery('')
    if (value) onChange('')
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
      if (value) onChange('')
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

  // The list is absolutely-positioned, so opening it doesn't push a
  // scrollable ancestor's scrollbar the way normal content would — if it
  // opens near the bottom of a scrollable modal/drawer, the modal just
  // clips it with no indication there's more below. Nudge any scrollable
  // ancestor to bring the freshly-opened list fully into view.
  useEffect(function () {
    if (!open || !listRef.current) return
    var id = requestAnimationFrame(function () {
      if (listRef.current) listRef.current.scrollIntoView({ block: 'nearest' })
    })
    return function () { cancelAnimationFrame(id) }
  }, [open])

  return (
    <div>
      {label && (
        <label htmlFor={inputId} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-1">
          {labelIcon && <span className="shrink-0 w-5 h-5 rounded-md bg-slate-100 text-slate-500 inline-flex items-center justify-center"><Icon name={labelIcon} size={11} /></span>}
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div ref={containerRef} className="relative">
        <div className="flex gap-1">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              value={query}
              onChange={handleInputChange}
              onFocus={handleFocus}
              onKeyDown={handleKeyDown}
              placeholder={placeholder || 'Search or select...'}
              className={
                "w-full pl-3 pr-9 py-2.5 bg-white border rounded-xl text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-shadow " +
                (error ? "border-red-400 focus:border-red-500 focus:ring-red-500/20"
                       : "border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/20")
              }
            />
            {query && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={startVoice}
            className={
              "w-11 shrink-0 rounded-xl border flex items-center justify-center transition-colors " +
              (listening
                ? "bg-red-500 border-red-500 text-white animate-pulse"
                : "bg-white border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600")
            }
            aria-label={listening ? 'Stop voice input' : 'Voice input'}
            title="Voice input"
          >
            <Icon name="mic" className="w-[18px] h-[18px]" />
          </button>
        </div>

        {open && (filtered.length > 0 || showAddOption) && (
          <div
            ref={listRef}
            className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] max-h-72 overflow-y-auto py-1"
          >
            {filtered.map(function (item, idx) {
              return (
                <div
                  key={item.value}
                  onClick={function () { handleSelect(item) }}
                  className={
                    "px-3 py-2 text-[13px] cursor-pointer transition-colors " +
                    (idx === hlIdx ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-700 hover:bg-slate-50")
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
              <div className="px-3 py-2 text-[13px] text-slate-500">No results</div>
            )}
            {showAddOption && (
              <div
                onClick={handleAdd}
                className={
                  "px-3 py-2 text-[13px] cursor-pointer font-semibold transition-colors " +
                  (hlIdx === filtered.length ? "bg-emerald-50 text-emerald-700" : "text-emerald-600 hover:bg-emerald-50")
                }
              >
                + Add "{query.trim()}"
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