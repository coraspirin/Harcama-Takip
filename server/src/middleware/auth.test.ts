import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestClient, type TestServer } from '../test/harness.ts';

/**
 * Rol ayrimi ve oturum kilidi testleri. Gercek route'lar sonraki fazlarda
 * geldigi icin middleware'ler burada "probe" uclarina baglanarak izole olcuLur;
 * bu uclar yalnizca testte kaydedilir, uretim uygulamasinda yer almaz.
 */

let server: TestServer;

const ADMIN = { username: 'patron', password: 'CokGuclu!Sifre1' };
const USER = { username: 'ayse', password: 'KullaniciSifre1!' };

before(async () => {
  const { requireUser, requireSuperAdmin, requireAnyRole } = await import('./auth.ts');

  server = await startTestServer({
    configure: (app) => {
      app.get('/api/probe/user', requireUser, (req, res) => res.json({ role: req.user?.role }));
      app.get('/api/probe/admin', requireSuperAdmin, (req, res) =>
        res.json({ role: req.user?.role }),
      );
      app.get('/api/probe/any', requireAnyRole, (req, res) => res.json({ role: req.user?.role }));
    },
  });

  await server.newClient().post('/api/setup', ADMIN);

  // Normal kullaniciyi dogrudan veritabaninda olustururuz; super admin'in
  // kullanici olusturma ucu Faz 7'de gelecek.
  const { createUser } = await import('../db/users.ts');
  const { hashPassword } = await import('../lib/auth.ts');
  createUser({
    username: USER.username,
    passwordHash: await hashPassword(USER.password),
    role: 'user',
  });
});

after(async () => {
  await server.close();
});

async function login(creds: { username: string; password: string }): Promise<TestClient> {
  const client = server.newClient();
  const res = await client.post('/api/auth/login', creds);
  assert.equal(res.status, 200, `${creds.username} girisi basarili olmali`);
  return client;
}

test('oturumsuz istek 401 doner', async () => {
  assert.equal((await server.newClient().get('/api/probe/user')).status, 401);
  assert.equal((await server.newClient().get('/api/probe/admin')).status, 401);
});

test('normal kullanici user uclarina erisir, admin uclarina ERISEMEZ', async () => {
  const client = await login(USER);

  const ok = await client.get<{ role: string }>('/api/probe/user');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.role, 'user');

  const denied = await client.get<{ error: { code: string } }>('/api/probe/admin');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');
});

test('SUPER ADMIN normal kullanici uclarina ERISEMEZ (finansal veri izolasyonu)', async () => {
  const client = await login(ADMIN);

  const adminOk = await client.get<{ role: string }>('/api/probe/admin');
  assert.equal(adminOk.status, 200);
  assert.equal(adminOk.body.role, 'super_admin');

  // Kritik kural: super admin'in hicbir finansal veri ucuna erisimi olmamali.
  const denied = await client.get<{ error: { code: string } }>('/api/probe/user');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');
});

test('her iki rol de rol-bagimsiz uclara erisir', async () => {
  assert.equal((await (await login(USER)).get('/api/probe/any')).status, 200);
  assert.equal((await (await login(ADMIN)).get('/api/probe/any')).status, 200);
});

test('kullanici pasife alinirsa elindeki gecerli token ile de islem yapamaz', async () => {
  const client = await login(USER);
  assert.equal((await client.get('/api/probe/user')).status, 200);

  const { findUserByUsername, setUserActive } = await import('../db/users.ts');
  const user = findUserByUsername(USER.username);
  assert.ok(user);
  setUserActive(user.id, false);

  // Token hala gecerli ama kullanici her istekte veritabanindan tazelenir.
  const res = await client.get<{ error: { message: string } }>('/api/probe/user');
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /devre disi/i);

  // Pasif kullanici yeniden giris de yapamaz
  const relogin = await server.newClient().post('/api/auth/login', USER);
  assert.equal(relogin.status, 403);

  setUserActive(user.id, true);
});

test('sifre degistirmesi gereken kullanici uygulamanin geri kalanina giremez', async () => {
  const { findUserByUsername, setUserPassword } = await import('../db/users.ts');
  const { hashPassword } = await import('../lib/auth.ts');

  const user = findUserByUsername(USER.username);
  assert.ok(user);

  const TEMP = 'GeciciSifre123!';
  setUserPassword(user.id, await hashPassword(TEMP), true);

  const client = await login({ username: USER.username, password: TEMP });

  const blocked = await client.get<{ error: { code: string } }>('/api/probe/user');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

  // Ancak sifre degistirme ve /auth/me acik kalmali, aksi halde kilit acilamaz
  assert.equal((await client.get('/api/auth/me')).status, 200);

  const changed = await client.post('/api/auth/change-password', {
    currentPassword: TEMP,
    newPassword: USER.password,
  });
  assert.equal(changed.status, 200);

  // Kilit kalkti
  assert.equal((await client.get('/api/probe/user')).status, 200);
});
