import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from './test/harness.ts';

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

test('GET /api/health - veritabanina dokunarak saglik doner', async () => {
  const res = await server.newClient().get<{ status: string; time: string }>('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.ok(res.body.time);
});

test('bilinmeyen /api yolu JSON 404 doner (HTML degil)', async () => {
  const res = await server
    .newClient()
    .get<{ error: { code: string } }>('/api/olmayan-endpoint');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
