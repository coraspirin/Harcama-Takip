import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
