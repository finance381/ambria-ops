import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { pushBack, goBack } from '../../lib/backNav'
import Icon from './Icon'

// Viewing a receipt used to mean an <a target="_blank"> straight to the image
// URL — a real navigation. In a standalone PWA that replaces the app's own
// window instead of opening a tab, so the phone's back gesture doesn't just
// close the picture: it unwinds the SPA itself back to its first-load route,
// dropping whatever modal/list state the user was in.
//
// This stays inside the app entirely (no navigation) and registers with the
// app's own back-gesture stack (lib/backNav) the same way every other
// in-app "deeper view" does, so one back step closes just this and lands
// back on whatever was already open behind it.
function ImageLightbox({ url, alt, onClose }) {
  useEffect(function () {
    pushBack(onClose)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(function () {
    function onKey(ev) { if (ev.key === 'Escape') goBack() }
    window.addEventListener('keydown', onKey)
    return function () { window.removeEventListener('keydown', onKey) }
  }, [])

  if (!url) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
      onClick={goBack}>
      <button type="button" onClick={goBack} aria-label="Close"
        className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors">
        <Icon name="close" size={18} />
      </button>
      <img src={url} alt={alt || 'receipt'} onClick={function (ev) { ev.stopPropagation() }}
        className="max-w-full max-h-full object-contain rounded" />
    </div>,
    document.body
  )
}

export default ImageLightbox
