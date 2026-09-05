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
