import { useState, useRef } from 'react'

export function useVoice() {
  var [listening, setListening] = useState(false)
  var recognitionRef = useRef(null)
  var callbackRef = useRef(null)

  function start(onResult) {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Speech recognition not supported in this browser')
      return
    }

    callbackRef.current = onResult

    var recognition = new SpeechRecognition()
    recognition.lang = 'en-IN'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = function (event) {
      var transcript = event.results[0][0].transcript
      if (callbackRef.current) callbackRef.current(transcript)
      setListening(false)
    }

    recognition.onerror = function () {
      setListening(false)
    }

    recognition.onend = function () {
      setListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  function stop() {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    setListening(false)
  }

  return { listening: listening, start: start, stop: stop }
}