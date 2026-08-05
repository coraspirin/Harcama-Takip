import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { idParamSchema, isoDateSchema, positiveKurusSchema } from '../lib/validation.ts';
import { addDays, todayIso } from '../lib/date.ts';
import { accountExists } from '../db/accounts.ts';
import { categoryExists } from '../db/categories.ts';
import {
  BILL_PERIODS,
  SCHEDULED_KINDS,
  countConfirmedOccurrences,
  deleteScheduledItem,
  findOccurrence,
  findScheduledItem,
  listOccurrences,
  listScheduledItems,
  listUpcomingOccurrences,
  updateOccurrenceAmount,
  updateScheduledItem,
  type OccurrenceWithItem,
  type ScheduledItemWithProgress,
} from '../db/scheduled.ts';
import {
  confirmOccurrence,
  createScheduledItemWithOccurrences,
  unconfirmOccurrence,
} from '../services/scheduledService.ts';

export const scheduledRouter: Router = Router();

scheduledRouter.use(requireUser);

function serializeItem(row: ScheduledItemWithProgress) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    direction: row.direction,
    accountId: row.account_id,
    accountName: row.account_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    counterparty: row.counterparty,
    description: row.description,
    totalAmountKurus: row.total_amount_kurus,
    installmentCount: row.installment_count,
    period: row.period,
    amountKurus: row.amount_kurus,
    startDate: row.start_date,
    active: row.active === 1,
    progress: {
      total: row.occurrence_count,
      confirmed: row.confirmed_count,
      pending: row.pending_count,
    },
    nextDueDate: row.next_due_date,
    remainingKurus: row.remaining_kurus,
  };
}

function serializeOccurrence(row: OccurrenceWithItem) {
  return {
    id: row.id,
    scheduledItemId: row.scheduled_item_id,
    itemName: row.item_name,
    kind: row.kind,
    direction: row.direction,
    accountId: row.account_id,
    accountName: row.account_name,
    categoryName: row.category_name,
    dueDate: row.due_date,
    amountKurus: row.amount_kurus,
    status: row.status,
    transactionId: row.transaction_id,
    seq: row.seq,
    totalSeq: row.total_seq,
  };
}

const createSchema = z
  .object({
    kind: z.enum(SCHEDULED_KINDS),
    name: z.string().trim().min(1, 'Ad gerekli').max(100),
    direction: z.enum(['income', 'expense']).default('expense'),
    accountId: z.number().int().positive(),
    categoryId: z.number().int().positive().nullable().default(null),
    counterparty: z.string().trim().max(100).nullable().default(null),
    description: z.string().trim().max(500).nullable().default(null),
    startDate: isoDateSchema,

    // planned / bill
    amountKurus: positiveKurusSchema.nullable().default(null),
    // installment
    totalAmountKurus: positiveKurusSchema.nullable().default(null),
    installmentCount: z.number().int().min(2).max(120).nullable().default(null),
    // bill
    period: z.enum(BILL_PERIODS).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'planned' && value.amountKurus === null) {
      ctx.addIssue({ code: 'custom', path: ['amountKurus'], message: 'Planlanan kayit icin tutar zorunlu' });
    }
    if (value.kind === 'installment') {
      if (value.totalAmountKurus === null) {
        ctx.addIssue({ code: 'custom', path: ['totalAmountKurus'], message: 'Toplam tutar zorunlu' });
      }
      if (value.installmentCount === null) {
        ctx.addIssue({ code: 'custom', path: ['installmentCount'], message: 'Taksit sayisi zorunlu' });
      }
    }
    if (value.kind === 'bill' && value.period === null) {
      ctx.addIssue({ code: 'custom', path: ['period'], message: 'Fatura periyodu zorunlu' });
    }
    // Taksit ve fatura dogasi geregi giderdir
    if (value.kind !== 'planned' && value.direction !== 'expense') {
      ctx.addIssue({ code: 'custom', path: ['direction'], message: 'Taksit ve fatura yalnizca gider olabilir' });
    }
  });

scheduledRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const kind = req.query.kind
      ? z.enum(SCHEDULED_KINDS).parse(req.query.kind)
      : undefined;

    res.json({ items: listScheduledItems(user.id, kind).map(serializeItem) });
  }),
);

