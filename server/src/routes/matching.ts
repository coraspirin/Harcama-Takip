import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { detectRecurrences, rejectRecurrence } from '../services/recurrenceDetector.ts';

export const matchingRouter: Router = Router();

matchingRouter.use(requireUser);

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
