import { addMonthsToYearMonth, monthRange, toYearMonth, type IsoDate, type YearMonth } from '../lib/date.ts';
import { sumTransactions } from '../db/transactions.ts';
import { monthlyTotals } from '../db/reports.ts';
import { listRecurringBills, sumPendingOccurrences } from '../db/scheduled.ts';
import { calculateFreeMoney } from './budgetPaceService.ts';
import { calculateReserve } from './reserveService.ts';
import { savingsForMonth } from './savingsOverviewService.ts';

/** Ortalama gelir icin geriye bakilan ay sayisi. */
export const INCOME_AVERAGE_MONTHS = 3;

export type MonthOverview = {
  month: YearMonth;
  actualIncomeKurus: number;
  pendingIncomeKurus: number;
  averageIncomeKurus: number;
  expectedIncomeKurus: number;
  incomeIsEstimate: boolean;
  spentKurus: number;
  pendingExpenseKurus: number;
  unknownAmountCount: number;
  /** Uc aylik / yillik giderler icin bu ay kenara ayrilacak pay */
  reserveKurus: number;
  /** Birikim hedeflerine bu ay giden tutar */
  savingsKurus: number;
  freeKurus: number;
};

/**
 * Son `months` ayin (verilen ay HARIC) ortalama geliri. Yalnizca kaydi olan
 * aylar ortalamaya girer: uygulamayi yeni kullanmaya baslayan biri icin bos
 * aylar ortalamayi sifira cekerdi.
 */
export function averageIncome(userId: number, month: YearMonth, months: number): number {
  const history = monthlyTotals(
    userId,
    addMonthsToYearMonth(month, -months),
    addMonthsToYearMonth(month, -1),
  );
  if (history.length === 0) return 0;
  return Math.round(history.reduce((sum, r) => sum + Number(r.income_kurus), 0) / history.length);
}

/**
 * Ayin para durumu: beklenen gelir, yapilan harcama, bekleyen odemeler ve ay
 * sonuna kadar serbestce harcanabilecek tutar.
 *
 * Icinde bulunulan ayda vadesi GECMIS ama odenmemis kayitlar da bekleyen
 * odemelere dahildir: o para hala bu ay cikacak.
 */
export function getMonthOverview(userId: number, month: YearMonth, today: IsoDate): MonthOverview {
  const range = monthRange(month);
  const actual = sumTransactions(userId, { from: range.start, to: range.end });

  const pendingFrom = month === toYearMonth(today) ? '0000-01-01' : range.start;
  const pending = sumPendingOccurrences(userId, pendingFrom, range.end);

  const averageIncomeKurus = averageIncome(userId, month, INCOME_AVERAGE_MONTHS);

  // Gecmis bir ay icin kenara ayirma anlamsizdir; o ay kapandi.
  const reserveKurus =
    month < toYearMonth(today)
      ? 0
      : calculateReserve(
          listRecurringBills(userId).map((b) => ({
            id: b.id,
            name: b.name,
            period: b.period,
            amountKurus: b.amount_kurus ?? b.last_paid_kurus,
            startDate: b.start_date,
          })),
          month,
        ).monthlyKurus;

  const savingsKurus = savingsForMonth(userId, month, today);

  const free = calculateFreeMoney({
    actualIncomeKurus: actual.incomeKurus,
    pendingIncomeKurus: pending.incomeKurus,
    averageIncomeKurus,
    spentKurus: actual.expenseKurus,
    pendingExpenseKurus: pending.expenseKurus,
    reserveKurus,
    savingsKurus,
  });

  return {
    month,
    actualIncomeKurus: actual.incomeKurus,
    pendingIncomeKurus: pending.incomeKurus,
    averageIncomeKurus,
    expectedIncomeKurus: free.expectedIncomeKurus,
    incomeIsEstimate: free.incomeIsEstimate,
    spentKurus: actual.expenseKurus,
    pendingExpenseKurus: pending.expenseKurus,
    unknownAmountCount: pending.unknownAmountCount,
    reserveKurus,
    savingsKurus,
    freeKurus: free.freeKurus,
  };
}
