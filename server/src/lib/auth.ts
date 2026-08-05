import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { env } from '../config/env.ts';
import type { Role } from '../types.ts';

/** bcrypt maliyet katsayisi. 12 ~ 250ms; brute-force'u pratik olmaktan cikarir. */
const BCRYPT_ROUNDS = 12;

export const ACCESS_COOKIE = 'ht_at';
export const REFRESH_COOKIE = 'ht_rt';

/**
 * Refresh cookie'si yalnizca /api/auth altina gonderilir; diger endpoint'lere
 * her istekte tasinmaz, boylece sizma yuzeyi daralir.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

export type AccessTokenPayload = {
  sub: string;
  username: string;
  role: Role;
};

export type RefreshTokenPayload = {
  sub: string;
  jti: string;
  fam: string;
};

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Refresh token veritabanina hash'lenerek yazilir. bcrypt yerine SHA-256:
 * token zaten yuksek entropili rastgele bir deger, yavas hash'e gerek yok ve
 * her istekte dogrulama yapilacagi icin hiz onemli.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
  });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    return null;
  }
}

export function newTokenId(): string {
  return crypto.randomUUID();
}

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Strict: uygulama tek origin'den servis edildigi icin CSRF'e karsi
    // ek bir token mekanizmasina gerek birakmaz.
    sameSite: 'strict',
    secure: env.COOKIE_SECURE,
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseCookieOptions(),
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL_MIN * 60 * 1000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookieOptions(),
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookieOptions(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookieOptions(), path: REFRESH_COOKIE_PATH });
}

/** Refresh token'in son kullanma zamani (ISO). */
export function refreshExpiresAt(): string {
  const ms = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}
