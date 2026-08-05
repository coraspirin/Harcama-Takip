import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.ts';
import { runMigrations } from './migrate.ts';

export const DB_FILENAME = 'harcama.db';

/**
 * Yeni bir SQLite baglantisi acar, pragma'lari uygular ve migration'lari
 * calistirir. `location` ":memory:" verilirse testler icin izole bir veritabani
 * doner.
 */
export function openDatabase(location: string): DatabaseSync {
  if (location !== ':memory:') {
    fs.mkdirSync(path.dirname(location), { recursive: true });
  }

  const db = new DatabaseSync(location);

  // WAL: okuma ve yazmanin birbirini kilitlememesi icin.
  if (location !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  // Foreign key kisitlari SQLite'ta varsayilan olarak KAPALIDIR; cascade
  // silme ve user_id butunlugu buna bagli oldugu icin acilmasi sart.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');

  runMigrations(db);
  return db;
}

let instance: DatabaseSync | null = null;

/** Uygulamanin paylasilan veritabani baglantisi. */
export function getDb(): DatabaseSync {
  if (!instance) {
    instance = openDatabase(path.join(env.DATA_DIR, DB_FILENAME));
  }
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}
