import { z } from 'zod';
import { getDb } from '../db/connection.ts';
import { seedDefaultCategories } from '../db/categories.ts';
import { isoDateSchema, yearMonthSchema } from '../lib/validation.ts';

/**
 * Disa/ice aktarim semasi. Surum numarasi, ileride alan degistiginde eski
 * yedeklerin nasil okunacagina karar verebilmek icin dosyaya yazilir.
 *
 * Surum 2: hesap/banka/ekstre kalkti, kategoriye "nature" eklendi, genel
 * limit icin butcenin categoryId'si bos olabilir.
 *
 * Surum 1 yedekleri de okunur: banka, hesap ve ekstre alanlari yok sayilir
 * (zod bilinmeyen anahtarlari atar), islemler hesapsiz olarak aktarilir.
 */
export const EXPORT_SCHEMA_VERSION = 2;

const categorySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(60),
  kind: z.enum(['income', 'expense']),
  nature: z.enum(['fixed', 'variable']).default('variable'),
  isDefault: z.boolean(),
  archived: z.boolean(),
});

const transactionSchema = z.object({
  categoryId: z.number().int().nullable(),
  // Surum 1'de transfer bacaklari olabilir; para yonune gore gelir/gider olur.
  type: z
    .enum(['income', 'expense', 'transfer_in', 'transfer_out'])
    .transform((t) => (t === 'transfer_in' ? 'income' : t === 'transfer_out' ? 'expense' : t)),
  amountKurus: z.number().int().positive(),
  date: isoDateSchema,
  description: z.string().max(500).nullable(),
  // Surum 1'deki 'ocr' kaynagi artik yok; elle girilmis sayilir.
  source: z
    .enum(['manual', 'ocr', 'scheduled'])
    .default('manual')
    .transform((s) => (s === 'ocr' ? 'manual' : s)),
});

const budgetSchema = z.object({
  categoryId: z.number().int().nullable(),
  yearMonth: yearMonthSchema,
  limitKurus: z.number().int().positive(),
});

/** Ice aktarilan dosya boyutunu ve kayit sayisini sinirlariz (DoS onlemi). */
const MAX_ROWS = 100_000;

export const importPayloadSchema = z.object({
  schemaVersion: z.number().int().min(1).max(EXPORT_SCHEMA_VERSION),
  categories: z.array(categorySchema).max(MAX_ROWS).default([]),
  transactions: z.array(transactionSchema).max(MAX_ROWS).default([]),
  budgets: z.array(budgetSchema).max(MAX_ROWS).default([]),
});

export type ImportPayload = z.infer<typeof importPayloadSchema>;
export type ImportMode = 'merge' | 'replace';

export type ImportResult = {
  mode: ImportMode;
  categories: number;
  transactions: number;
  budgets: number;
};

export function exportUserData(userId: number, username: string) {
  const db = getDb();
  const all = <T>(sql: string) => db.prepare(sql).all(userId) as T[];

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    username,
    categories: all<Record<string, unknown>>(
      'SELECT id, name, kind, nature, is_default, archived FROM categories WHERE user_id = ? ORDER BY id',
    ).map((r) => ({
      id: r['id'],
      name: r['name'],
      kind: r['kind'],
      nature: r['nature'],
      isDefault: r['is_default'] === 1,
      archived: r['archived'] === 1,
    })),
    transactions: all<Record<string, unknown>>(
      `SELECT category_id, type, amount_kurus, date, description, source
       FROM transactions WHERE user_id = ? ORDER BY id`,
    ).map((r) => ({
      categoryId: r['category_id'],
      type: r['type'],
      amountKurus: r['amount_kurus'],
      date: r['date'],
      description: r['description'],
      source: r['source'],
    })),
    budgets: all<Record<string, unknown>>(
      'SELECT category_id, year_month, limit_kurus FROM budgets WHERE user_id = ? ORDER BY id',
    ).map((r) => ({
      categoryId: r['category_id'],
      yearMonth: r['year_month'],
      limitKurus: r['limit_kurus'],
    })),
  };
}

/** Kullaniciya ait TUM finansal veriyi siler (kullanici hesabi kalir). */
export function deleteAllUserData(userId: number): void {
  const db = getDb();
  // Sira onemli: yabanci anahtar zinciri asagidan yukari bosaltilir.
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM scheduled_occurrences WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM scheduled_items WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM recurrence_rejections WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM budgets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM categories WHERE user_id = ?').run(userId);
}

export function resetUserData(userId: number): void {
  const db = getDb();
  db.exec('BEGIN');
  try {
    deleteAllUserData(userId);
    seedDefaultCategories(userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Ice aktarim. Dosyadaki id'ler yeni id'lere ESLENIR; dosyanin id'leri
 * veritabanina oldugu gibi yazilmaz (baska bir kullanicinin id'siyle
 * catismasin ve merge modunda mevcut kayitlari ezmesin diye).
 *
 * merge   : mevcut veri korunur, dosyadaki kayitlar eklenir. Ayni isimli
 *           kategori varsa mevcut olan yeniden kullanilir.
 * replace : kullanicinin tum finansal verisi silinir, dosya aynen kurulur.
 */
export function importUserData(
  userId: number,
  payload: ImportPayload,
  mode: ImportMode,
): ImportResult {
  const db = getDb();

  const result: ImportResult = {
    mode,
    categories: 0,
    transactions: 0,
    budgets: 0,
  };

  db.exec('BEGIN');
  try {
    if (mode === 'replace') deleteAllUserData(userId);

    // --- Kategoriler ---
    const categoryIdMap = new Map<number, number>();
    for (const category of payload.categories) {
      const existing = db
        .prepare(
          'SELECT id FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE AND kind = ?',
        )
        .get(userId, category.name, category.kind) as { id: number } | undefined;

      if (existing) {
        categoryIdMap.set(category.id, existing.id);
        continue;
      }

      const inserted = db
        .prepare(
          `INSERT INTO categories (user_id, name, kind, nature, is_default, archived)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          category.name,
          category.kind,
          category.nature,
          category.isDefault ? 1 : 0,
          category.archived ? 1 : 0,
        );
      categoryIdMap.set(category.id, Number(inserted.lastInsertRowid));
      result.categories++;
    }

    // --- Islemler ---
    const insertTransaction = db.prepare(
      `INSERT INTO transactions
         (user_id, category_id, type, amount_kurus, date, description, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const tx of payload.transactions) {
      const categoryId = tx.categoryId === null ? null : (categoryIdMap.get(tx.categoryId) ?? null);

      insertTransaction.run(
        userId,
        categoryId,
        tx.type,
        tx.amountKurus,
        tx.date,
        tx.description,
        tx.source,
      );
      result.transactions++;
    }

    // --- Butceler ---
    for (const budget of payload.budgets) {
      // Genel limitin kategorisi yoktur; kategorili limitin kategorisi
      // cozulemezse atlanir.
      let categoryId: number | null = null;
      if (budget.categoryId !== null) {
        const mapped = categoryIdMap.get(budget.categoryId);
        if (mapped === undefined) continue;
        categoryId = mapped;
      }

      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO budgets (user_id, category_id, year_month, limit_kurus)
           VALUES (?, ?, ?, ?)`,
        )
        .run(userId, categoryId, budget.yearMonth, budget.limitKurus);
      result.budgets += Number(inserted.changes);
    }

    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
