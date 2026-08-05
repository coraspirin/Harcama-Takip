import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStatementInterest, reconcileStatement } from './interestService.ts';

test('borcun tamami odenirse faiz sifirdir', () => {
  const result = calculateStatementInterest({
    statementAmountKurus: 500_000,
    paidAmountKurus: 500_000,
    monthlyInterestBp: 311,
    taxesIncluded: true,
  });

  assert.equal(result.unpaidKurus, 0);
  assert.equal(result.totalInterestKurus, 0);
  assert.equal(result.estimatedDebtKurus, 0);
});

test('fazla odeme yapilsa da kalan borc negatife dusmez', () => {
  const result = calculateStatementInterest({
    statementAmountKurus: 100_000,
    paidAmountKurus: 150_000,
    monthlyInterestBp: 311,
    taxesIncluded: true,
  });

  assert.equal(result.unpaidKurus, 0);
  assert.equal(result.totalInterestKurus, 0);
});

test('kismi odemede kalan tutar uzerinden faiz isler (vergisiz)', () => {
  // Ekstre 1.000,00 - odenen 400,00 -> kalan 600,00
  // %3,11 aylik faiz -> 18,66
  const result = calculateStatementInterest({
    statementAmountKurus: 100_000,
    paidAmountKurus: 40_000,
    monthlyInterestBp: 311,
    taxesIncluded: false,
  });

  assert.equal(result.unpaidKurus, 60_000);
  assert.equal(result.baseInterestKurus, 1_866);
  assert.equal(result.taxKurus, 0);
  assert.equal(result.totalInterestKurus, 1_866);
  assert.equal(result.estimatedDebtKurus, 61_866);
});

test('vergiler dahilse faize KKDF + BSMV (%30) eklenir', () => {
  const result = calculateStatementInterest({
    statementAmountKurus: 100_000,
    paidAmountKurus: 40_000,
    monthlyInterestBp: 311,
    taxesIncluded: true,
  });

  assert.equal(result.baseInterestKurus, 1_866);
  // 1866 * %30 = 559,8 -> 560 kurus
  assert.equal(result.taxKurus, 560);
  assert.equal(result.totalInterestKurus, 2_426);
  assert.equal(result.estimatedDebtKurus, 62_426);
});

test('hic odeme yapilmazsa tum ekstre tutari faize tabi olur', () => {
  const result = calculateStatementInterest({
    statementAmountKurus: 250_000,
    paidAmountKurus: 0,
    monthlyInterestBp: 400,
    taxesIncluded: false,
  });

  assert.equal(result.unpaidKurus, 250_000);
  assert.equal(result.baseInterestKurus, 10_000); // %4 -> 100,00 TL
  assert.equal(result.estimatedDebtKurus, 260_000);
});

test('faiz orani tanimsizsa (banka secilmemis) faiz sifirdir', () => {
  const result = calculateStatementInterest({
    statementAmountKurus: 100_000,
    paidAmountKurus: 0,
    monthlyInterestBp: 0,
    taxesIncluded: true,
  });

  assert.equal(result.totalInterestKurus, 0);
  assert.equal(result.estimatedDebtKurus, 100_000);
});

test('tum ara sonuclar tam sayi kurustur (float sizintisi yok)', () => {
  const result = calculateStatementInterest({
    statementAmountKurus: 33_333,
    paidAmountKurus: 11_111,
    monthlyInterestBp: 277,
    taxesIncluded: true,
  });

  for (const value of [
    result.unpaidKurus,
    result.baseInterestKurus,
    result.taxKurus,
    result.totalInterestKurus,
    result.estimatedDebtKurus,
  ]) {
    assert.ok(Number.isInteger(value), `${value} tam sayi olmali`);
  }
});

test('mutabakat farki dogru hesaplanir', () => {
  const match = reconcileStatement(100_000, 100_000);
  assert.equal(match.matches, true);
  assert.equal(match.differenceKurus, 0);

  // Ekstre islemlerden 250,00 TL fazla -> girilmemis bir harcama var
  const mismatch = reconcileStatement(125_000, 100_000);
  assert.equal(mismatch.matches, false);
  assert.equal(mismatch.differenceKurus, 25_000);
});
