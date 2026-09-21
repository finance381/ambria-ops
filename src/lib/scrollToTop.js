// Bring a list's top back into view after its contents have been replaced.
//
// Pressing Next at the bottom of a table leaves you exactly where you were
// standing — which, now that every row under you has changed, is the bottom of
// a page you have not read. Nothing scrolled, so the browser has no reason to
// move; the screen has to say so itself.
export function scrollToTopOf(el) {
  if (!el || typeof el.scrollIntoView !== 'function') return
  var reduce = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
  // On the next frame, so the element has been re-rendered at its new height
  // before anything measures where its top is.
  window.requestAnimationFrame(function () {
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  })
}

export default scrollToTopOf
