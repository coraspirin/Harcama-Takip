import type { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations/index.ts';

export type Migration = {
  /** Sirali ve benzersiz. Uygulandiktan sonra ASLA degistirilmez. */
  id: number;
  name: string;
  sql: string;
};

/**
 * Uygulanmamis migration'lari sirayla ve tek bir transaction icinde calistirir.
 * Migration dosyalari .ts modulu olarak tutulur; boylece tsc ciktisina dogal
 * olarak dahil olurlar ve ayri bir "sql dosyalarini kopyala" adimi gerekmez.
 */
export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => Number((row as { id: number }).id)),
  );

  const pending = migrations
    .filter((m) => !applied.has(m.id))
    .sort((a, b) => a.id - b.id);

  if (pending.length === 0) return;

  for (const migration of pending) {
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(
        migration.id,
        migration.name,
      );
      db.exec('COMMIT');
      console.log(`[db] migration uygulandi: ${migration.id} - ${migration.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration basarisiz: ${migration.id} - ${migration.name}\n${(err as Error).message}`,
      );
    }
  }
}
