import { useState, useRef, useEffect } from 'react'
import { registerVoiceStop } from '../lib/voiceRegistry'

// Read straight from the same key i18n persists, rather than through useLang:
// VoiceInput is mounted in places that sit outside the language provider, and a
// missing provider must not break the microphone.
function preferredLang() {
  try { return localStorage.getItem('ambria_lang') === 'hi' ? 'hi-IN' : 'en-IN' } catch (_) { return 'en-IN' }
}

export function useVoice(lang) {
  var [listening, setListening] = useState(false)
  var recognitionRef = useRef(null)
  var callbackRef = useRef(null)
  var unregisterRef = useRef(null)

  function unregister() {
    if (unregisterRef.current) { unregisterRef.current(); unregisterRef.current = null }
  }

  function stop() {
    var r = recognitionRef.current
    recognitionRef.current = null
    if (r) { try { r.stop() } catch (_) {} }
    setListening(false)
    unregister()
  }

  // Every consumer used to roll its own SpeechRecognition setup — four copies
  // of the same continuous/error/registry logic, so the pause-cutoff bug had
  // to be fixed four times. This is the one place that ever constructs a
  // recognizer now; a caller juggling more than one field (different language
  // per field, say) passes langOverride per start() call instead of needing
  // its own instance.
  function start(onResult, langOverride) {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Chrome or Edge on Android and desktop support it; Firefox does not.')
      return
    }

    // A second tap now stops the current recogniser instead of stacking a new
    // one on top of it, which is what made the button feel dead after one use.
    if (recognitionRef.current) { stop(); return }

    // The Web Speech API refuses to run outside a secure context. Opening the
    // dev server over a LAN IP (192.168.x.x) is the usual way to hit this, and
    // it used to fail silently.
    if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) {
      alert('Voice input needs a secure connection. Use https, or localhost instead of the machine\'s IP address.')
      return
    }

    callbackRef.current = onResult

    var recognition = new SpeechRecognition()
    recognition.lang = langOverride || lang || preferredLang()
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    // Without this, Chrome treats the very first pause in speech as the end
    // of the whole utterance and tears the session down right there — a
    // dictation that runs 9 seconds with a breath around second 3 only ever
    // captured that first 3 seconds, with everything said after going to a
    // closed recognizer. continuous keeps the session open across pauses;
    // each pause-delimited chunk still arrives as its own onresult call.
    recognition.continuous = true

    recognition.onresult = function (event) {
      var transcript = ''
      for (var i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      if (transcript && callbackRef.current) callbackRef.current(transcript)
    }

    // Every error used to be swallowed here, so a blocked microphone
    // permission looked exactly like a broken button.
    recognition.onerror = function (event) {
      recognitionRef.current = null
      setListening(false)
      unregister()
      var code = event && event.error
      // 'aborted' is the user tapping stop, which needs no announcement. But
      // 'no-speech' must be reported: silently swallowing it is indistinguishable
      // from a dead button, which is exactly how this used to look.
      if (code === 'aborted') return
      if (code === 'no-speech') {
        alert('Nothing was heard. Check that the right microphone is selected and speak once the button turns red.')
        return
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        alert('Microphone access is blocked. Allow it for this site in your browser settings, then try again.')
        return
      }
      if (code === 'network') {
        alert('Voice input needs a network connection to transcribe. Check your connection and try again.')
        return
      }
      alert('Voice input failed: ' + (code || 'unknown error'))
    }

    // Clearing the ref here is what lets the next tap start a fresh recogniser.
    recognition.onend = function () {
      recognitionRef.current = null
      setListening(false)
      unregister()
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
      unregisterRef.current = registerVoiceStop(stop)
    } catch (err) {
      recognitionRef.current = null
      setListening(false)
      alert('Could not start voice input: ' + (err && err.message ? err.message : 'unknown error'))
    }
  }

  // A component unmounting mid-dictation (navigating away, closing a modal)
  // used to leave Requisitions.jsx's own recognizer running until the browser
  // eventually ended it on its own — every consumer now gets this for free.
  useEffect(function () {
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { listening: listening, start: start, stop: stop }
}
