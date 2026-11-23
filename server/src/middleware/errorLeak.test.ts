import '../test/env.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../app.ts';
import { createLogger, serializeErr } from '../lib/logger.ts';

const SECRET = 'Gizli123!';
const EMAIL = 'a@b.c';

function capture() {
  let out = '';
  return {
    stream: {
      write: (s: string) => {
        out += s;
      },
    },
    lines: () => out,
  };
}

async function withApp<T>(
  fn: (url: string, lines: () => string) => Promise<T>,
  configure?: Parameters<typeof createApp>[0],
): Promise<T> {
  const sink = capture();
  const logger = createLogger({ level: 'info', stream: sink.stream });
  const app = createApp({ ...configure, logger });
  const srv: Server = app.listen(0);
  try {
    const { port } = srv.address() as AddressInfo;
    return await fn(`http://127.0.0.1:${port}`, sink.lines);
  } finally {
    srv.close();
  }
}

test('bozuk JSON govdesi -> 400 INVALID_JSON, govde loga sizmaz', async () => {
  await withApp(async (url, lines) => {
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"email":"${EMAIL}","password":"${SECRET}",`,
    });
    const text = await res.text();
    assert.equal(res.status, 400);
    const body = JSON.parse(text) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'INVALID_JSON');
    assert.ok(!text.includes(SECRET) && !text.includes(EMAIL));

    const out = lines();
    assert.ok(out.includes('/api/auth/login'), 'pino-http satiri yazilmali');
    assert.ok(!out.includes(SECRET), `parola loga sizdi: ${out}`);
    assert.ok(!out.includes(EMAIL), `e-posta loga sizdi: ${out}`);
  });
});

test('cok buyuk govde -> 413 PAYLOAD_TOO_LARGE', async () => {
  await withApp(async (url, lines) => {
    const big = JSON.stringify({ password: SECRET, pad: 'x'.repeat(3 * 1024 * 1024) });
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: big,
    });
    assert.equal(res.status, 413);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.ok(!lines().includes(SECRET));
  });
});

test('5xx: err serializer govdeyi ve parse mesajini loga sokmaz', async () => {
  await withApp(
    async (url, lines) => {
      const res = await fetch(`${url}/api/__probe`);
      assert.equal(res.status, 500);
      const out = lines();
      assert.ok(out.includes('unhandled_error'));
      assert.ok(!out.includes(SECRET), `parola loga sizdi: ${out}`);
    },
    {
      configure: (app) => {
        app.get('/api/__probe', (_req, _res, next) => {
          const e = new SyntaxError(`Unexpected token in {"password":"${SECRET}"`) as SyntaxError &
            Record<string, unknown>;
          e.body = `{"password":"${SECRET}"}`;
          next(e);
        });
      },
    },
  );
});

test('serializeErr: body/raw/headers dusurulur, SyntaxError mesaji ve stack gizlenir', () => {
  const err = new SyntaxError(`Unexpected token ${SECRET} in JSON`) as SyntaxError &
    Record<string, unknown>;
  err.body = `{"password":"${SECRET}"}`;
  err.raw = SECRET;
  err.rawBody = SECRET;
  err.config = { data: SECRET };
  err.request = { body: SECRET };
  err.response = { data: SECRET };
  err.headers = { authorization: SECRET };
  err.type = 'entity.parse.failed';
  err.status = 400;

  const out = serializeErr(err) as Record<string, unknown>;
  const json = JSON.stringify(out);
  assert.ok(!json.includes(SECRET), `sizinti: ${json}`);
  for (const k of ['body', 'raw', 'rawBody', 'config', 'request', 'response', 'headers', 'stack']) {
    assert.equal(k in out, false, `${k} kalmamali`);
  }
  assert.equal(out.message, '[gizlendi: JSON parse hatasi]');

  // Normal hata: mesaj ve stack korunur.
  const plain = serializeErr(new Error('disk dolu')) as Record<string, unknown>;
  assert.equal(plain.message, 'disk dolu');
  assert.ok(typeof plain.stack === 'string');
});
