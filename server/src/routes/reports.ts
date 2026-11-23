import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest } from '../lib/errors.ts';
import { isoDateSchema, yearMonthSchema } from '../lib/validation.ts';
import { addMonthsToYearMonth, monthRange, todayIso, toYearMonth } from '../lib/date.ts';
import { percentChange } from '../lib/money.ts';
import { sumTransactions } from '../db/transactions.ts';
import {
  categoryBreakdown,
  expenseNatureTotals,
  monthlyNatureTotals,
  monthlyTotals,
  type CategoryBreakdownRow,
} from '../db/reports.ts';
import { currentBalanceKurus, listDebts, pendingInstallmentsByMonth } from '../db/debts.ts';
import { buildForecast } from '../services/forecastService.ts';
import { getSavingsOverview } from '../services/savingsOverviewService.ts';
import { getMonthClosing } from '../services/closingService.ts';

export const reportsRouter: Router = Router();

reportsRouter.use(requireUser);

function serializeBreakdown(rows: CategoryBreakdownRow[]) {
  const total = rows.reduce((sum, r) => sum + Number(r.total_kurus), 0);

  return rows.map((row) => ({
    categoryId: row.category_id,
    // Kategorisiz kayitlar da raporda gorunmeli, sessizce dusurulmemeli
    categoryName: row.category_name ?? 'Kategorisiz',
    totalKurus: Number(row.total_kurus),
    transactionCount: Number(row.transaction_count),
    sharePercent: total === 0 ? 0 : Math.round((Number(row.total_kurus) / total) * 1000) / 10,
  }));
}

/**
 * Aylik ozet: secilen ayin gelir/gider/net toplami, onceki aya gore degisim ve
 * kategori kirilimi.
 */
reportsRouter.get(
  '/monthly',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const month = req.query.month
      ? yearMonthSchema.parse(req.query.month)
      : toYearMonth(todayIso());

    const previousMonth = addMonthsToYearMonth(month, -1);
    const range = monthRange(month);
    const previousRange = monthRange(previousMonth);

    const current = sumTransactions(user.id, { from: range.start, to: range.end });
    const previous = sumTransactions(user.id, {
      from: previousRange.start,
      to: previousRange.end,
    });

    res.json({
      month,
      totals: {
        incomeKurus: current.incomeKurus,
        expenseKurus: current.expenseKurus,
        netKurus: current.incomeKurus - current.expenseKurus,
      },
      previous: {
        month: previousMonth,
        incomeKurus: previous.incomeKurus,
        expenseKurus: previous.expenseKurus,
        netKurus: previous.incomeKurus - previous.expenseKurus,
        incomeChangePercent: percentChange(previous.incomeKurus, current.incomeKurus),
        expenseChangePercent: percentChange(previous.expenseKurus, current.expenseKurus),
      },
      expenseByCategory: serializeBreakdown(
        categoryBreakdown(user.id, range.start, range.end, 'expense'),
      ),
      incomeByCategory: serializeBreakdown(
        categoryBreakdown(user.id, range.start, range.end, 'income'),
      ),
    });
  }),
);

const rangeQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  kind: z.enum(['income', 'expense']).default('expense'),
});

/** Serbest tarih araliginda kategori kirilimi. */
reportsRouter.get(
  '/categories',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const q = rangeQuerySchema.parse(req.query);

    if (q.from > q.to) throw badRequest('Baslangic tarihi bitis tarihinden sonra olamaz');

    const rows = serializeBreakdown(categoryBreakdown(user.id, q.from, q.to, q.kind));

    res.json({
      from: q.from,
      to: q.to,
      kind: q.kind,
      totalKurus: rows.reduce((sum, r) => sum + r.totalKurus, 0),
      categories: rows,
    });
  }),
);

const trendQuerySchema = z.object({
  to: yearMonthSchema.optional(),
  months: z.coerce.number().int().min(2).max(36).default(12),
});

/**
 * Aylik trend. Islem olmayan aylar da sifir degerle doner; aksi halde grafikte
 * bosluk yerine iki ay birlesip yaniltici bir egim olusur.
 */
