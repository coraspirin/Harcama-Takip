import '../test/env.ts';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestServer } from '../test/harness.ts';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

let server: TestServer;
let fake: http.Server;
let fakePort = 0;
let hits = 0;
let lastAuth: string | undefined;

before(async () => {
  server = await bootstrap();
  fake = http.createServer((req, res) => {
    hits++;
    lastAuth = req.headers.authorization;
    res.setHeader('content-type', 'application/json');
    res.end('[]');
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  fakePort = (fake.address() as AddressInfo).port;
});

after(async () => {
  fake.close();
  await server.close();
});

type Err = { error: { code: string; message: string } };
type Settings = { settings: { baseUrl: string } | null };
const P = '/api/settings/home-assistant';

test('POST /test: farkli adres + token yok -> 400 HA_TOKEN_REQUIRED, istek gitmez', async () => {
  const c = await createUserAndLogin(server, 'kullanici1');
  const save = await c.put(P, {
    baseUrl: 'http://localhost:9',
    token: 'kayitli-token',
    notifyTarget: null,
  });
  assert.equal(save.status, 200);
  hits = 0;
  const r = await c.post<Err>(`${P}/test`, { baseUrl: `http://127.0.0.1:${fakePort}` });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'HA_TOKEN_REQUIRED');
  assert.equal(hits, 0);
});

test('POST /test: ayni adres + token yok -> kayitli token kullanilir', async () => {
  const c = await createUserAndLogin(server, 'kullanici2');
  const base = `http://127.0.0.1:${fakePort}`;
  await c.put(P, { baseUrl: base, token: 'kayitli-token', notifyTarget: null });
  hits = 0;
  const r = await c.post(`${P}/test`, { baseUrl: base });
  assert.equal(r.status, 200);
  assert.equal(hits, 1);
  assert.equal(lastAuth, 'Bearer kayitli-token');
});

test('POST /test: sondaki / ve host buyuk/kucuk harf farki ayni sayilir', async () => {
  const c = await createUserAndLogin(server, 'kullanici3');
  await c.put(P, {
    baseUrl: `http://localhost:${fakePort}`,
    token: 'tok-3',
    notifyTarget: null,
  });
  hits = 0;
  const r = await c.post(`${P}/test`, { baseUrl: `HTTP://LocalHost:${fakePort}/` });
  assert.equal(r.status, 200);
  assert.equal(hits, 1);
  assert.equal(lastAuth, 'Bearer tok-3');
});

test('yol farki farkli adres sayilir', async () => {
  const c = await createUserAndLogin(server, 'kullanici4');
  const base = `http://127.0.0.1:${fakePort}`;
  await c.put(P, { baseUrl: base, token: 'tok-4', notifyTarget: null });
  hits = 0;
  const r = await c.post<Err>(`${P}/test`, { baseUrl: `${base}/alt` });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'HA_TOKEN_REQUIRED');
  assert.equal(hits, 0);
});

test('PUT: farkli adres + token yok -> 400, kayit degismez; yeni token ile basarili', async () => {
  const c = await createUserAndLogin(server, 'kullanici5');
  await c.put(P, { baseUrl: 'http://localhost:9', token: 'tok-5', notifyTarget: null });

  const bad = await c.put<Err>(P, { baseUrl: 'http://baska.example:8123', notifyTarget: null });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'HA_TOKEN_REQUIRED');
  assert.equal((await c.get<Settings>(P)).body.settings?.baseUrl, 'http://localhost:9');

  const ok = await c.put(P, {
    baseUrl: 'http://baska.example:8123',
    token: 'yeni-token',
    notifyTarget: null,
  });
  assert.equal(ok.status, 200);
  assert.equal((await c.get<Settings>(P)).body.settings?.baseUrl, 'http://baska.example:8123');

  const same = await c.put(P, { baseUrl: 'http://BASKA.example:8123/', notifyTarget: null });
  assert.equal(same.status, 200);
});
