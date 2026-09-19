# Pull-to-Refresh in a PWA — The Logic

This explains the *logic* behind "pull down to get the latest build": why a
plain reload isn't enough on its own, why the gesture has to be built by hand
on iOS, and how the two pieces (service worker + touch gesture) fit together.
Reusable in any Vite/CRA/webpack PWA — see the code at the bottom.

---

## The one core idea

> **Pull-to-refresh is just "reload the page." Getting the *latest* build on
> reload is a separate problem, solved entirely by the service worker's
> caching strategy — not by the gesture.**

If your service worker serves a stale cached shell on every navigation, pull-
to-refresh will faithfully reload... the same stale page. Fix the caching
strategy first; the gesture is the easy 20% on top.

---

## Why the gesture has to be hand-built at all

Two unrelated gaps stack on top of each other:

1. **A normal browser tab already reloads on pull-down** on Android Chrome.
   iOS Safari never had this gesture, in a tab or otherwise — pulling down
   just rubber-bands and does nothing.
2. **An installed PWA (Home Screen icon, `display: standalone`) has no
   browser chrome at all** — no address bar, no native reload affordance, on
   *any* platform. There is nothing to pull down *into*.

So: Android tab → fine without any of this. iOS Safari tab → missing the
gesture. Any installed/standalone PWA → missing the gesture **and** the UI
to trigger a reload manually. The fix has to be inside the app itself,
which is why it's a touch-event component, not a platform setting.

---

## The two pieces, and which one actually matters

```
User pulls down at the top of the page
        │
        ▼
1. Touch gesture detects the pull → shows a spinner → triggers reload
        │
        ▼
2. Browser re-requests the page
        │
        ▼
3. Service worker's fetch handler decides what "the page" even means
   ├── network-first  → fetches the real latest HTML  ✅ gets new build
   └── cache-first     → hands back whatever was cached  ❌ stale forever
```

Step 1 is cosmetic. **Step 3 is the part that determines whether this
feature does anything.** A pull-to-refresh gesture wired to a service worker
using cache-first (or no network fallback logic) will spin, "refresh," and
show the exact same stale content every time.

### The caching rule that makes this work

- **Navigation requests** (`e.request.mode === 'navigate'`, i.e. loading the
  HTML shell) → **network-first**: try the network, fall back to cache only
  if offline. This is what guarantees a reload sees the *current* deploy.
- **Hashed static assets** (`app.a1b2c3.js`, `style.9f8e7d.css` — filename
  changes every build because bundlers content-hash them) → safe to serve
  **stale-while-revalidate** or even cache-first, because a new build means
  a *new filename*, which is automatically a cache miss. You never need to
  invalidate these by hand.
- Anything that talks to your backend/API → **never cache**, always network.

If your app's `sw.js` already follows this split, a plain `location.reload()`
is sufficient — no `skipWaiting`/`postMessage` version-negotiation dance
required, because the new HTML you just fetched already points at the new
hashed asset names.

---

## The gesture logic (what the component actually does)

```
touchstart  → record starting Y, but only if scrollTop === 0
              (if the page is scrolled down, this is a normal scroll, ignore it)
        │
        ▼
touchmove   → delta = currentY - startY
              if delta > 0 and still at scrollTop 0:
                 preventDefault()           (stop the native rubber-band)
                 pull distance = delta * dampening, capped at MAX
                 show/scale a spinner by that distance
        │
        ▼
touchend    → if pull distance crossed THRESHOLD:
                 show spinner in "spinning" state
                 location.reload()
              else:
                 snap back to 0 (no refresh)
```

Key details that matter in practice:

- **Gate on `scrollTop === 0` at touchstart, re-check on every touchmove.**
  Without this, a normal upward scroll-then-flick anywhere on the page would
  trigger it.
- **`touchmove` must be a non-passive listener** (`{ passive: false }`) —
  `preventDefault()` is a no-op (and throws a console warning) on a passive
  listener, so the native bounce won't actually stop without this.
- **Dampen the distance** (e.g. multiply the raw finger delta by ~0.5) so
  the indicator doesn't fly to max instantly — it should feel like pulling
  against resistance.
- **Single-touch only** (`e.touches.length !== 1`) — ignore pinch/multi-touch
  gestures.
- This only needs to run for **touch** input. No mouse/pointer equivalent is
  expected or needed — desktop users have a real reload button.

---

## Platform logic — where this is and isn't needed

| Context | Native pull-to-refresh? | Needs this component? |
|---|---|---|
| Android Chrome, normal tab | Yes | Redundant but harmless |
| Android Chrome, installed PWA | No | **Yes** |
| iOS Safari, normal tab | No | **Yes** |
| iOS Safari, installed PWA (Home Screen) | No | **Yes** |
| Desktop browsers | N/A (no touch) | No-op — listeners never fire |

Given the last two rows, the simplest correct choice is usually: **always
mount it**, everywhere in the app shell. It's inert without touch input and
redundant-but-harmless where a native gesture already exists.

---

## Things that make it break (and the logic behind each)

