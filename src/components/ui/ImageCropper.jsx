import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'

// Full-screen crop step shared by the camera's review screen (crop what was
// just shot) and the receipt gallery (crop something already attached).
// The image stays put at its own size — a draggable, resizable selection box
// sits over it, same as every other crop tool (Photos, Google Photos, etc.).
// react-easy-crop's pan/zoom-the-image-inside-a-fixed-window model was tried
// first and looked and felt wrong for this — nobody expects to have to zoom
// and reposition the photo itself just to trim its edges.
function ImageCropper({ imageUrl, onDone, onCancel }) {
  var imgRef = useRef(null)
  var [crop, setCrop] = useState()
  var [completedCrop, setCompletedCrop] = useState(null)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  // Starts the box at 90% of the image, centered, rather than the full frame
  // — leaves the resize handles reachable at the edges immediately instead
  // of making the first interaction "shrink it off the edge to grab a handle".
  function onImageLoad(e) {
    var w = e.currentTarget.width, h = e.currentTarget.height
    setCrop(centerCrop(makeAspectCrop({ unit: '%', width: 90 }, w / h, w, h), w, h))
  }

  async function confirm() {
    if (!completedCrop || !imgRef.current || saving) return
    if (completedCrop.width < 1 || completedCrop.height < 1) return
    setSaving(true); setError('')
    try {
      // Not react-image-crop's own cropToCanvas helper: it sizes the output
      // canvas as crop size × (naturalSize/displaySize) × devicePixelRatio —
      // on a phone photo (often 3000-4000px+ per side already) shown small
      // on screen, that extra devicePixelRatio multiplier (2-3x on most
      // phones) pushed the canvas well past what mobile browsers reliably
      // allocate, which get silently clamped/truncated rather than erroring
      // — the crop came out covering a smaller area than what was actually
      // selected. This draws at the image's own natural resolution only, no
      // extra multiplier, same approach as the older ImageCrop.jsx.
      var img = imgRef.current
      var scaleX = img.naturalWidth / img.width
      var scaleY = img.naturalHeight / img.height
      var canvas = document.createElement('canvas')
      canvas.width = Math.round(completedCrop.width * scaleX)
      canvas.height = Math.round(completedCrop.height * scaleY)
      var ctx = canvas.getContext('2d')
      ctx.drawImage(
        img,
        completedCrop.x * scaleX, completedCrop.y * scaleY, completedCrop.width * scaleX, completedCrop.height * scaleY,
        0, 0, canvas.width, canvas.height
      )
      canvas.toBlob(function (blob) {
        if (!blob) { setError('Could not crop that image — try again.'); setSaving(false); return }
        onDone(blob)
      }, 'image/jpeg', 0.92)
    } catch (e) {
      setError('Could not crop that image — try again.')
      setSaving(false)
    }
  }

  return createPortal((
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col" onClick={function (ev) { ev.stopPropagation() }}>
      <div className="flex-1 min-h-0 flex items-center justify-center p-3 overflow-hidden">
        <ReactCrop crop={crop} onChange={function (_px, pct) { setCrop(pct) }} onComplete={setCompletedCrop}
          className="max-h-full">
          <img ref={imgRef} src={imageUrl} alt="Crop" onLoad={onImageLoad}
            className="max-h-[calc(100dvh-10rem)] max-w-full object-contain" />
        </ReactCrop>
      </div>

      <div className="relative z-10 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-black">
        {error && <p className="text-rose-400 text-[12px] text-center mb-2">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onCancel}
            className="h-11 px-5 rounded-full bg-white/15 backdrop-blur text-white text-sm font-semibold border border-white/40">
            Cancel
          </button>
          <span className="text-white/60 text-[11.5px] hidden sm:inline">Drag the corners to resize, drag inside to move</span>
          <button type="button" onClick={confirm} disabled={saving || !completedCrop}
            className="h-11 px-6 rounded-full bg-indigo-600 text-white text-sm font-bold shadow-lg disabled:opacity-50">
            {saving ? 'Saving...' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}

export default ImageCropper
