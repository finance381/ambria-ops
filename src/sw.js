// Custom service worker (vite-plugin-pwa injectManifest strategy).
// precacheAndRoute reproduces exactly what the old generateSW-auto-generated
// worker did — this line is the entire offline-caching behavior, unchanged.
// Everything below it is new: push notifications, which generateSW had no
// hook to add.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

// Drops the precache of earlier builds once this one is active — generateSW
// did this by default; a custom worker has to ask for it.
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// "Update now" (UpdateBanner -> updateServiceWorker) posts SKIP_WAITING to
// the new worker waiting behind the old one. generateSW's worker listened
// for it; this custom one did not, so the new version sat waiting and the
// button did nothing — it only "worked" once every tab of the app had been
// closed and the waiting worker took over on its own.
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('push', function (event) {
  var data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) {}
  var title = data.title || 'Ambria Ops'
  var options = {
    body: data.body || '',
    icon: '/ambria-ops/icon-192.png',
    badge: '/ambria-ops/icon-192.png',
    data: { link: data.link || '/ambria-ops/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Focuses an already-open tab rather than opening a second one, since this
// is a PWA people keep pinned open — a fresh tab per notification would
// pile up fast.
self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var link = (event.notification.data && event.notification.data.link) || '/ambria-ops/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if ('focus' in clientList[i]) return clientList[i].focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(link)
    })
  )
})
