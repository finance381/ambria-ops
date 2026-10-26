import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper from 'react-easy-crop'
import Icon from './Icon'

// Crops to the pixel rectangle react-easy-crop reports (image-space, already
// accounting for its own pan/zoom) by drawing just that rectangle onto a
// fresh canvas at its own size — this is the standard react-easy-crop output
// recipe, not anything specific to receipts.
function cropToBlob(imageUrl, area) {
  return new Promise(function (resolve, reject) {
    var img = new Image()
    img.onload = function () {
      var canvas = document.createElement('canvas')
      canvas.width = Math.round(area.width)
      canvas.height = Math.round(area.height)
      canvas.getContext('2d').drawImage(
        img, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height
      )
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob); else reject(new Error('Crop failed'))
      }, 'image/jpeg', 0.92)
    }
    img.onerror = function () { reject(new Error('Could not load image')) }
    img.src = imageUrl
  })
}

// Full-screen crop step shared by the camera's review screen (crop what was
// just shot) and the receipt gallery (crop something already attached).
// Aspect is pinned to the source photo's own shape rather than a fixed
// ratio — zoom and drag trim the unwanted border/background around a
// receipt without forcing it into a square or any other shape it wasn't.
function ImageCropper({ imageUrl, onDone, onCancel }) {
  var [crop, setCrop] = useState({ x: 0, y: 0 })
  var [zoom, setZoom] = useState(1)
  var [aspect, setAspect] = useState(4 / 3)
  var [areaPixels, setAreaPixels] = useState(null)
  var [saving, setSaving] = useState(false)
  var [error, setError] = useState('')

  var onCropComplete = useCallback(function (_area, pixels) { setAreaPixels(pixels) }, [])
  function onMediaLoaded(mediaSize) {
    if (mediaSize && mediaSize.naturalWidth && mediaSize.naturalHeight) {
      setAspect(mediaSize.naturalWidth / mediaSize.naturalHeight)
    }
  }

  async function confirm() {
    if (!areaPixels || saving) return
    setSaving(true); setError('')
    try {
      var blob = await cropToBlob(imageUrl, areaPixels)
      onDone(blob)
    } catch (e) {
      setError('Could not crop that image — try again.')
      setSaving(false)
    }
  }

  return createPortal((
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col" onClick={function (ev) { ev.stopPropagation() }}>
      <div className="relative flex-1 min-h-0">
        <Cropper image={imageUrl} crop={crop} zoom={zoom} aspect={aspect}
          onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete}
          onMediaLoaded={onMediaLoaded} objectFit="contain"
          style={{ containerStyle: { background: '#000' } }} />
      </div>

      <div className="relative z-10 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-black">
        {error && <p className="text-rose-400 text-[12px] text-center mb-2">{error}</p>}
        <div className="flex items-center gap-3 mb-3">
          <Icon name="gallery" size={15} className="text-white/60 shrink-0" />
          <input type="range" min={1} max={4} step={0.01} value={zoom} aria-label="Zoom"
            onChange={function (e) { setZoom(Number(e.target.value)) }}
            className="w-full accent-indigo-500" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onCancel}
            className="h-11 px-5 rounded-full bg-white/15 backdrop-blur text-white text-sm font-semibold border border-white/40">
            Cancel
          </button>
          <span className="text-white/60 text-[11.5px]">Drag to reposition · pinch or slide to zoom</span>
          <button type="button" onClick={confirm} disabled={saving || !areaPixels}
            className="h-11 px-6 rounded-full bg-indigo-600 text-white text-sm font-bold shadow-lg disabled:opacity-50">
            {saving ? 'Saving...' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}

export default ImageCropper
