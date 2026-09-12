import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Live in-page camera, deliberately NOT <input type="file" capture="environment">.
// That native picker launches the OS camera as its own activity, backgrounding this
// tab — and on lower-memory phones the OS then kills the backgrounded tab outright,
// so returning from the shot reloads the whole app from scratch (no URL routing
// anywhere in this app means a reload always lands back on the default home screen,
// not wherever the user actually was). Staying in a getUserMedia video element the
// whole time means the tab is never backgrounded, so there's nothing for the OS to
// reclaim mid-capture.
function CameraCapture({ onCapture, onClose }) {
  var videoRef = useRef(null)
  var streamRef = useRef(null)
  var [error, setError] = useState('')
  var [ready, setReady] = useState(false)
  var [shotUrl, setShotUrl] = useState('')
  var [shotBlob, setShotBlob] = useState(null)

  useEffect(function () {
    var cancelled = false
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Camera not supported on this browser. Use Gallery instead.')
      return
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(function (stream) {
        if (cancelled) { stream.getTracks().forEach(function (t) { t.stop() }); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = function () { setReady(true) }
        }
      })
      .catch(function (err) {
        console.error('Camera open failed', err)
        setError(err && err.name === 'NotAllowedError'
          ? 'Camera permission denied — allow camera access in your browser settings, or use Gallery instead.'
          : 'Could not open camera. Use Gallery instead.')
      })
    return function () {
      cancelled = true
      if (streamRef.current) streamRef.current.getTracks().forEach(function (t) { t.stop() })
    }
  }, [])

  useEffect(function () {
    return function () { if (shotUrl) URL.revokeObjectURL(shotUrl) }
  }, [shotUrl])

  function takeShot() {
    var video = videoRef.current
    if (!video || !video.videoWidth) return
    var canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob(function (blob) {
      if (!blob) return
      setShotBlob(blob)
      setShotUrl(URL.createObjectURL(blob))
    }, 'image/jpeg', 0.9)
  }

  function retake() {
    setShotUrl('')
    setShotBlob(null)
  }

  function confirm() {
    if (!shotBlob) return
    var file = new File([shotBlob], 'camera_' + Date.now() + '.jpg', { type: 'image/jpeg', lastModified: Date.now() })
    onCapture(file)
  }

  return createPortal((
    <div className="fixed inset-0 z-[9998] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white shrink-0">
        <button type="button" onClick={onClose} className="text-sm font-semibold px-2 py-1">Cancel</button>
        <span className="text-sm font-semibold">Take Photo</span>
        <span className="w-12" />
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {error ? (
          <p className="text-white text-sm text-center px-8 leading-relaxed">{error}</p>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted
              className={"max-w-full max-h-full object-contain" + (shotUrl ? " hidden" : "")} />
            {shotUrl && <img src={shotUrl} alt="Captured receipt" className="max-w-full max-h-full object-contain" />}
          </>
        )}
      </div>

      {!error && (
        <div className="flex items-center justify-center gap-6 px-4 py-6 shrink-0">
          {shotUrl ? (
            <>
              <button type="button" onClick={retake}
                className="px-5 py-2.5 rounded-full bg-white/10 text-white text-sm font-semibold border border-white/30">
                Retake
              </button>
              <button type="button" onClick={confirm}
                className="px-6 py-2.5 rounded-full bg-indigo-600 text-white text-sm font-bold">
                Use Photo
              </button>
            </>
          ) : (
            <button type="button" onClick={takeShot} disabled={!ready}
              aria-label="Capture photo"
              className="w-16 h-16 rounded-full bg-white border-4 border-white/40 disabled:opacity-40" />
          )}
        </div>
      )}
    </div>
  ), document.body)
}

export default CameraCapture
