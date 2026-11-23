import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { idParamSchema, isoDateSchema, positiveKurusSchema } from '../lib/validation.ts';
import { addDays, isIsoDate, todayIso } from '../lib/date.ts';
import { suggestCategories } from '../services/categorySuggestionService.ts';
import { categoryExists } from '../db/categories.ts';
import {
  countTransactions,
  deleteTransaction,
  bulkDeleteTransactions,
  findTransaction,
  insertTransaction,
  listFallbackCategories,
  listRecentCategories,
  listTransactions,
  sumTransactions,
  updateTransaction,
  type TransactionFilters,
} from '../db/transactions.ts';
import { serializeTransaction } from './serializers.ts';

export const transactionsRouter: Router = Router();

transactionsRouter.use(requireUser);

const transactionSchema = z.object({
  categoryId: z.number().int().positive().nullable().default(null),
  type: z.enum(['income', 'expense']),
  amountKurus: positiveKurusSchema,
  date: isoDateSchema,
  description: z.string().trim().max(500).nullable().default(null),
});

const listQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  kind: z.enum(['income', 'expense']).optional(),
  minAmountKurus: z.coerce.number().int().min(0).optional(),
  maxAmountKurus: z.coerce.number().int().min(0).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Referans verilen kategori gercekten bu kullaniciya mi ait? */
function assertOwnedRefs(userId: number, categoryId: number | null): void {
  if (categoryId !== null && !categoryExists(userId, categoryId)) {
    throw notFound('Secilen kategori bulunamadi');
  }
}

transactionsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const q = listQuerySchema.parse(req.query);

    if (q.from && q.to && q.from > q.to) {
      throw badRequest('Baslangic tarihi bitis tarihinden sonra olamaz');
    }
    if (
      q.minAmountKurus !== undefined &&
      q.maxAmountKurus !== undefined &&
      q.minAmountKurus > q.maxAmountKurus
    ) {
      throw badRequest('En dusuk tutar en yuksek tutardan buyuk olamaz');
    }

    const filters: TransactionFilters = {
      ...(q.from !== undefined && { from: q.from }),
      ...(q.to !== undefined && { to: q.to }),
      ...(q.categoryId !== undefined && { categoryId: q.categoryId }),
      ...(q.kind !== undefined && { kind: q.kind }),
      ...(q.minAmountKurus !== undefined && { minAmountKurus: q.minAmountKurus }),
      ...(q.maxAmountKurus !== undefined && { maxAmountKurus: q.maxAmountKurus }),
      ...(q.search !== undefined && { search: q.search }),
    };

    const total = countTransactions(user.id, filters);
    const rows = listTransactions(user.id, filters, q.pageSize, (q.page - 1) * q.pageSize);

    res.json({
      transactions: rows.map(serializeTransaction),
      totals: sumTransactions(user.id, filters),
      pagination: { page: q.page, pageSize: q.pageSize, total },
    });
  }),
);

const suggestQuerySchema = z.object({
  description: z.string().trim().max(200),
  type: z.enum(['income', 'expense']),
});

/**
 * Aciklamaya gore kategori onerisi. Aciklama yalnizca query'de gelir; istek
 * logu query yazmadigi icin loglanmaz. Rota, '/:id' rotalarindan once olmali.
 */
transactionsRouter.get(
  '/suggest-category',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const q = suggestQuerySchema.parse(req.query);

    if (q.description.length < 2) {
      res.json({ suggestions: [] });
      return;
    }
    res.json({ suggestions: suggestCategories(user.id, q.type, q.description) });
  }),
);

const recentQuerySchema = z.object({
  type: z.enum(['income', 'expense']),
  limit: z.coerce.number().int().min(1).max(12).default(6),
});

/** Son 90 gunde en cok kullanilan kategoriler; yeni kullanicida ada gore yedek liste. */
transactionsRouter.get(
  '/recent-categories',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const q = recentQuerySchema.parse(req.query);

    const rows = listRecentCategories(user.id, q.type, addDays(todayIso(), -90), q.limit);
    const categories =
      rows.length > 0
        ? rows.map((r) => ({
            categoryId: r.category_id,
            categoryName: r.category_name,
            useCount: Number(r.use_count),
            lastUsedAt: r.last_used_at,
          }))
        : listFallbackCategories(user.id, q.type, q.limit).map((c) => ({
            categoryId: c.id,
            categoryName: c.name,
            useCount: 0,
            lastUsedAt: null as string | null,
          }));

    res.json({ categories });
  }),
);

transactionsRouter.post(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = transactionSchema.parse(req.body);

    if (!isIsoDate(input.date)) throw badRequest('Gecersiz tarih');
    assertOwnedRefs(user.id, input.categoryId);

    const id = insertTransaction(user.id, input);
    const created = findTransaction(user.id, id);
    if (!created) throw notFound('Islem olusturuldu ancak okunamadi');

    res.status(201).json({ transaction: serializeTransaction(created) });
  }),
);

transactionsRouter.patch(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = transactionSchema.parse(req.body);

    const existing = findTransaction(user.id, id);
    if (!existing) throw notFound('Islem bulunamadi');
    if (!isIsoDate(input.date)) throw badRequest('Gecersiz tarih');
    assertOwnedRefs(user.id, input.categoryId);

    const updated = updateTransaction(user.id, id, input);
    if (!updated) throw notFound('Islem bulunamadi');

    res.json({ transaction: serializeTransaction(updated) });
  }),
);

transactionsRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const existing = findTransaction(user.id, id);
    if (!existing) throw notFound('Islem bulunamadi');

    deleteTransaction(user.id, id);
    res.json({ deleted: true, removedRows: 1 });
  }),
);

const bulkDeleteSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
});

/** Secili islemleri topluca siler. */
transactionsRouter.post(
  '/bulk-delete',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = bulkDeleteSchema.parse(req.body);

    res.json({ removedRows: bulkDeleteTransactions(user.id, input.ids) });
  }),
);
