import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.ts';
import { currentUser, requireSuperAdmin } from '../../middleware/auth.ts';
import { sensitiveLimiter } from '../../middleware/rateLimit.ts';
import { badRequest, conflict, notFound } from '../../lib/errors.ts';
import { hashPassword } from '../../lib/auth.ts';
import { emailSchema, idParamSchema, passwordSchema, usernameSchema } from '../../lib/validation.ts';
import {
  countUsersByRole,
  deleteUser,
  emailExists,
  findUserById,
  listUsers,
  setUserActive,
  setUserPassword,
  usernameExists,
} from '../../db/users.ts';
import { revokeAllForUser } from '../../db/sessions.ts';
import { writeAudit } from '../../db/audit.ts';
import { provisionUser } from '../../services/userProvisioning.ts';
import type { UserRow } from '../../types.ts';

export const adminUsersRouter: Router = Router();

adminUsersRouter.use(requireSuperAdmin);

/**
 * Super admin'e donen kullanici gorunumu.
 *
 * KURAL: bu nesnede finansal veriye dair TEK BIR ALAN bile bulunmaz -
 * ne bakiye, ne islem sayisi, ne kategori. Yalnizca hesap yonetimi bilgileri.
 * Yeni bir alan eklenecekse once bu kural hatirlanmali.
 */
function serializeAdminUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
  };
}

/** Sifre sifirlamada tek seferlik, guclu bir gecici sifre uretilir. */
function generateTemporaryPassword(): string {
  // base64url: 12 bayt -> 16 karakter, hem okunabilir hem yeterince entropili
  return crypto.randomBytes(12).toString('base64url');
}

adminUsersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ users: listUsers().map(serializeAdminUser) });
  }),
);

const createSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  /** Kullanici ilk giriste sifresini degistirmek zorunda kalsin mi. */
  mustChangePassword: z.boolean().default(true),
});

adminUsersRouter.post(
  '/',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = createSchema.parse(req.body);

    if (usernameExists(input.username)) throw conflict('Bu kullanici adi zaten kullaniliyor');
    if (input.email && emailExists(input.email)) throw conflict('Bu e-posta zaten kullaniliyor');

    const created = provisionUser({
      username: input.username,
      email: input.email ?? null,
      passwordHash: await hashPassword(input.password),
      role: 'user',
      mustChangePassword: input.mustChangePassword,
    });

    writeAudit({
      actorUserId: admin.id,
      actorUsername: admin.username,
      action: 'user.created',
      targetUserId: created.id,
      targetUsername: created.username,
      ip: req.ip ?? null,
    });

    res.status(201).json({ user: serializeAdminUser(created) });
  }),
);

const activeSchema = z.object({ isActive: z.boolean() });

adminUsersRouter.patch(
  '/:id/active',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const id = idParamSchema.parse(req.params.id);
    const { isActive } = activeSchema.parse(req.body);

    const target = findUserById(id);
    if (!target) throw notFound('Kullanici bulunamadi');
    if (target.id === admin.id) throw badRequest('Kendi hesabinizi devre disi birakamazsiniz');
    if (target.role === 'super_admin' && !isActive && countUsersByRole('super_admin') <= 1) {
      throw badRequest('Sistemdeki tek super admin devre disi birakilamaz');
    }

    setUserActive(id, isActive);
    // Pasife alinan kullanicinin acik oturumlari da kapanmali
    if (!isActive) revokeAllForUser(id);

    writeAudit({
      actorUserId: admin.id,
      actorUsername: admin.username,
      action: isActive ? 'user.activated' : 'user.deactivated',
      targetUserId: target.id,
      targetUsername: target.username,
      ip: req.ip ?? null,
    });

    const updated = findUserById(id);
    res.json({ user: updated ? serializeAdminUser(updated) : null });
  }),
);

/**
 * Sifre sifirlama. Uretilen gecici sifre YALNIZCA bu yanitta doner, hicbir
 * yerde saklanmaz ve loglanmaz.
 *
 * Guvenlik notu: super admin bir sifreyi sifirlayip o kullanici olarak giris
 * yapabilir - bu, rol ayriminin kacinilmaz siniridir. Mitigasyon: islem audit
 * log'a yazilir ve kullanici ilk giriste sifresini degistirmek ZORUNDA kalir,
 * boylece admin'in bildigi sifre kalici erisim saglamaz.
 */
adminUsersRouter.post(
  '/:id/reset-password',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const target = findUserById(id);
    if (!target) throw notFound('Kullanici bulunamadi');
    if (target.id === admin.id) {
      throw badRequest('Kendi sifrenizi buradan sifirlayamazsiniz; Ayarlar bolumunu kullanin');
    }

    const temporaryPassword = generateTemporaryPassword();
    setUserPassword(id, await hashPassword(temporaryPassword), true);
    // Sifirlanan hesabin tum oturumlari kapanir
    revokeAllForUser(id);

    writeAudit({
      actorUserId: admin.id,
      actorUsername: admin.username,
      action: 'user.password_reset',
      targetUserId: target.id,
      targetUsername: target.username,
      ip: req.ip ?? null,
    });

    res.json({
      temporaryPassword,
      note: 'Bu sifre yalnizca bir kez gosterilir. Kullanici ilk giriste degistirmek zorundadir.',
    });
  }),
);

adminUsersRouter.delete(
  '/:id',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    const target = findUserById(id);
    if (!target) throw notFound('Kullanici bulunamadi');
    if (target.id === admin.id) throw badRequest('Kendi hesabinizi silemezsiniz');
    if (target.role === 'super_admin' && countUsersByRole('super_admin') <= 1) {
      throw badRequest('Sistemdeki tek super admin silinemez');
    }

    // Audit kaydi silmeden ONCE yazilir: kullanici satiri gidince
    // actor_user_id disindaki bilgiler metin olarak korunur.
    writeAudit({
      actorUserId: admin.id,
      actorUsername: admin.username,
      action: 'user.deleted',
      targetUserId: target.id,
      targetUsername: target.username,
      ip: req.ip ?? null,
    });

    // Kullaniciya ait tum veri ON DELETE CASCADE ile birlikte silinir.
    deleteUser(id);

    res.json({ deleted: true });
  }),
);
