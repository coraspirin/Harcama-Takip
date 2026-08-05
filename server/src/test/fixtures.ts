import assert from 'node:assert/strict';
import { startTestServer, type TestClient, type TestServer } from './harness.ts';

export const ADMIN = { username: 'patron', password: 'CokGuclu!Sifre1' };
export const DEFAULT_PASSWORD = 'KullaniciSifre1!';

/**
 * Sunucuyu baslatir ve kurulumu tamamlar (super admin olusur).
 * Kullanici olusturma ucu Faz 7'de gelecegi icin normal kullanicilar
 * `createUser` ile dogrudan veritabaninda olusturulur.
 */
export async function bootstrap(options?: {
  configure?: (app: import('express').Express) => void;
}): Promise<TestServer> {
  const server = await startTestServer(options ?? {});
  const res = await server.newClient().post('/api/setup', ADMIN);
  assert.equal(res.status, 201, 'kurulum basarili olmali');
  return server;
}

/** Yeni bir normal kullanici olusturur ve oturum acmis istemcisini doner. */
export async function createUserAndLogin(
  server: TestServer,
  username: string,
  password = DEFAULT_PASSWORD,
): Promise<TestClient> {
  const { provisionUser } = await import('../services/userProvisioning.ts');
  const { hashPassword } = await import('../lib/auth.ts');

  provisionUser({
    username,
    passwordHash: await hashPassword(password),
    role: 'user',
  });

  const client = server.newClient();
  const res = await client.post('/api/auth/login', { username, password });
  assert.equal(res.status, 200, `${username} girisi basarili olmali`);
  return client;
}

/** Super admin olarak oturum acmis istemci. */
export async function loginAdmin(server: TestServer): Promise<TestClient> {
  const client = server.newClient();
  const res = await client.post('/api/auth/login', ADMIN);
  assert.equal(res.status, 200);
  return client;
}
