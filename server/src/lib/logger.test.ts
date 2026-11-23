import '../test/env.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from './logger.ts';

function capture(): { lines: () => string; stream: { write: (s: string) => void } } {
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

test('hassas alanlar loga yazilmaz (redact)', () => {
  const sink = capture();
  const log = createLogger({ level: 'info', stream: sink.stream });

  log.info(
    {
      req: { headers: { authorization: 'Bearer GIZLI-JWT', cookie: 'access=GIZLI-COOKIE' } },
      res: { headers: { 'set-cookie': ['refresh=GIZLI-REFRESH'] } },
      password: 'GIZLI-PAROLA',
      user: { password: 'GIZLI-PAROLA-2', token: 'GIZLI-TOKEN' },
      ha: { token_encrypted: 'GIZLI-SIFRELI' },
    },
    'deneme',
  );

  const out = sink.lines();
  assert.ok(out.includes('deneme'));
  assert.ok(out.includes('[Redacted]'));
  assert.ok(!/GIZLI/.test(out), `gizli deger sizdi: ${out}`);
});

test('err alani stack ile serilestirilir', () => {
  const sink = capture();
  const log = createLogger({ level: 'info', stream: sink.stream });
  log.error({ err: new Error('patladi') }, 'hata');

  const parsed = JSON.parse(sink.lines()) as { err: { message: string; stack: string } };
  assert.equal(parsed.err.message, 'patladi');
  assert.ok(parsed.err.stack.includes('Error'));
});
