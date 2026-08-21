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

import { useVoice } from '../../hooks/useVoice'

function VoiceInput({ as, value, onChange, className, style, ...rest }) {
  var voice = useVoice()
  var isTextarea = as === 'textarea'
  var Tag = isTextarea ? 'textarea' : 'input'
  var mergedClass = (className || '') + ' pr-10'
  var mergedStyle = Object.assign({ fontSize: '16px' }, style || {})

  function handleVoice() {
    voice.start(function (text) {
      var current = value || ''
      var next = current ? current + ' ' + text : text
      // Synthesize a change event shape so parents' onChange(e) handlers work unchanged
      onChange({ target: { value: next } })
    })
  }

  return (
    <div className="relative">
      <Tag value={value || ''} onChange={onChange} className={mergedClass} style={mergedStyle} {...rest} />
      <button type="button" onClick={handleVoice} tabIndex={-1}
        className={"absolute right-2 " + (isTextarea ? "top-2" : "top-1/2 -translate-y-1/2") + " p-1.5 rounded " + (voice.listening ? "text-red-500 animate-pulse" : "text-blue-600 hover:bg-blue-50")}
        aria-label="Voice input">🎤</button>
    </div>
  )
}

export default VoiceInput