// Rate limit yalnizca bu dosyada aciktir; diger test dosyalari sayaci
// paylasmasin diye varsayilan olarak atlanir (bkz. rateLimit.ts).
process.env.RATE_LIMIT_IN_TEST = '1';

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from '../test/harness.ts';

let server: TestServer;

const ADMIN = { username: 'patron', password: 'CokGuclu!Sifre1' };

before(async () => {
  server = await startTestServer();
  await server.newClient().post('/api/setup', ADMIN);
});

after(async () => {
  await server.close();
});

test('ardisik yanlis giris denemeleri 429 ile durdurulur', async () => {
  const client = server.newClient();
  const statuses: number[] = [];

  // Limit 15 dakikada 10 deneme; 12 deneme yapip son ikisinin engellendigini
  // dogruluyoruz.
  for (let i = 0; i < 12; i++) {
    const res = await client.post('/api/auth/login', {
      username: ADMIN.username,
      password: `YanlisSifre${i}!`,
    });
    statuses.push(res.status);
  }

  assert.equal(statuses[0], 401, 'ilk denemeler kimlik hatasi vermeli');
  assert.equal(statuses.at(-1), 429, 'limit asildiginda 429 donmeli');
  assert.equal(statuses.filter((s) => s === 429).length, 2, 'son iki deneme engellenmeli');
});

test('limit asildiktan sonra DOGRU sifre ile de giris yapilamaz', async () => {
  const client = server.newClient();
  const res = await client.post<{ error: { code: string } }>('/api/auth/login', ADMIN);

  assert.equal(res.status, 429);
  assert.equal(res.body.error.code, 'TOO_MANY_REQUESTS');
});

test('farkli kullanici adi ayri sayac kullanir (ortak IP kilitlenmez)', async () => {
  // Ayni IP'den farkli bir kullanici adiyla deneme hala 401 almali;
  // yalnizca IP'ye bakan bir limit burada 429 dondururdu.
  const res = await server.newClient().post('/api/auth/login', {
    username: 'baska.kullanici',
    password: 'HerhangiBirSifre1!',
  });

  assert.equal(res.status, 401);
});
