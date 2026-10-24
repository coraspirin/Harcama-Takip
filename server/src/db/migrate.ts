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

  const appliedRows = db.prepare('SELECT id, name FROM schema_migrations').all() as {
    id: number;
    name: string;
  }[];

  // Koddaki listeyle uyusmayan bir kayit, veritabaninin baska bir semaya
  // (or. hesap/OCR iceren eski tasarima) ait oldugunu gosterir. Uzerine
  // migration calistirmak yarim kalmis, tutarsiz bir sema uretirdi.
  const known = new Map(migrations.map((m) => [m.id, m.name]));
  const foreign = appliedRows.filter((row) => known.get(Number(row.id)) !== row.name);
  if (foreign.length > 0) {
    const list = foreign.map((row) => `${row.id} - ${row.name}`).join(', ');
    throw new Error(
      `Veritabani bu surumun semasiyla uyusmuyor (taninmayan migration: ${list}). ` +
        'Eski tasarimdan kalmis olabilir; veritabani dosyasini (Docker kurulumunda ' +
        'harcama-data volume\'unu) silip uygulamayi yeniden baslatin.',
    );
  }

  const applied = new Set(appliedRows.map((row) => Number(row.id)));

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
