import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Itineric',
        short_name: 'Itineric',
        description: 'A living, AI-assisted travel direction service.',
        theme_color: '#0F1B2E',
        background_color: '#F7F1E4',
        display: 'standalone',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // The sequence is nearly 60 MB. It is warmed in a bounded browser
        // cache while the user scrolls, rather than forcing every install to
        // precache the whole cinematic asset set.
        globIgnores: ['**/*.webp'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.maptiler\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'maptiler-assets', expiration: { maxEntries: 120, maxAgeSeconds: 86_400 } },
          },
        ],
      },
    }),
  ],
  build: {
    sourcemap: true,
    target: 'es2022',
  },
});
