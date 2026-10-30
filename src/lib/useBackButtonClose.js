import { useEffect } from 'react'
import { pushBack, popBack } from './backNav'

// Registers an open modal/dialog with the app's existing back-gesture stack
// (lib/backNav, already used by ImageLightbox and every page-level
// drill-down) so a phone's back press closes just it instead of either doing
// nothing or unwinding the SPA behind it. A second, independent
// pushState/popstate pair here — rather than reusing that one shared stack —
// would each treat a single physical back press as "my own top entry was
// just removed", closing two things on one press.
export function useBackButtonClose(open, onClose) {
  useEffect(function () {
    if (!open) return
    pushBack(onClose)
    return function () { popBack(onClose) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}
