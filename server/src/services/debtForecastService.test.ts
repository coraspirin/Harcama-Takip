import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareExtraPayment,
  simulatePayoff,
  simulateStrategy,
  type StrategyDebt,
} from './debtForecastService.ts';

describe('tek borcun bitme tahmini', () => {
  test('faizsiz borc: bakiye / aylik odeme kadar ay', () => {
    const payoff = simulatePayoff({
      balanceKurus: 1_000_000,
      monthlyInterestBp: 0,
      taxesIncluded: false,
      paymentKurus: 100_000,
      startMonth: '2026-11',
    });
    assert.equal(payoff.status, 'ends');
    assert.equal(payoff.months, 10);
    assert.equal(payoff.payoffMonth, '2027-08');
    assert.equal(payoff.totalInterestKurus, 0);
    assert.equal(payoff.totalPaidKurus, 1_000_000);
  });

  test('faizli borc: 10.000 TL, aylik %4,25, ayda 1.000 TL -> 14 ay', () => {
    // Anuite formulu: n = -ln(1 - rB/P) / ln(1 + r) = 13,3 -> 14. odemede biter
    const payoff = simulatePayoff({
      balanceKurus: 1_000_000,
      monthlyInterestBp: 425,
      taxesIncluded: false,
      paymentKurus: 100_000,
      startMonth: '2026-11',
    });
    assert.equal(payoff.status, 'ends');
    assert.equal(payoff.months, 14);
    assert.equal(payoff.firstMonthInterestKurus, 42_500);

    // Odenen toplam = anapara + faiz; son odeme kalan kadar
    assert.equal(payoff.totalPaidKurus, 1_000_000 + payoff.totalInterestKurus!);
    const last = payoff.schedule[payoff.schedule.length - 1]!;
    assert.ok(last.paymentKurus < 100_000);
    assert.equal(last.closingKurus, 0);
  });

  test('vergiler dahilse faiz daha yuksek, bitis daha gec', () => {
    const base = { balanceKurus: 1_000_000, monthlyInterestBp: 425, paymentKurus: 100_000, startMonth: '2026-11' };
    const withoutTax = simulatePayoff({ ...base, taxesIncluded: false });
    const withTax = simulatePayoff({ ...base, taxesIncluded: true });
    assert.ok(withTax.totalInterestKurus! > withoutTax.totalInterestKurus!);
    assert.ok(withTax.months! >= withoutTax.months!);
  });

  test('odeme faizi karsilamiyorsa borc hic bitmez', () => {
    const payoff = simulatePayoff({
      balanceKurus: 1_000_000,
      monthlyInterestBp: 425,
      taxesIncluded: false,
      paymentKurus: 42_500,
      startMonth: '2026-11',
    });
    assert.equal(payoff.status, 'never');
    assert.equal(payoff.months, null);
  });

  test('odeme tanimli degilse tahmin yapilmaz', () => {
    const payoff = simulatePayoff({
      balanceKurus: 1_000_000,
      monthlyInterestBp: 0,
      taxesIncluded: false,
      paymentKurus: null,
      startMonth: '2026-11',
    });
    assert.equal(payoff.status, 'no_payment');
  });

  test('sifir bakiye zaten bitmis sayilir', () => {
    const payoff = simulatePayoff({
      balanceKurus: 0,
      monthlyInterestBp: 425,
      taxesIncluded: true,
      paymentKurus: 100_000,
      startMonth: '2026-11',
    });
    assert.equal(payoff.status, 'paid');
    assert.equal(payoff.months, 0);
  });
});

describe('fazla odeme karsilastirmasi', () => {
  test('ayda fazladan odeme borcu erken bitirir ve faizi azaltir', () => {
    const result = compareExtraPayment(
      {
        balanceKurus: 1_000_000,
        monthlyInterestBp: 425,
        taxesIncluded: false,
        paymentKurus: 100_000,
        startMonth: '2026-11',
      },
      50_000,
    );
    assert.ok(result.monthsSaved! > 0);
    assert.ok(result.interestSavedKurus! > 0);
    assert.equal(result.base.months! - result.improved.months!, result.monthsSaved);
  });

  test('bitmeyen borc fazla odemeyle bitebilir; fark hesaplanamaz', () => {
    const result = compareExtraPayment(
      {
        balanceKurus: 1_000_000,
        monthlyInterestBp: 425,
        taxesIncluded: false,
        paymentKurus: 40_000,
        startMonth: '2026-11',
      },
      60_000,
    );
    assert.equal(result.base.status, 'never');
    assert.equal(result.improved.status, 'ends');
    assert.equal(result.monthsSaved, null);
  });
});

describe('cig ve kartopu yontemleri', () => {
  const debts: StrategyDebt[] = [
    // Kucuk bakiye, dusuk faiz
    { id: 1, name: 'Arkadas', balanceKurus: 200_000, monthlyInterestBp: 0, taxesIncluded: false, minPaymentKurus: 20_000 },
    // Buyuk bakiye, yuksek faiz
    { id: 2, name: 'Kart', balanceKurus: 1_500_000, monthlyInterestBp: 400, taxesIncluded: true, minPaymentKurus: 100_000 },
  ];

  test('kartopu once kucuk bakiyeyi kapatir', () => {
    const result = simulateStrategy(debts, 100_000, 'snowball', '2026-11');
    assert.equal(result.status, 'ends');
    assert.equal(result.order[0]?.id, 1);
  });

  test('cig once yuksek faizliye yuklenir ve toplam faizi daha az odetir', () => {
    const avalanche = simulateStrategy(debts, 100_000, 'avalanche', '2026-11');
    const snowball = simulateStrategy(debts, 100_000, 'snowball', '2026-11');
    assert.equal(avalanche.status, 'ends');
    assert.ok(avalanche.totalInterestKurus! <= snowball.totalInterestKurus!);
  });

  test('fazla odeme tum borclarin bitisini one ceker', () => {
    const none = simulateStrategy(debts, 0, 'avalanche', '2026-11');
    const extra = simulateStrategy(debts, 200_000, 'avalanche', '2026-11');
    assert.ok(extra.months! < none.months!);
  });

  test('butce faizi karsilamiyorsa hic bitmez', () => {
    const result = simulateStrategy(
      [{ id: 1, name: 'Kart', balanceKurus: 10_000_000, monthlyInterestBp: 500, taxesIncluded: true, minPaymentKurus: 100_000 }],
      0,
      'avalanche',
      '2026-11',
    );
    assert.equal(result.status, 'never');
  });

  test('borc yoksa bitmis sayilir', () => {
    const result = simulateStrategy([], 100_000, 'snowball', '2026-11');
    assert.equal(result.status, 'paid');
  });
});
