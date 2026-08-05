import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from '../test/harness.ts';
import type { PublicUser } from '../types.ts';

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

// NOT: testler dosya sirasiyla calisir ve ayni sunucuyu paylasir; kurulum
// dogasi geregi tek seferlik oldugu icin sira anlamlidir.

test('kurulum yapilmamisken status false doner', async () => {
  const res = await server.newClient().get<{ setupCompleted: boolean }>('/api/setup/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.setupCompleted, false);
});

test('gecersiz kullanici adi reddedilir', async () => {
  const res = await server.newClient().post<{ error: { code: string } }>('/api/setup', {
    username: 'ab', // 3 karakterden kisa
    password: 'GecerliSifre1!',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('kisa sifre reddedilir', async () => {
  const res = await server.newClient().post<{ error: { code: string } }>('/api/setup', {
    username: 'patron',
    password: 'kisa',
  });
  assert.equal(res.status, 400);
});

test('kurulum ilk super admin hesabini olusturur ve oturum acar', async () => {
  const client = server.newClient();
  const res = await client.post<{ user: PublicUser }>('/api/setup', {
    username: 'Patron', // buyuk harfli girilse de kucuk harfe normalize edilir
    email: 'Patron@Example.com',
    password: 'CokGuclu!Sifre1',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.user.username, 'patron');
  assert.equal(res.body.user.email, 'patron@example.com');
  assert.equal(res.body.user.role, 'super_admin');
  assert.equal(res.body.user.isActive, true);
  assert.equal(res.body.user.mustChangePassword, false);

  // Kurulumu yapan kisi dogrudan oturum acmis olur
  assert.ok(client.hasCookie('ht_at'), 'access cookie kurulmali');
  assert.ok(client.hasCookie('ht_rt'), 'refresh cookie kurulmali');

  const me = await client.get<{ user: PublicUser }>('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'super_admin');
});

test('kurulum tamamlandiktan sonra status true doner', async () => {
  const res = await server.newClient().get<{ setupCompleted: boolean }>('/api/setup/status');
  assert.equal(res.body.setupCompleted, true);
});

test('kurulum IKINCI kez calistirilamaz - ikinci super admin olusturulamaz', async () => {
  const res = await server.newClient().post<{ error: { code: string } }>('/api/setup', {
    username: 'sahte.admin',
    password: 'BaskaBirSifre1!',
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CONFLICT');
});

test('kullanici adi normalize edilmis haliyle giris yapabilir', async () => {
  const client = server.newClient();
  const res = await client.post<{ user: PublicUser }>('/api/auth/login', {
    username: 'PATRON',
    password: 'CokGuclu!Sifre1',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.username, 'patron');
});
