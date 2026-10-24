import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { idParamSchema, isoDateSchema, kurusSchema, positiveKurusSchema } from '../lib/validation.ts';
import { isIsoDate, todayIso } from '../lib/date.ts';
import {
  DEBT_KINDS,
  currentBalanceKurus,
  deleteDebt,
  deleteDebtPayment,
  findDebt,
  insertDebt,
  insertDebtPayment,
  listDebtPayments,
  listDebts,
  setDebtBalance,
  updateDebt,
  type DebtPaymentRow,
} from '../db/debts.ts';
import { compareExtraPayment, simulateStrategy, type StrategyDebt } from '../services/debtForecastService.ts';
import {
  forecastStartMonth,
  getDebtOverview,
  payoffInput,
  serializeDebt,
  summarizePayoff,
} from '../services/debtOverviewService.ts';

export const debtsRouter: Router = Router();

debtsRouter.use(requireUser);

function serializePayment(row: DebtPaymentRow) {
  return {
    id: row.id,
    debtId: row.debt_id,
    date: row.date,
    amountKurus: row.amount_kurus,
    note: row.note,
  };
}

debtsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const includeClosed = req.query.includeClosed === 'true';

    res.json(getDebtOverview(user.id, includeClosed));
  }),
);

const extraQuerySchema = z.object({
  extra: z.coerce.number().int().min(0).max(1_000_000_000_00).default(0),
});

/**
 * Fazla odemeyi borclara nasil dagitmali? Acik borclar (taksitler haric -
 * onlarin plani sabit) icin cig ve kartopu yontemleri karsilastirilir.
 */
debtsRouter.get(
  '/plan',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { extra } = extraQuerySchema.parse(req.query);

    const debts: StrategyDebt[] = listDebts(user.id)
      .filter((row) => row.direction === 'owe')
      .map((row) => ({
        id: row.id,
        name: row.name,
        balanceKurus: currentBalanceKurus(row),
        monthlyInterestBp: row.monthly_interest_bp,
        taxesIncluded: row.taxes_included === 1,
        minPaymentKurus: row.monthly_payment_kurus ?? 0,
      }));

    const start = forecastStartMonth();
    res.json({
      extraKurus: extra,
      startMonth: start,
      avalanche: simulateStrategy(debts, extra, 'avalanche', start),
      snowball: simulateStrategy(debts, extra, 'snowball', start),
      baseline: simulateStrategy(debts, 0, 'avalanche', start),
    });
  }),
);

const debtSchema = z
  .object({
    kind: z.enum(DEBT_KINDS),
    direction: z.enum(['owe', 'lent']).default('owe'),
    name: z.string().trim().min(1, 'Ad gerekli').max(100),
    counterparty: z.string().trim().max(100).nullable().default(null),
    monthlyInterestBp: z.number().int().min(0).max(10_000).default(0),
    taxesIncluded: z.boolean().default(false),
    monthlyPaymentKurus: positiveKurusSchema.nullable().default(null),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .refine((v) => v.kind === 'personal' || v.direction === 'owe', {
    message: 'Alacak yalnizca kisilerle olan borclarda secilebilir',
    path: ['direction'],
  });

const createSchema = debtSchema.and(
  z.object({
    balanceKurus: kurusSchema.refine((v) => v >= 0, 'Bakiye eksi olamaz'),
    // Bos birakilirsa baslangic tutari = bakiye
    originalKurus: kurusSchema.refine((v) => v >= 0).nullable().default(null),
    balanceDate: isoDateSchema.optional(),
  }),
);

debtsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = createSchema.parse(req.body);
    const balanceDate = input.balanceDate ?? todayIso();
    if (!isIsoDate(balanceDate)) throw badRequest('Gecersiz tarih');

    const id = insertDebt(user.id, {
      ...input,
      originalKurus: Math.max(input.originalKurus ?? input.balanceKurus, input.balanceKurus),
      balanceKurus: input.balanceKurus,
      balanceDate,
    });

    const created = findDebt(user.id, id);
    if (!created) throw notFound('Borc olusturuldu ancak okunamadi');
    res.status(201).json({ debt: serializeDebt(created) });
  }),
);

debtsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const { extra } = extraQuerySchema.parse(req.query);

    const row = findDebt(user.id, id);
    if (!row) throw notFound('Borc bulunamadi');

    const whatIf = compareExtraPayment(payoffInput(row), extra);

    res.json({
      debt: serializeDebt(row),
      payments: listDebtPayments(user.id, id).map(serializePayment),
      schedule: whatIf.base.schedule,
      whatIf: {
        extraKurus: extra,
        base: summarizePayoff(whatIf.base),
        improved: summarizePayoff(whatIf.improved),
        monthsSaved: whatIf.monthsSaved,
        interestSavedKurus: whatIf.interestSavedKurus,
      },
    });
  }),
);

const updateSchema = debtSchema.and(
  z.object({
    originalKurus: kurusSchema.refine((v) => v >= 0, 'Tutar eksi olamaz'),
    closed: z.boolean().default(false),
  }),
);

debtsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = updateSchema.parse(req.body);

    if (!findDebt(user.id, id)) throw notFound('Borc bulunamadi');
    updateDebt(user.id, id, input);

    const updated = findDebt(user.id, id);
    if (!updated) throw notFound('Borc bulunamadi');
    res.json({ debt: serializeDebt(updated) });
  }),
);

const balanceSchema = z.object({
  balanceKurus: kurusSchema.refine((v) => v >= 0, 'Bakiye eksi olamaz'),
  date: isoDateSchema.optional(),
});

/**
 * Banka uygulamasindan/ekstreden okunan guncel bakiyeyi bildirir. Bu tarihe
 * kadarki odemelerin bakiyeye yansidigi kabul edilir; tahminlerdeki faiz
 * sapmasi da bu sekilde duzeltilir.
 */
debtsRouter.post(
  '/:id/balance',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = balanceSchema.parse(req.body);
    const date = input.date ?? todayIso();
    if (!isIsoDate(date)) throw badRequest('Gecersiz tarih');

    if (!findDebt(user.id, id)) throw notFound('Borc bulunamadi');
    setDebtBalance(user.id, id, input.balanceKurus, date);

    const updated = findDebt(user.id, id);
    if (!updated) throw notFound('Borc bulunamadi');
    res.json({ debt: serializeDebt(updated) });
  }),
);

debtsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    if (!findDebt(user.id, id)) throw notFound('Borc bulunamadi');
    deleteDebt(user.id, id);
    res.json({ deleted: true });
  }),
);

const paymentSchema = z.object({
  date: isoDateSchema,
  amountKurus: positiveKurusSchema,
  note: z.string().trim().max(200).nullable().default(null),
});

debtsRouter.post(
  '/:id/payments',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = paymentSchema.parse(req.body);
    if (!isIsoDate(input.date)) throw badRequest('Gecersiz tarih');

    const debt = findDebt(user.id, id);
    if (!debt) throw notFound('Borc bulunamadi');

    insertDebtPayment(user.id, id, input.date, input.amountKurus, input.note);

    const updated = findDebt(user.id, id);
    if (!updated) throw notFound('Borc bulunamadi');
    res.status(201).json({
      debt: serializeDebt(updated),
      // Bildirilen bakiyeden once tarihli odeme bakiyeyi degistirmez;
      // kullanici bunu bilmeli.
      affectsBalance: input.date > debt.balance_date,
    });
  }),
);

debtsRouter.delete(
  '/:id/payments/:paymentId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const paymentId = idParamSchema.parse(req.params.paymentId);

    if (!findDebt(user.id, id)) throw notFound('Borc bulunamadi');
    if (!deleteDebtPayment(user.id, id, paymentId)) throw notFound('Odeme bulunamadi');

    const updated = findDebt(user.id, id);
    res.json({ debt: updated ? serializeDebt(updated) : null });
  }),
);
