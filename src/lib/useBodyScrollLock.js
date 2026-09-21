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
export function useBodyScrollLock(locked) {
  useEffect(function () {
    if (!locked) return
    var previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return function () { document.body.style.overflow = previous }
  }, [locked])
}

export default useBodyScrollLock
