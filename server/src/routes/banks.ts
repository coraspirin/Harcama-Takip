import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { idParamSchema } from '../lib/validation.ts';
import {
  bankDeletionImpact,
  bankNameExists,
  createBank,
  deleteBank,
  findBank,
  listBanks,
  updateBank,
} from '../db/banks.ts';
import { serializeBank } from './serializers.ts';

export const banksRouter: Router = Router();

banksRouter.use(requireUser);

const bankSchema = z.object({
  name: z.string().trim().min(1, 'Banka adi gerekli').max(80),
  /**
   * Aylik faiz orani baz puan cinsinden: %3.11 -> 311.
   * Ust sinir %100/ay (10000 bp) - bunun uzeri veri girisi hatasidir.
   */
  monthlyInterestBp: z.number().int().min(0).max(10_000).default(0),
  taxesIncluded: z.boolean().default(true),
});

banksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({ banks: listBanks(user.id).map(serializeBank) });
  }),
);

banksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = bankSchema.parse(req.body);

    if (bankNameExists(user.id, input.name)) {
      throw conflict('Bu isimde bir banka zaten var');
    }

    res.status(201).json({ bank: serializeBank(createBank(user.id, input)) });
  }),
);

banksRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = bankSchema.parse(req.body);

    if (!findBank(user.id, id)) throw notFound('Banka bulunamadi');
    if (bankNameExists(user.id, input.name, id)) {
      throw conflict('Bu isimde bir banka zaten var');
    }

    const updated = updateBank(user.id, id, input);
    if (!updated) throw notFound('Banka bulunamadi');
    res.json({ bank: serializeBank(updated) });
  }),
);

/**
 * Silme onay ekrani icin: bu banka silinirse kac hesap ve kac islem gider?
 * Kullaniciya "N kayit silinecek, emin misiniz?" uyarisi bu veriyle gosterilir.
 */
banksRouter.get(
  '/:id/impact',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const bank = findBank(user.id, id);
    if (!bank) throw notFound('Banka bulunamadi');

    res.json({ impact: bankDeletionImpact(user.id, id) });
  }),
);

banksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const bank = findBank(user.id, id);
    if (!bank) throw notFound('Banka bulunamadi');

    // Bagli hesaplar ve islemler ON DELETE CASCADE ile birlikte silinir.
    const impact = bankDeletionImpact(user.id, id);
    deleteBank(user.id, id);

    res.json({ deleted: true, impact });
  }),
);
