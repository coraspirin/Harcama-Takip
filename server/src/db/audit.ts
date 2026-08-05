import { getDb } from './connection.ts';

/**
 * Super admin'in yaptigi hesap yonetimi islemleri. Finansal veriye dair hicbir
 * bilgi burada tutulmaz - yalnizca kim, ne zaman, hangi hesaba ne yapti.
 */
export const AUDIT_ACTIONS = [
  'setup.super_admin_created',
  'user.created',
  'user.activated',
  'user.deactivated',
  'user.deleted',
  'user.password_reset',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditLogRow = {
  id: number;
  actor_user_id: number | null;
  actor_username: string;
  action: AuditAction;
  target_user_id: number | null;
  target_username: string | null;
  details: string | null;
  ip: string | null;
  created_at: string;
};

export type WriteAuditInput = {
  actorUserId: number | null;
  actorUsername: string;
  action: AuditAction;
  targetUserId?: number | null;
  targetUsername?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
};

export function writeAudit(input: WriteAuditInput): void {
  getDb()
    .prepare(
      `INSERT INTO audit_logs
         (actor_user_id, actor_username, action, target_user_id, target_username, details, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.actorUserId,
      input.actorUsername,
      input.action,
      input.targetUserId ?? null,
      input.targetUsername ?? null,
      input.details ? JSON.stringify(input.details) : null,
      input.ip ?? null,
    );
}

export function listAuditLogs(limit: number, offset: number): AuditLogRow[] {
  return getDb()
    .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as AuditLogRow[];
}

export function countAuditLogs(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number };
  return Number(row.n);
}