1. **Service worker still cache-first on navigation.** The gesture "works"
   (spins, reloads) but nothing changes — because the real bug is the
   caching strategy, not the gesture. Always check this first if a user
   says "I refreshed and it's still old."

2. **`touchmove` registered as passive (or missing `{ passive: false }`).**
   `preventDefault()` silently fails, the OS rubber-bands over your custom
   UI, and the two visuals fight each other.

3. **Not re-checking `scrollTop` inside `touchmove`.** A user can start the
   pull at the top, and content can shift under their finger (e.g. a lazy-
   loaded banner) — recheck on every move, not just at touchstart.

4. **Mounting it inside a nested scroll container** instead of the page/
   document. If your layout scrolls a `<div>` instead of the window, check
   *that* container's `scrollTop`, not `document.scrollingElement`.

5. **Un-hashed build filenames.** If a build doesn't fingerprint JS/CSS
   filenames, stale-while-revalidate can serve an old bundle indefinitely.
   Confirm your bundler does content hashing (Vite/webpack/CRA all do this
   by default) before trusting a plain reload to fix everything.

---

## Summary in one paragraph

Pull-to-refresh is a touch gesture that ends in an ordinary page reload —
the interesting part is not the swipe, it's whether the service worker
treats that reload as **network-first** for the HTML shell (so it actually
fetches the new build) while still caching hashed static assets aggressively
(safe, because new builds get new filenames). Build the gesture as a small
touch-tracking component gated on `scrollTop === 0`, with a non-passive
`touchmove` listener so you can suppress the native bounce, and mount it
once in the app shell — it's inert on desktop and harmless where a native
version already exists.

---

## Reusable code

Drop this into any Vite/CRA/webpack PWA. No dependencies.

```jsx
// PullToRefresh.jsx
import { useEffect, useRef, useState } from 'react'

var THRESHOLD = 64   // px of pull before a release triggers reload
var MAX_PULL = 100    // px cap on how far the indicator travels

export default function PullToRefresh({ children }) {
  var [pullDistance, setPullDistance] = useState(0)
  var [refreshing, setRefreshing] = useState(false)
  var [dragging, setDragging] = useState(false)
  var startY = useRef(0)
  var tracking = useRef(false)

  useEffect(function () {
    function atTop() {
      return (document.scrollingElement || document.documentElement).scrollTop <= 0
    }

    function onTouchStart(e) {
      if (refreshing || e.touches.length !== 1 || !atTop()) return
      startY.current = e.touches[0].clientY
      tracking.current = true
      setDragging(true)
    }

    function onTouchMove(e) {
      if (!tracking.current || refreshing) return
      var delta = e.touches[0].clientY - startY.current
      if (delta <= 0 || !atTop()) {
        tracking.current = false
        setDragging(false)
        setPullDistance(0)
        return
      }
      setPullDistance(Math.min(delta * 0.5, MAX_PULL))
      e.preventDefault()
    }

    function onTouchEnd() {
      if (!tracking.current) return
      tracking.current = false
      setDragging(false)
      if (pullDistance >= THRESHOLD) {
        setRefreshing(true)
        setPullDistance(40)
        window.location.reload()
      } else {
        setPullDistance(0)
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return function () {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [pullDistance, refreshing])

  var showSpinner = pullDistance > 0 || refreshing
  var armed = refreshing || pullDistance >= THRESHOLD

  return (
    <div>
      <div
        style={{
          height: pullDistance,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: dragging ? 'none' : 'height 200ms ease-out'
        }}
      >
        {showSpinner && (
          <div
            style={{
              width: 20, height: 20, borderRadius: '9999px',
              border: '2px solid #64748b',
              borderTopColor: 'transparent',
              animation: armed ? 'ptr-spin 0.6s linear infinite' : 'none',
              transform: armed ? undefined : 'rotate(' + Math.min(pullDistance * 3, 300) + 'deg)'
            }}
          />
        )}
      </div>
      {children}
    </div>
  )
}
```

```css
/* add once, globally */
@keyframes ptr-spin {
  to { transform: rotate(360deg); }
}
```

Mount it once, wrapping your app's routed content (below any fixed header,
above any fixed bottom nav):

```jsx
<main>
  <PullToRefresh>
    <Outlet /> {/* or your router's page content */}
  </PullToRefresh>
</main>
```

### The service worker half (`sw.js`)

The gesture is inert without this. Minimum viable strategy:

```js
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url)
  if (url.origin !== self.location.origin) return // never touch API/backend calls

  if (e.request.mode === 'navigate') {
    // network-first: always try to get the real latest HTML
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match(e.request) // offline fallback only
      })
    )
    return
  }

  if (/\.(js|css|png|jpg|jpeg|svg|woff2?|json)$/.test(url.pathname)) {
    // stale-while-revalidate: safe because bundlers content-hash filenames
    e.respondWith(
      caches.open('v1').then(function (cache) {
        return cache.match(e.request).then(function (cached) {
          var fetchPromise = fetch(e.request).then(function (res) {
            if (res && res.status === 200) cache.put(e.request, res.clone())
            return res
          })
          return cached || fetchPromise
        })
      })
    )
  }
})
```
