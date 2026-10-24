import { Router } from 'express';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { yearMonthSchema } from '../lib/validation.ts';
import { daysInMonth, monthRange, todayIso, toYearMonth } from '../lib/date.ts';
import { dailyTotals } from '../db/reports.ts';
import { listUpcomingOccurrences } from '../db/scheduled.ts';
import { buildCalendar } from '../services/insightService.ts';

export const calendarRouter: Router = Router();

calendarRouter.use(requireUser);

/** Ust sinir: bir ayda gosterilecek bekleyen kayit sayisi. */
const MAX_PENDING = 500;

/**
 * Ay takvimi: gun gun gerceklesen gelir/gider, bekleyen odemeler ve ay
 * basindan itibaren net akis. Net akis eksiye dustugu gunler "sikisik"
 * isaretlenir.
 */
calendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const today = todayIso();
    const month = req.query.month ? yearMonthSchema.parse(req.query.month) : toYearMonth(today);
    const range = monthRange(month);
    const [y, m] = month.split('-').map(Number) as [number, number];

    const totalsByDay = new Map(
      dailyTotals(user.id, range.start, range.end).map((r) => [
        r.date,
        { incomeKurus: Number(r.income_kurus), expenseKurus: Number(r.expense_kurus) },
      ]),
    );

    // Vadesi gecmis bekleyenler de gelir: icinde bulunulan ayda bugune tasinir.
    const pending = listUpcomingOccurrences(user.id, range.end, MAX_PENDING).map((o) => ({
      id: o.id,
      name: o.seq !== null ? `${o.item_name} (${o.seq}/${o.total_seq})` : o.item_name,
      direction: o.direction,
      amountKurus: o.amount_kurus,
      dueDate: o.due_date,
    }));

    const days = buildCalendar({ month, daysInMonth: daysInMonth(y, m), today, totalsByDay, pending });

    res.json({
      month,
      today,
      days,
      tightDayCount: days.filter((d) => d.tight).length,
      endCumulativeKurus: days.at(-1)?.cumulativeKurus ?? 0,
    });
  }),
);
