import '../test/env.ts';
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../lib/logger.ts';
import { getLastScan, setLastScan } from './scanStatus.ts';
import { runScheduledScan, type ScanResult } from './scheduler.ts';

const result: ScanResult = {
  notificationsCreated: 2,
  billOccurrencesCreated: 1,
  autoConfirmed: 3,
  insights: { budgetAlerts: 4, anomalyAlerts: 5, closingAlerts: 6 },
};

type Fields = Record<string, unknown>;

afterEach(() => {
  mock.restoreAll();
  setLastScan(null);
});

test('basarili tarama: tek ozet satiri ve ok:true durumu', async () => {
  const info = mock.method(logger, 'info');
  await runScheduledScan({
    scan: () => result,
    purgeTokens: () => 9,
    dispatchHa: () => Promise.resolve(7),
  });

  assert.equal(info.mock.callCount(), 1);
  const [fields, msg] = info.mock.calls[0]?.arguments as unknown as [Fields, string];
  assert.equal(msg, 'gunluk tarama tamamlandi');
  assert.equal(fields.event, 'daily_scan');
  assert.equal(fields.notificationsCreated, 2);
  assert.equal(fields.billOccurrencesCreated, 1);
  assert.equal(fields.autoConfirmed, 3);
  assert.equal(fields.budgetAlerts, 4);
  assert.equal(fields.anomalyAlerts, 5);
  assert.equal(fields.closingAlerts, 6);
  assert.equal(fields.haSent, 7);
  assert.equal(fields.haError, false);
  assert.equal(fields.tokensPurged, 9);
  assert.equal(typeof fields.durationMs, 'number');

  const last = getLastScan();
  assert.equal(last?.ok, true);
  assert.ok(last?.at);
});

test('HA hatasi: warn yazilir, ozet satiri yine yazilir, tarama ok sayilir', async () => {
  const info = mock.method(logger, 'info');
  const warn = mock.method(logger, 'warn');
  await runScheduledScan({
    scan: () => result,
    purgeTokens: () => 0,
    dispatchHa: () => Promise.reject(new Error('HA kapali')),
  });

  assert.equal(warn.mock.callCount(), 1);
  assert.equal(info.mock.callCount(), 1);
  const [fields] = info.mock.calls[0]?.arguments as unknown as [Fields];
  assert.equal(fields.haError, true);
  assert.equal(fields.haSent, 0);
  assert.equal(getLastScan()?.ok, true);
});

test('tarama hatasi: error satiri, ok:false, firlatmaz', async () => {
  const info = mock.method(logger, 'info');
  const error = mock.method(logger, 'error');
  await runScheduledScan({
    scan: () => {
      throw new Error('tarama patladi');
    },
  });

  assert.equal(error.mock.callCount(), 1);
  const [fields] = error.mock.calls[0]?.arguments as unknown as [Fields];
  assert.equal(fields.event, 'daily_scan');
  assert.ok(fields.err instanceof Error);
  assert.equal(info.mock.callCount(), 0);
  assert.equal(getLastScan()?.ok, false);
});
