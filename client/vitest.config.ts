import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Test yapilandirmasi vite.config.ts'ten ayridir: PWA ve Tailwind eklentileri
 * test ortaminda gereksizdir (service worker uretmeye calisir).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Tarih testleri makineden bagimsiz, uretim saat dilimiyle kosar.
    env: { TZ: 'Europe/Istanbul' },
    restoreMocks: true,
  },
});
