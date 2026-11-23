import { env } from './config/env.ts';
import { logger } from './lib/logger.ts';
import { createApp } from './app.ts';
import { closeDb, getDb } from './db/connection.ts';
import { purgeExpiredTokens } from './db/sessions.ts';
import { startScheduler, stopScheduler } from './services/scheduler.ts';

// Tarih hesaplari (vade, ay sonu) surec saat dilimine bagli oldugu icin
// TZ'yi acilista sabitleriz.
process.env.TZ = env.TZ;

// Migration'lar burada, istekler gelmeye baslamadan once calisir.
getDb();

// Suresi coktan dolmus refresh token kayitlarini temizle.
const purged = purgeExpiredTokens();
if (purged > 0)
  logger.info({ event: 'tokens_purged', purged }, 'suresi dolmus oturum kayitlari temizlendi');

const app = createApp();

// Vadesi yaklasan planlanan odeme/taksit/fatura taramasi
startScheduler();

const server = app.listen(env.PORT, () => {
  logger.info(
    { event: 'server_started', port: env.PORT, nodeEnv: env.NODE_ENV, tz: env.TZ },
    'sunucu dinlemede',
  );
  logger.info({ event: 'data_dir', dataDir: env.DATA_DIR }, 'veri dizini');
});

function shutdown(signal: string): void {
  logger.info({ event: 'shutdown', signal }, 'kapatma sinyali alindi');
  stopScheduler();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Acik baglantilar kapanmazsa zorla cik
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
