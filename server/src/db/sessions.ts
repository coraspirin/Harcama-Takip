import { getDb } from './connection.ts';

export type RefreshTokenRow = {
  id: number;
  user_id: number;
  token_hash: string;
  family_id: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  created_at: string;
};

export type StoreRefreshTokenInput = {
  userId: number;
  tokenHash: string;
  familyId: string;
  expiresAt: string;
  userAgent?: string | null;
};

export function storeRefreshToken(input: StoreRefreshTokenInput): void {
  getDb()
    .prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId,
      input.tokenHash,
      input.familyId,
      input.expiresAt,
      input.userAgent?.slice(0, 255) ?? null,
    );
}

export function findRefreshToken(tokenHash: string): RefreshTokenRow | null {
  const row = getDb()
    .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
    .get(tokenHash) as RefreshTokenRow | undefined;
  return row ?? null;
}

export function revokeRefreshToken(tokenHash: string): void {
  getDb()
    .prepare(
      `UPDATE refresh_tokens SET revoked_at = datetime('now')
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .run(tokenHash);
}

/**
 * Iptal edilmis bir token yeniden kullanilirsa (calinma belirtisi) o oturumun
 * tum rotasyon zinciri birden iptal edilir.
 */
export function revokeFamily(familyId: string): void {
  getDb()
    .prepare(
      `UPDATE refresh_tokens SET revoked_at = datetime('now')
       WHERE family_id = ? AND revoked_at IS NULL`,
    )
    .run(familyId);
}

/** "Tum cihazlardan cikis" ve sifre degisikliginde kullanilir. */
export function revokeAllForUser(userId: number): number {
  const result = getDb()
    .prepare(
      `UPDATE refresh_tokens SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .run(userId);
  return Number(result.changes);
}

export function countActiveSessions(userId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM refresh_tokens
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')`,
    )
    .get(userId) as { n: number };
  return Number(row.n);
}

/** Suresi dolmus kayitlarin temizligi (acilista ve zamanlanmis gorevde). */
export function purgeExpiredTokens(): number {
  const result = getDb()
    .prepare(`DELETE FROM refresh_tokens WHERE expires_at < datetime('now', '-7 days')`)
    .run();
  return Number(result.changes);
}
