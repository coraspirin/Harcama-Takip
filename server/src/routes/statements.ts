import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { idParamSchema, isoDateSchema, kurusSchema } from '../lib/validation.ts';
import { addDays } from '../lib/date.ts';
import { findAccount } from '../db/accounts.ts';
import { findBank } from '../db/banks.ts';
import {
  createStatement,
  deleteStatement,
  findLatestStatement,
  findPreviousStatement,
  findStatement,
  listStatements,
  periodActivityKurus,
  updateStatement,
  type CardStatementRow,
} from '../db/statements.ts';
import { calculateStatementInterest, reconcileStatement } from '../services/interestService.ts';

export const statementsRouter: Router = Router();

statementsRouter.use(requireUser);

function serializeStatement(row: CardStatementRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    periodEnd: row.period_end,
    dueDate: row.due_date,
    statementAmountKurus: row.statement_amount_kurus,
    paidAmountKurus: row.paid_amount_kurus,
    minimumPaymentKurus: row.minimum_payment_kurus,
    createdAt: row.created_at,
  };
}

const statementSchema = z.object({
  accountId: z.number().int().positive(),
  periodEnd: isoDateSchema,
  dueDate: isoDateSchema.nullable().default(null),
  statementAmountKurus: kurusSchema,
  paidAmountKurus: kurusSchema.refine((v) => v >= 0, 'Odenen tutar negatif olamaz').default(0),
  minimumPaymentKurus: kurusSchema.nullable().default(null),
});

/** Kredi karti hesabini ve (varsa) bagli bankasini dogrular. */
function requireCreditCard(userId: number, accountId: number) {
  const account = findAccount(userId, accountId);
  if (!account) throw notFound('Hesap bulunamadi');
  if (account.type !== 'credit_card') {
    throw badRequest('Ekstre yalnizca kredi karti hesaplarina eklenebilir');
  }
  return account;
}

statementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const accountId = idParamSchema.parse(req.query.accountId);

    requireCreditCard(user.id, accountId);
    res.json({ statements: listStatements(user.id, accountId).map(serializeStatement) });
  }),
);

/**
 * Kredi karti ozeti: son ekstre, tahmini faiz ve ekstre-islem mutabakati.
 * Bakiye islemlerden gelir; ekstre yalnizca faiz ve mutabakat icin kullanilir.
 */
statementsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const accountId = idParamSchema.parse(req.query.accountId);

    const account = requireCreditCard(user.id, accountId);
    const bank = account.bank_id !== null ? findBank(user.id, account.bank_id) : null;
    const statement = findLatestStatement(user.id, accountId);

    if (!statement) {
      res.json({
        accountId,
        balanceKurus: account.balance_kurus,
        bank: bank ? { id: bank.id, name: bank.name } : null,
        statement: null,
        interest: null,
        reconciliation: null,
      });
      return;
    }

    const previous = findPreviousStatement(user.id, accountId, statement.period_end);
    const periodStart = previous ? addDays(previous.period_end, 1) : null;

    const interest = calculateStatementInterest({
      statementAmountKurus: statement.statement_amount_kurus,
      paidAmountKurus: statement.paid_amount_kurus,
      monthlyInterestBp: bank?.monthly_interest_bp ?? 0,
      taxesIncluded: bank?.taxes_included === 1,
    });

    const reconciliation = reconcileStatement(
      statement.statement_amount_kurus,
      periodActivityKurus(user.id, accountId, periodStart, statement.period_end),
    );

    res.json({
      accountId,
      balanceKurus: account.balance_kurus,
      bank: bank
        ? {
            id: bank.id,
            name: bank.name,
            monthlyInterestBp: bank.monthly_interest_bp,
            taxesIncluded: bank.taxes_included === 1,
          }
        : null,
      statement: serializeStatement(statement),
      period: { start: periodStart, end: statement.period_end },
      interest,
      reconciliation,
      // Banka tanimli degilse faiz hesaplanamaz - kullaniciya bunu soyleriz.
      warning: bank
        ? null
        : 'Bu karta bagli bir banka secilmedigi icin faiz hesaplanamiyor. Hesap ayarlarindan banka secin.',
    });
  }),
);

statementsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = statementSchema.parse(req.body);

    requireCreditCard(user.id, input.accountId);

    if (input.dueDate && input.dueDate < input.periodEnd) {
      throw badRequest('Son odeme tarihi kesim tarihinden once olamaz');
    }

    try {
      res.status(201).json({ statement: serializeStatement(createStatement(user.id, input)) });
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_SQLITE_ERROR') {
        throw conflict('Bu kesim tarihi icin zaten bir ekstre kaydi var');
      }
      throw err;
    }
  }),
);

statementsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = statementSchema.parse(req.body);

    const existing = findStatement(user.id, id);
    if (!existing) throw notFound('Ekstre bulunamadi');

    if (input.dueDate && input.dueDate < input.periodEnd) {
      throw badRequest('Son odeme tarihi kesim tarihinden once olamaz');
    }

    const updated = updateStatement(user.id, id, input);
    if (!updated) throw notFound('Ekstre bulunamadi');

    res.json({ statement: serializeStatement(updated) });
  }),
);

statementsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    if (!findStatement(user.id, id)) throw notFound('Ekstre bulunamadi');

    deleteStatement(user.id, id);
    res.json({ deleted: true });
  }),
);
