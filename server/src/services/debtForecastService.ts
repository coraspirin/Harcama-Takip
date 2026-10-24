import { addMonthsToYearMonth, type YearMonth } from '../lib/date.ts';
import { monthlyInterest, TAX_SURCHARGE_BP } from './interestService.ts';

/**
 * Borcun bitme tahmini. Saf fonksiyonlardir; baslangic ayi disaridan verilir.
 *
 * Her ay once acilis bakiyesine bir aylik faiz (istenirse KKDF + BSMV ile)
 * eklenir, sonra odeme dusulur. Bu bir TAHMINDIR: bankalar faizi gun bazinda
 * isletir; sonuc kullaniciya "tahmini" ibaresiyle gosterilir.
 */

/** Simulasyonun ust siniri: 50 yil. Bunu asan borc "bitmiyor" sayilir. */
export const MAX_MONTHS = 600;

export type PayoffStatus =
  /** Bakiye zaten sifir */
  | 'paid'
  /** Tahmini bir bitis ayi var */
  | 'ends'
  /** Aylik odeme faizi karsilamiyor: borc hic azalmiyor */
  | 'never'
  /** Aylik odeme tanimli degil */
  | 'no_payment';

export type PayoffInput = {
  balanceKurus: number;
  monthlyInterestBp: number;
  taxesIncluded: boolean;
  paymentKurus: number | null;
  /** Ilk odemenin yapilacagi ay */
  startMonth: YearMonth;
};

export type PayoffRow = {
  month: YearMonth;
  openingKurus: number;
  interestKurus: number;
  paymentKurus: number;
  closingKurus: number;
};

export type Payoff = {
  status: PayoffStatus;
  /** Kac odemede biter; yalnizca 'ends' ve 'paid' (0) icin dolu */
  months: number | null;
  /** Son odemenin ayi */
  payoffMonth: YearMonth | null;
  /** Bitene kadar odenecek toplam faiz */
  totalInterestKurus: number | null;
  totalPaidKurus: number | null;
  /** Ilk ayin faizi: odeme bunun altindaysa borc buyur */
  firstMonthInterestKurus: number;
  schedule: PayoffRow[];
};

export function simulatePayoff(input: PayoffInput): Payoff {
  const firstMonthInterestKurus = monthlyInterest(
    input.balanceKurus,
    input.monthlyInterestBp,
    input.taxesIncluded,
  ).totalInterestKurus;

  const empty = {
    months: null,
    payoffMonth: null,
    totalInterestKurus: null,
    totalPaidKurus: null,
    firstMonthInterestKurus,
    schedule: [],
  };

  if (input.balanceKurus <= 0) {
    return { ...empty, status: 'paid', months: 0, totalInterestKurus: 0, totalPaidKurus: 0 };
  }
  if (input.paymentKurus === null || input.paymentKurus <= 0) {
    return { ...empty, status: 'no_payment' };
  }
  // Odeme ilk ayin faizini bile karsilamiyorsa bakiye her ay buyur.
  if (input.paymentKurus <= firstMonthInterestKurus) {
    return { ...empty, status: 'never' };
  }

  const schedule: PayoffRow[] = [];
  let balance = input.balanceKurus;
  let totalInterest = 0;
  let totalPaid = 0;

  for (let i = 0; i < MAX_MONTHS && balance > 0; i++) {
    const interest = monthlyInterest(balance, input.monthlyInterestBp, input.taxesIncluded)
      .totalInterestKurus;
    const due = balance + interest;
    const payment = Math.min(input.paymentKurus, due);

    schedule.push({
      month: addMonthsToYearMonth(input.startMonth, i),
      openingKurus: balance,
      interestKurus: interest,
      paymentKurus: payment,
      closingKurus: due - payment,
    });

    balance = due - payment;
    totalInterest += interest;
    totalPaid += payment;
  }

  if (balance > 0) return { ...empty, status: 'never' };

  return {
    status: 'ends',
    months: schedule.length,
    payoffMonth: schedule[schedule.length - 1]!.month,
    totalInterestKurus: totalInterest,
    totalPaidKurus: totalPaid,
    firstMonthInterestKurus,
    schedule,
  };
}

export type WhatIf = {
  base: Payoff;
  improved: Payoff;
  /** Kac ay erken biter; iki senaryodan biri bitmiyorsa null */
  monthsSaved: number | null;
  interestSavedKurus: number | null;
};

/** Aylik odemeye `extraKurus` eklenirse ne degisir? */
export function compareExtraPayment(input: PayoffInput, extraKurus: number): WhatIf {
  const base = simulatePayoff(input);
  const improved = simulatePayoff({
    ...input,
    paymentKurus: (input.paymentKurus ?? 0) + extraKurus,
  });

  const comparable =
    base.months !== null && improved.months !== null && base.totalInterestKurus !== null;

  return {
    base,
    improved,
    monthsSaved: comparable ? base.months! - improved.months! : null,
    interestSavedKurus: comparable
      ? base.totalInterestKurus! - (improved.totalInterestKurus ?? 0)
      : null,
  };
}

