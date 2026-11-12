import { useEffect } from 'react'
import { pushBack, popBack } from './backNav'

// Registers an open modal/dialog with the app's existing back-gesture stack
// (lib/backNav, already used by ImageLightbox and every page-level
// drill-down) so a phone's back press closes just it instead of either doing
// nothing or unwinding the SPA behind it. A second, independent
// pushState/popstate pair here — rather than reusing that one shared stack —
// would each treat a single physical back press as "my own top entry was
// just removed", closing two things on one press.
//
// The removal on close waits a tick. React's StrictMode (npm run dev) runs
// every effect twice — open, close, open — and an immediate popBack there
// fired a history.back() that landed after the second pushBack, leaving the
// history one step short; the next close then walked back out of the screen
// behind the modal. A removal still pending when the same modal re-opens is
// simply cancelled, so the entry pushed the first time is the one kept.
var pendingPops = new Map()

export function useBackButtonClose(open, onClose) {
  useEffect(function () {
    if (!open) return
    if (pendingPops.has(onClose)) {
      clearTimeout(pendingPops.get(onClose))
      pendingPops.delete(onClose)
    } else {
      pushBack(onClose)
    }
    return function () {
      pendingPops.set(onClose, setTimeout(function () {
        pendingPops.delete(onClose)
        popBack(onClose)
      }, 0))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}
