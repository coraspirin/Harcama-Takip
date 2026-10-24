import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrate.ts';

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

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

describe('migration zinciri', () => {
  test('bos veritabaninda hesapsiz sema olusur', () => {
    const db = freshDb();
    runMigrations(db);

    assert.deepEqual(appliedIds(db), [1, 2, 3]);
    const tables = tableNames(db);
    for (const table of ['users', 'ha_settings', 'categories', 'transactions', 'budgets']) {
      assert.ok(tables.includes(table), `${table} olmali`);
    }
    for (const gone of ['accounts', 'banks', 'card_statements', 'ocr_imports']) {
      assert.ok(!tables.includes(gone), `${gone} olmamali`);
    }
    assert.ok(!columnNames(db, 'transactions').includes('account_id'));
    assert.ok(columnNames(db, 'categories').includes('nature'));
    db.close();
  });

  test('ikinci calistirma hicbir sey yapmaz', () => {
    const db = freshDb();
    runMigrations(db);
    assert.doesNotThrow(() => runMigrations(db));
    assert.deepEqual(appliedIds(db), [1, 2, 3]);
    db.close();
  });

  test('eski tasarimdan kalan veritabani acikca reddedilir', () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO schema_migrations (id, name) VALUES (1, 'auth'), (2, 'finance_core');
    `);

    assert.throws(() => runMigrations(db), /2 - finance_core.*silip/s);
    db.close();
  });
});
