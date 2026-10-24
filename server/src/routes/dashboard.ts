import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { yearMonthSchema } from '../lib/validation.ts';
import { addMonthsToYearMonth, monthRange, todayIso, toYearMonth } from '../lib/date.ts';
import { percentChange } from '../lib/money.ts';
import { listTransactions, sumTransactions } from '../db/transactions.ts';
import { serializeTransaction } from './serializers.ts';

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireUser);

const querySchema = z.object({
  month: yearMonthSchema.optional(),
});

/** Dashboard ozeti: aylik gelir/gider/net, onceki aya gore degisim ve son islemler. */
dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { month } = querySchema.parse(req.query);

    const current = month ?? toYearMonth(todayIso());
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
      recentTransactions: listTransactions(user.id, {}, 8, 0).map(serializeTransaction),
    });
  }),
);
