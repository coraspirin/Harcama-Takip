import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { sensitiveLimiter } from '../middleware/rateLimit.ts';
import { badRequest } from '../lib/errors.ts';
import {
  exportUserData,
  importPayloadSchema,
  importUserData,
  resetUserData,
} from '../services/dataService.ts';

export const dataRouter: Router = Router();

dataRouter.use(requireUser);

/** Kullanicinin TUM verisini JSON olarak indirir. */
dataRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const data = exportUserData(user.id, user.username);

    const filename = `harcama-takip-${user.username}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(data);
  }),
);

const importSchema = z.object({
  mode: z.enum(['merge', 'replace']).default('merge'),
  data: importPayloadSchema,
});

dataRouter.post(
  '/import',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { mode, data } = importSchema.parse(req.body);

    res.json({ result: importUserData(user.id, data, mode) });
  }),
);

/**
 * Verinin tamamini siler. Kaza sonucu tetiklenmemesi icin istemcinin
 * dogrulama kelimesini aynen gondermesi gerekir.
 */
const RESET_CONFIRMATION = 'VERIMI SIL';

dataRouter.post(
  '/reset',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body);

    if (confirm !== RESET_CONFIRMATION) {
      throw badRequest(`Onaylamak icin "${RESET_CONFIRMATION}" yazmalisiniz`);
    }

    resetUserData(user.id);
    res.json({ reset: true });
  }),
);
