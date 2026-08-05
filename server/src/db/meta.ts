import { getDb } from './connection.ts';

const SETUP_KEY = 'setup_completed';

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value);
}

/**
 * Kurulum bir kez tamamlanir ve geri alinamaz. Bu bayrak sayesinde /api/setup
 * ikinci bir super admin olusturmak icin kullanilamaz.
 */
export function isSetupCompleted(): boolean {
  return getMeta(SETUP_KEY) === '1';
}

export function markSetupCompleted(): void {
  setMeta(SETUP_KEY, '1');
}
