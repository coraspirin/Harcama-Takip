import '../test/env.ts';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestServer } from '../test/harness.ts';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dispatchHomeAssistantNotifications } from './scheduler.ts';
import { encryptSecret } from './cryptoService.ts';
import { findHaSettings, recordHaResult, saveHaSettings } from '../db/haSettings.ts';
import { createNotification } from '../db/notifications.ts';
import { getDb } from '../db/connection.ts';

let server: TestServer;
let okPort = 0;
let failPort = 0;
const servers: http.Server[] = [];

async function listen(status: number): Promise<number> {
  const s = http.createServer((_req, res) => {
    res.statusCode = status;
    res.end(status === 200 ? '{}' : 'bozuk');
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  return (s.address() as AddressInfo).port;
}

function userId(name: string): number {
  const row = getDb().prepare('SELECT id FROM users WHERE username = ?').get(name) as {
    id: number;
  };
  return row.id;
}

function setup(id: number, port: number): void {
  saveHaSettings(id, {
    baseUrl: `http://127.0.0.1:${port}`,
    tokenEncrypted: encryptSecret('t'),
    notifyTarget: 'mobile_app_x',
    enabled: true,
  });
}

before(async () => {
  server = await bootstrap();
  okPort = await listen(200);
  failPort = await listen(500);
});

after(async () => {
  for (const s of servers) s.close();
  await server.close();
});

test('gonderim hatasi last_error olarak kalir; basarili kullanicida null yazilir; bildirimi olmayanin eski hatasi silinmez', async () => {
  await createUserAndLogin(server, 'bad');
  await createUserAndLogin(server, 'good');
  await createUserAndLogin(server, 'idle');
  const bad = userId('bad');
  const good = userId('good');
  const idle = userId('idle');

  for (const [id, key] of [
    [bad, 'k-bad'],
    [good, 'k-good'],
  ] as const) {
    createNotification(id, { type: 'reminder', title: 'Baslik', body: 'Govde', dedupeKey: key });
  }
  setup(bad, failPort);
  setup(good, okPort);
  setup(idle, okPort);
  recordHaResult(good, 'eski hata');
  recordHaResult(idle, 'eski idle hata');

  const sent = await dispatchHomeAssistantNotifications();
  assert.equal(sent, 1);

  const badRow = findHaSettings(bad);
  assert.ok(badRow?.last_error?.includes('500'), 'hata metni kalici olmali');
  assert.equal(findHaSettings(good)?.last_error, null);
  assert.equal(findHaSettings(idle)?.last_error, 'eski idle hata');
});
