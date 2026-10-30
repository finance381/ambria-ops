import { useState } from 'react'
import { createPortal } from 'react-dom'

// A small receipt/proof thumbnail that blows up to a large preview on
// hover, following the cursor, instead of needing a click (and a second
// close action) just to check what a tiny 36px square actually shows.
function HoverZoomThumb({ url, alt, onClick, className }) {
  var [hoverPos, setHoverPos] = useState(null) // {x, y, size} (viewport coords) or null
  var MARGIN = 16

  function place(ev) {
    var x = ev.clientX, y = ev.clientY
    // Capped to the viewport itself (minus margins) — 960 doesn't fit a
    // short laptop window, and this still beats squinting at a 40px thumb.
    var size = Math.min(960, window.innerWidth - MARGIN * 2, window.innerHeight - MARGIN * 2)
    // Flip to the cursor's left once the preview would run off the right
    // edge, and clamp vertically so it never opens above/below the viewport.
    var left = (x + MARGIN + size > window.innerWidth) ? (x - MARGIN - size) : (x + MARGIN)
    var top = Math.min(Math.max(y - size / 2, MARGIN), window.innerHeight - size - MARGIN)
    setHoverPos({ x: left, y: top, size: size })
  }

  return (
    <>
      <img src={url} alt={alt || 'Receipt'} onClick={onClick}
        onMouseEnter={place} onMouseMove={place} onMouseLeave={function () { setHoverPos(null) }}
        className={className} />
      {hoverPos && createPortal((
        <div className="fixed z-[9999] pointer-events-none" style={{ top: hoverPos.y, left: hoverPos.x }}>
          <img src={url} alt="" style={{ width: hoverPos.size, height: hoverPos.size }}
            className="object-contain rounded-xl border-2 border-white shadow-2xl bg-white" />
        </div>
      ), document.body)}
    </>
  )
}

export default HoverZoomThumb
