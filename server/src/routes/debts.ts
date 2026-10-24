import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { idParamSchema, isoDateSchema, kurusSchema, positiveKurusSchema } from '../lib/validation.ts';
import { addMonthsToYearMonth, isIsoDate, todayIso, toYearMonth } from '../lib/date.ts';
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
  listInstallmentDebts,
  setDebtBalance,
  updateDebt,
  type DebtPaymentRow,
  type DebtWithBalance,
  type InstallmentDebtRow,
} from '../db/debts.ts';
import {
  compareExtraPayment,
  simulatePayoff,
  simulateStrategy,
  type Payoff,
  type PayoffInput,
  type StrategyDebt,
} from '../services/debtForecastService.ts';

export const debtsRouter: Router = Router();

debtsRouter.use(requireUser);

/**
 * Tahminler bir SONRAKI aydan baslar: odeme gunu bilinmedigi icin bu ayin
 * odemesinin yapilip yapilmadigini varsaymayiz; yapildiysa odeme olarak
 * girilir ve bakiyeden zaten duser.
 */
function forecastStartMonth(): string {
  return addMonthsToYearMonth(toYearMonth(todayIso()), 1);
}

function payoffInput(row: DebtWithBalance): PayoffInput {
  return {
    balanceKurus: currentBalanceKurus(row),
    monthlyInterestBp: row.monthly_interest_bp,
    taxesIncluded: row.taxes_included === 1,
    paymentKurus: row.monthly_payment_kurus,
    startMonth: forecastStartMonth(),
  };
}

function summarizePayoff(payoff: Payoff) {
  return {
    status: payoff.status,
    months: payoff.months,
    payoffMonth: payoff.payoffMonth,
    totalInterestKurus: payoff.totalInterestKurus,
    totalPaidKurus: payoff.totalPaidKurus,
    firstMonthInterestKurus: payoff.firstMonthInterestKurus,
  };
}

function serializeDebt(row: DebtWithBalance) {
  const balance = currentBalanceKurus(row);
  return {
    id: row.id,
    kind: row.kind,
    direction: row.direction,
    name: row.name,
    counterparty: row.counterparty,
    originalKurus: row.original_kurus,
    reportedBalanceKurus: row.balance_kurus,
    balanceDate: row.balance_date,
    paidSinceKurus: Number(row.paid_since_kurus),
    currentBalanceKurus: balance,
    paidTotalKurus: Number(row.paid_total_kurus),
    paymentCount: Number(row.payment_count),
    lastPaymentDate: row.last_payment_date,
    monthlyInterestBp: row.monthly_interest_bp,
    taxesIncluded: row.taxes_included === 1,
    monthlyPaymentKurus: row.monthly_payment_kurus,
    note: row.note,
    closed: row.closed === 1,
    forecast: row.closed === 1 ? null : summarizePayoff(simulatePayoff(payoffInput(row))),
  };
}

function serializeInstallment(row: InstallmentDebtRow) {
  return {
    itemId: row.item_id,
    name: row.name,
    remainingKurus: Number(row.remaining_kurus),
    remainingCount: Number(row.remaining_count),
    totalCount: row.total_count,
    nextDueDate: row.next_due_date,
    lastDueDate: row.last_due_date,
    monthlyKurus: row.monthly_kurus,
  };
}

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

    const debts = listDebts(user.id, includeClosed).map(serializeDebt);
    const installments = listInstallmentDebts(user.id).map(serializeInstallment);

    const openOwe = debts.filter((d) => !d.closed && d.direction === 'owe');
    const openLent = debts.filter((d) => !d.closed && d.direction === 'lent');

    // Borcsuz kalma ayi: tum borclarin ve taksitlerin en gec biten ayi.
    // Bitme tarihi hesaplanamayan bir borc varsa tarih verilmez; yanlis bir
    // iyimserlik yerine nedeni ekranda gosterilir.
    const unknown = openOwe.filter(
      (d) => d.forecast && d.forecast.status !== 'ends' && d.forecast.status !== 'paid',
    );
    const endMonths = [
      ...openOwe.map((d) => d.forecast?.payoffMonth).filter((m): m is string => !!m),
      ...installments.map((i) => i.lastDueDate?.slice(0, 7)).filter((m): m is string => !!m),
    ];
    const debtFreeMonth =
      unknown.length > 0 || endMonths.length === 0 ? null : [...endMonths].sort().at(-1)!;

    res.json({
      debts,
      installments,
      totals: {
        oweKurus:
          openOwe.reduce((sum, d) => sum + d.currentBalanceKurus, 0) +
          installments.reduce((sum, i) => sum + i.remainingKurus, 0),
        lentKurus: openLent.reduce((sum, d) => sum + d.currentBalanceKurus, 0),
        monthlyPaymentKurus:
          openOwe.reduce((sum, d) => sum + (d.monthlyPaymentKurus ?? 0), 0) +
          installments.reduce((sum, i) => sum + (i.monthlyKurus ?? 0), 0),
        remainingInterestKurus: openOwe.reduce(
          (sum, d) => sum + (d.forecast?.totalInterestKurus ?? 0),
          0,
        ),
        debtFreeMonth,
        unknownForecastCount: unknown.length,
      },
    });
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
