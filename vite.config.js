import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The page artwork reaches the browser late.
//
// It is imported by a component, so it lives inside the main chunk as a URL
// string: nothing knows the file exists until half a megabyte of JS has
// downloaded, parsed and rendered. On a phone that is a second or more of bare
// ground before the backdrop arrives.
//
// This puts the URL in the head instead, so the fetch runs alongside the
// bundle rather than behind it. It cannot be written into index.html by hand,
// because the name carries a content hash that only exists after the build —
// hence reading it back off the bundle here.
function preloadPageArt() {
  var base = '/'
  return {
    name: 'preload-page-art',
    apply: 'build',
    enforce: 'post',
    configResolved: function (config) { base = config.base },
    transformIndexHtml: function (html, ctx) {
      var file = Object.keys(ctx.bundle || {}).find(function (f) { return /pc-bg-[^/]*.webp$/.test(f) })
      if (!file) return
      return [{
        tag: 'link',
        attrs: { rel: 'preload', as: 'image', href: base + file, fetchpriority: 'high' },
        injectTo: 'head',
      }]
    },
  }
}

export default defineConfig({
  base: '/ambria-ops/',
  plugins: [
    react(),
    tailwindcss(),
    preloadPageArt(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      // The default glob is js,css,html,ico,png,svg — which quietly left every
      // .webp out, and both page backdrops are webp. They were fetched over the
      // network on a cold load while everything around them came from the
      // cache, which is the one thing a backdrop must not do.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
      },
      manifest: {
          "name": "Ambria Ops",
          "short_name": "Ambria Ops",
            "description": "Internal operations app for Ambria: inventory, events, quotes and finance",
            "start_url": "./",
            "display": "standalone",
            "background_color": "#f5f6f8",
            "theme_color": "#0B0B0D",
            "orientation": "portrait",
            "handle_links": "not-preferred",
            "icons": [
              {
                "src": "favicon.svg",
                "sizes": "any",
                "type": "image/svg+xml",
                "purpose": "any"
              },
              {
                "src": "icon-192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any"
              },
              {
                "src": "icon-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any"
              },
              {
                "src": "icon-192-maskable.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "maskable"
              },
              {
                "src": "icon-512-maskable.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable"
              }
            ]
        }
    })
  ]
})

