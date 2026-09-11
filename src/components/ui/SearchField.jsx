import { useRef } from 'react'
import Icon from './Icon'
import { FIELD_SEARCH } from '../../lib/ui'

// The one search box every list in the app uses.
//
// Before this, twenty-odd screens each hand-rolled a bare <input>: no
// magnifier, five different border radii between them, and — the reason this
// exists — no way to empty the box except select-all and backspace, which on a
// phone in a banquet hall is a real cost every time you want the full list
// back. SearchDropdown already had its clear button; the plain filters did not.
//
// `onChange` takes the value, not the event, so a caller that does extra work
// on every keystroke (resetting a page number, say) reads as one line.
function SearchField({ value, onChange, placeholder, className, ariaLabel, autoFocus }) {
  var inputRef = useRef(null)
  var hasValue = !!(value && String(value).length > 0)
  return (
    // The wrapper carries layout (w-full, flex-1, min-w) and nothing else, so a
    // caller can place it in a toolbar row without restyling the field itself.
    <div className={"relative " + (className || 'w-full')}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
        <Icon name="search" size={15} />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value || ''}
        onChange={function (e) { onChange(e.target.value) }}
        placeholder={placeholder || 'Search...'}
        aria-label={ariaLabel || placeholder || 'Search'}
        autoFocus={autoFocus}
        // 16px is what stops iOS zooming the page on focus.
        style={{ fontSize: '16px' }}
        className={FIELD_SEARCH + (hasValue ? ' pr-9' : ' pr-3')}
      />
      {hasValue && (
        // Focus goes back to the field: clearing is almost always the start of
        // a new search, not the end of one.
        <button
          type="button"
          onClick={function () { onChange(''); if (inputRef.current) inputRef.current.focus() }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  )
}

export default SearchField
