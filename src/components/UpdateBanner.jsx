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
    <div className={"fixed bottom-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-auto sm:max-w-sm z-[9999] rounded-2xl text-white text-sm shadow-xl px-4 py-3 " +
      (urgent ? "bg-red-700" : "bg-gray-900")}>
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium leading-snug">{urgent ? 'Auto-update in ' + timeStr : 'A new version is available.'}</span>
        {!urgent && (
          <button onClick={handleDismiss}
            aria-label="Dismiss"
            className="shrink-0 -mt-1 -mr-1 text-gray-400 hover:text-white text-lg leading-none px-1">×</button>
        )}
      </div>
      <div className={"flex items-center gap-3 mt-2.5 " + (urgent ? "justify-end" : "justify-between")}>
        {!urgent && <span className="text-xs text-gray-400 whitespace-nowrap">Auto in {timeStr}</span>}
        <button onClick={handleUpdate}
          className="shrink-0 rounded-full bg-indigo-500 hover:bg-indigo-400 px-3.5 py-1.5 font-semibold transition whitespace-nowrap">
          Update now
        </button>
      </div>
    </div>
  )
}

export default UpdateBanner