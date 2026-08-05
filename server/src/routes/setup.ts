import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { setupLimiter } from '../middleware/rateLimit.ts';
import { conflict } from '../lib/errors.ts';
import { hashPassword } from '../lib/auth.ts';
import { emailSchema, passwordSchema, usernameSchema } from '../lib/validation.ts';
import { createUser, emailExists, usernameExists } from '../db/users.ts';
import { isSetupCompleted, markSetupCompleted } from '../db/meta.ts';
import { writeAudit } from '../db/audit.ts';
import { toPublicUser } from '../types.ts';
import { issueSession } from '../services/sessionService.ts';

export const setupRouter: Router = Router();

const setupSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

/** Frontend acilista buraya bakar: kurulum yapilmamissa /kurulum ekranina gider. */
setupRouter.get('/status', (_req, res) => {
  res.json({ setupCompleted: isSetupCompleted() });
});

/**
 * Ilk (ve tek) super admin hesabini olusturur. Kurulum tamamlandiktan sonra bu
 * uc kalici olarak kapanir - ikinci bir super admin buradan olusturulamaz.
 * Bu yuzden seed script'i veya SUPER_ADMIN_PASSWORD gibi bir ortam degiskeni
 * yoktur; sifre hicbir yerde duz metin durmaz.
 */
setupRouter.post(
  '/',
  setupLimiter,
  asyncHandler(async (req, res) => {
    if (isSetupCompleted()) {
      throw conflict('Kurulum daha once tamamlanmis');
    }

    const input = setupSchema.parse(req.body);

    if (usernameExists(input.username)) throw conflict('Bu kullanici adi zaten kullaniliyor');
    if (input.email && emailExists(input.email)) throw conflict('Bu e-posta zaten kullaniliyor');

    const user = createUser({
      username: input.username,
      email: input.email ?? null,
      passwordHash: await hashPassword(input.password),
      role: 'super_admin',
    });

    markSetupCompleted();

    writeAudit({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'setup.super_admin_created',
      targetUserId: user.id,
      targetUsername: user.username,
      ip: req.ip ?? null,
    });

    // Kurulumu yapan kisi dogrudan oturum acmis olur.
    issueSession(res, user, { userAgent: req.get('user-agent') });

    res.status(201).json({ user: toPublicUser(user) });
  }),
);
