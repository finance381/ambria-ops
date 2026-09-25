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
