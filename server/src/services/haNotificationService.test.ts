import '../test/env.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchNotifyTargets } from './haNotificationService.ts';

test('3xx yanit 502 HA_ERROR; yonlendirilen hedefe istek gitmez', async () => {
  let targetHits = 0;
  let authAtTarget: string | undefined;
  const target = http.createServer((req, res) => {
    targetHits++;
    authAtTarget = req.headers.authorization;
    res.end('[]');
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const targetPort = (target.address() as AddressInfo).port;

  const redirector = http.createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/api/services` });
    res.end();
  });
  await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', r));
  const port = (redirector.address() as AddressInfo).port;

  try {
    await assert.rejects(
      () => fetchNotifyTargets(`http://127.0.0.1:${port}`, 'gizli-token'),
      (err: { status?: number; code?: string; message?: string }) =>
        err.status === 502 && err.code === 'HA_ERROR' && /y[oö]nlendirme/i.test(err.message ?? ''),
    );
    assert.equal(targetHits, 0);
    assert.equal(authAtTarget, undefined);
  } finally {
    redirector.close();
    target.close();
  }
});
