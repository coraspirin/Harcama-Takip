import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFreeMoney, calculatePace } from './budgetPaceService.ts';

describe('aylik limit hizi', () => {
  test('ay ortasinda: kalan gunler bugun DAHIL sayilir', () => {
    // Eylul 30 gun; 10'unda 10 gun gecti, bugun dahil 21 gun kaldi
    const pace = calculatePace({
      yearMonth: '2026-09',
      today: '2026-09-10',
      limitKurus: 3_000_000,
      spentKurus: 1_000_000,
    });

    assert.equal(pace.phase, 'current');
    assert.equal(pace.daysElapsed, 10);
    assert.equal(pace.daysLeft, 21);
    assert.equal(pace.remainingKurus, 2_000_000);
    // 20.000 TL / 21 gun = 952,38 -> kurusa asagi yuvarlanir
    assert.equal(pace.dailyAllowanceKurus, 95_238);
    // 10 gunde 10.000 TL -> 30 gunde 30.000 TL
    assert.equal(pace.projectedSpendKurus, 3_000_000);
    assert.equal(pace.projectedExceeds, false);
    assert.equal(pace.usagePercent, 33);
  });

  test('mevcut hiz limiti asacaksa projectedExceeds true olur', () => {
    const pace = calculatePace({
      yearMonth: '2026-09',
      today: '2026-09-10',
      limitKurus: 2_000_000,
      spentKurus: 1_000_000,
    });
    assert.equal(pace.projectedSpendKurus, 3_000_000);
    assert.equal(pace.projectedExceeds, true);
    assert.equal(pace.exceeded, false, 'henuz asilmadi, yalnizca gidisat kotu');
  });

  test('limit asildiysa gunluk harcanabilir 0 olur, eksiye dusmez', () => {
    const pace = calculatePace({
      yearMonth: '2026-09',
      today: '2026-09-20',
      limitKurus: 1_000_000,
      spentKurus: 1_200_000,
    });
    assert.equal(pace.remainingKurus, -200_000);
    assert.equal(pace.dailyAllowanceKurus, 0);
    assert.equal(pace.exceeded, true);
  });

  test('ayin son gunu: tek gun kalir', () => {
    const pace = calculatePace({
      yearMonth: '2026-02',
      today: '2026-02-28',
      limitKurus: 100_000,
      spentKurus: 40_000,
    });
    assert.equal(pace.daysInMonth, 28);
    assert.equal(pace.daysLeft, 1);
    assert.equal(pace.dailyAllowanceKurus, 60_000);
  });

  test('gecmis ay: kalan gun yok, tahmin gercek harcamadir', () => {
    const pace = calculatePace({
      yearMonth: '2026-08',
      today: '2026-09-10',
      limitKurus: 100_000,
      spentKurus: 80_000,
    });
    assert.equal(pace.phase, 'past');
    assert.equal(pace.daysLeft, 0);
    assert.equal(pace.dailyAllowanceKurus, null);
    assert.equal(pace.projectedSpendKurus, 80_000);
  });

  test('gelecek ay: tum gunler kalir, limit gunlere bolunur', () => {
    const pace = calculatePace({
      yearMonth: '2026-10',
      today: '2026-09-10',
      limitKurus: 3_100_000,
      spentKurus: 0,
    });
    assert.equal(pace.phase, 'future');
    assert.equal(pace.daysElapsed, 0);
    assert.equal(pace.daysLeft, 31);
    assert.equal(pace.dailyAllowanceKurus, 100_000);
    assert.equal(pace.projectedSpendKurus, 0);
  });
});

describe('serbest para', () => {
  test('beklenen gelir - harcanan - bekleyen odemeler', () => {
    const free = calculateFreeMoney({
      actualIncomeKurus: 5_000_000,
      pendingIncomeKurus: 0,
      averageIncomeKurus: 4_800_000,
      spentKurus: 2_000_000,
      pendingExpenseKurus: 1_500_000,
    });
    assert.equal(free.expectedIncomeKurus, 5_000_000);
    assert.equal(free.incomeIsEstimate, false);
    assert.equal(free.freeKurus, 1_500_000);
  });

  test('bu ay gelir gorunmuyorsa onceki aylarin ortalamasi kullanilir', () => {
    const free = calculateFreeMoney({
      actualIncomeKurus: 0,
      pendingIncomeKurus: 0,
      averageIncomeKurus: 4_800_000,
      spentKurus: 300_000,
      pendingExpenseKurus: 0,
    });
    assert.equal(free.expectedIncomeKurus, 4_800_000);
    assert.equal(free.incomeIsEstimate, true);
    assert.equal(free.freeKurus, 4_500_000);
  });

  test('bekleyen planlanan alacak beklenen gelire eklenir', () => {
    const free = calculateFreeMoney({
      actualIncomeKurus: 1_000_000,
      pendingIncomeKurus: 250_000,
      averageIncomeKurus: 0,
      spentKurus: 0,
      pendingExpenseKurus: 0,
    });
    assert.equal(free.expectedIncomeKurus, 1_250_000);
  });

  test('harcama geliri asarsa serbest para eksiye duser', () => {
    const free = calculateFreeMoney({
      actualIncomeKurus: 1_000_000,
      pendingIncomeKurus: 0,
      averageIncomeKurus: 0,
      spentKurus: 900_000,
      pendingExpenseKurus: 300_000,
    });
    assert.equal(free.freeKurus, -200_000);
  });
});

describe('serbest para ve kenara ayirma', () => {
  test('seyrek giderlerin aylik payi serbest paradan dusulur', () => {
    const free = calculateFreeMoney({
      actualIncomeKurus: 5_000_000,
      pendingIncomeKurus: 0,
      averageIncomeKurus: 0,
      spentKurus: 2_000_000,
      pendingExpenseKurus: 500_000,
      reserveKurus: 100_000,
    });
    assert.equal(free.freeKurus, 2_400_000);
  });
});
