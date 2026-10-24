import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { averageHistory, buildForecast, projectDebts, type HistoryMonth } from './forecastService.ts';
import type { StrategyDebt } from './debtForecastService.ts';

const history: HistoryMonth[] = [
  { month: '2026-07', incomeKurus: 5_000_000, fixedExpenseKurus: 2_000_000, variableExpenseKurus: 1_500_000 },
  { month: '2026-08', incomeKurus: 5_000_000, fixedExpenseKurus: 2_000_000, variableExpenseKurus: 2_500_000 },
  { month: '2026-09', incomeKurus: 5_000_000, fixedExpenseKurus: 2_000_000, variableExpenseKurus: 2_000_000 },
];

const loan: StrategyDebt = {
  id: 1,
  name: 'Kredi',
  balanceKurus: 1_000_000,
  monthlyInterestBp: 0,
  taxesIncluded: false,
  minPaymentKurus: 100_000,
};

describe('gecmis ortalamasi', () => {
  test('gelir, sabit ve degisken gider ayri ortalanir', () => {
    const avg = averageHistory(history);
    assert.equal(avg.months, 3);
    assert.equal(avg.incomeKurus, 5_000_000);
    assert.equal(avg.fixedExpenseKurus, 2_000_000);
    assert.equal(avg.variableExpenseKurus, 2_000_000);
    assert.equal(avg.netKurus, 1_000_000);
  });

  test('veri yoksa sifir', () => {
    assert.equal(averageHistory([]).netKurus, 0);
  });
});

describe('borc projeksiyonu', () => {
  test('aylik odemeyle borc her ay azalir', () => {
    const timeline = projectDebts([loan], '2026-11', 3);
    assert.deepEqual(
      timeline.map((t) => t.balanceKurus),
      [900_000, 800_000, 700_000],
    );
    assert.equal(timeline[0]?.paidKurus, 100_000);
  });

  test('yuvarlamada ek tutar en yuksek faizliye gider', () => {
    const card: StrategyDebt = { ...loan, id: 2, name: 'Kart', monthlyInterestBp: 300, minPaymentKurus: 50_000 };
    const timeline = projectDebts([loan, card], '2026-11', 1, { extraKurus: 100_000, rollover: true });
    // Kart: 1.000.000 + %3 faiz = 1.030.000 - 50.000 asgari - 100.000 ek
    assert.equal(timeline[0]?.balanceKurus, 900_000 + 880_000);
    assert.equal(timeline[0]?.paidKurus, 250_000);
  });
});

describe('gidisat tahmini', () => {
  test('nakit = net - borc odemesi - taksit - birikim plani; 12 ay ileri', () => {
    const forecast = buildForecast({
      history,
      debts: [loan],
      installmentsByMonth: new Map([['2026-11', 50_000]]),
      installmentRemainingKurus: 50_000,
      savingsPlanKurus: 200_000,
      startMonth: '2026-11',
      cutKurus: 0,
    });

    assert.equal(forecast.projection.length, 12);
    assert.equal(forecast.start.debtKurus, 1_050_000);
    // Ilk ay: 1.000.000 - 100.000 - 50.000 - 200.000
    assert.equal(forecast.monthlyFreeCashKurus, 650_000);
    assert.equal(forecast.projection[0]?.cashKurus, 650_000);
    assert.equal(forecast.projection[0]?.debtKurus, 900_000);
    // Kredi 10. ayda biter; son iki ay odeme yok -> nakit hizlanir
    assert.equal(forecast.end.debtKurus, 0);
    assert.equal(forecast.direction, 'improving');
  });

  test('gider geliri asiyorsa yon kotulesiyor', () => {
    const forecast = buildForecast({
      history: [{ month: '2026-09', incomeKurus: 1_000_000, fixedExpenseKurus: 800_000, variableExpenseKurus: 400_000 }],
      debts: [],
      installmentsByMonth: new Map(),
      installmentRemainingKurus: 0,
      savingsPlanKurus: 0,
      startMonth: '2026-11',
      cutKurus: 0,
    });
    assert.ok(forecast.end.cashKurus < 0);
    assert.equal(forecast.direction, 'worsening');
  });

  test('ayda daha az harcayip borca yatirmak borcu erken bitirir', () => {
    const card: StrategyDebt = { ...loan, name: 'Kart', monthlyInterestBp: 400, taxesIncluded: true, minPaymentKurus: 80_000 };
    const forecast = buildForecast({
      history,
      debts: [card],
      installmentsByMonth: new Map(),
      installmentRemainingKurus: 0,
      savingsPlanKurus: 0,
      startMonth: '2026-11',
      cutKurus: 100_000,
    });

    assert.ok(forecast.scenario);
    assert.ok((forecast.scenario.monthsSaved ?? 0) > 0);
    assert.ok((forecast.scenario.interestSavedKurus ?? 0) > 0);
    assert.ok(forecast.scenario.debtFreeMonth! < forecast.scenario.baselineDebtFreeMonth!);
    // Kesinti borca gittigi icin 12. ayda borc daha az
    assert.ok(forecast.scenario.projection[11]!.debtKurus < forecast.projection[11]!.debtKurus);
  });
});
