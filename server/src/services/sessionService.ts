import type { Response } from 'express';
import {
  hashToken,
  newTokenId,
  refreshExpiresAt,
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
} from '../lib/auth.ts';
import { storeRefreshToken } from '../db/sessions.ts';
import type { UserRow } from '../types.ts';

/**
 * Kullaniciya yeni bir access + refresh token cifti verir, refresh token'i
 * hash'leyerek veritabanina yazar ve cookie'leri kurar.
 *
 * `familyId` verilirse mevcut oturumun rotasyon zinciri surdurulur; verilmezse
 * yeni bir oturum (yeni cihaz) baslar.
 */
export function issueSession(
  res: Response,
  user: UserRow,
  options: { userAgent?: string | null; familyId?: string } = {},
): void {
  const familyId = options.familyId ?? newTokenId();
  const jti = newTokenId();

  const accessToken = signAccessToken({
    sub: String(user.id),
    username: user.username,
    role: user.role,
  });

  const refreshToken = signRefreshToken({ sub: String(user.id), jti, fam: familyId });

  storeRefreshToken({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: refreshExpiresAt(),
    userAgent: options.userAgent ?? null,
  });

  setAuthCookies(res, accessToken, refreshToken);
}
