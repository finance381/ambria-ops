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
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
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
    // Some phones report the camera's full sensor resolution here (4000x3000
    // or more) regardless of the ideal constraint above. A canvas that big
    // fails to allocate on lower-memory devices with a "low memory" error —
    // it's a RAM/heap limit, not the phone's free storage. Capping the long
    // edge at 1600px (matching imageCompress.js's own cap for gallery photos)
    // keeps every capture well inside what any device can allocate.
    var maxDim = 1600
    var scale = Math.min(maxDim / video.videoWidth, maxDim / video.videoHeight, 1)
    var canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
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
