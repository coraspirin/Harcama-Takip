import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateGoalProgress,
  monthlySavingsCommitment,
  suggestEmergencyFund,
} from './savingsForecastService.ts';

describe('birikim hedefi', () => {
  test('tarihli hedef: kalan tutar kalan aylara bolunur (bu ay dahil)', () => {
    const progress = calculateGoalProgress({
      targetKurus: 3_000_000,
      targetDate: '2027-03-31',
      today: '2026-10-24',
      contributions: [{ date: '2026-10-01', amountKurus: 600_000 }],
    });
    assert.equal(progress.savedKurus, 600_000);
    assert.equal(progress.remainingKurus, 2_400_000);
    assert.equal(progress.percent, 20);
    // Ekim..Mart = 6 ay
    assert.equal(progress.monthsLeft, 6);
    assert.equal(progress.requiredMonthlyKurus, 400_000);
  });

  test('tempo yeni hedefte yalnizca ilk katkidan itibaren hesaplanir', () => {
    const progress = calculateGoalProgress({
      targetKurus: 1_000_000,
      targetDate: null,
      today: '2026-10-24',
      contributions: [{ date: '2026-10-05', amountKurus: 100_000 }],
    });
    // Tek ay: ortalama 100.000; kalan 900.000 -> 9 ay sonra
    assert.equal(progress.averageMonthlyKurus, 100_000);
    assert.equal(progress.projectedMonth, '2027-07');
    assert.equal(progress.onTrack, null);
  });

  test('tempo hedef tarihine yetmiyorsa onTrack false', () => {
    const progress = calculateGoalProgress({
      targetKurus: 1_000_000,
      targetDate: '2026-12-31',
      today: '2026-10-24',
      contributions: [
        { date: '2026-08-10', amountKurus: 50_000 },
        { date: '2026-09-10', amountKurus: 50_000 },
        { date: '2026-10-10', amountKurus: 50_000 },
      ],
    });
    assert.equal(progress.averageMonthlyKurus, 50_000);
    assert.equal(progress.onTrack, false);
    // Kalan 850.000 / 3 ay
    assert.equal(progress.requiredMonthlyKurus, 283_334);
  });

  test('cekisler (eksi katki) birikimi azaltir', () => {
    const progress = calculateGoalProgress({
      targetKurus: 1_000_000,
      targetDate: null,
      today: '2026-10-24',
      contributions: [
        { date: '2026-09-01', amountKurus: 500_000 },
        { date: '2026-10-01', amountKurus: -200_000 },
      ],
    });
    assert.equal(progress.savedKurus, 300_000);
  });

  test('hedefe ulasildiysa gereken tutar yok, tahmin bu ay', () => {
    const progress = calculateGoalProgress({
      targetKurus: 100_000,
      targetDate: '2027-01-31',
      today: '2026-10-24',
      contributions: [{ date: '2026-10-01', amountKurus: 120_000 }],
    });
    assert.equal(progress.reached, true);
    assert.equal(progress.requiredMonthlyKurus, null);
    assert.equal(progress.onTrack, true);
    assert.equal(progress.percent, 120);
  });

  test('katki yoksa tahmin yapilmaz', () => {
    const progress = calculateGoalProgress({
      targetKurus: 100_000,
      targetDate: null,
      today: '2026-10-24',
      contributions: [],
    });
    assert.equal(progress.projectedMonth, null);
    assert.equal(progress.averageMonthlyKurus, 0);
  });
});

describe('acil durum fonu onerisi', () => {
  test('aylik sabit giderin 3 ve 6 kati', () => {
    const suggestion = suggestEmergencyFund([2_000_000, 2_200_000, 1_800_000]);
    assert.equal(suggestion.averageFixedExpenseKurus, 2_000_000);
    assert.equal(suggestion.minKurus, 6_000_000);
    assert.equal(suggestion.comfortableKurus, 12_000_000);
  });

  test('veri yoksa oneri sifir', () => {
    assert.equal(suggestEmergencyFund([]).minKurus, 0);
  });
});

describe('aylik birikim taahhudu', () => {
  test('plan ile bu ayki katkinin buyugu alinir', () => {
    assert.equal(
      monthlySavingsCommitment([
        { monthlyPlanKurus: 100_000, contributedThisMonthKurus: 30_000 },
        { monthlyPlanKurus: 50_000, contributedThisMonthKurus: 80_000 },
        { monthlyPlanKurus: null, contributedThisMonthKurus: 20_000 },
        { monthlyPlanKurus: null, contributedThisMonthKurus: -10_000 },
      ]),
      100_000 + 80_000 + 20_000,
    );
  });
});
