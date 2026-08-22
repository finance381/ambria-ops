import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/ambria-ops/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
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