reportsRouter.get(
  '/trend',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const q = trendQuerySchema.parse(req.query);

    const toMonth = q.to ?? toYearMonth(todayIso());
    const fromMonth = addMonthsToYearMonth(toMonth, -(q.months - 1));

    const rows = new Map(
      monthlyTotals(user.id, fromMonth, toMonth).map((row) => [row.year_month, row]),
    );

    const series = Array.from({ length: q.months }, (_, i) => {
      const month = addMonthsToYearMonth(fromMonth, i);
      const row = rows.get(month);
      const incomeKurus = Number(row?.income_kurus ?? 0);
      const expenseKurus = Number(row?.expense_kurus ?? 0);
      return { month, incomeKurus, expenseKurus, netKurus: incomeKurus - expenseKurus };
    });

    res.json({ from: fromMonth, to: toMonth, series });
  }),
);

const forecastQuerySchema = z.object({
  basis: z.coerce
    .number()
    .int()
    .refine((v) => [3, 6, 12].includes(v), 'basis 3, 6 veya 12 olmali')
    .default(6),
  cut: z.coerce.number().int().min(0).max(1_000_000_000_00).default(0),
});

/**
 * Gidisat: son `basis` tam ayin ortalamasi 12 ay ileri tasinir. Icinde
 * bulunulan ay yarim oldugu icin ortalamaya girmez; projeksiyon gelecek
 * aydan baslar.
 *
 * `cut`: ayda bu kadar az harcanip borca yatirilirsa borclar ne zaman biter.
 */
reportsRouter.get(
  '/forecast',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const q = forecastQuerySchema.parse(req.query);
    const today = todayIso();
    const current = toYearMonth(today);

    const history = monthlyNatureTotals(
      user.id,
      addMonthsToYearMonth(current, -q.basis),
      addMonthsToYearMonth(current, -1),
    ).map((r) => ({
      month: r.year_month,
      incomeKurus: Number(r.income_kurus),
      fixedExpenseKurus: Number(r.fixed_expense_kurus),
      variableExpenseKurus: Number(r.variable_expense_kurus),
    }));

    const debts = listDebts(user.id)
      .filter((d) => d.direction === 'owe')
      .map((d) => ({
        id: d.id,
        name: d.name,
        balanceKurus: currentBalanceKurus(d),
        monthlyInterestBp: d.monthly_interest_bp,
        taxesIncluded: d.taxes_included === 1,
        minPaymentKurus: d.monthly_payment_kurus ?? 0,
      }));

    const startMonth = addMonthsToYearMonth(current, 1);
    // Bu ayin (henuz odenmemis) taksitleri de kalan borca dahil; projeksiyon
    // gelecek aydan basladigi icin bu ayinkiler baslangic borcunda kalir.
    const installmentsByMonth = pendingInstallmentsByMonth(user.id);
    const installmentRemainingKurus = [...installmentsByMonth.values()].reduce((a, b) => a + b, 0);

    const forecast = buildForecast({
      history,
      debts,
      installmentsByMonth,
      installmentRemainingKurus,
      savingsPlanKurus: getSavingsOverview(user.id, today).totals.monthlyPlanKurus,
      startMonth,
      cutKurus: q.cut,
    });

    res.json({ basis: q.basis, startMonth, hasHistory: history.length > 0, ...forecast });
  }),
);

/**
 * Son `count` kapanmis ayin ozeti (icinde bulunulan ay haric). Kayit
 * saklanmaz; her istekte islemlerden hesaplanir.
 */
reportsRouter.get(
  '/closings',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const count = z.coerce
      .number()
      .int()
      .min(1)
      .max(24)
      .default(6)
      .parse(req.query.count ?? 6);
    const current = toYearMonth(todayIso());

    const closings = Array.from({ length: count }, (_, i) =>
      getMonthClosing(user.id, addMonthsToYearMonth(current, -(i + 1))),
    );
    res.json({ closings });
  }),
);

const yearlyQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

function serializeYearlyBreakdown(rows: CategoryBreakdownRow[], previous: CategoryBreakdownRow[]) {
  const previousByCategory = new Map(previous.map((r) => [r.category_id, Number(r.total_kurus)]));
  return serializeBreakdown(rows).map((row) => {
    const previousYearKurus = previousByCategory.get(row.categoryId) ?? 0;
    return {
      ...row,
      previousYearKurus,
      changePercent: percentChange(previousYearKurus, row.totalKurus),
    };
  });
}

type MonthExpense = { month: string; expenseKurus: number };

