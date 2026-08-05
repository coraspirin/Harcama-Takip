import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { idParamSchema, positiveKurusSchema, yearMonthSchema } from '../lib/validation.ts';
import { addMonthsToYearMonth, todayIso, toYearMonth } from '../lib/date.ts';
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

export const budgetsRouter: Router = Router();

budgetsRouter.use(requireUser);

function serializeBudget(row: BudgetWithSpent) {
  const remainingKurus = row.limit_kurus - row.spent_kurus;
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryArchived: row.category_archived === 1,
    yearMonth: row.year_month,
    limitKurus: row.limit_kurus,
    spentKurus: row.spent_kurus,
    remainingKurus,
    // Limit her zaman > 0 (DB CHECK), bolme guvenli
    usagePercent: Math.round((row.spent_kurus / row.limit_kurus) * 100),
    exceeded: row.spent_kurus > row.limit_kurus,
  };
}

budgetsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const month = req.query.month
      ? yearMonthSchema.parse(req.query.month)
      : toYearMonth(todayIso());

    const budgets = listBudgets(user.id, month).map(serializeBudget);

    res.json({
      month,
      budgets,
      totals: {
        limitKurus: budgets.reduce((sum, b) => sum + b.limitKurus, 0),
        spentKurus: budgets.reduce((sum, b) => sum + b.spentKurus, 0),
        exceededCount: budgets.filter((b) => b.exceeded).length,
      },
    });
  }),
);

const createSchema = z.object({
  categoryId: z.number().int().positive(),
  yearMonth: yearMonthSchema,
  limitKurus: positiveKurusSchema,
});

budgetsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = createSchema.parse(req.body);

    const category = findCategory(user.id, input.categoryId);
    if (!category) throw notFound('Kategori bulunamadi');
    if (category.kind !== 'expense') {
      throw badRequest('Butce yalnizca gider kategorileri icin belirlenebilir');
    }
    if (budgetExistsForCategory(user.id, input.categoryId, input.yearMonth)) {
      throw conflict('Bu kategori icin bu ayda zaten bir butce var');
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
