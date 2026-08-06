import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import {
  linkAsTransfer,
  listMatchedTransfers,
  rejectTransferCandidate,
  unlinkTransfer,
} from '../db/transactions.ts';
import { getMatchSettings, saveMatchSettings } from '../db/matchSettings.ts';
import { autoLinkTransfers, listCandidates } from '../services/transferMatcher.ts';
import { detectRecurrences, rejectRecurrence } from '../services/recurrenceDetector.ts';

export const matchingRouter: Router = Router();

matchingRouter.use(requireUser);

matchingRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const settings = getMatchSettings(user.id);
    res.json({
      settings: {
        dayWindow: settings.day_window,
        autoLink: settings.auto_link === 1,
        selfAliases: settings.self_aliases,
      },
    });
  }),
);

const settingsSchema = z.object({
  dayWindow: z.number().int().min(0).max(7),
  autoLink: z.boolean(),
  selfAliases: z.string().max(500),
});

matchingRouter.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    saveMatchSettings(user.id, settingsSchema.parse(req.body));
    res.json({ saved: true });
  }),
);

/** Aday ciftler + eslestirici tarafindan kurulmus mevcut transferler. */
matchingRouter.get(
  '/transfer-candidates',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);

    res.json({
      candidates: listCandidates(user.id),
      matched: listMatchedTransfers(user.id).map((row) => ({
        transferGroupId: row.transfer_group_id,
        amountKurus: row.amount_kurus,
        date: row.date,
        description: row.description,
        fromAccountName: row.account_name,
        toAccountName: row.counterparty_account_name,
        matched: row.transfer_matched,
      })),
    });
  }),
);

/** Kesin adaylari otomatik birlestirir; kalanlari kuyrukta birakir. */
matchingRouter.post(
  '/scan',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({ result: autoLinkTransfers(user.id) });
  }),
);

const pairSchema = z.object({
  expenseId: z.number().int().positive(),
  incomeId: z.number().int().positive(),
});

matchingRouter.post(
  '/link',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = pairSchema.parse(req.body);

    const groupId = linkAsTransfer(user.id, input.expenseId, input.incomeId, 'confirmed');
    if (groupId === null) {
      throw badRequest('Bu islemler birlestirilemedi; biri zaten bir transferin parcasi olabilir');
    }

    res.json({ transferGroupId: groupId });
  }),
);

matchingRouter.post(
  '/reject',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = pairSchema.parse(req.body);
    rejectTransferCandidate(user.id, input.expenseId, input.incomeId);
    res.json({ rejected: true });
  }),
);

matchingRouter.post(
  '/unlink',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const groupId = z.string().uuid().parse(req.body?.transferGroupId);

    const restored = unlinkTransfer(user.id, groupId);
    if (restored === 0) throw notFound('Eslestirilmis transfer bulunamadi');

    res.json({ restored });
  }),
);

/** Gecmisten tekrar eden odemeler. */
matchingRouter.get(
  '/recurrences',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({ suggestions: detectRecurrences(user.id) });
  }),
);

matchingRouter.post(
  '/recurrences/reject',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const signature = z.string().trim().min(1).max(200).parse(req.body?.signature);
    rejectRecurrence(user.id, signature);
    res.json({ rejected: true });
  }),
);
