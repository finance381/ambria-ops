// Every mic session (useVoice.js, SearchDropdown.jsx's own inline
// recognizer) registers its stop function here while listening. Submitting a
// form calls stopAllVoice() first, so a user who forgot to tap the mic off
// before hitting Submit doesn't leave it listening in the background.
var activeStops = new Set()

export function registerVoiceStop(stopFn) {
  activeStops.add(stopFn)
  return function unregister() { activeStops.delete(stopFn) }
}

export function stopAllVoice() {
  activeStops.forEach(function (stopFn) { try { stopFn() } catch (_) {} })
  activeStops.clear()
}
