import { Router } from 'express';
import { getDb } from '../db/connection.ts';

export const healthRouter: Router = Router();

healthRouter.get('/', (_req, res) => {
  // Veritabanina da dokunuruz: Docker healthcheck'in "ayakta ama DB bozuk"
  // durumunu saglikli saymamasi icin.
  const row = getDb().prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;

  res.json({
    status: row?.ok === 1 ? 'ok' : 'degraded',
    time: new Date().toISOString(),
  });
});
