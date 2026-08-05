import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

var SOFT_MAX_MS = 4 * 60 * 60 * 1000  // 4 hours

function UpdateBanner() {
  var swState = useRegisterSW({
    onRegisterError: function (err) {
      try { console.warn('SW registration failed', err) } catch (_) {}
    }
  })
  var needRefresh = swState.needRefresh[0]
  var setNeedRefresh = swState.needRefresh[1]
  var updateServiceWorker = swState.updateServiceWorker

  var [deadlineTs, setDeadlineTs] = useState(0)
  var [now, setNow] = useState(Date.now())
  var forcedRef = useRef(false)

  // Start the 4h clock when the banner first appears
  useEffect(function () {
    if (needRefresh && deadlineTs === 0) {
      setDeadlineTs(Date.now() + SOFT_MAX_MS)
    }
    if (!needRefresh) {
      setDeadlineTs(0)
      forcedRef.current = false
    }
  }, [needRefresh])

  // Tick every 30s to update countdown + check for force
  useEffect(function () {
    if (!needRefresh || deadlineTs === 0) return
    function tick() {
      var t = Date.now()
      setNow(t)
      if (t >= deadlineTs && !forcedRef.current) {
        forcedRef.current = true
        try { updateServiceWorker(true) } catch (_) { window.location.reload() }
      }
    }
    tick()
    var id = setInterval(tick, 30000)
    return function () { clearInterval(id) }
  }, [needRefresh, deadlineTs])

  function handleUpdate() {
    updateServiceWorker(true)
  }

  function handleDismiss() {
    setNeedRefresh(false)
  }

  if (!needRefresh) return null

  var remainMs = Math.max(0, deadlineTs - now)
  var totalMin = Math.floor(remainMs / 60000)
  var h = Math.floor(totalMin / 60)
  var m = totalMin % 60
  var timeStr = h > 0 ? (h + 'h ' + m + 'm') : (m + 'm')
  var urgent = remainMs < 10 * 60 * 1000  // last 10 minutes

  return (
    <div className={"fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-full text-white text-sm px-4 py-2 shadow-xl " +
      (urgent ? "bg-red-700" : "bg-gray-900")}>
      <span>{urgent ? 'Auto-update in ' + timeStr : 'A new version is available.'}</span>
      {!urgent && <span className="text-xs text-gray-400">Auto in {timeStr}</span>}
      <button onClick={handleUpdate}
        className="rounded-full bg-indigo-500 hover:bg-indigo-400 px-3 py-1 font-semibold transition">
        Update now
      </button>
      {!urgent && (
        <button onClick={handleDismiss}
          aria-label="Dismiss"
          className="text-gray-400 hover:text-white text-lg leading-none px-1">×</button>
      )}
    </div>
  )
}

export default UpdateBanner