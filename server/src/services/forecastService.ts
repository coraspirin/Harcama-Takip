import { addMonthsToYearMonth, type YearMonth } from '../lib/date.ts';
import { monthlyInterest } from './interestService.ts';
import { simulateStrategy, type StrategyDebt } from './debtForecastService.ts';

/**
 * "Boyle giderse" tahmini. Gecmis aylarin ortalamasi ileriye tasinir; borclar
 * aylik odemeleriyle, taksitler planiyla duser. Saf fonksiyonlardir.
 *
 * Nakit akisi = gelir - gider - borc odemeleri - taksitler - birikim plani.
 * Borc odemesi ve birikim gider degildir, bu yuzden ayri satirlardir.
 */

export const PROJECTION_MONTHS = 12;

export type HistoryMonth = {
  month: YearMonth;
  incomeKurus: number;
  fixedExpenseKurus: number;
  variableExpenseKurus: number;
};

export type Averages = {
  /** Ortalamaya giren (kaydi olan) ay sayisi */
  months: number;
  incomeKurus: number;
  fixedExpenseKurus: number;
  variableExpenseKurus: number;
  netKurus: number;
};

/** Yalnizca kaydi olan aylar ortalanir; bos aylar ortalamayi sifira cekmesin. */
export function averageHistory(history: HistoryMonth[]): Averages {
  const n = history.length;
  const avg = (pick: (h: HistoryMonth) => number) =>
    n === 0 ? 0 : Math.round(history.reduce((sum, h) => sum + pick(h), 0) / n);
  const incomeKurus = avg((h) => h.incomeKurus);
  const fixedExpenseKurus = avg((h) => h.fixedExpenseKurus);
  const variableExpenseKurus = avg((h) => h.variableExpenseKurus);
  return {
    months: n,
    incomeKurus,
    fixedExpenseKurus,
    variableExpenseKurus,
    netKurus: incomeKurus - fixedExpenseKurus - variableExpenseKurus,
  };
}

export type DebtMonth = { month: YearMonth; balanceKurus: number; paidKurus: number };

/**
 * Borclari N ay ileri tasir. `rollover` kapaliyken her borca yalnizca kendi
 * aylik odemesi yapilir; kapanan borcun odemesi serbest kalir (nakde doner).
 * Aciksa butce sabit kalir: kapanan borcun odemesi ve `extraKurus` en yuksek
 * faizli borca aktarilir (cig yontemi).
 */
export function projectDebts(
  debts: StrategyDebt[],
  startMonth: YearMonth,
  months: number,
  options: { extraKurus?: number; rollover?: boolean } = {},
): DebtMonth[] {
  const state = debts.map((d) => ({ ...d, balance: Math.max(0, d.balanceKurus) }));
  const budget =
    state.reduce((sum, d) => sum + d.minPaymentKurus, 0) + Math.max(0, options.extraKurus ?? 0);
  const byRate = [...state].sort((a, b) => b.monthlyInterestBp - a.monthlyInterestBp);
  const timeline: DebtMonth[] = [];

  for (let i = 0; i < months; i++) {
    for (const d of state) {
      if (d.balance > 0) d.balance += monthlyInterest(d.balance, d.monthlyInterestBp, d.taxesIncluded).totalInterestKurus;
    }

    let paid = 0;
    let remaining = options.rollover ? budget : Infinity;
    for (const d of state) {
      const payment = Math.min(d.minPaymentKurus, d.balance, remaining);
      d.balance -= payment;
      paid += payment;
      remaining -= payment;
    }
    if (options.rollover) {
      for (const d of byRate) {
        if (remaining <= 0) break;
        const payment = Math.min(d.balance, remaining);
        d.balance -= payment;
        paid += payment;
        remaining -= payment;
      }
    }

    timeline.push({
      month: addMonthsToYearMonth(startMonth, i),
      balanceKurus: state.reduce((sum, d) => sum + d.balance, 0),
      paidKurus: paid,
    });
  }

  return timeline;
}

export type ProjectionPoint = {
  month: YearMonth;
  /** O ayin odemelerinden sonra kalan toplam borc (taksitler dahil) */
  debtKurus: number;
  /** O aya kadar biriken nakit (eksi ise acik) */
  cashKurus: number;
};

export type ForecastInput = {
  history: HistoryMonth[];
  debts: StrategyDebt[];
  /** Taksitlerin ay bazinda bekleyen tutarlari */
  installmentsByMonth: Map<YearMonth, number>;
  installmentRemainingKurus: number;
  savingsPlanKurus: number;
  startMonth: YearMonth;
  /** Ayda bu kadar az harcanip borca yatirilirsa */
  cutKurus: number;
};