function extremeMonth(
  months: MonthExpense[],
  better: (candidate: number, best: number) => boolean,
): MonthExpense | null {
  let best: MonthExpense | null = null;
  for (const m of months) {
    if (best === null || better(m.expenseKurus, best.expenseKurus)) {
      best = { month: m.month, expenseKurus: m.expenseKurus };
    }
  }
  return best;
}

/** Yillik ozet: aylik seri, kategori kirilimi (onceki yil karsilastirmali), one cikanlar. */
reportsRouter.get(
  '/yearly',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const q = yearlyQuerySchema.parse(req.query);

    const today = todayIso();
    const thisYear = Number(today.slice(0, 4));
    const year = q.year ?? thisYear;
    const prevYear = year - 1;

    const isCurrentYear = year === thisYear;
    const monthsElapsed = isCurrentYear ? Number(today.slice(5, 7)) : year < thisYear ? 12 : 0;

    const range = { start: `${year}-01-01`, end: `${year}-12-31` };
    const prevRange = { start: `${prevYear}-01-01`, end: `${prevYear}-12-31` };

    const monthRows = new Map(
      monthlyTotals(user.id, `${year}-01`, `${year}-12`).map((r) => [r.year_month, r]),
    );
    const months = Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`;
      const row = monthRows.get(month);
      const incomeKurus = Number(row?.income_kurus ?? 0);
      const expenseKurus = Number(row?.expense_kurus ?? 0);
      return { month, incomeKurus, expenseKurus, netKurus: incomeKurus - expenseKurus };
    });

    const incomeKurus = months.reduce((s, m) => s + m.incomeKurus, 0);
    const expenseKurus = months.reduce((s, m) => s + m.expenseKurus, 0);
    const netKurus = incomeKurus - expenseKurus;

    const prevMonthRows = monthlyTotals(user.id, `${prevYear}-01`, `${prevYear}-12`);
    let previousYear: { incomeKurus: number; expenseKurus: number; netKurus: number } | null = null;
    if (prevMonthRows.length > 0) {
      const income = prevMonthRows.reduce((s, r) => s + Number(r.income_kurus), 0);
      const expense = prevMonthRows.reduce((s, r) => s + Number(r.expense_kurus), 0);
      previousYear = { incomeKurus: income, expenseKurus: expense, netKurus: income - expense };
    }

    const withExpense = months.filter((m) => m.expenseKurus > 0);
    const elapsedWithExpense = withExpense.filter(
      (m) => Number(m.month.slice(5, 7)) <= monthsElapsed,
    );
    const nature = expenseNatureTotals(user.id, range.start, range.end);

    res.json({
      year,
      isCurrentYear,
      monthsElapsed,
      totals: {
        incomeKurus,
        expenseKurus,
        netKurus,
        savingsRatePercent:
          incomeKurus === 0 ? null : Math.round((netKurus / incomeKurus) * 1000) / 10,
      },
      previousYear,
      changePercent: {
        income: previousYear ? percentChange(previousYear.incomeKurus, incomeKurus) : null,
        expense: previousYear ? percentChange(previousYear.expenseKurus, expenseKurus) : null,
        net: previousYear ? percentChange(previousYear.netKurus, netKurus) : null,
      },
      months,
      expenseByCategory: serializeYearlyBreakdown(
        categoryBreakdown(user.id, range.start, range.end, 'expense'),
        categoryBreakdown(user.id, prevRange.start, prevRange.end, 'expense'),
      ),
      incomeByCategory: serializeYearlyBreakdown(
        categoryBreakdown(user.id, range.start, range.end, 'income'),
        categoryBreakdown(user.id, prevRange.start, prevRange.end, 'income'),
      ),
      highlights: {
        highestExpenseMonth: extremeMonth(withExpense, (a, b) => a > b),
        lowestExpenseMonth: extremeMonth(elapsedWithExpense, (a, b) => a < b),
        averageMonthlyExpenseKurus:
          monthsElapsed === 0 ? 0 : Math.round(expenseKurus / monthsElapsed),
        averageMonthlyIncomeKurus:
          monthsElapsed === 0 ? 0 : Math.round(incomeKurus / monthsElapsed),
      },
      expenseByNature: {
        fixedKurus: Number(nature.fixed_kurus),
        variableKurus: Number(nature.variable_kurus),
        uncategorizedKurus: Number(nature.uncategorized_kurus),
      },
    });
  }),
);
