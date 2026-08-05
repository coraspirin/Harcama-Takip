import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import { idParamSchema, kurusSchema } from '../lib/validation.ts';
import {
  ACCOUNT_TYPES,
  accountNameExists,
  countAccountTransactions,
  createAccount,
  deleteAccount,
  findAccount,
  listAccounts,
  updateAccount,
} from '../db/accounts.ts';
import { findBank } from '../db/banks.ts';
import { serializeAccount } from './serializers.ts';

export const accountsRouter: Router = Router();

accountsRouter.use(requireUser);

const accountSchema = z.object({
  name: z.string().trim().min(1, 'Hesap adi gerekli').max(80),
  type: z.enum(ACCOUNT_TYPES),
  bankId: z.number().int().positive().nullable().default(null),
  openingBalanceKurus: kurusSchema.default(0),
  archived: z.boolean().default(false),
  /** Kredi kartina ozgu: ekstre kesim gunu, son odeme gunu ve limit */
  statementDay: z.number().int().min(1).max(31).nullable().default(null),
  dueDay: z.number().int().min(1).max(31).nullable().default(null),
  creditLimitKurus: kurusSchema.refine((v) => v >= 0, 'Limit negatif olamaz').nullable().default(null),
});

/** Hesap turu ile banka baglantisi arasindaki tutarlilik kurallari. */
function validateBankLink(
  userId: number,
  type: (typeof ACCOUNT_TYPES)[number],
  bankId: number | null,
): void {
  if (type === 'cash' && bankId !== null) {
    throw badRequest('Nakit hesap bir bankaya baglanamaz');
  }
  if (bankId !== null && !findBank(userId, bankId)) {
    throw notFound('Secilen banka bulunamadi');
  }
}

accountsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const includeArchived = req.query.includeArchived === 'true';
    res.json({ accounts: listAccounts(user.id, includeArchived).map(serializeAccount) });
  }),
);

accountsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const account = findAccount(user.id, id);
    if (!account) throw notFound('Hesap bulunamadi');

    res.json({ account: serializeAccount(account) });
  }),
);

accountsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = accountSchema.parse(req.body);

    validateBankLink(user.id, input.type, input.bankId);
    if (accountNameExists(user.id, input.name)) {
      throw conflict('Bu isimde bir hesap zaten var');
    }

    res.status(201).json({ account: serializeAccount(createAccount(user.id, input)) });
  }),
);

accountsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = accountSchema.parse(req.body);

    if (!findAccount(user.id, id)) throw notFound('Hesap bulunamadi');
    validateBankLink(user.id, input.type, input.bankId);
    if (accountNameExists(user.id, input.name, id)) {
      throw conflict('Bu isimde bir hesap zaten var');
    }

    const updated = updateAccount(user.id, id, input);
    if (!updated) throw notFound('Hesap bulunamadi');
    res.json({ account: serializeAccount(updated) });
  }),
);

/**
 * Islemi olan bir hesap kazayla silinmesin diye once 409 doner ve kac kaydin
 * silinecegini bildirir; kullanici onaylarsa ?force=true ile tekrar cagrilir.
 */
accountsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const account = findAccount(user.id, id);
    if (!account) throw notFound('Hesap bulunamadi');

    const transactionCount = countAccountTransactions(user.id, id);
    if (transactionCount > 0 && req.query.force !== 'true') {
      throw conflict(
        `Bu hesaba bagli ${transactionCount} islem kaydi var. Hesabi silmek yerine arsivleyebilirsiniz.`,
        { transactionCount },
      );
    }

    deleteAccount(user.id, id);
    res.json({ deleted: true, deletedTransactions: transactionCount });
  }),
);
