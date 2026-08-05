import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBasisPoints,
  formatKurus,
  formatTRY,
  parseKurus,
  percentChange,
  splitInstallments,
} from './money.ts';

test('parseKurus - turkce ve ingilizce bicimler', () => {
  assert.equal(parseKurus('1.234,56'), 123456);
  assert.equal(parseKurus('1234,56'), 123456);
  assert.equal(parseKurus('1234.56'), 123456);
  assert.equal(parseKurus('1,234.56'), 123456);
  assert.equal(parseKurus('1234'), 123400);
  assert.equal(parseKurus('1.234'), 123400); // binlik ayraci
  assert.equal(parseKurus('  99,90 ₺ '), 9990);
  assert.equal(parseKurus('-45,50'), -4550);
  assert.equal(parseKurus(12.34), 1234);
});

test('parseKurus - gecersiz girdi hata verir', () => {
  assert.throws(() => parseKurus(''));
  assert.throws(() => parseKurus('abc'));
});

test('formatKurus - binlik ayraci ve iki hane kurus', () => {
  assert.equal(formatKurus(123456), '1.234,56');
  assert.equal(formatKurus(5), '0,05');
  assert.equal(formatKurus(0), '0,00');
  assert.equal(formatKurus(-123456), '-1.234,56');
  assert.equal(formatTRY(100000), '1.000,00 ₺');
});

test('splitInstallments - toplam her zaman korunur', () => {
  const parts = splitInstallments(100000, 3);
  assert.deepEqual(parts, [33334, 33333, 33333]);
  assert.equal(
    parts.reduce((a, b) => a + b, 0),
    100000,
  );
});

test('splitInstallments - tam bolunen ve tek taksit', () => {
  assert.deepEqual(splitInstallments(90000, 3), [30000, 30000, 30000]);
  assert.deepEqual(splitInstallments(12345, 1), [12345]);
});

test('splitInstallments - 12 taksitte de toplam korunur', () => {
  for (const total of [100000, 99999, 1, 123457, 7]) {
    for (const n of [2, 3, 6, 9, 12, 24]) {
      const sum = splitInstallments(total, n).reduce((a, b) => a + b, 0);
      assert.equal(sum, total, `${total} / ${n}`);
    }
  }
});

test('splitInstallments - gecersiz taksit sayisi', () => {
  assert.throws(() => splitInstallments(1000, 0));
  assert.throws(() => splitInstallments(1000, -1));
  assert.throws(() => splitInstallments(10.5, 2));
});

test('applyBasisPoints - aylik %3.11 faiz', () => {
  // 1.000,00 TL uzerinden %3.11 -> 31,10 TL
  assert.equal(applyBasisPoints(100000, 311), 3110);
  assert.equal(applyBasisPoints(0, 311), 0);
  // Yuvarlama tam sayi kurusa yapilir
  assert.equal(applyBasisPoints(1, 311), 0);
  assert.equal(applyBasisPoints(100, 311), 3);
});

test('percentChange - payda sifir tanimsizdir', () => {
  assert.equal(percentChange(0, 100), null);
  assert.equal(percentChange(100, 150), 50);
  assert.equal(percentChange(100, 50), -50);
});
