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
  var frameRef = useRef(null)
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
          // autoplay alone doesn't reliably start a stream assigned to
          // srcObject after mount on every mobile browser — an explicit
          // play() is the standard fix, and a rejected promise here (e.g.
          // a stray autoplay policy) shouldn't surface as an uncaught error.
          var playPromise = videoRef.current.play()
          if (playPromise && playPromise.catch) playPromise.catch(function () {})
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
    // The preview fills the screen (object-cover), so a landscape webcam is
    // shown cropped to the screen's portrait shape. The photo is cut to that
    // same window — what you framed is what you get, not the wider picture
    // the camera actually saw.
    var vw = video.videoWidth, vh = video.videoHeight
    var frame = frameRef.current
    var fa = frame && frame.clientHeight ? frame.clientWidth / frame.clientHeight : vw / vh
    var sx = 0, sy = 0, sw = vw, sh = vh
    if (vw / vh > fa) { sw = Math.round(vh * fa); sx = Math.round((vw - sw) / 2) }
    else { sh = Math.round(vw / fa); sy = Math.round((vh - sh) / 2) }
    // Some phones report the camera's full sensor resolution here (4000x3000
    // or more) regardless of the ideal constraint above. A canvas that big
    // fails to allocate on lower-memory devices with a "low memory" error —
    // it's a RAM/heap limit, not the phone's free storage. Capping the long
    // edge at 1600px (matching imageCompress.js's own cap for gallery photos)
    // keeps every capture well inside what any device can allocate.
    var maxDim = 1600
    var scale = Math.min(maxDim / sw, maxDim / sh, 1)
    var canvas = document.createElement('canvas')
    canvas.width = Math.round(sw * scale)
    canvas.height = Math.round(sh * scale)
    canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
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
    <div className="fixed inset-0 z-[9998] bg-black flex flex-col"
      // A portal's DOM node sits outside whatever rendered it, but React
      // still bubbles its events up through the component tree — not the
      // DOM tree. Every caller here is a modal with its own backdrop
      // "click outside closes" handler, so without this, pressing the
      // shutter (or Retake/Use Photo/Cancel) bubbled straight through to
      // that handler and closed the modal underneath instead of doing
      // anything in here.
      onClick={function (ev) { ev.stopPropagation() }}>
      {/* The camera fills the screen, portrait, with the controls floating
          over it on soft shades — a webcam's wide picture is cropped to the
          screen rather than shown as a letterboxed strip. */}
      <div ref={frameRef} className="absolute inset-0 overflow-hidden">
        {error ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-white text-sm text-center px-8 leading-relaxed">{error}</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted
              className={"absolute inset-0 w-full h-full object-cover" + (shotUrl ? " hidden" : "")} />
            {shotUrl && <img src={shotUrl} alt="Captured receipt" className="absolute inset-0 w-full h-full object-cover" />}
          </>
        )}
      </div>

      <div className="relative z-10 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-6 text-white bg-gradient-to-b from-black/60 to-transparent">
        <button type="button" onClick={onClose} className="h-9 px-3.5 rounded-full bg-black/35 backdrop-blur text-sm font-semibold">Cancel</button>
        <span className="text-sm font-semibold drop-shadow">{shotUrl ? 'Check the photo' : 'Take Photo'}</span>
        <span className="w-[72px]" />
      </div>

      <div className="flex-1" />

      {!error && (
        <div className="relative z-10 flex items-center justify-center gap-4 px-4 pt-10 pb-[max(1.75rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/70 to-transparent">
          {shotUrl ? (
            <>
              <button type="button" onClick={retake}
                className="h-12 px-6 rounded-full bg-white/15 backdrop-blur text-white text-sm font-semibold border border-white/40">
                Retake
              </button>
              <button type="button" onClick={confirm}
                className="h-12 px-7 rounded-full bg-indigo-600 text-white text-sm font-bold shadow-lg">
                Use Photo
              </button>
            </>
          ) : (
            <button type="button" onClick={takeShot} disabled={!ready}
              aria-label="Capture photo"
              className="w-[72px] h-[72px] rounded-full bg-white ring-4 ring-white/40 ring-offset-4 ring-offset-transparent active:scale-95 transition-transform disabled:opacity-40" />
          )}
        </div>
      )}
    </div>
  ), document.body)
}

export default CameraCapture
