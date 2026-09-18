// An ink ripple on every press, fitted to the control that was pressed.
//
// One listener on the document rather than a wrapper round several hundred
// buttons. Everything here already renders real <button> elements, so the DOM
// is the only place that knows the full list — and a component would have had
// to be threaded through every module to reach them.
//
// The ripple is drawn in an overlay of its own, positioned over the control and
// clipped to a copy of its border radius. The obvious implementation — append a
// span inside the button and give it overflow:hidden — would clip whatever the
// button already has hanging outside itself, and this app has plenty: the
// notification counts at -top-2, the "Sent" badge at -top-1 -left-1, the sheen
// on the active nav pill. Nothing is added to the control and nothing about it
// is changed.

var HOSTS = 'button, a[href], [role="button"]'

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

function onPointerDown(e) {
  // Primary button only: a right-click opens a menu, it does not press anything.
  if (e.button != null && e.button !== 0) return

  var host = e.target && e.target.closest ? e.target.closest(HOSTS) : null
  if (!host) return
  if (host.disabled || host.getAttribute('aria-disabled') === 'true') return
  if (host.closest('[data-no-ripple]')) return

  var rect = host.getBoundingClientRect()
  if (!rect.width || !rect.height) return

  var cs = window.getComputedStyle(host)
  var overlay = document.createElement('span')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.style.cssText = [
    'position:fixed',
    'left:' + rect.left + 'px',
    'top:' + rect.top + 'px',
    'width:' + rect.width + 'px',
    'height:' + rect.height + 'px',
    // The control's own corners, so a pill ripples as a pill.
    'border-top-left-radius:' + cs.borderTopLeftRadius,
    'border-top-right-radius:' + cs.borderTopRightRadius,
    'border-bottom-right-radius:' + cs.borderBottomRightRadius,
    'border-bottom-left-radius:' + cs.borderBottomLeftRadius,
    'overflow:hidden',
    'pointer-events:none',
    // Above the sheets and overlays, which sit at 9998.
    'z-index:10000',
  ].join(';')

  // Big enough to reach the furthest corner from wherever it was pressed.
  var x = e.clientX - rect.left
  var y = e.clientY - rect.top
  var far = Math.max(
    Math.hypot(x, y),
    Math.hypot(rect.width - x, y),
    Math.hypot(x, rect.height - y),
    Math.hypot(rect.width - x, rect.height - y)
  )

  // Ink the colour of the text it is under, so it works on a dark pill and a
  // white card without either being told about it.
  var ink = cs.color || 'rgb(15,23,42)'

  var dot = document.createElement('span')
  dot.className = 'ambria-ripple-dot'
  dot.style.cssText = [
    'position:absolute',
    'left:' + (x - far) + 'px',
    'top:' + (y - far) + 'px',
    'width:' + (far * 2) + 'px',
    'height:' + (far * 2) + 'px',
    'border-radius:9999px',
    'background:' + ink,
    'opacity:0.18',
  ].join(';')

  overlay.appendChild(dot)
  document.body.appendChild(overlay)

  var done = false
  function cleanup() {
    if (done) return
    done = true
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
  }
  dot.addEventListener('animationend', cleanup)
  // A press that never finishes animating — the element unmounts under it, the
  // tab is hidden mid-animation — must not leave the overlay on the page.
  setTimeout(cleanup, 900)
}

export function initRipple() {
  if (typeof document === 'undefined') return
  if (prefersReducedMotion()) return
  document.addEventListener('pointerdown', onPointerDown, { passive: true })
}
