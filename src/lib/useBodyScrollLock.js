import { useEffect } from 'react'

// Holds the page still while something is open over it.
//
// Two different things make a page move under a dialog, and this handles the
// first: with the body scrollable, a wheel or a drag that misses the panel —
// on the backdrop, or on any part of the dialog that is not itself scrollable
// — scrolls the page behind it. You close the dialog and find yourself
// somewhere else.
//
// The second is scroll chaining: a list inside the dialog reaches its end and
// the browser hands the rest of the gesture to the page. That is not fixed
// here, because it belongs to the scrolling element rather than to the body —
// those panes carry `overscroll-contain`.
//
// The previous value is restored rather than cleared, so a dialog opened from
// inside another one does not unlock the page when only it closes.
//
// The lock goes on <html>, not <body>. index.css gives html an overflow of
// its own (overflow-x: clip), so body's overflow no longer passes up to the
// window: overflow:hidden on body turned body itself into a scroll box, every
// `sticky top-0` inside it (the admin sidebar) began sticking to that box —
// never scrolled — instead of the window, and with the page scrolled down the
// sidebar jumped up out of view behind the dialog. On html the window keeps
// its scroll position and sticky elements stay put.
export function useBodyScrollLock(locked) {
  useEffect(function () {
    if (!locked) return
    var root = document.documentElement
    var previous = root.style.overflow
    root.style.overflow = 'hidden'
    return function () { root.style.overflow = previous }
  }, [locked])
}

export default useBodyScrollLock
