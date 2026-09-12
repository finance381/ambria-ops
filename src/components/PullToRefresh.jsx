import { useEffect, useRef, useState } from 'react'

// Distance (px, after resistance) the user has to pull before release triggers
// a refresh, and the hard cap on how far the indicator can travel.
var PULL_THRESHOLD = 68
var MAX_PULL = 100

// html has `overscroll-behavior-y: none` (src/index.css) to stop Android's
// rubber-band bounce, which as a side effect also kills the browser's native
// pull-to-refresh gesture. This reimplements it — including the point of the
// gesture: actually catching a queued but not-yet-active service worker
// (registerType is 'prompt', so a new SW installs and waits until something
// tells it to skip waiting) instead of just reloading onto the stale cache.
async function refreshAndReload() {
  try {
    var reg = await navigator.serviceWorker.getRegistration()
    if (reg) {
      await reg.update()
      if (reg.installing) {
        await new Promise(function (resolve) {
          var worker = reg.installing
          function onStateChange() {
            if (worker.state === 'installed' || worker.state === 'redundant') {
              worker.removeEventListener('statechange', onStateChange)
              resolve()
            }
          }
          worker.addEventListener('statechange', onStateChange)
          setTimeout(resolve, 3000)
        })
      }
      if (reg.waiting) {
        await new Promise(function (resolve) {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          setTimeout(resolve, 2500)
        })
      }
    }
  } catch (_) {}
  window.location.reload()
}

function PullToRefresh() {
  var [pull, setPull] = useState(0)
  var [refreshing, setRefreshing] = useState(false)
  // Mutable tracking state lives in a ref so touchmove (which fires dozens of
  // times a gesture) doesn't tear down and reattach the window listeners on
  // every frame — only the derived pixel offset goes through setState/render.
  var trackRef = useRef({ startY: null, pulling: false, pull: 0 })

  useEffect(function () {
    var t = trackRef.current

    function onTouchStart(e) {
      if (refreshing || e.touches.length !== 1 || window.scrollY > 0) {
        t.startY = null
        return
      }
      t.startY = e.touches[0].clientY
      t.pulling = false
    }

    function onTouchMove(e) {
      if (refreshing || t.startY == null) return
      var dy = e.touches[0].clientY - t.startY
      if (dy <= 0 || window.scrollY > 0) {
        if (t.pull !== 0) { t.pull = 0; setPull(0) }
        t.pulling = false
        return
      }
      t.pulling = true
      // Elastic resistance so the last few pixels of pull get progressively harder.
      var eased = Math.min(MAX_PULL, dy * 0.45)
      t.pull = eased
      setPull(eased)
    }

    function onTouchEnd() {
      t.startY = null
      if (!t.pulling) return
      t.pulling = false
      if (t.pull >= PULL_THRESHOLD) {
        t.pull = 0
        setRefreshing(true)
        refreshAndReload()
      } else {
        t.pull = 0
        setPull(0)
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return function () {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [refreshing])

  if (pull <= 0 && !refreshing) return null

  var progress = Math.min(1, pull / PULL_THRESHOLD)

  return (
    <div className="fixed top-0 left-0 right-0 z-[9998] flex justify-center pointer-events-none">
      <div
        className="mt-2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center"
        style={{
          transform: 'translateY(' + (refreshing ? 8 : pull * 0.6) + 'px)',
          opacity: refreshing ? 1 : progress,
          transition: refreshing ? 'transform 150ms ease-out' : (pull === 0 ? 'transform 200ms ease-out, opacity 200ms ease-out' : 'none'),
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          className={refreshing ? 'animate-spin' : ''}
          style={refreshing ? undefined : { transform: 'rotate(' + (progress * 360) + 'deg)' }}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="#4338CA" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}

export default PullToRefresh
