import { Router } from 'express';
import { getDb } from '../db/connection.ts';
import { logger } from '../lib/logger.ts';
import { getLastScan } from '../services/scanStatus.ts';

/** Veritabanina dokunur; erisilemezse firlatir. */
function defaultCheckDb(): void {
  const row = getDb().prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
  if (row?.ok !== 1) throw new Error('SELECT 1 beklenen sonucu vermedi');
}

/**
 * Kimlik dogrulamasiz ve herkese aciktir; bu yuzden yanitta sayac, hata
 * mesaji veya kullanici bilgisi YOKTUR. Ayrintilar loglardadir.
 *
 * Durum kodu karari:
 * - DB hatasi -> 503: Docker HEALTHCHECK container'i unhealthy sayar.
 * - Son tarama basarisiz -> 200 + status 'degraded': container'i yeniden
 *   baslatmak taramayi duzeltmez, yalnizca izleme araclari durumu gorur.
 */
export function createHealthRouter(checkDb: () => void = defaultCheckDb): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    let db: 'ok' | 'error' = 'ok';
    try {
      checkDb();
    } catch (err) {
      db = 'error';
      logger.error({ event: 'health_db', err }, 'health check: veritabani erisilemiyor');
    }

    const last = getLastScan();
    const scanFailed = last !== null && !last.ok;

    res.status(db === 'ok' ? 200 : 503).json({
      status: db === 'ok' && !scanFailed ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      db,
      scheduler: {
        lastScanAt: last?.at ?? null,
        lastScanOk: last?.ok ?? null,
        lastScanDurationMs: last?.durationMs ?? null,
      },
    });
  });

  return router;
}

export const healthRouter: Router = createHealthRouter();
