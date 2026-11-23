import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { asyncHandler } from './error.ts';

function run(fn: () => unknown): Promise<unknown[]> {
  return new Promise((resolve) => {
    const calls: unknown[] = [];
    const next = (err?: unknown) => {
      calls.push(err);
      resolve(calls);
    };
    asyncHandler(fn)({} as Request, {} as Response, next);
    // Basarida next cagrilmaz; mikro/makro gorev sonrasi mevcut cagrilari don.
    setTimeout(() => resolve(calls), 20);
  });
}

test('Promise.reject(undefined) Error ile next edilir', async () => {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  const calls = await run(() => Promise.reject(undefined));
  assert.equal(calls.length, 1);
  assert.ok(calls[0] instanceof Error);
});

test('senkron throw undefined/null Error ile next edilir', async () => {
  for (const v of [undefined, null, 0, '']) {
    const calls = await run(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw v;
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof Error);
  }
});

test('normal Error aynen iletilir', async () => {
  const err = new Error('x');
  assert.equal((await run(() => Promise.reject(err)))[0], err);
  assert.equal(
    (
      await run(() => {
        throw err;
      })
    )[0],
    err,
  );
});

test('basarida next cagrilmaz', async () => {
  assert.equal((await run(() => Promise.resolve('ok'))).length, 0);
});
