import { startTestServer, type TestServer } from '../test/harness.ts';
import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createHealthRouter } from './health.ts';
import { setLastScan } from '../services/scanStatus.ts';

type Health = {
  status: string;
  time: string;
  db: string;
  scheduler: {
    lastScanAt: string | null;
    lastScanOk: boolean | null;
    lastScanDurationMs: number | null;
  };
};

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

afterEach(() => {
  setLastScan(null);
});

const ALLOWED = ['db', 'scheduler', 'status', 'time'];
const ALLOWED_SCHEDULER = ['lastScanAt', 'lastScanDurationMs', 'lastScanOk'];

function assertOnlyAllowedKeys(body: Health): void {
  assert.deepEqual(Object.keys(body).sort(), ALLOWED);
  assert.deepEqual(Object.keys(body.scheduler).sort(), ALLOWED_SCHEDULER);
}

test('henuz tarama yok -> 200, ok, scheduler alanlari null', async () => {
  const res = await server.newClient().get<Health>('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.db, 'ok');
  assert.equal(res.body.scheduler.lastScanAt, null);
  assert.equal(res.body.scheduler.lastScanOk, null);
  assert.equal(res.body.scheduler.lastScanDurationMs, null);
  assertOnlyAllowedKeys(res.body);
});

test('basarili tarama sonrasi alanlar dolar', async () => {
  const at = new Date().toISOString();
  setLastScan({ at, ok: true, durationMs: 42 });
  const res = await server.newClient().get<Health>('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.deepEqual(res.body.scheduler, {
    lastScanAt: at,
    lastScanOk: true,
    lastScanDurationMs: 42,
  });
  assertOnlyAllowedKeys(res.body);
});

test('basarisiz tarama -> 200 ama degraded', async () => {
  setLastScan({ at: new Date().toISOString(), ok: false, durationMs: 7 });
  const res = await server.newClient().get<Health>('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'degraded');
  assert.equal(res.body.db, 'ok');
  assert.equal(res.body.scheduler.lastScanOk, false);
});

test('DB hatasi -> 503, degraded, hata mesaji sizmaz', async () => {
  const app = express();
  app.use(
    '/api/health',
    createHealthRouter(() => {
      throw new Error('GIZLI-DB-YOLU disk I/O error');
    }),
  );
  const srv = app.listen(0);
  try {
    const { port } = srv.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const text = await res.text();
    const body = JSON.parse(text) as Health;
    assert.equal(res.status, 503);
    assert.equal(body.status, 'degraded');
    assert.equal(body.db, 'error');
    assert.ok(!text.includes('GIZLI'));
    assertOnlyAllowedKeys(body);
  } finally {
    srv.close();
  }
});
