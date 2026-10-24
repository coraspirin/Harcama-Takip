import { monthRange, toYearMonth, type YearMonth } from '../lib/date.ts';
import { sumTransactions } from '../db/transactions.ts';
import { categoryBreakdown } from '../db/reports.ts';
import { listBudgets } from '../db/budgets.ts';
import { debtPaymentsInMonth } from '../db/debts.ts';
import { listUserContributions } from '../db/savings.ts';

export type MonthClosing = {
  month: YearMonth;
  /** O ay hic islem, borc odemesi veya birikim yoksa false */
  hasData: boolean;
  incomeKurus: number;
  expenseKurus: number;
  netKurus: number;
  /** Genel limit varsa uyuldu mu */
  limit: { limitKurus: number; spentKurus: number; kept: boolean } | null;
  /** Limiti asilan kategoriler */
  exceededCategories: string[];
  savedKurus: number;
  debtPaidKurus: number;
  topCategory: { name: string; totalKurus: number } | null;
};

/**
 * Ayin kapanis ozeti. Kayit olarak saklanmaz, her istekte islemlerden
 * hesaplanir: gecmis bir islem duzeltildiginde kapanis da kendiliginden
 * duzelir.
 */
export function getMonthClosing(userId: number, month: YearMonth): MonthClosing {
  const range = monthRange(month);
  const totals = sumTransactions(userId, { from: range.start, to: range.end });

  const budgets = listBudgets(userId, month);
  const general = budgets.find((b) => b.category_id === null);
  const exceededCategories = budgets
    .filter((b) => b.category_id !== null && b.spent_kurus > b.limit_kurus)
    .map((b) => b.category_name ?? 'Kategori');

  const savedKurus = listUserContributions(userId)
    .filter((c) => toYearMonth(c.date) === month)
    .reduce((sum, c) => sum + c.amount_kurus, 0);
  const debtPaidKurus = debtPaymentsInMonth(userId, month).oweKurus;

  const top = categoryBreakdown(userId, range.start, range.end, 'expense')[0];

  return {
    month,
    hasData: totals.incomeKurus + totals.expenseKurus + debtPaidKurus !== 0 || savedKurus !== 0,
    incomeKurus: totals.incomeKurus,
    expenseKurus: totals.expenseKurus,
    netKurus: totals.incomeKurus - totals.expenseKurus,
    limit: general
      ? {
          limitKurus: general.limit_kurus,
          spentKurus: general.spent_kurus,
          kept: general.spent_kurus <= general.limit_kurus,
        }
      : null,
    exceededCategories,
    savedKurus,
    debtPaidKurus,
    topCategory: top
      ? { name: top.category_name ?? 'Kategorisiz', totalKurus: Number(top.total_kurus) }
      : null,
  };
}
