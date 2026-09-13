import { useRef, useState } from 'react'
import ysFixWebmDuration from 'fix-webm-duration'

// One MediaRecorder-backed voice-note slot: records via getUserMedia, patches
// the WebM header with the real duration (raw MediaRecorder output otherwise
// seeks/plays incorrectly past ~3s), and hands back a blob + object URL.
// `urlRef` (not just the `url` state) is what gets revoked, so a slow-to-settle
// `onstop` always revokes the actually-current blob URL rather than whatever
// was captured in that callback's closure when recording started.
export function useAudioRecorder() {
  var [blob, setBlob] = useState(null)
  var [url, setUrl] = useState('')
  var [recording, setRecording] = useState(false)
  var liveRef = useRef(null) // { recorder, stream } while a recording is in flight
  var urlRef = useRef('')

  function start() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = []
      var recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      var startedAt = Date.now()
      liveRef.current = { recorder: recorder, stream: stream }
      recorder.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop() })
        liveRef.current = null
        var rawBlob = new Blob(chunks, { type: 'audio/webm' })
        var durationMs = Date.now() - startedAt
        function finish(finalBlob) {
          if (urlRef.current) URL.revokeObjectURL(urlRef.current)
          var objUrl = URL.createObjectURL(finalBlob)
          urlRef.current = objUrl
          setBlob(finalBlob)
          setUrl(objUrl)
          setRecording(false)
        }
        ysFixWebmDuration(rawBlob, durationMs, { logger: false }).then(finish).catch(function () { finish(rawBlob) })
      }
      setRecording(true)
      recorder.start()
      setTimeout(stop, 30000)
    }).catch(function () { alert('Microphone access denied') })
  }

  function stop() {
    var live = liveRef.current
    if (live && live.recorder.state === 'recording') live.recorder.stop()
  }

  function remove() {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = ''
    setBlob(null)
    setUrl('')
    setRecording(false)
  }

  // For "the surrounding UI is closing, discard everything" — unlike stop(),
  // this releases the microphone immediately instead of waiting for onstop to
  // process a blob nobody will see, and unlike remove() it also cuts off a
  // recording that's still in flight.
  function cancel() {
    var live = liveRef.current
    if (live) {
      live.recorder.onstop = null
      try { if (live.recorder.state !== 'inactive') live.recorder.stop() } catch (_) {}
      live.stream.getTracks().forEach(function (t) { t.stop() })
      liveRef.current = null
    }
    remove()
  }

  return { blob: blob, url: url, recording: recording, start: start, stop: stop, remove: remove, cancel: cancel }
}
