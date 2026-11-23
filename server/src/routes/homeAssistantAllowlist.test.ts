import '../test/haAllowlistEnv.ts';
import { bootstrap, createUserAndLogin } from '../test/fixtures.ts';
import type { TestServer } from '../test/harness.ts';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

let server: TestServer;

before(async () => {
  server = await bootstrap();
});

after(async () => {
  await server.close();
});

type Err = { error: { code: string } };
const URL_PATH = '/api/settings/home-assistant';

test('izin disi adresle kaydetme ve baglanti testi 400 HA_HOST_NOT_ALLOWED', async () => {
  const client = await createUserAndLogin(server, 'ali');
  const body = { baseUrl: 'http://evil.example.org:8123', token: 'x', notifyTarget: null };
  const save = await client.put<Err>(URL_PATH, body);
  assert.equal(save.status, 400);
  assert.equal(save.body.error.code, 'HA_HOST_NOT_ALLOWED');
  const probe = await client.post<Err>(`${URL_PATH}/test`, {
    baseUrl: body.baseUrl,
    token: 'x',
  });
  assert.equal(probe.status, 400);
  assert.equal(probe.body.error.code, 'HA_HOST_NOT_ALLOWED');
});

test('izinli adresle kaydetme basarili; u:p@ reddedilir', async () => {
  const client = await createUserAndLogin(server, 'veli');
  const ok = await client.put(URL_PATH, {
    baseUrl: 'https://ALLOWED.example.com',
    token: 'x',
    notifyTarget: null,
  });
  assert.equal(ok.status, 200);
  const cred = await client.put(URL_PATH, {
    baseUrl: 'https://u:p@allowed.example.com',
    token: 'x',
    notifyTarget: null,
  });
  assert.equal(cred.status, 400);
});
