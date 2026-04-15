import { useState, useRef, useEffect } from 'react'

function ImageCrop({ imageSrc, onCrop, onUseFull, onCancel }) {
  var canvasRef = useRef(null)
  var containerRef = useRef(null)
  var [crop, setCrop] = useState({ x: 50, y: 50, w: 200, h: 200 })
  var [dragging, setDragging] = useState(null)
  var [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  var startPos = useRef({ x: 0, y: 0, crop: null })

  useEffect(function () {
    var img = new Image()
    img.onload = function () {
      var container = containerRef.current
      if (!container) return
      var maxW = container.clientWidth
      var maxH = 400
      var scale = Math.min(maxW / img.width, maxH / img.height, 1)
      var w = img.width * scale
      var h = img.height * scale
      setImgSize({ w: w, h: h, naturalW: img.width, naturalH: img.height, scale: scale })
      setCrop({ x: w * 0.1, y: h * 0.1, w: w * 0.8, h: h * 0.8 })
    }
    img.src = imageSrc
  }, [imageSrc])

  function handleMouseDown(e, type) {
    e.preventDefault()
    var rect = containerRef.current.getBoundingClientRect()
    startPos.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      crop: { ...crop }
    }
    setDragging(type)
  }

  function handleTouchStart(e, type) {
    var touch = e.touches[0]
    var rect = containerRef.current.getBoundingClientRect()
    startPos.current = {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
      crop: { ...crop }
    }
    setDragging(type)
  }

  useEffect(function () {
    if (!dragging) return

    function getPos(e) {
      var rect = containerRef.current.getBoundingClientRect()
      if (e.touches) {
        return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
      }
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    function handleMove(e) {
      var pos = getPos(e)
      var dx = pos.x - startPos.current.x
      var dy = pos.y - startPos.current.y
      var sc = startPos.current.crop

      if (dragging === 'move') {
        var newX = Math.max(0, Math.min(imgSize.w - sc.w, sc.x + dx))
        var newY = Math.max(0, Math.min(imgSize.h - sc.h, sc.y + dy))
        setCrop({ x: newX, y: newY, w: sc.w, h: sc.h })
      } else if (dragging === 'resize') {
        var newW = Math.max(40, Math.min(imgSize.w - sc.x, sc.w + dx))
        var newH = Math.max(40, Math.min(imgSize.h - sc.y, sc.h + dy))
        setCrop({ x: sc.x, y: sc.y, w: newW, h: newH })
      }
    }

    function handleUp() {
      setDragging(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('touchmove', handleMove)
    window.addEventListener('touchend', handleUp)
    return function () {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('touchend', handleUp)
    }
  }, [dragging, imgSize])

  function doCrop() {
    var canvas = document.createElement('canvas')
    var scale = imgSize.scale
    canvas.width = crop.w / scale
    canvas.height = crop.h / scale
    var ctx = canvas.getContext('2d')
    var img = new Image()
    img.onload = function () {
      ctx.drawImage(
        img,
        crop.x / scale, crop.y / scale, crop.w / scale, crop.h / scale,
        0, 0, canvas.width, canvas.height
      )
      onCrop(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = imageSrc
  }

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative bg-black rounded-lg overflow-hidden select-none"
        style={{ height: imgSize.h || 300 }}
      >
        {/* Source image */}
        <img
          src={imageSrc}
          alt="Crop source"
          style={{ width: imgSize.w, height: imgSize.h }}
          className="block"
          draggable="false"
        />

        {/* Dark overlay with crop window cut out */}
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
          {/* Top */}
          <div className="absolute bg-black/60" style={{ top: 0, left: 0, right: 0, height: crop.y }} />
          {/* Bottom */}
          <div className="absolute bg-black/60" style={{ top: crop.y + crop.h, left: 0, right: 0, bottom: 0 }} />
          {/* Left */}
          <div className="absolute bg-black/60" style={{ top: crop.y, left: 0, width: crop.x, height: crop.h }} />
          {/* Right */}
          <div className="absolute bg-black/60" style={{ top: crop.y, left: crop.x + crop.w, right: 0, height: crop.h }} />
        </div>

        {/* Crop rectangle (draggable) */}
        <div
          className="absolute border-2 border-white cursor-move"
          style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
          onMouseDown={function (e) { handleMouseDown(e, 'move') }}
          onTouchStart={function (e) { handleTouchStart(e, 'move') }}
        >
          {/* Resize handle */}
          <div
            className="absolute bottom-0 right-0 w-5 h-5 bg-white rounded-tl cursor-se-resize"
            onMouseDown={function (e) { e.stopPropagation(); handleMouseDown(e, 'resize') }}
            onTouchStart={function (e) { e.stopPropagation(); handleTouchStart(e, 'resize') }}
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={function () { onUseFull(imageSrc) }}
          className="px-3 py-1.5 text-sm text-indigo-600 bg-indigo-50 rounded-md hover:bg-indigo-100 transition-colors"
        >
          Use Full
        </button>
        <button
          type="button"
          onClick={doCrop}
          className="px-3 py-1.5 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
        >
          ✂️ Crop & Use
        </button>
      </div>
    </div>
  )
}

export default ImageCrop