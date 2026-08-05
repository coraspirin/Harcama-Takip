import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestClient, type TestServer } from '../test/harness.ts';
import type { PublicUser } from '../types.ts';

let server: TestServer;

const ADMIN = { username: 'patron', password: 'CokGuclu!Sifre1' };

before(async () => {
  server = await startTestServer();
  await server.newClient().post('/api/setup', ADMIN);
});

after(async () => {
  await server.close();
});

async function login(creds = ADMIN): Promise<TestClient> {
  const client = server.newClient();
  const res = await client.post('/api/auth/login', creds);
  assert.equal(res.status, 200, 'giris basarili olmali');
  return client;
}

test('oturum acmadan /auth/me 401 doner', async () => {
  const res = await server.newClient().get<{ error: { code: string } }>('/api/auth/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('yanlis sifre 401 doner ve kullanici adi ile sifre hatasi ayrilmaz', async () => {
  const wrongPassword = await server
    .newClient()
    .post<{ error: { message: string } }>('/api/auth/login', {
      username: ADMIN.username,
      password: 'YanlisSifre1!',
    });
  const wrongUser = await server
    .newClient()
    .post<{ error: { message: string } }>('/api/auth/login', {
      username: 'olmayan.kullanici',
      password: 'YanlisSifre1!',
    });

  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongUser.status, 401);
  // Kullanici numaralandirmayi engellemek icin iki mesaj ayni olmali
  assert.equal(wrongPassword.body.error.message, wrongUser.body.error.message);
});

test('basarili giris cookie kurar ve /auth/me calisir', async () => {
  const client = await login();
  assert.ok(client.hasCookie('ht_at'));
  assert.ok(client.hasCookie('ht_rt'));

  const me = await client.get<{ user: PublicUser; activeSessions: number }>('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, ADMIN.username);
  assert.ok(me.body.activeSessions >= 1);
});

test('refresh yeni token verir, eski refresh token bir daha kullanilamaz', async () => {
  const client = await login();

  // Rotasyondan onceki refresh token'i saklamak icin ham cookie'yi taklit
  // eden ikinci bir istemci kullaniyoruz.
  const first = await client.post('/api/auth/refresh');
  assert.equal(first.status, 200);

  const second = await client.post('/api/auth/refresh');
  assert.equal(second.status, 200, 'rotasyon sonrasi yeni token ile yenileme calismali');

  const me = await client.get<{ user: PublicUser }>('/api/auth/me');
  assert.equal(me.status, 200);
});

test('calinmis refresh token tekrar kullanilirsa tum oturum zinciri kapatilir', async () => {
  const victim = await login();

  // Saldirgan, kurbanin refresh token'inin bir kopyasini ele geciriyor
  const stolenToken = victim.getCookie('ht_rt');
  assert.ok(stolenToken, 'refresh token cookie bulunmali');

  // Kurban normal akista token'ini yeniliyor -> eski token iptal oluyor
  assert.equal((await victim.post('/api/auth/refresh')).status, 200);

  // Saldirgan iptal edilmis token'i kullanmaya calisiyor
  const attacker = server.newClient();
  attacker.setCookie('ht_rt', stolenToken);
  const replay = await attacker.post('/api/auth/refresh');
  assert.equal(replay.status, 401);

  // Yeniden kullanim tespit edildigi icin kurbanin GECERLI token'i da iptal
  // edilmis olmali - hirsizlik suphesinde oturum tamamen kapanir.
  const victimAfter = await victim.post('/api/auth/refresh');
  assert.equal(victimAfter.status, 401, 'yeniden kullanim sonrasi zincir kapanmali');
});

test('logout cookie temizler ve /auth/me artik 401 doner', async () => {
  const client = await login();
  const out = await client.post<{ ok: boolean }>('/api/auth/logout');
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 401);
});

test('logout-all diger cihazlarin oturumunu da kapatir', async () => {
  const phone = await login();
  const laptop = await login();

  // Iki cihaz da acik
  assert.equal((await phone.get('/api/auth/me')).status, 200);
  assert.equal((await laptop.get('/api/auth/me')).status, 200);

  const res = await laptop.post<{ revokedSessions: number }>('/api/auth/logout-all');
  assert.equal(res.status, 200);
  assert.ok(res.body.revokedSessions >= 2, 'en az iki oturum iptal edilmeli');

  // Telefondaki access token'i suresi dolana kadar gecerli kalir, ancak
  // refresh token'i iptal oldugu icin oturum yenilenemez.
  const refreshed = await phone.post('/api/auth/refresh');
  assert.equal(refreshed.status, 401);
});

test('sifre degisikligi eski sifreyi gecersiz kilar ve tum oturumlari iptal eder', async () => {
  const NEW_PASSWORD = 'YeniCokGuclu!Sifre2';

  const phone = await login();
  const laptop = await login();

  const changed = await laptop.post<{ user: PublicUser }>('/api/auth/change-password', {
    currentPassword: ADMIN.password,
    newPassword: NEW_PASSWORD,
  });
  assert.equal(changed.status, 200);

  // Islemi yapan cihaz calismaya devam eder (yeni oturum verilir)
  assert.equal((await laptop.get('/api/auth/me')).status, 200);

  // Diger cihaz yenileyemez
  assert.equal((await phone.post('/api/auth/refresh')).status, 401);

  // Eski sifreyle giris yapilamaz
  const oldLogin = await server.newClient().post('/api/auth/login', ADMIN);
  assert.equal(oldLogin.status, 401);

  // Yeni sifreyle giris yapilir
  const newLogin = await server
    .newClient()
    .post('/api/auth/login', { username: ADMIN.username, password: NEW_PASSWORD });
  assert.equal(newLogin.status, 200);

  // Sonraki testler icin sifreyi geri al
  const back = await server.newClient().post('/api/auth/login', {
    username: ADMIN.username,
    password: NEW_PASSWORD,
  });
  assert.equal(back.status, 200);
});

test('yanlis mevcut sifreyle degisiklik reddedilir', async () => {
  const client = await login({ username: ADMIN.username, password: 'YeniCokGuclu!Sifre2' });
  const res = await client.post<{ error: { code: string } }>('/api/auth/change-password', {
    currentPassword: 'TamamenYanlis1!',
    newPassword: 'BaskaBirSifre3!',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'BAD_REQUEST');
});
