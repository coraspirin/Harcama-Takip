import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { idParamSchema, isoDateSchema, kurusSchema, positiveKurusSchema } from '../lib/validation.ts';
import { isIsoDate, todayIso } from '../lib/date.ts';
import {
  deleteContribution,
  deleteGoal,
  findGoal,
  insertContribution,
  insertGoal,
  listUserContributions,
  updateGoal,
} from '../db/savings.ts';
import {
  getSavingsOverview,
  serializeContribution,
  serializeGoal,
} from '../services/savingsOverviewService.ts';

export const savingsRouter: Router = Router();

savingsRouter.use(requireUser);

function goalResponse(userId: number, goalId: number) {
  const goal = findGoal(userId, goalId);
  if (!goal) throw notFound('Hedef bulunamadi');
  const contributions = listUserContributions(userId).filter((c) => c.goal_id === goalId);
  return {
    goal: serializeGoal(goal, contributions, todayIso()),
    contributions: contributions.map(serializeContribution),
  };
}

savingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(getSavingsOverview(user.id, todayIso(), req.query.includeClosed === 'true'));
  }),
);

const goalSchema = z.object({
  name: z.string().trim().min(1, 'Ad gerekli').max(100),
  targetKurus: positiveKurusSchema,
  targetDate: isoDateSchema.nullable().default(null),
  monthlyPlanKurus: positiveKurusSchema.nullable().default(null),
  isEmergencyFund: z.boolean().default(false),
  note: z.string().trim().max(500).nullable().default(null),
});

function assertDate(value: string | null): void {
  if (value !== null && !isIsoDate(value)) throw badRequest('Gecersiz tarih');
}

savingsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = goalSchema.parse(req.body);
    assertDate(input.targetDate);

    const id = insertGoal(user.id, input);
    res.status(201).json(goalResponse(user.id, id));
  }),
);

savingsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(goalResponse(user.id, idParamSchema.parse(req.params.id)));
  }),
);

savingsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = goalSchema.and(z.object({ closed: z.boolean().default(false) })).parse(req.body);
    assertDate(input.targetDate);

    if (!findGoal(user.id, id)) throw notFound('Hedef bulunamadi');
    updateGoal(user.id, id, input);
    res.json(goalResponse(user.id, id));
  }),
);

savingsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    if (!deleteGoal(user.id, id)) throw notFound('Hedef bulunamadi');
    res.json({ deleted: true });
  }),
);

const contributionSchema = z.object({
  date: isoDateSchema,
  // Eksi tutar hedeften cekistir
  amountKurus: kurusSchema.refine((v) => v !== 0, 'Tutar sifir olamaz'),
  note: z.string().trim().max(200).nullable().default(null),
});

savingsRouter.post(
  '/:id/contributions',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const input = contributionSchema.parse(req.body);
    assertDate(input.date);

    if (!findGoal(user.id, id)) throw notFound('Hedef bulunamadi');
    insertContribution(user.id, id, input.date, input.amountKurus, input.note);
    res.status(201).json(goalResponse(user.id, id));
  }),
);

savingsRouter.delete(
  '/:id/contributions/:contributionId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const contributionId = idParamSchema.parse(req.params.contributionId);

    if (!findGoal(user.id, id)) throw notFound('Hedef bulunamadi');
    if (!deleteContribution(user.id, id, contributionId)) throw notFound('Katki bulunamadi');
    res.json(goalResponse(user.id, id));
  }),
);
