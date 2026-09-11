// src/components/ui/VoiceInput.jsx
// Reusable input/textarea with a built-in speech-to-text mic overlay.
// Appends transcript to the current value with a leading space.
//
// Usage:
//   <VoiceInput value={desc} onChange={function (e) { setDesc(e.target.value) }} placeholder="..." />
//   <VoiceInput as="textarea" rows="3" value={notes} onChange={...} maxLength={500} />
//
// All standard input/textarea props (className, style, placeholder, maxLength, rows, disabled, autoFocus, id, aria-label, etc.)
// pass through to the underlying element. `pr-10` is auto-added to leave room for the mic button.
// `fontSize: '16px'` is auto-added to prevent iOS zoom (can be overridden via style prop).

import { useRef, useId } from 'react'
import { useVoice } from '../../hooks/useVoice'
import Icon from './Icon'

function VoiceInput({ as, value, onChange, className, style, id, ...rest }) {
  // An id is generated when the caller does not pass one, so a wrapping label
  // can point at the control with htmlFor.
  var autoId = useId()
  var inputId = id || autoId
  var voice = useVoice()
  var isTextarea = as === 'textarea'
  var Tag = isTextarea ? 'textarea' : 'input'
  // w-full as well as pr-10: the control is wrapped in a relative div, so
  // without it the input falls back to its intrinsic size and stops matching
  // the plain inputs beside it in a grid.
  var mergedClass = 'w-full ' + (className || '') + ' pr-10'
  var mergedStyle = Object.assign({ fontSize: '16px' }, style || {})

  // Transcription takes a second or two, so the callback must read the value as
  // it is when the text arrives. Closing over the `value` of the render that
  // started the recogniser would discard anything typed in the meantime.
  var latest = useRef(value)
  latest.current = value

  function handleVoice() {
    voice.start(function (text) {
      var current = latest.current || ''
      var next = current ? current + ' ' + text : text
      // Synthesize a change event shape so parents' onChange(e) handlers work unchanged
      onChange({ target: { value: next } })
    })
  }

  return (
    // min-w-0: a grid/flex track is minmax(auto, 1fr) by default and an
    // input's intrinsic min-width would push the track wider than its
    // container. w-full alone does not prevent that.
    <div className="relative min-w-0">
      <Tag id={inputId} value={value || ''} onChange={onChange} className={mergedClass} style={mergedStyle} {...rest} />
      <button type="button" onClick={handleVoice} tabIndex={-1}
        className={"absolute right-2 " + (isTextarea ? "top-2" : "top-1/2 -translate-y-1/2") +
          " w-7 h-7 flex items-center justify-center rounded-lg transition-colors " +
          (voice.listening ? "bg-red-500 text-white animate-pulse" : "text-slate-400 hover:bg-slate-100 hover:text-indigo-600")}
        title={voice.listening ? 'Stop voice input' : 'Voice input'}
        aria-label={voice.listening ? 'Stop voice input' : 'Voice input'}><Icon name="mic" className="w-4 h-4" /></button>
    </div>
  )
}

export default VoiceInput