import { useState, useRef } from 'react'

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

  function stop() {
    var r = recognitionRef.current
    recognitionRef.current = null
    if (r) { try { r.stop() } catch (_) {} }
    setListening(false)
  }

  function start(onResult) {
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
    recognition.lang = lang || preferredLang()
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = function (event) {
      var transcript = event.results[0][0].transcript
      if (callbackRef.current) callbackRef.current(transcript)
    }

    // Every error used to be swallowed here, so a blocked microphone
    // permission looked exactly like a broken button.
    recognition.onerror = function (event) {
      recognitionRef.current = null
      setListening(false)
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
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch (err) {
      recognitionRef.current = null
      setListening(false)
      alert('Could not start voice input: ' + (err && err.message ? err.message : 'unknown error'))
    }
  }

  return { listening: listening, start: start, stop: stop }
}
