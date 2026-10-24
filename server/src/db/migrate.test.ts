import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrate.ts';
import { migration001Auth } from './migrations/001_auth.ts';
import { migration007HomeAssistant } from './migrations/007_home_assistant.ts';
import { DEFAULT_CATEGORIES } from './defaultCategories.ts';

function tableNames(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

function appliedIds(db: DatabaseSync): number[] {
  return (db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as { id: number }[]).map(
    (r) => Number(r.id),
  );
}

describe('014_household migration', () => {
  test('yeni kurulumda hesapsiz sema olusur', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    runMigrations(db);

    assert.deepEqual(appliedIds(db), [1, 7, 14]);
    const tables = tableNames(db);
    for (const gone of ['accounts', 'banks', 'card_statements', 'ocr_imports']) {
      assert.ok(!tables.includes(gone), `${gone} olmamali`);
    }
    assert.ok(!columnNames(db, 'transactions').includes('account_id'));
    assert.ok(columnNames(db, 'categories').includes('nature'));
    db.close();
  });

  test('eski kurulum yukseltilir: kullanici ve HA ayari kalir, kategoriler yeniden kurulur', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');

    // Eski kurulumu taklit et: 001 ve 007 gercek SQL'iyle, silinen
    // migration'larin tablolari ise sade halleriyle.
    db.exec(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(migration001Auth.sql);
    db.exec(migration007HomeAssistant.sql);
    db.exec(`
      CREATE TABLE banks (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id INTEGER, bank_id INTEGER REFERENCES banks(id));
      CREATE TABLE categories (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, kind TEXT);
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY, user_id INTEGER,
        account_id INTEGER REFERENCES accounts(id),
        category_id INTEGER REFERENCES categories(id)
      );
      CREATE TABLE ocr_imports (id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES accounts(id));
      CREATE TABLE ocr_draft_lines (id INTEGER PRIMARY KEY, import_id INTEGER REFERENCES ocr_imports(id));
    `);
    for (let id = 1; id <= 13; id++) {
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(id, `eski_${id}`);
    }
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role) VALUES (1, 'ayse', 'x', 'user'), (2, 'patron', 'x', 'super_admin')",
    ).run();
    db.prepare("INSERT INTO ha_settings (user_id, base_url, token_encrypted) VALUES (1, 'http://ha', 'gizli')").run();
    db.prepare('INSERT INTO banks (id, user_id) VALUES (1, 1)').run();
    db.prepare('INSERT INTO accounts (id, user_id, bank_id) VALUES (1, 1, 1)').run();
    db.prepare('INSERT INTO transactions (id, user_id, account_id) VALUES (1, 1, 1)').run();

    runMigrations(db);

    // 007 kayitta kalmali; aksi halde bir sonraki acilista ha_settings yeniden
    // olusturulmaya calisilir.
    assert.deepEqual(appliedIds(db), [1, 7, 14]);
    assert.doesNotThrow(() => runMigrations(db), 'ikinci calistirma bos gecmeli');

    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 2);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ha_settings').get() as { n: number }).n, 1);
    assert.ok(!tableNames(db).includes('accounts'));
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n, 0);

    const seeded = db
      .prepare('SELECT user_id, COUNT(*) AS n FROM categories GROUP BY user_id')
      .all() as { user_id: number; n: number }[];
    // Yalnizca normal kullaniciya kategori kurulur, super admine kurulmaz.
    assert.deepEqual(
      seeded.map((r) => ({ userId: Number(r.user_id), n: Number(r.n) })),
      [{ userId: 1, n: DEFAULT_CATEGORIES.length }],
    );
    db.close();
  });
});