export type Scenario = {
  cutKurus: number;
  projection: ProjectionPoint[];
  debtFreeMonth: YearMonth | null;
  baselineDebtFreeMonth: YearMonth | null;
  monthsSaved: number | null;
  interestSavedKurus: number | null;
};

export type Forecast = {
  averages: Averages;
  monthlyDebtPaymentKurus: number;
  savingsPlanKurus: number;
  /** Ortalama net - borc odemeleri - taksit - birikim plani (ilk ay) */
  monthlyFreeCashKurus: number;
  projection: ProjectionPoint[];
  start: { debtKurus: number };
  end: { debtKurus: number; cashKurus: number };
  /** Nakit eksiye dusmuyor ve borc azaliyor/nakit birikiyorsa 'improving' */
  direction: 'improving' | 'worsening' | 'flat';
  scenario: Scenario | null;
};

function buildProjection(input: ForecastInput, debtTimeline: DebtMonth[], cutKurus: number) {
  const avg = averageHistory(input.history);
  let cash = 0;
  let installmentLeft = input.installmentRemainingKurus;

  return debtTimeline.map((point) => {
    const installment = input.installmentsByMonth.get(point.month) ?? 0;
    installmentLeft = Math.max(0, installmentLeft - installment);
    cash +=
      avg.incomeKurus -
      avg.fixedExpenseKurus -
      Math.max(0, avg.variableExpenseKurus - cutKurus) -
      point.paidKurus -
      installment -
      input.savingsPlanKurus;
    return { month: point.month, debtKurus: point.balanceKurus + installmentLeft, cashKurus: cash };
  });
}

export function buildForecast(input: ForecastInput): Forecast {
  const averages = averageHistory(input.history);
  const startDebt =
    input.debts.reduce((sum, d) => sum + Math.max(0, d.balanceKurus), 0) +
    input.installmentRemainingKurus;

  const baselineTimeline = projectDebts(input.debts, input.startMonth, PROJECTION_MONTHS);
  const projection = buildProjection(input, baselineTimeline, 0);

  const monthlyDebtPaymentKurus = input.debts.reduce(
    (sum, d) => sum + (d.balanceKurus > 0 ? d.minPaymentKurus : 0),
    0,
  );
  const firstInstallment = input.installmentsByMonth.get(input.startMonth) ?? 0;
  const monthlyFreeCashKurus =
    averages.netKurus - monthlyDebtPaymentKurus - firstInstallment - input.savingsPlanKurus;

  const last = projection[projection.length - 1] ?? { debtKurus: startDebt, cashKurus: 0 };
  // Acik veren nakit veya buyuyen borc, borc azalsa bile kotulesmedir:
  // borc baska bir yerden (acik) finanse ediliyor demektir.
  const direction: Forecast['direction'] =
    last.cashKurus < 0 || last.debtKurus > startDebt
      ? 'worsening'
      : last.debtKurus < startDebt || last.cashKurus > 0
        ? 'improving'
        : 'flat';

  let scenario: Scenario | null = null;
  if (input.cutKurus > 0) {
    const cutTimeline = projectDebts(input.debts, input.startMonth, PROJECTION_MONTHS, {
      extraKurus: input.cutKurus,
      rollover: true,
    });
    // Bitis karsilastirmasi icin iki senaryo da ayni (yuvarlamali) kuralla
    // simule edilir; fark yalnizca ek tutardir.
    const base = simulateStrategy(input.debts, 0, 'avalanche', input.startMonth);
    const improved = simulateStrategy(input.debts, input.cutKurus, 'avalanche', input.startMonth);
    const comparable = base.months !== null && improved.months !== null;
    scenario = {
      cutKurus: input.cutKurus,
      projection: buildProjection(input, cutTimeline, input.cutKurus),
      debtFreeMonth: improved.payoffMonth,
      baselineDebtFreeMonth: base.payoffMonth,
      monthsSaved: comparable ? base.months! - improved.months! : null,
      interestSavedKurus:
        comparable && base.totalInterestKurus !== null && improved.totalInterestKurus !== null
          ? base.totalInterestKurus - improved.totalInterestKurus
          : null,
    };
  }

  return {
    averages,
    monthlyDebtPaymentKurus,
    savingsPlanKurus: input.savingsPlanKurus,
    monthlyFreeCashKurus,
    projection,
    start: { debtKurus: startDebt },
    end: { debtKurus: last.debtKurus, cashKurus: last.cashKurus },
    direction,
    scenario,
  };
}
