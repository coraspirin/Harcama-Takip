import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { idParamSchema, positiveKurusSchema, yearMonthSchema } from '../lib/validation.ts';
import { addMonthsToYearMonth, monthRange, todayIso, toYearMonth } from '../lib/date.ts';
import {
  budgetExistsForCategory,
  copyBudgets,
  createBudget,
  deleteBudget,
  findBudget,
  listBudgets,
  updateBudget,
  type BudgetWithSpent,
} from '../db/budgets.ts';
import { findCategory } from '../db/categories.ts';
import { sumTransactions } from '../db/transactions.ts';
import { monthlyTotals } from '../db/reports.ts';
import { sumPendingOccurrences } from '../db/scheduled.ts';
import { calculateFreeMoney, calculatePace } from '../services/budgetPaceService.ts';

export const budgetsRouter: Router = Router();

budgetsRouter.use(requireUser);

function serializeBudget(row: BudgetWithSpent, today = todayIso()) {
  const pace = calculatePace({
    yearMonth: row.year_month,
    today,
    limitKurus: row.limit_kurus,
    spentKurus: row.spent_kurus,
  });

  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryArchived: row.category_archived === 1,
    /** Genel limit: o ayin tum giderlerini kapsar */
    isGeneral: row.category_id === null,
    yearMonth: row.year_month,
    limitKurus: row.limit_kurus,
    spentKurus: row.spent_kurus,
    remainingKurus: pace.remainingKurus,
    usagePercent: pace.usagePercent,
    exceeded: pace.exceeded,
    daysLeft: pace.daysLeft,
    dailyAllowanceKurus: pace.dailyAllowanceKurus,
    projectedSpendKurus: pace.projectedSpendKurus,
    projectedExceeds: pace.projectedExceeds,
  };
}

budgetsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const month = req.query.month
      ? yearMonthSchema.parse(req.query.month)
      : toYearMonth(todayIso());

    const today = todayIso();
    const all = listBudgets(user.id, month).map((row) => serializeBudget(row, today));
    const general = all.find((b) => b.isGeneral) ?? null;
    const budgets = all.filter((b) => !b.isGeneral);

    res.json({
      month,
      general,
      budgets,
      // Toplamlar yalnizca kategori limitlerini kapsar; genel limit ayni
      // giderleri bir daha sayardi.
      totals: {
        limitKurus: budgets.reduce((sum, b) => sum + b.limitKurus, 0),
        spentKurus: budgets.reduce((sum, b) => sum + b.spentKurus, 0),
        exceededCount: all.filter((b) => b.exceeded).length,
      },
    });
  }),
);

const createSchema = z.object({
  // null: genel aylik limit
  categoryId: z.number().int().positive().nullable().default(null),
  yearMonth: yearMonthSchema,
  limitKurus: positiveKurusSchema,
});

budgetsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = createSchema.parse(req.body);

    if (input.categoryId !== null) {
      const category = findCategory(user.id, input.categoryId);
      if (!category) throw notFound('Kategori bulunamadi');
      if (category.kind !== 'expense') {
        throw badRequest('Butce yalnizca gider kategorileri icin belirlenebilir');
      }
    }
    if (budgetExistsForCategory(user.id, input.categoryId, input.yearMonth)) {
      throw conflict(
        input.categoryId === null
          ? 'Bu ay icin zaten bir genel limit var'
          : 'Bu kategori icin bu ayda zaten bir butce var',
      );
    }

    createBudget(user.id, input.categoryId, input.yearMonth, input.limitKurus);

    const created = listBudgets(user.id, input.yearMonth).find(
      (b) => b.category_id === input.categoryId,
    );
    res.status(201).json({ budget: created ? serializeBudget(created) : null });
  }),
);

budgetsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const { limitKurus } = z.object({ limitKurus: positiveKurusSchema }).parse(req.body);

    const existing = findBudget(user.id, id);
    if (!existing) throw notFound('Butce bulunamadi');

    updateBudget(user.id, id, limitKurus);

    const updated = listBudgets(user.id, existing.year_month).find((b) => b.id === id);
    res.json({ budget: updated ? serializeBudget(updated) : null });
  }),
);

budgetsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    if (!findBudget(user.id, id)) throw notFound('Butce bulunamadi');

    deleteBudget(user.id, id);
    res.json({ deleted: true });
  }),
);

/** Ortalama gelir icin geriye bakilan ay sayisi. */
const INCOME_AVERAGE_MONTHS = 3;

/**
 * Ayin para durumu: beklenen gelir, yapilan harcama, bekleyen odemeler ve
 * ay sonuna kadar serbestce harcanabilecek tutar.
 *
 * Icinde bulunulan ayda vadesi GECMIS ama odenmemis kayitlar da bekleyen
 * odemelere dahildir: o para hala bu ay cikacak.
 */
budgetsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const today = todayIso();
    const month = req.query.month ? yearMonthSchema.parse(req.query.month) : toYearMonth(today);
    const range = monthRange(month);

    const actual = sumTransactions(user.id, { from: range.start, to: range.end });

    const pendingFrom = month === toYearMonth(today) ? '0000-01-01' : range.start;
    const pending = sumPendingOccurrences(user.id, pendingFrom, range.end);

    const history = monthlyTotals(
      user.id,
      addMonthsToYearMonth(month, -INCOME_AVERAGE_MONTHS),
      addMonthsToYearMonth(month, -1),
    );
    // Yalnizca kaydi olan aylar ortalamaya girer: uygulamayi yeni kullanmaya
    // baslayan biri icin bos aylar ortalamayi sifira cekerdi.
    const averageIncomeKurus =
      history.length === 0
        ? 0
        : Math.round(history.reduce((sum, r) => sum + Number(r.income_kurus), 0) / history.length);

    const free = calculateFreeMoney({
      actualIncomeKurus: actual.incomeKurus,
      pendingIncomeKurus: pending.incomeKurus,
      averageIncomeKurus,
      spentKurus: actual.expenseKurus,
      pendingExpenseKurus: pending.expenseKurus,
    });

    res.json({
      month,
      actualIncomeKurus: actual.incomeKurus,
      pendingIncomeKurus: pending.incomeKurus,
      averageIncomeKurus,
      expectedIncomeKurus: free.expectedIncomeKurus,
      incomeIsEstimate: free.incomeIsEstimate,
      spentKurus: actual.expenseKurus,
      pendingExpenseKurus: pending.expenseKurus,
      unknownAmountCount: pending.unknownAmountCount,
      freeKurus: free.freeKurus,
    });
  }),
);

/** Bir onceki ayin butcelerini bu aya kopyalar (mevcut kayitlar korunur). */
budgetsRouter.post(
  '/copy',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { toMonth } = z.object({ toMonth: yearMonthSchema }).parse(req.body);

    const fromMonth = addMonthsToYearMonth(toMonth, -1);
    const copied = copyBudgets(user.id, fromMonth, toMonth);

    res.json({ fromMonth, toMonth, copied });
  }),
);
