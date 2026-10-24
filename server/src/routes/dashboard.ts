import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { yearMonthSchema } from '../lib/validation.ts';
import { addMonthsToYearMonth, monthRange, todayIso, toYearMonth } from '../lib/date.ts';
import { percentChange } from '../lib/money.ts';
import { listTransactions, sumTransactions } from '../db/transactions.ts';
import { serializeTransaction } from './serializers.ts';
import { listBudgets } from '../db/budgets.ts';
import { calculatePace } from '../services/budgetPaceService.ts';
import { getMonthOverview } from '../services/monthOverviewService.ts';
import { getDebtOverview } from '../services/debtOverviewService.ts';

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireUser);

const querySchema = z.object({
  month: yearMonthSchema.optional(),
});

/**
 * Ozet ekrani: aylik gelir/gider/net, onceki aya gore degisim, genel limitin
 * gidisati, ayin serbest parasi, borc ozeti ve son islemler. Hesaplar Butce
 * ve Borclar sayfalariyla ayni servislerden gelir; iki ekran farkli rakam
 * gostermez.
 */
dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { month } = querySchema.parse(req.query);

    const today = todayIso();
    const current = month ?? toYearMonth(today);

    const generalRow = listBudgets(user.id, current).find((b) => b.category_id === null);
    const generalLimit = generalRow
      ? {
          limitKurus: generalRow.limit_kurus,
          spentKurus: generalRow.spent_kurus,
          ...calculatePace({
            yearMonth: current,
            today,
            limitKurus: generalRow.limit_kurus,
            spentKurus: generalRow.spent_kurus,
          }),
        }
      : null;
    const previous = addMonthsToYearMonth(current, -1);

    const currentRange = monthRange(current);
    const previousRange = monthRange(previous);

    const currentTotals = sumTransactions(user.id, {
      from: currentRange.start,
      to: currentRange.end,
    });
    const previousTotals = sumTransactions(user.id, {
      from: previousRange.start,
      to: previousRange.end,
    });

    res.json({
      month: current,
      totals: {
        incomeKurus: currentTotals.incomeKurus,
        expenseKurus: currentTotals.expenseKurus,
        netKurus: currentTotals.incomeKurus - currentTotals.expenseKurus,
      },
      previousMonth: {
        month: previous,
        incomeKurus: previousTotals.incomeKurus,
        expenseKurus: previousTotals.expenseKurus,
        netKurus: previousTotals.incomeKurus - previousTotals.expenseKurus,
        incomeChangePercent: percentChange(previousTotals.incomeKurus, currentTotals.incomeKurus),
        expenseChangePercent: percentChange(
          previousTotals.expenseKurus,
          currentTotals.expenseKurus,
        ),
      },
      limit: generalLimit,
      overview: getMonthOverview(user.id, current, today),
      debts: getDebtOverview(user.id).totals,
      recentTransactions: listTransactions(user.id, {}, 8, 0).map(serializeTransaction),
    });
  }),
);
