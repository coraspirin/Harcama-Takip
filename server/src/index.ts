import { env } from './config/env.ts';
import { createApp } from './app.ts';
import { closeDb, getDb } from './db/connection.ts';

// Tarih hesaplari (vade, ay sonu) surec saat dilimine bagli oldugu icin
// TZ'yi acilista sabitleriz.
process.env.TZ = env.TZ;

// Migration'lar burada, istekler gelmeye baslamadan once calisir.
getDb();

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[server] http://localhost:${env.PORT} (${env.NODE_ENV}, TZ=${env.TZ})`);
  console.log(`[server] veri dizini: ${env.DATA_DIR}`);
});

function shutdown(signal: string): void {
  console.log(`[server] ${signal} alindi, kapaniyor...`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Acik baglantilar kapanmazsa zorla cik
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
