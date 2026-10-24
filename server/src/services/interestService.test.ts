import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyInterest } from './interestService.ts';

test('vergisiz aylik faiz bakiye x oran', () => {
  // 10.000 TL, aylik %4,25
  const result = monthlyInterest(1_000_000, 425, false);
  assert.equal(result.baseInterestKurus, 42_500);
  assert.equal(result.taxKurus, 0);
  assert.equal(result.totalInterestKurus, 42_500);
});

test('vergiler dahilse faize KKDF + BSMV (%30) eklenir', () => {
  // 1.000 TL, aylik %3,11 -> 31,10 TL faiz + 9,33 TL vergi
  const result = monthlyInterest(100_000, 311, true);
  assert.equal(result.baseInterestKurus, 3_110);
  assert.equal(result.taxKurus, 933);
  assert.equal(result.totalInterestKurus, 4_043);
});

test('faiz orani sifirsa faiz yoktur', () => {
  assert.equal(monthlyInterest(500_000, 0, true).totalInterestKurus, 0);
});

test('sifir veya eksi bakiyede faiz islemez', () => {
  assert.equal(monthlyInterest(0, 425, true).totalInterestKurus, 0);
  assert.equal(monthlyInterest(-1000, 425, true).totalInterestKurus, 0);
});

test('tum ara sonuclar tam sayi kurustur (float sizintisi yok)', () => {
  const result = monthlyInterest(123_457, 287, true);
  for (const value of Object.values(result)) {
    assert.ok(Number.isInteger(value), `${value} tam sayi olmali`);
  }
});
