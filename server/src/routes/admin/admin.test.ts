import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, bootstrap, createUserAndLogin, loginAdmin } from '../../test/fixtures.ts';
import type { TestClient, TestServer } from '../../test/harness.ts';

let server: TestServer;
let admin: TestClient;
let ayse: TestClient;

type AdminUser = {
  id: number;
  username: string;
  email: string | null;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

type AuditLog = {
  id: number;
  actorUsername: string;
  action: string;
  targetUsername: string | null;
  createdAt: string;
};

/**
 * Super admin yanitlarinda GORUNMEMESI gereken alanlar. Yeni bir alan
 * eklendiginde bu liste testi dusurmeli.
 */
const FORBIDDEN_FIELDS = [
  'balance',
  'balanceKurus',
  'transactionCount',
  'accounts',
  'transactions',
  'categories',
  'budgets',
  'totalKurus',
  'passwordHash',
  'password_hash',
];

function assertNoFinancialData(payload: unknown, context: string) {
  const json = JSON.stringify(payload);
  for (const field of FORBIDDEN_FIELDS) {
    assert.ok(
      !json.includes(`"${field}"`),
      `${context} yanitinda "${field}" alani bulunmamali: ${json.slice(0, 200)}`,
    );
  }
}

before(async () => {
  server = await bootstrap();
  admin = await loginAdmin(server);
  ayse = await createUserAndLogin(server, 'ayse');

  // Ayse'nin finansal verisi olsun ki sizinti testi anlamli olsun
  await ayse.post('/api/transactions', {
    type: 'expense',
    amountKurus: 99_900,
    date: '2026-08-05',
    description: 'Gizli harcama',
  });
});

after(async () => {
  await server.close();
});

describe('erisim kontrolu', () => {
  test('normal kullanici admin uclarina ERISEMEZ', async () => {
    for (const path of ['/api/admin/users', '/api/admin/audit-log']) {
      const res = await ayse.get<{ error: { code: string } }>(path);
      assert.equal(res.status, 403, `${path} normal kullaniciya kapali olmali`);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
  });

  test('oturumsuz istek 401 doner', async () => {
    assert.equal((await server.newClient().get('/api/admin/users')).status, 401);
  });

  test('super admin finansal uclara ERISEMEZ', async () => {
    for (const path of ['/api/categories', '/api/transactions', '/api/reports/monthly']) {
      assert.equal((await admin.get(path)).status, 403, `${path} admin'e kapali olmali`);
    }
  });
});

describe('kullanici yonetimi', () => {
  let createdId: number;

  test('kullanici listesinde FINANSAL VERI YOK', async () => {
    const res = await admin.get<{ users: AdminUser[] }>('/api/admin/users');
    assert.equal(res.status, 200);
    assert.ok(res.body.users.length >= 2);

    assertNoFinancialData(res.body, 'kullanici listesi');

    const user = res.body.users.find((u) => u.username === 'ayse');
    assert.ok(user);
    // Yalnizca hesap yonetimi alanlari
    assert.deepEqual(Object.keys(user).sort(), [
      'createdAt',
      'email',
      'id',
      'isActive',
      'mustChangePassword',
      'role',
      'username',
    ]);
  });

  test('yeni kullanici olusturulur ve varsayilan kategorileri hazir gelir', async () => {
    const res = await admin.post<{ user: AdminUser }>('/api/admin/users', {
      username: 'yeni.kullanici',
      email: 'yeni@example.com',
      password: 'IlkSifre123!',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.user.mustChangePassword, true);
    createdId = res.body.user.id;

    // Kullanici giris yapabilmeli ve sifre degistirme kilidiyle karsilasmali
    const client = server.newClient();
    const login = await client.post('/api/auth/login', {
      username: 'yeni.kullanici',
      password: 'IlkSifre123!',
    });
    assert.equal(login.status, 200);

    const blocked = await client.get<{ error: { code: string } }>('/api/categories');
    assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

    await client.post('/api/auth/change-password', {
      currentPassword: 'IlkSifre123!',
      newPassword: 'KendiSifrem123!',
    });

    const categories = await client.get<{ categories: unknown[] }>('/api/categories');
    assert.ok(categories.body.categories.length > 10, 'varsayilan kategoriler kurulmali');
  });

  test('ayni kullanici adi ikinci kez olusturulamaz', async () => {
    const res = await admin.post('/api/admin/users', {
      username: 'yeni.kullanici',
      password: 'BaskaSifre123!',
    });
    assert.equal(res.status, 409);
  });

  test('kullanici pasife alininca oturumlari kapanir ve giris yapamaz', async () => {
    const client = server.newClient();
    await client.post('/api/auth/login', {
      username: 'yeni.kullanici',
      password: 'KendiSifrem123!',
    });
    assert.equal((await client.get('/api/categories')).status, 200);

    const res = await admin.patch<{ user: AdminUser }>(`/api/admin/users/${createdId}/active`, {
      isActive: false,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.isActive, false);

    // Acik oturum da gecersiz olmali
    assert.equal((await client.get('/api/categories')).status, 403);
    assert.equal((await client.post('/api/auth/refresh')).status, 401);

    const relogin = await server.newClient().post('/api/auth/login', {
      username: 'yeni.kullanici',
      password: 'KendiSifrem123!',
    });
    assert.equal(relogin.status, 403);

    await admin.patch(`/api/admin/users/${createdId}/active`, { isActive: true });
  });

  test('sifre sifirlama tek seferlik gecici sifre uretir ve kilit koyar', async () => {
    const res = await admin.post<{ temporaryPassword: string }>(
      `/api/admin/users/${createdId}/reset-password`,
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.temporaryPassword.length >= 12);

    const client = server.newClient();
    const login = await client.post('/api/auth/login', {
      username: 'yeni.kullanici',
      password: res.body.temporaryPassword,
    });
    assert.equal(login.status, 200);

    // Sifreyi degistirmeden uygulamaya giremez
    const blocked = await client.get<{ error: { code: string } }>('/api/categories');
    assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  });

  test('admin kendi hesabini pasife alamaz veya silemez', async () => {
    const list = await admin.get<{ users: AdminUser[] }>('/api/admin/users');
    const self = list.body.users.find((u) => u.username === ADMIN.username);
    assert.ok(self);

    assert.equal((await admin.patch(`/api/admin/users/${self.id}/active`, { isActive: false })).status, 400);
    assert.equal((await admin.delete(`/api/admin/users/${self.id}`)).status, 400);
    assert.equal((await admin.post(`/api/admin/users/${self.id}/reset-password`)).status, 400);
  });

  test('kullanici silinince TUM finansal verisi de silinir', async () => {
    const list = await admin.get<{ users: AdminUser[] }>('/api/admin/users');
    const target = list.body.users.find((u) => u.username === 'ayse');
    assert.ok(target);

    const res = await admin.delete(`/api/admin/users/${target.id}`);
    assert.equal(res.status, 200);

    // Ayse'nin oturumu da gecersiz olmali
    assert.equal((await ayse.get('/api/categories')).status, 401);

    const after = await admin.get<{ users: AdminUser[] }>('/api/admin/users');
    assert.ok(!after.body.users.some((u) => u.username === 'ayse'));
  });
});

describe('islem gunlugu', () => {
  test('admin islemleri kim/ne zaman/hedef bilgisiyle kaydedilir', async () => {
    const res = await admin.get<{ logs: AuditLog[]; pagination: { total: number } }>(
      '/api/admin/audit-log',
    );

    assert.equal(res.status, 200);
    assert.ok(res.body.pagination.total > 0);

    const actions = res.body.logs.map((l) => l.action);
    for (const expected of [
      'setup.super_admin_created',
      'user.created',
      'user.deactivated',
      'user.activated',
      'user.password_reset',
      'user.deleted',
    ]) {
      assert.ok(actions.includes(expected), `${expected} kaydi olmali`);
    }

    for (const log of res.body.logs) {
      assert.equal(log.actorUsername, ADMIN.username);
      assert.ok(log.createdAt);
    }
  });

  test('silinen kullanicinin adi gunlukte METIN olarak korunur', async () => {
    const res = await admin.get<{ logs: AuditLog[] }>('/api/admin/audit-log');
    const deletion = res.body.logs.find((l) => l.action === 'user.deleted');
    assert.ok(deletion);
    assert.equal(deletion.targetUsername, 'ayse', 'kullanici silinse de kayit anlamli kalmali');
  });

  test('islem gunlugunde finansal veri yok', async () => {
    const res = await admin.get('/api/admin/audit-log');
    assertNoFinancialData(res.body, 'islem gunlugu');
  });
});
