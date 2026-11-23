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

// ---- Allowlist serializer ve errorHandler sertlestirmesi ----

type LogLine = Record<string, unknown>;
const parseLines = (raw: string): LogLine[] =>
  raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogLine);

function probeApp(thrower: (next: (e?: unknown) => void) => void) {
  return {
    configure: (
      app: Parameters<NonNullable<Parameters<typeof createApp>[0]>['configure'] & object>[0],
    ) => {
      app.get('/api/__probe', (_req, _res, next) => thrower(next));
    },
  };
}

const syntaxErr = () => new SyntaxError(`Unexpected token in {"password":"${SECRET}"`);

test('serializeErr: AggregateError ic hatalarinin body/alanlari sizmaz', () => {
  const inner = Object.assign(new Error('x'), { body: SECRET, code: 'E1' });
  const out = serializeErr(new AggregateError([inner, 'ham ' + SECRET])) as LogLine;
  const json = JSON.stringify(out);
  assert.ok(!json.includes(SECRET), json);
  assert.equal(out.aggregateCount, 2);
  assert.deepEqual((out.aggregateErrors as LogLine[])[0], {
    name: 'Error',
    message: 'x',
    code: 'E1',
  });
});

test('serializeErr: allowlist disi alanlar (error, meta) kopyalanmaz', () => {
  const e = Object.assign(new Error('x'), {
    error: { body: SECRET },
    meta: { password: SECRET },
    status: 502,
    code: 'ECONNRESET',
  });
  const out = serializeErr(e) as LogLine;
  assert.ok(!JSON.stringify(out).includes(SECRET));
  assert.equal('error' in out, false);
  assert.equal('meta' in out, false);
  assert.equal(out.status, 502);
  assert.equal(out.code, 'ECONNRESET');
});

test('serializeErr: parse hatasini saran ust hatalarin mesaji maskelenir', () => {
  const inner = syntaxErr();
  const outer = new Error('wrap: ' + inner.message, { cause: inner });
  const outer2 = new Error('wrap2: ' + outer.message, { cause: outer });
  const out = serializeErr(outer2) as LogLine;
  const json = JSON.stringify(out);
  assert.ok(!json.includes(SECRET), json);
  assert.equal(out.message, '[gizlendi: JSON parse hatasi]');
  assert.equal('stack' in out, false);
  const cause = out.cause as LogLine;
  assert.equal(cause.message, '[gizlendi: JSON parse hatasi]');
  assert.equal('stack' in cause, false);
});

test('serializeErr: parse hatasi aggregate icinde de saran hatayi maskeler', () => {
  const agg = new AggregateError([syntaxErr()], `agg ${SECRET}`);
  const json = JSON.stringify(serializeErr(agg));
  assert.ok(!json.includes(SECRET), json);
});

test('serializeErr: dongusel cause sonlanir, cause en fazla 3 seviye', () => {
  const a = new Error('a');
  const b = new Error('b', { cause: a });
  (a as { cause?: unknown }).cause = b;
  const out = serializeErr(a) as LogLine;
  assert.ok(JSON.stringify(out).length > 0);

  let chain: Error = new Error('e0');
  for (let i = 1; i <= 8; i++) chain = new Error(`e${i}`, { cause: chain });
  let depth = 0;
  let cur = serializeErr(chain) as LogLine | undefined;
  while (cur?.cause) {
    depth++;
    cur = cur.cause as LogLine;
  }
  assert.equal(depth, 3);
});

test('serializeErr: Error olmayan degerler yazilmaz; uzun mesaj kirpilir; normal hata korunur', () => {
  for (const v of ['raw ' + SECRET, { password: SECRET }, 42, null, undefined]) {
    const out = serializeErr(v) as LogLine;
    assert.deepEqual(Object.keys(out).sort(), ['message', 'type']);
    assert.equal(out.type, typeof v);
    assert.ok(!JSON.stringify(out).includes(SECRET));
  }
  const big = serializeErr(new Error('x'.repeat(100_000))) as { message: string; stack: string };
  assert.ok(big.message.length < 2100 && big.stack.length < 2100);

  const plain = serializeErr(new Error('db down')) as LogLine;
  assert.equal(plain.message, 'db down');
  assert.ok(typeof plain.stack === 'string' && plain.stack.includes('db down'));
});

test('status alanli ama expose olmayan hata -> 500 + unhandled_error', async () => {
  await withApp(
    async (url, lines) => {
      const res = await fetch(`${url}/api/__probe`);
      assert.equal(res.status, 500);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'INTERNAL_ERROR');
      const rows = parseLines(lines());
      assert.ok(rows.some((r) => r.event === 'unhandled_error'));
      assert.ok(!rows.some((r) => r.event === 'client_error'));
    },
    probeApp((next) => next(Object.assign(new Error('upstream yok'), { status: 404 }))),
  );
});

test('expose=true + 404 -> 404 NOT_FOUND, client_error satiri, mesaj yok', async () => {
  await withApp(
    async (url, lines) => {
      const res = await fetch(`${url}/api/__probe`);
      assert.equal(res.status, 404);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, 'NOT_FOUND');
      assert.ok(!body.error.message.includes('Bulunamadi'));
      const out = lines();
      assert.ok(!out.includes('Bulunamadi'));
      const row = parseLines(out).find((r) => r.event === 'client_error');
      assert.ok(row);
      assert.equal(row.type, null);
      assert.equal(row.status, 404);
    },
    probeApp((next) => next(Object.assign(new Error('Bulunamadi'), { status: 404, expose: true }))),
  );
});

test("next('raw ...') -> 500, log ve yanitta sizinti yok", async () => {
  await withApp(
    async (url, lines) => {
      const res = await fetch(`${url}/api/__probe`);
      const text = await res.text();
      assert.equal(res.status, 500);
      assert.ok(!text.includes(SECRET), text);
      const out = lines();
      assert.ok(!out.includes(SECRET), out);
      assert.ok(out.includes('unhandled_error'));
    },
    probeApp((next) => next('raw ' + SECRET)),
  );
});

test('bozuk JSON -> client_error satiri type entity.parse.failed, sizinti yok', async () => {
  await withApp(async (url, lines) => {
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"password":"${SECRET}",`,
    });
    assert.equal(res.status, 400);
    const out = lines();
    assert.ok(!out.includes(SECRET), out);
    const row = parseLines(out).find((r) => r.event === 'client_error');
    assert.ok(row);
    assert.equal(row.type, 'entity.parse.failed');
    assert.equal(row.status, 400);
  });
});

test('5xx: pino-http sentetik err satiri yok, unhandled_error stack ile var', async () => {
  await withApp(
    async (url, lines) => {
      await fetch(`${url}/api/__probe`);
      const rows = parseLines(lines());
      assert.ok(!lines().includes('failed with status code'));
      const un = rows.find((r) => r.event === 'unhandled_error');
      assert.ok(un);
      const err = un.err as LogLine;
      assert.equal(err.message, 'db down');
      assert.ok(typeof err.stack === 'string');
      const req = rows.find(
        (r) => typeof r.msg === 'string' && r.msg.startsWith('GET /api/__probe'),
      );
      assert.ok(req && req.err === undefined, lines());
    },
    probeApp((next) => next(new Error('db down'))),
  );
});