/** Dashboard ve uyari kartlari icin: yaklasan ve gecikmis vadeler. */
scheduledRouter.get(
  '/upcoming',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const days = z.coerce.number().int().min(0).max(365).default(30).parse(req.query.days ?? 30);

    const today = todayIso();
    const rows = listUpcomingOccurrences(user.id, addDays(today, days));

    res.json({
      today,
      occurrences: rows.map(serializeOccurrence),
      overdueCount: rows.filter((r) => r.due_date < today).length,
    });
  }),
);

scheduledRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = createSchema.parse(req.body);

    if (!accountExists(user.id, input.accountId)) throw notFound('Secilen hesap bulunamadi');
    if (input.categoryId !== null && !categoryExists(user.id, input.categoryId)) {
      throw notFound('Secilen kategori bulunamadi');
    }

    const id = createScheduledItemWithOccurrences(user.id, input);
    const created = findScheduledItem(user.id, id);
    if (!created) throw notFound('Kayit olusturuldu ancak okunamadi');

    res.status(201).json({ item: serializeItem(created) });
  }),
);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  categoryId: z.number().int().positive().nullable().default(null),
  counterparty: z.string().trim().max(100).nullable().default(null),
  description: z.string().trim().max(500).nullable().default(null),
  active: z.boolean().default(true),
});

scheduledRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = updateSchema.parse(req.body);

    if (!findScheduledItem(user.id, id)) throw notFound('Kayit bulunamadi');
    if (input.categoryId !== null && !categoryExists(user.id, input.categoryId)) {
      throw notFound('Secilen kategori bulunamadi');
    }

    updateScheduledItem(user.id, id, input);

    const updated = findScheduledItem(user.id, id);
    res.json({ item: updated ? serializeItem(updated) : null });
  }),
);

scheduledRouter.get(
  '/:id/occurrences',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    if (!findScheduledItem(user.id, id)) throw notFound('Kayit bulunamadi');

    res.json({ occurrences: listOccurrences(user.id, id).map(serializeOccurrence) });
  }),
);

/**
 * Kaydi siler. Onaylanmis vadelerden dogan ISLEMLER SILINMEZ: gecmis harcama
 * gerceklesmistir, plan kaydinin kaldirilmasi onu yok saymaz.
 */
scheduledRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    if (!findScheduledItem(user.id, id)) throw notFound('Kayit bulunamadi');

    const confirmed = countConfirmedOccurrences(user.id, id);
    deleteScheduledItem(user.id, id);

    res.json({ deleted: true, keptTransactions: confirmed });
  }),
);

// --- Vade islemleri ---

export const occurrencesRouter: Router = Router();
occurrencesRouter.use(requireUser);

const confirmSchema = z.object({
  amountKurus: positiveKurusSchema.optional(),
  date: isoDateSchema.optional(),
});

occurrencesRouter.post(
  '/:id/confirm',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = confirmSchema.parse(req.body ?? {});

    confirmOccurrence(user.id, id, input);

    const updated = findOccurrence(user.id, id);
    res.json({ occurrence: updated ? serializeOccurrence(updated) : null });
  }),
);

occurrencesRouter.post(
  '/:id/unconfirm',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    unconfirmOccurrence(user.id, id);

    const updated = findOccurrence(user.id, id);
    res.json({ occurrence: updated ? serializeOccurrence(updated) : null });
  }),
);

const occurrenceUpdateSchema = z.object({
  amountKurus: positiveKurusSchema.nullable().default(null),
  dueDate: isoDateSchema,
});

/** Fatura tutarini girmek veya vadeyi duzeltmek icin (yalnizca bekleyen kayitlar). */
occurrencesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = occurrenceUpdateSchema.parse(req.body);

    const existing = findOccurrence(user.id, id);
    if (!existing) throw notFound('Vade kaydi bulunamadi');
    if (existing.status !== 'pending') {
      throw badRequest('Onaylanmis kayit duzenlenemez; once onayi geri alin');
    }

    updateOccurrenceAmount(user.id, id, input.amountKurus, input.dueDate);

    const updated = findOccurrence(user.id, id);
    res.json({ occurrence: updated ? serializeOccurrence(updated) : null });
  }),
);
