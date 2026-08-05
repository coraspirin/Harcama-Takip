import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { idParamSchema, isoDateSchema, positiveKurusSchema } from '../lib/validation.ts';
import { isIsoDate } from '../lib/date.ts';
import { accountExists } from '../db/accounts.ts';
import { categoryExists } from '../db/categories.ts';
import {
  countTransactions,
  deleteTransaction,
  deleteTransferGroup,
  findTransaction,
  findTransferGroup,
  insertTransaction,
  listTransactions,
  sumTransactions,
  updateTransaction,
  type TransactionFilters,
} from '../db/transactions.ts';
import { getDb } from '../db/connection.ts';
import { serializeTransaction } from './serializers.ts';

export const transactionsRouter: Router = Router();

transactionsRouter.use(requireUser);

const transactionSchema = z.object({
  accountId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable().default(null),
  type: z.enum(['income', 'expense']),
  amountKurus: positiveKurusSchema,
  date: isoDateSchema,
  description: z.string().trim().max(500).nullable().default(null),
});

const listQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  kind: z.enum(['income', 'expense', 'transfer']).optional(),
  minAmountKurus: z.coerce.number().int().min(0).optional(),
  maxAmountKurus: z.coerce.number().int().min(0).optional(),
  search: z.string().trim().max(200).optional(),
  includeTransfers: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Referans verilen hesap/kategori gercekten bu kullaniciya mi ait? */
function assertOwnedRefs(userId: number, accountId: number, categoryId: number | null): void {
  if (!accountExists(userId, accountId)) throw notFound('Secilen hesap bulunamadi');
  if (categoryId !== null && !categoryExists(userId, categoryId)) {
    throw notFound('Secilen kategori bulunamadi');
  }
}

transactionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
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
      ...(q.accountId !== undefined && { accountId: q.accountId }),
      ...(q.categoryId !== undefined && { categoryId: q.categoryId }),
      ...(q.kind !== undefined && { kind: q.kind }),
      ...(q.minAmountKurus !== undefined && { minAmountKurus: q.minAmountKurus }),
      ...(q.maxAmountKurus !== undefined && { maxAmountKurus: q.maxAmountKurus }),
      ...(q.search !== undefined && { search: q.search }),
      ...(q.includeTransfers !== undefined && { includeTransfers: q.includeTransfers }),
    };

    const total = countTransactions(user.id, filters);
    const rows = listTransactions(user.id, filters, q.pageSize, (q.page - 1) * q.pageSize);

    res.json({
      transactions: rows.map(serializeTransaction),
      // Toplamlar transferleri HARIC tutar; aksi halde ayni para iki kez sayilir.
      totals: sumTransactions(user.id, filters),
      pagination: { page: q.page, pageSize: q.pageSize, total },
    });
  }),
);

transactionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = transactionSchema.parse(req.body);

    if (!isIsoDate(input.date)) throw badRequest('Gecersiz tarih');
    assertOwnedRefs(user.id, input.accountId, input.categoryId);

    const id = insertTransaction(user.id, input);
    const created = findTransaction(user.id, id);
    if (!created) throw notFound('Islem olusturuldu ancak okunamadi');

    res.status(201).json({ transaction: serializeTransaction(created) });
  }),
);

transactionsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = transactionSchema.parse(req.body);

    const existing = findTransaction(user.id, id);
    if (!existing) throw notFound('Islem bulunamadi');
    if (existing.transfer_group_id !== null) {
      throw badRequest('Transfer kayitlari duzenlenemez; silip yeniden olusturun');
    }

    if (!isIsoDate(input.date)) throw badRequest('Gecersiz tarih');
    assertOwnedRefs(user.id, input.accountId, input.categoryId);

    const updated = updateTransaction(user.id, id, input);
    if (!updated) throw notFound('Islem bulunamadi');

    res.json({ transaction: serializeTransaction(updated) });
  }),
);

transactionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const existing = findTransaction(user.id, id);
    if (!existing) throw notFound('Islem bulunamadi');

    // Transferin tek bacagini silmek hesaplari tutarsiz birakir: cift silinir.
    if (existing.transfer_group_id !== null) {
      const removed = deleteTransferGroup(user.id, existing.transfer_group_id);
      res.json({ deleted: true, removedRows: removed });
      return;
    }

    deleteTransaction(user.id, id);
    res.json({ deleted: true, removedRows: 1 });
  }),
);

const transferSchema = z.object({
  fromAccountId: z.number().int().positive(),
  toAccountId: z.number().int().positive(),
  amountKurus: positiveKurusSchema,
  date: isoDateSchema,
  description: z.string().trim().max(500).nullable().default(null),
});

/**
 * Hesaplar arasi transfer. Iki satir olarak yazilir (cikan + giren) ve ortak
 * bir transfer_group_id tasir. Rapor ve butce sorgulari bu satirlari disladigi
 * icin transfer, gelir/gider toplamlarini sismez.
 */
transactionsRouter.post(
  '/transfer',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = transferSchema.parse(req.body);

    if (input.fromAccountId === input.toAccountId) {
      throw badRequest('Kaynak ve hedef hesap ayni olamaz');
    }
    if (!isIsoDate(input.date)) throw badRequest('Gecersiz tarih');
    if (!accountExists(user.id, input.fromAccountId)) throw notFound('Kaynak hesap bulunamadi');
    if (!accountExists(user.id, input.toAccountId)) throw notFound('Hedef hesap bulunamadi');

    const groupId = crypto.randomUUID();
    const db = getDb();

    db.exec('BEGIN');
    try {
      insertTransaction(user.id, {
        accountId: input.fromAccountId,
        categoryId: null,
        type: 'transfer_out',
        amountKurus: input.amountKurus,
        date: input.date,
        description: input.description,
        transferGroupId: groupId,
      });
      insertTransaction(user.id, {
        accountId: input.toAccountId,
        categoryId: null,
        type: 'transfer_in',
        amountKurus: input.amountKurus,
        date: input.date,
        description: input.description,
        transferGroupId: groupId,
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json({
      transferGroupId: groupId,
      transactions: findTransferGroup(user.id, groupId).map(serializeTransaction),
    });
  }),
);
