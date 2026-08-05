import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { conflict, notFound } from '../lib/errors.ts';
import { idParamSchema } from '../lib/validation.ts';
import {
  categoryNameExists,
  countCategoryUsage,
  createCategory,
  deleteCategory,
  findCategory,
  listCategories,
  updateCategory,
} from '../db/categories.ts';
import { serializeCategory } from './serializers.ts';

export const categoriesRouter: Router = Router();

categoriesRouter.use(requireUser);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Kategori adi gerekli').max(60),
  kind: z.enum(['income', 'expense']),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Kategori adi gerekli').max(60),
  archived: z.boolean().default(false),
});

categoriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const includeArchived = req.query.includeArchived === 'true';

    const categories = listCategories(user.id, includeArchived).map((row) => ({
      ...serializeCategory(row),
      usageCount: countCategoryUsage(user.id, row.id),
    }));

    res.json({ categories });
  }),
);

categoriesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = createSchema.parse(req.body);

    if (categoryNameExists(user.id, input.name, input.kind)) {
      throw conflict('Bu isimde bir kategori zaten var');
    }

    res
      .status(201)
      .json({ category: serializeCategory(createCategory(user.id, input.name, input.kind)) });
  }),
);

categoriesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = updateSchema.parse(req.body);

    const existing = findCategory(user.id, id);
    if (!existing) throw notFound('Kategori bulunamadi');

    if (categoryNameExists(user.id, input.name, existing.kind, id)) {
      throw conflict('Bu isimde bir kategori zaten var');
    }

    const updated = updateCategory(user.id, id, input.name, input.archived);
    if (!updated) throw notFound('Kategori bulunamadi');

    res.json({ category: serializeCategory(updated) });
  }),
);

/**
 * Kullanimda olan kategori silinmez, ARSIVLENIR: gecmis islemlerin kategorisi
 * kaybolmamali. Istemciye ne yapildigi acikca bildirilir.
 */
categoriesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const existing = findCategory(user.id, id);
    if (!existing) throw notFound('Kategori bulunamadi');

    const usage = countCategoryUsage(user.id, id);
    if (usage > 0) {
      const archived = updateCategory(user.id, id, existing.name, true);
      res.json({
        action: 'archived',
        usageCount: usage,
        category: archived ? serializeCategory(archived) : null,
      });
      return;
    }

    deleteCategory(user.id, id);
    res.json({ action: 'deleted', usageCount: 0, category: null });
  }),
);
