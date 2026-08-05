import { getDb } from './connection.ts';

export type NotificationRow = {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body: string | null;
  related_type: string | null;
  related_id: number | null;
  due_date: string | null;
  dedupe_key: string;
  read_at: string | null;
  sent_ha_at: string | null;
  created_at: string;
};

export type CreateNotificationInput = {
  type: string;
  title: string;
  body?: string | null;
  relatedType?: string | null;
  relatedId?: number | null;
  dueDate?: string | null;
  /**
   * Ayni uyarinin ikinci kez olusmasini engelleyen anahtar. Zamanlanmis gorev
   * gunde birden fazla calissa da (yeniden baslatma, elle tetikleme) kullanici
   * ayni bildirimi bir kez gorur.
   */
  dedupeKey: string;
};

/** Zaten varsa hicbir sey yapmaz; olusturulduysa true doner. */
export function createNotification(userId: number, input: CreateNotificationInput): boolean {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO notifications
         (user_id, type, title, body, related_type, related_id, due_date, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.type,
      input.title,
      input.body ?? null,
      input.relatedType ?? null,
      input.relatedId ?? null,
      input.dueDate ?? null,
      input.dedupeKey,
    );
  return Number(result.changes) > 0;
}

export function listNotifications(userId: number, limit = 50): NotificationRow[] {
  return getDb()
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(userId, limit) as NotificationRow[];
}

export function countUnread(userId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId) as { n: number };
  return Number(row.n);
}

export function markRead(userId: number, id: number): boolean {
  const result = getDb()
    .prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND id = ? AND read_at IS NULL`)
    .run(userId, id);
  return Number(result.changes) > 0;
}

export function markAllRead(userId: number): number {
  const result = getDb()
    .prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`)
    .run(userId);
  return Number(result.changes);
}

export function deleteNotification(userId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM notifications WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return Number(result.changes) > 0;
}

/** Home Assistant'a iletilmemis uyarilar (Faz 10'da kullanilacak). */
export function listUnsentToHa(userId: number): NotificationRow[] {
  return getDb()
    .prepare('SELECT * FROM notifications WHERE user_id = ? AND sent_ha_at IS NULL ORDER BY id')
    .all(userId) as NotificationRow[];
}

export function markSentToHa(id: number): void {
  getDb().prepare(`UPDATE notifications SET sent_ha_at = datetime('now') WHERE id = ?`).run(id);
}
