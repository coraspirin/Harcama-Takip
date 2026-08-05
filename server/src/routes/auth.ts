import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.ts';
import { loginLimiter, refreshLimiter, sensitiveLimiter } from '../middleware/rateLimit.ts';
import { currentUser, requireAnyRole } from '../middleware/auth.ts';
import { badRequest, forbidden, unauthorized } from '../lib/errors.ts';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  hashPassword,
  hashToken,
  verifyPassword,
  verifyRefreshToken,
} from '../lib/auth.ts';
import { passwordSchema, usernameSchema } from '../lib/validation.ts';
import { findUserById, findUserByUsername, setUserPassword } from '../db/users.ts';
import {
  countActiveSessions,
  findRefreshToken,
  revokeAllForUser,
  revokeFamily,
  revokeRefreshToken,
} from '../db/sessions.ts';
import { toPublicUser } from '../types.ts';
import { issueSession } from '../services/sessionService.ts';

export const authRouter: Router = Router();

/**
 * Kullanici bulunamadiginda da bcrypt karsilastirmasi calissin diye kullanilan
 * sabit hash. Aksi halde yanit suresi, kullanici adinin var olup olmadigini
 * ele verir (kullanici numaralandirma).
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO1FKKGz9Wl8kZ0PMxGCk2r5t7g5xW8Iu';

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, 'Sifre gerekli'),
});

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = findUserByUsername(input.username);

    const passwordOk = await verifyPassword(input.password, user?.password_hash ?? DUMMY_HASH);

    // Kullanici adi yanlis / sifre yanlis ayrimi yapmayiz.
    if (!user || !passwordOk) throw unauthorized('Kullanici adi veya sifre hatali');
    if (user.is_active !== 1) throw forbidden('Hesabiniz devre disi birakilmis');

    issueSession(res, user, { userAgent: req.get('user-agent') });

    res.json({ user: toPublicUser(user) });
  }),
);

/**
 * Refresh token rotasyonu: her yenilemede eski token iptal edilir, yenisi
 * verilir. Iptal edilmis bir token tekrar kullanilirsa token calinmis kabul
 * edilir ve o oturumun tum zinciri (family) iptal edilir.
 */
authRouter.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw unauthorized();

    const payload = verifyRefreshToken(token);
    if (!payload) {
      clearAuthCookies(res);
      throw unauthorized('Oturum suresi doldu');
    }

    const stored = findRefreshToken(hashToken(token));
    if (!stored) {
      clearAuthCookies(res);
      throw unauthorized('Oturum gecersiz');
    }

    if (stored.revoked_at !== null) {
      // Yeniden kullanim tespiti - tum zinciri kapat.
      revokeFamily(stored.family_id);
      clearAuthCookies(res);
      throw unauthorized('Oturum guvenlik nedeniyle sonlandirildi');
    }

    if (new Date(stored.expires_at).getTime() < Date.now()) {
      clearAuthCookies(res);
      throw unauthorized('Oturum suresi doldu');
    }

    const user = findUserById(stored.user_id);
    if (!user || user.is_active !== 1) {
      revokeFamily(stored.family_id);
      clearAuthCookies(res);
      throw unauthorized();
    }

    revokeRefreshToken(stored.token_hash);
    issueSession(res, user, {
      userAgent: req.get('user-agent'),
      familyId: stored.family_id,
    });

    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) revokeRefreshToken(hashToken(token));
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

/** "Tum cihazlardan cikis yap" - diger oturumlar dahil her sey kapanir. */
authRouter.post(
  '/logout-all',
  requireAnyRole,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const revoked = revokeAllForUser(user.id);
    clearAuthCookies(res);
    res.json({ ok: true, revokedSessions: revoked });
  }),
);

authRouter.get(
  '/me',
  requireAnyRole,
  asyncHandler(async (req, res) => {
    const auth = currentUser(req);
    const user = findUserById(auth.id);
    if (!user) throw unauthorized();
    res.json({
      user: toPublicUser(user),
      activeSessions: countActiveSessions(user.id),
    });
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mevcut sifre gerekli'),
  newPassword: passwordSchema,
});

/**
 * Sifre degisikligi tum refresh token'lari iptal eder (calinmis bir oturum
 * varsa sifre degistirerek kapatilabilsin diye). Islemi yapan cihaza hemen
 * yeni bir oturum verilir, boylece kullanici tekrar giris yapmak zorunda kalmaz.
 */
authRouter.post(
  '/change-password',
  sensitiveLimiter,
  requireAnyRole,
  asyncHandler(async (req, res) => {
    const auth = currentUser(req);
    const input = changePasswordSchema.parse(req.body);

    const user = findUserById(auth.id);
    if (!user) throw unauthorized();

    const ok = await verifyPassword(input.currentPassword, user.password_hash);
    if (!ok) throw badRequest('Mevcut sifreniz hatali');

    if (input.currentPassword === input.newPassword) {
      throw badRequest('Yeni sifre eskisiyle ayni olamaz');
    }

    setUserPassword(user.id, await hashPassword(input.newPassword), false);
    revokeAllForUser(user.id);

    const updated = findUserById(user.id);
    if (!updated) throw unauthorized();

    issueSession(res, updated, { userAgent: req.get('user-agent') });

    res.json({ user: toPublicUser(updated) });
  }),
);
