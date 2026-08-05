import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': yeni surum otomatik devreye girmez, kullaniciya sorulur.
      // Otomatik guncelleme, kullanici form doldururken sayfayi yenileyebilir.
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Harcama Takip',
        short_name: 'Harcama',
        description: 'Kisisel gelir ve gider takip uygulamasi',
        lang: 'tr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#4f46e5',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Yalnizca uygulama kabugu (statik dosyalar) onbellege alinir.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // API yanitlari ASLA onbellege alinmaz: bayat bakiye gostermek,
        // hic gostermemekten daha kotudur.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Gelistirmede service worker kapali: onbellek, kod degisikliklerini
        // gizleyip saatler kaybettirir.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    // Gelistirmede de API ayni origin'den gorunsun: httpOnly cookie'ler
    // boylece CORS/SameSite ayari gerektirmeden calisir.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        /**
         * recharts + d3 tek basina paketin yarisindan fazlasi. Ayri parcaya
         * alindiginda giris/kurulum gibi grafiksiz ekranlar onu hic indirmez.
         */
        manualChunks: {
          charts: ['recharts'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
