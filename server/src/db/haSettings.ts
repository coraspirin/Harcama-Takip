import { getDb } from './connection.ts';

export type HaSettingsRow = {
  user_id: number;
  base_url: string;
  token_encrypted: string;
  notify_target: string | null;
  enabled: number;
  last_error: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
};

export function findHaSettings(userId: number): HaSettingsRow | null {
  const row = getDb().prepare('SELECT * FROM ha_settings WHERE user_id = ?').get(userId) as
    | HaSettingsRow
    | undefined;
  return row ?? null;
}

export type SaveHaSettingsInput = {
  baseUrl: string;
  tokenEncrypted: string;
  notifyTarget: string | null;
  enabled: boolean;
};

export function saveHaSettings(userId: number, input: SaveHaSettingsInput): void {
  getDb()
    .prepare(
      `INSERT INTO ha_settings (user_id, base_url, token_encrypted, notify_target, enabled)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         base_url = excluded.base_url,
         token_encrypted = excluded.token_encrypted,
         notify_target = excluded.notify_target,
         enabled = excluded.enabled,
         updated_at = datetime('now')`,
    )
    .run(userId, input.baseUrl, input.tokenEncrypted, input.notifyTarget, input.enabled ? 1 : 0);
}

export function deleteHaSettings(userId: number): boolean {
  const result = getDb().prepare('DELETE FROM ha_settings WHERE user_id = ?').run(userId);
  return Number(result.changes) > 0;
}

export function recordHaResult(userId: number, error: string | null): void {
  getDb()
    .prepare(
      `UPDATE ha_settings
       SET last_error = ?,
           last_success_at = CASE WHEN ? IS NULL THEN datetime('now') ELSE last_success_at END,
           updated_at = datetime('now')
       WHERE user_id = ?`,
    )
    .run(error, error, userId);
}

/** Bildirim gonderimi acik olan tum kullanicilar (zamanlanmis gorev icin). */
export function listEnabledHaSettings(): HaSettingsRow[] {
  return getDb()
    .prepare('SELECT * FROM ha_settings WHERE enabled = 1 AND notify_target IS NOT NULL')
    .all() as HaSettingsRow[];
}