// --- Birden fazla borc: fazla odemeyi nereye vermeli? ---

export type Strategy =
  /** Cig: en yuksek faizli borc once - toplam faizi en aza indirir */
  | 'avalanche'
  /** Kartopu: en kucuk bakiye once - borc sayisi en hizli azalir */
  | 'snowball';

export type StrategyDebt = {
  id: number;
  name: string;
  balanceKurus: number;
  monthlyInterestBp: number;
  taxesIncluded: boolean;
  /** Her ay bu borca en az odenecek tutar (asgari/taksit). Yoksa 0. */
  minPaymentKurus: number;
};

export type StrategyResult = {
  strategy: Strategy;
  status: 'ends' | 'never' | 'paid';
  months: number | null;
  payoffMonth: YearMonth | null;
  totalInterestKurus: number | null;
  /** Borclarin kapanis sirasi */
  order: { id: number; name: string; months: number; payoffMonth: YearMonth }[];
};

function effectiveRateBp(debt: StrategyDebt): number {
  return debt.taxesIncluded
    ? debt.monthlyInterestBp + Math.round((debt.monthlyInterestBp * TAX_SURCHARGE_BP) / 10_000)
    : debt.monthlyInterestBp;
}

/**
 * Tum borclari birlikte simule eder. Her ay toplam butce = tum borclarin
 * asgari odemeleri + fazla tutar. Kapanan borcun asgari odemesi butceden
 * DUSMEZ, siradaki borca aktarilir ("yuvarlanir"); iki yontemin farki
 * yalnizca fazlaligin hangi borca once gittigidir.
 */
export function simulateStrategy(
  debts: StrategyDebt[],
  extraKurus: number,
  strategy: Strategy,
  startMonth: YearMonth,
): StrategyResult {
  const active = debts
    .filter((d) => d.balanceKurus > 0)
    .map((d) => ({ ...d, balance: d.balanceKurus }));

  if (active.length === 0) {
    return { strategy, status: 'paid', months: 0, payoffMonth: null, totalInterestKurus: 0, order: [] };
  }

  const budget = active.reduce((sum, d) => sum + d.minPaymentKurus, 0) + Math.max(0, extraKurus);

  const priority = [...active].sort((a, b) =>
    strategy === 'avalanche'
      ? effectiveRateBp(b) - effectiveRateBp(a) || a.balance - b.balance
      : a.balance - b.balance || effectiveRateBp(b) - effectiveRateBp(a),
  );

  const order: StrategyResult['order'] = [];
  let totalInterest = 0;

  for (let i = 0; i < MAX_MONTHS; i++) {
    const month = addMonthsToYearMonth(startMonth, i);
    const openingTotal = active.reduce((sum, d) => sum + d.balance, 0);

    for (const debt of active) {
      if (debt.balance <= 0) continue;
      const interest = monthlyInterest(debt.balance, debt.monthlyInterestBp, debt.taxesIncluded)
        .totalInterestKurus;
      debt.balance += interest;
      totalInterest += interest;
    }

    let remaining = budget;

    // Once herkese asgari odemesi
    for (const debt of active) {
      if (debt.balance <= 0) continue;
      const payment = Math.min(debt.minPaymentKurus, debt.balance, remaining);
      debt.balance -= payment;
      remaining -= payment;
    }

    // Kalan butce oncelik sirasiyla
    for (const debt of priority) {
      const target = active.find((d) => d.id === debt.id)!;
      if (remaining <= 0) break;
      if (target.balance <= 0) continue;
      const payment = Math.min(target.balance, remaining);
      target.balance -= payment;
      remaining -= payment;
    }

    for (const debt of active) {
      if (debt.balance <= 0 && !order.some((o) => o.id === debt.id)) {
        order.push({ id: debt.id, name: debt.name, months: i + 1, payoffMonth: month });
      }
    }

    const closingTotal = active.reduce((sum, d) => sum + Math.max(0, d.balance), 0);
    if (closingTotal === 0) {
      return {
        strategy,
        status: 'ends',
        months: i + 1,
        payoffMonth: month,
        totalInterestKurus: totalInterest,
        order,
      };
    }
    // Ilk ayda toplam borc azalmadiysa butce faizi karsilamiyor demektir.
    if (i === 0 && closingTotal >= openingTotal) break;
  }

  return {
    strategy,
    status: 'never',
    months: null,
    payoffMonth: null,
    totalInterestKurus: null,
    order,
  };
}
