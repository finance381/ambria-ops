// Back navigation handler for mobile SPA
// Push a handler when entering a sub-view, popstate calls the deepest handler first

var stack = []
var ignoreNext = false

window.addEventListener('popstate', function () {
  if (ignoreNext) { ignoreNext = false; return }
  if (stack.length > 0) {
    var fn = stack.pop()
    fn()
  }
})

// Call when navigating deeper (detail, form, module)
// fn = what to do when user swipes back
export function pushBack(fn) {
  stack.push(fn)
  window.history.pushState({ d: stack.length }, '')
}

// Several steps back at once — a "Change date" that leaves an event and its
// day together. Each handler runs, deepest first, and history rewinds by the
// same count in one go, so no step is left behind to swallow a later back
// press. history.go fires a single popstate however far it travels, which is
// the one ignoreNext covers.
export function unwind(n) {
  var fns = []
  while (n > 0 && stack.length > 0) { fns.push(stack.pop()); n-- }
  if (fns.length === 0) return
  ignoreNext = true
  window.history.go(-fns.length)
  fns.forEach(function (fn) { fn() })
}

// Call when programmatically going back (← Back button click)
// Removes handler + goes back in history without triggering the handler
export function goBack() {
  if (stack.length > 0) {
    var fn = stack.pop()
    ignoreNext = true
    window.history.back()
    fn()
  }
}

// For a view that was pushed on open and can also close some other way (a
// modal's Save succeeding, a parent re-rendering it shut) rather than only
// through goBack()/the back gesture — call from that effect's cleanup so the
// entry doesn't sit on the stack as a stale handler. If a real back press
// already popped it (stack.lastIndexOf returns -1), this is a no-op; if it's
// still there, it's spliced out and its now-orphaned history entry is walked
// back off the stack so a later, unrelated back press doesn't silently
// consume it instead of actually going back.
export function popBack(fn) {
  var i = stack.lastIndexOf(fn)
  if (i === -1) return
  stack.splice(i, 1)
  if (i === stack.length) {
    ignoreNext = true
    window.history.back()
  }
}
