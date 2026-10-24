import { addMonthsToYearMonth, toYearMonth, type IsoDate, type YearMonth } from '../lib/date.ts';

/**
 * Birikim hedefinin gidisati. Saf fonksiyonlardir; "bugun" disaridan verilir.
 */

/** Ortalama tempo icin geriye bakilan ay sayisi (bu ay dahil). */
export const PACE_MONTHS = 3;

/** Hedef tarihsiz ve tempo cok dusukse tahmin bu kadar ayla sinirlanir. */
const MAX_PROJECTION_MONTHS = 600;

function monthIndex(ym: YearMonth): number {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return y * 12 + (m - 1);
}

export type GoalInput = {
  targetKurus: number;
  targetDate: IsoDate | null;
  today: IsoDate;
  contributions: { date: IsoDate; amountKurus: number }[];
};

export type GoalProgress = {
  savedKurus: number;
  remainingKurus: number;
  percent: number;
  reached: boolean;
  /**
   * Hedef tarihine yetismek icin bu aydan itibaren aylik ayrilmasi gereken
   * tutar. Tarih yoksa veya hedefe ulasildiysa null.
   */
  requiredMonthlyKurus: number | null;
  /** Hedef ayina kadar kalan ay sayisi (bu ay dahil); tarih yoksa null */
  monthsLeft: number | null;
  /** Son PACE_MONTHS aydaki ortalama net katki */
  averageMonthlyKurus: number;
  /** Bu tempoyla hedefe ulasilacak ay; tempo sifir veya eksiyse null */
  projectedMonth: YearMonth | null;
  /** Tarihli hedefte: bu tempo yetiyor mu */
  onTrack: boolean | null;
};

export function calculateGoalProgress(input: GoalInput): GoalProgress {
  const savedKurus = input.contributions.reduce((sum, c) => sum + c.amountKurus, 0);
  const remainingKurus = Math.max(0, input.targetKurus - savedKurus);
  const reached = remainingKurus === 0;
  const currentMonth = toYearMonth(input.today);

  // Tempo: bu ay dahil son PACE_MONTHS ay. Ilk katkidan once gecen aylar
  // ortalamaya katilmaz; yeni acilan hedefin temposu sifira cekilmesin.
  const firstMonth = input.contributions
    .map((c) => toYearMonth(c.date))
    .sort()[0];
  const windowStart = addMonthsToYearMonth(currentMonth, -(PACE_MONTHS - 1));
  const effectiveStart = firstMonth && firstMonth > windowStart ? firstMonth : windowStart;
  const windowMonths = firstMonth
    ? Math.max(1, monthIndex(currentMonth) - monthIndex(effectiveStart) + 1)
    : PACE_MONTHS;
  const windowTotal = input.contributions
    .filter((c) => {
      const m = toYearMonth(c.date);
      return m >= effectiveStart && m <= currentMonth;
    })
    .reduce((sum, c) => sum + c.amountKurus, 0);
  const averageMonthlyKurus = Math.round(windowTotal / windowMonths);

  let monthsLeft: number | null = null;
  let requiredMonthlyKurus: number | null = null;
  if (input.targetDate) {
    monthsLeft = Math.max(1, monthIndex(toYearMonth(input.targetDate)) - monthIndex(currentMonth) + 1);
    requiredMonthlyKurus = reached ? null : Math.ceil(remainingKurus / monthsLeft);
  }

  let projectedMonth: YearMonth | null = null;
  if (reached) {
    projectedMonth = currentMonth;
  } else if (averageMonthlyKurus > 0) {
    const months = Math.ceil(remainingKurus / averageMonthlyKurus);
    if (months <= MAX_PROJECTION_MONTHS) projectedMonth = addMonthsToYearMonth(currentMonth, months);
  }

  const onTrack =
    input.targetDate === null
      ? null
      : reached ||
        (projectedMonth !== null && projectedMonth <= toYearMonth(input.targetDate));

  return {
    savedKurus,
    remainingKurus,
    // Hedef her zaman > 0 (DB CHECK); %100'u gecebilir
    percent: Math.round((savedKurus / input.targetKurus) * 100),
    reached,
    requiredMonthlyKurus,
    monthsLeft,
    averageMonthlyKurus,
    projectedMonth,
    onTrack,
  };
}

export type EmergencyFundSuggestion = {
  /** Ortalamanin alindigi ay sayisi (veri olan aylar) */
  basedOnMonths: number;
  averageFixedExpenseKurus: number;
  /** En az 3 aylik sabit gider */
  minKurus: number;
  /** Rahat seviye: 6 aylik sabit gider */
  comfortableKurus: number;
};

/**
 * Acil durum fonu onerisi: aylik SABIT giderin (kira, fatura, aidat...)
 * 3 ila 6 kati. Degisken giderler kriz aninda kisilabildigi icin katilmaz.
 */
export function suggestEmergencyFund(monthlyFixedExpenses: number[]): EmergencyFundSuggestion {
  const months = monthlyFixedExpenses.length;
  const average =
    months === 0 ? 0 : Math.round(monthlyFixedExpenses.reduce((a, b) => a + b, 0) / months);
  return {
    basedOnMonths: months,
    averageFixedExpenseKurus: average,
    minKurus: average * 3,
    comfortableKurus: average * 6,
  };
}

/**
 * Bu ay birikime giden tutar: her hedef icin planlanan aylik tutar ile bu ay
 * yapilan net katkinin buyugu. Plan yapilmissa ama henuz yatirilmamissa o
 * para yine de "harcanabilir" sayilmamalidir.
 */
export function monthlySavingsCommitment(
  goals: { monthlyPlanKurus: number | null; contributedThisMonthKurus: number }[],
): number {
  return goals.reduce(
    (sum, g) => sum + Math.max(g.monthlyPlanKurus ?? 0, g.contributedThisMonthKurus, 0),
    0,
  );
}
