import { daysInMonth, toYearMonth, type IsoDate, type YearMonth } from '../lib/date.ts';

/**
 * Aylik limitin ay icindeki HIZI: ne kadar harcandi, kac gun kaldi, bundan
 * sonra gunde ne kadar harcanabilir ve bu hizla ay sonunda nereye varilir.
 *
 * Saf fonksiyonlardir: "bugun" disaridan verilir, boylece ay sinirlari ve
 * gecmis/gelecek aylar test edilebilir.
 */

export type MonthPhase = 'past' | 'current' | 'future';

export type PaceInput = {
  yearMonth: YearMonth;
  today: IsoDate;
  limitKurus: number;
  spentKurus: number;
};

export type Pace = {
  phase: MonthPhase;
  daysInMonth: number;
  /** Bugun DAHIL gecen gun sayisi. Gecmis ayda ayin tamami, gelecekte 0. */
  daysElapsed: number;
  /** Bugun DAHIL kalan gun sayisi. Gecmis ayda 0. */
  daysLeft: number;
  remainingKurus: number;
  /**
   * Limiti asmamak icin bugunden itibaren gunluk harcanabilir tutar. Limit
   * zaten asildiysa 0; gecmis ayda anlamsiz oldugu icin null.
   */
  dailyAllowanceKurus: number | null;
  /**
   * Bu hizla ay sonunda varilacak harcama. Gecen gunlerin ortalamasi kalan
   * gunlere uygulanir; gecmis ayda gercek harcama, gelecek ayda bugunku
   * harcama (genelde 0) doner.
   */
  projectedSpendKurus: number;
  /** projectedSpendKurus > limitKurus mu? */
  projectedExceeds: boolean;
  usagePercent: number;
  exceeded: boolean;
};

function monthPhase(yearMonth: YearMonth, today: IsoDate): MonthPhase {
  const current = toYearMonth(today);
  if (yearMonth < current) return 'past';
  if (yearMonth > current) return 'future';
  return 'current';
}

export function calculatePace(input: PaceInput): Pace {
  const [y, m] = input.yearMonth.split('-').map(Number) as [number, number];
  const total = daysInMonth(y, m);
  const phase = monthPhase(input.yearMonth, input.today);

  const daysElapsed =
    phase === 'past' ? total : phase === 'future' ? 0 : Number(input.today.slice(8, 10));
  const daysLeft = phase === 'past' ? 0 : total - daysElapsed + (phase === 'current' ? 1 : 0);

  const remainingKurus = input.limitKurus - input.spentKurus;

  const dailyAllowanceKurus =
    daysLeft === 0 ? null : Math.floor(Math.max(0, remainingKurus) / daysLeft);

  const projectedSpendKurus =
    phase === 'current' ? Math.round((input.spentKurus * total) / daysElapsed) : input.spentKurus;

  return {
    phase,
    daysInMonth: total,
    daysElapsed,
    daysLeft,
    remainingKurus,
    dailyAllowanceKurus,
    projectedSpendKurus,
    projectedExceeds: projectedSpendKurus > input.limitKurus,
    // Limit her zaman > 0 (DB CHECK), bolme guvenli
    usagePercent: Math.round((input.spentKurus / input.limitKurus) * 100),
    exceeded: input.spentKurus > input.limitKurus,
  };
}

export type FreeMoneyInput = {
  /** Bu ay su ana kadar gerceklesen gelir */
  actualIncomeKurus: number;
  /** Bu ay vadesi olan, henuz onaylanmamis planlanan alacaklar */
  pendingIncomeKurus: number;
  /** Onceki aylarin ortalama geliri; bu ay hic gelir gorunmuyorsa kullanilir */
  averageIncomeKurus: number;
  /** Bu ay su ana kadar yapilan gider */
  spentKurus: number;
  /** Bu ay vadesi olan, henuz odenmemis odemeler (tutari bilinenler) */
  pendingExpenseKurus: number;
  /** Uc aylik / yillik giderler icin bu ay kenara ayrilacak pay */
  reserveKurus?: number;
};

export type FreeMoney = {
  expectedIncomeKurus: number;
  /** Bu ay hic gelir gorunmedigi icin onceki aylarin ortalamasi kullanildi */
  incomeIsEstimate: boolean;
  /**
   * Ay sonuna kadar serbestce harcanabilecek para: beklenen gelir - yapilan
   * harcama - bekleyen odemeler - kenara ayrilacak pay. Negatifse ay acikla
   * kapanacak demektir.
   */
  freeKurus: number;
};

export function calculateFreeMoney(input: FreeMoneyInput): FreeMoney {
  const knownIncome = input.actualIncomeKurus + input.pendingIncomeKurus;
  const incomeIsEstimate = knownIncome === 0 && input.averageIncomeKurus > 0;
  const expectedIncomeKurus = incomeIsEstimate ? input.averageIncomeKurus : knownIncome;

  return {
    expectedIncomeKurus,
    incomeIsEstimate,
    freeKurus:
      expectedIncomeKurus -
      input.spentKurus -
      input.pendingExpenseKurus -
      (input.reserveKurus ?? 0),
  };
}
