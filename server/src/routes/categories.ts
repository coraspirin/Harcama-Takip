import { Router } from 'express';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { listCategories } from '../db/categories.ts';
import { serializeCategory } from './serializers.ts';

export const categoriesRouter: Router = Router();

categoriesRouter.use(requireUser);

// Faz 2'de yalnizca listeleme; olusturma/duzenleme/arsivleme Faz 4'te eklenecek.
categoriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const includeArchived = req.query.includeArchived === 'true';
    res.json({ categories: listCategories(user.id, includeArchived).map(serializeCategory) });
  }),
);
