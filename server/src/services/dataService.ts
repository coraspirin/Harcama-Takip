import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/connection.ts';
import { seedDefaultCategories } from '../db/categories.ts';
import { isoDateSchema, yearMonthSchema } from '../lib/validation.ts';

/**
 * Disa/ice aktarim semasi. Surum numarasi, ileride alan degistiginde eski
 * yedeklerin nasil okunacagina karar verebilmek icin dosyaya yazilir.
 */
export const EXPORT_SCHEMA_VERSION = 1;

const bankSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(80),
  monthlyInterestBp: z.number().int().min(0).max(10_000),
  taxesIncluded: z.boolean(),
});

const accountSchema = z.object({
  id: z.number().int(),
  bankId: z.number().int().nullable(),
  name: z.string().min(1).max(80),
  type: z.enum(['cash', 'bank', 'credit_card']),
  openingBalanceKurus: z.number().int(),
  archived: z.boolean(),
  statementDay: z.number().int().min(1).max(31).nullable().default(null),
  dueDay: z.number().int().min(1).max(31).nullable().default(null),
  creditLimitKurus: z.number().int().nullable().default(null),
});

const categorySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(60),
  kind: z.enum(['income', 'expense']),
  isDefault: z.boolean(),
  archived: z.boolean(),
});

const transactionSchema = z.object({
  accountId: z.number().int(),
  categoryId: z.number().int().nullable(),
  type: z.enum(['income', 'expense', 'transfer_in', 'transfer_out']),
  amountKurus: z.number().int().positive(),
  date: isoDateSchema,
  description: z.string().max(500).nullable(),
  transferGroupId: z.string().max(64).nullable(),
  source: z.enum(['manual', 'ocr', 'scheduled']).default('manual'),
});

const statementSchema = z.object({
  accountId: z.number().int(),
  periodEnd: isoDateSchema,
  dueDate: isoDateSchema.nullable(),
  statementAmountKurus: z.number().int(),
  paidAmountKurus: z.number().int().min(0),
  minimumPaymentKurus: z.number().int().nullable(),
});

const budgetSchema = z.object({
  categoryId: z.number().int(),
  yearMonth: yearMonthSchema,
  limitKurus: z.number().int().positive(),
});

/** Ice aktarilan dosya boyutunu ve kayit sayisini sinirlariz (DoS onlemi). */
const MAX_ROWS = 100_000;

export const importPayloadSchema = z.object({
  schemaVersion: z.number().int().min(1).max(EXPORT_SCHEMA_VERSION),
  banks: z.array(bankSchema).max(MAX_ROWS).default([]),
  accounts: z.array(accountSchema).max(MAX_ROWS).default([]),
  categories: z.array(categorySchema).max(MAX_ROWS).default([]),
  transactions: z.array(transactionSchema).max(MAX_ROWS).default([]),
  cardStatements: z.array(statementSchema).max(MAX_ROWS).default([]),
  budgets: z.array(budgetSchema).max(MAX_ROWS).default([]),
});

export type ImportPayload = z.infer<typeof importPayloadSchema>;
export type ImportMode = 'merge' | 'replace';

export type ImportResult = {
  mode: ImportMode;
  banks: number;
  accounts: number;
  categories: number;
  transactions: number;
  cardStatements: number;
  budgets: number;
  skippedTransactions: number;
};

export function exportUserData(userId: number, username: string) {
  const db = getDb();
  const all = <T>(sql: string) => db.prepare(sql).all(userId) as T[];

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    username,
    banks: all<Record<string, unknown>>(
      'SELECT id, name, monthly_interest_bp, taxes_included FROM banks WHERE user_id = ? ORDER BY id',
    ).map((r) => ({
      id: r['id'],
      name: r['name'],
      monthlyInterestBp: r['monthly_interest_bp'],
      taxesIncluded: r['taxes_included'] === 1,
    })),
    accounts: all<Record<string, unknown>>(
      `SELECT id, bank_id, name, type, opening_balance_kurus, archived,
              statement_day, due_day, credit_limit_kurus
       FROM accounts WHERE user_id = ? ORDER BY id`,
    ).map((r) => ({
      id: r['id'],
      bankId: r['bank_id'],
      name: r['name'],
      type: r['type'],
      openingBalanceKurus: r['opening_balance_kurus'],
      archived: r['archived'] === 1,
      statementDay: r['statement_day'],
      dueDay: r['due_day'],
      creditLimitKurus: r['credit_limit_kurus'],
    })),
    categories: all<Record<string, unknown>>(
      'SELECT id, name, kind, is_default, archived FROM categories WHERE user_id = ? ORDER BY id',
    ).map((r) => ({
      id: r['id'],
      name: r['name'],
      kind: r['kind'],
      isDefault: r['is_default'] === 1,
      archived: r['archived'] === 1,
    })),
    transactions: all<Record<string, unknown>>(
      `SELECT account_id, category_id, type, amount_kurus, date, description,
              transfer_group_id, source
       FROM transactions WHERE user_id = ? ORDER BY id`,
    ).map((r) => ({
      accountId: r['account_id'],
      categoryId: r['category_id'],
      type: r['type'],
      amountKurus: r['amount_kurus'],
      date: r['date'],
      description: r['description'],
      transferGroupId: r['transfer_group_id'],
      source: r['source'],
    })),
    cardStatements: all<Record<string, unknown>>(
      `SELECT account_id, period_end, due_date, statement_amount_kurus,
              paid_amount_kurus, minimum_payment_kurus
       FROM card_statements WHERE user_id = ? ORDER BY id`,
    ).map((r) => ({
      accountId: r['account_id'],
      periodEnd: r['period_end'],
      dueDate: r['due_date'],
      statementAmountKurus: r['statement_amount_kurus'],
      paidAmountKurus: r['paid_amount_kurus'],
      minimumPaymentKurus: r['minimum_payment_kurus'],
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
  db.prepare('DELETE FROM budgets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM card_statements WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM accounts WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM categories WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM banks WHERE user_id = ?').run(userId);
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
 *           banka/kategori varsa mevcut olan yeniden kullanilir.
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
    banks: 0,
    accounts: 0,
    categories: 0,
    transactions: 0,
    cardStatements: 0,
    budgets: 0,
    skippedTransactions: 0,
  };

  db.exec('BEGIN');
  try {
    if (mode === 'replace') deleteAllUserData(userId);

    // --- Bankalar ---
    const bankIdMap = new Map<number, number>();
    for (const bank of payload.banks) {
      const existing = db
        .prepare('SELECT id FROM banks WHERE user_id = ? AND name = ? COLLATE NOCASE')
        .get(userId, bank.name) as { id: number } | undefined;

      if (existing) {
        bankIdMap.set(bank.id, existing.id);
        continue;
      }

      const inserted = db
        .prepare(
          'INSERT INTO banks (user_id, name, monthly_interest_bp, taxes_included) VALUES (?, ?, ?, ?)',
        )
        .run(userId, bank.name, bank.monthlyInterestBp, bank.taxesIncluded ? 1 : 0);
      bankIdMap.set(bank.id, Number(inserted.lastInsertRowid));
      result.banks++;
    }

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
          'INSERT INTO categories (user_id, name, kind, is_default, archived) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          userId,
          category.name,
          category.kind,
          category.isDefault ? 1 : 0,
          category.archived ? 1 : 0,
        );
      categoryIdMap.set(category.id, Number(inserted.lastInsertRowid));
      result.categories++;
    }

    // --- Hesaplar ---
    const accountIdMap = new Map<number, number>();
    for (const account of payload.accounts) {
      const existing = db
        .prepare('SELECT id FROM accounts WHERE user_id = ? AND name = ? COLLATE NOCASE')
        .get(userId, account.name) as { id: number } | undefined;

      if (existing) {
        accountIdMap.set(account.id, existing.id);
        continue;
      }

      const mappedBankId =
        account.bankId === null ? null : (bankIdMap.get(account.bankId) ?? null);

      const inserted = db
        .prepare(
          `INSERT INTO accounts
             (user_id, bank_id, name, type, opening_balance_kurus, archived,
              statement_day, due_day, credit_limit_kurus)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          // Nakit hesap bankaya baglanamaz (DB CHECK); dosya bozuksa duzeltiriz
          account.type === 'cash' ? null : mappedBankId,
          account.name,
          account.type,
          account.openingBalanceKurus,
          account.archived ? 1 : 0,
          account.statementDay,
          account.dueDay,
          account.creditLimitKurus,
        );
      accountIdMap.set(account.id, Number(inserted.lastInsertRowid));
      result.accounts++;
    }

    // --- Islemler ---
    // Transfer gruplarina yeni benzersiz kimlik verilir ki merge modunda
    // mevcut bir transferle ayni id'yi paylasmasinlar.
    const transferGroupMap = new Map<string, string>();
    const insertTransaction = db.prepare(
      `INSERT INTO transactions
         (user_id, account_id, category_id, type, amount_kurus, date, description,
          transfer_group_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const tx of payload.transactions) {
      const accountId = accountIdMap.get(tx.accountId);
      if (accountId === undefined) {
        // Hesabi cozulemeyen islem sessizce atlanir; sayisi raporlanir.
        result.skippedTransactions++;
        continue;
      }

      const categoryId = tx.categoryId === null ? null : (categoryIdMap.get(tx.categoryId) ?? null);

      let groupId: string | null = null;
      if (tx.transferGroupId !== null) {
        let mapped = transferGroupMap.get(tx.transferGroupId);
        if (mapped === undefined) {
          mapped = crypto.randomUUID();
          transferGroupMap.set(tx.transferGroupId, mapped);
        }
        groupId = mapped;
      }

      insertTransaction.run(
        userId,
        accountId,
        categoryId,
        tx.type,
        tx.amountKurus,
        tx.date,
        tx.description,
        groupId,
        tx.source,
      );
      result.transactions++;
    }

    // --- Ekstreler ---
    for (const statement of payload.cardStatements) {
      const accountId = accountIdMap.get(statement.accountId);
      if (accountId === undefined) continue;

      db.prepare(
        `INSERT OR IGNORE INTO card_statements
           (user_id, account_id, period_end, due_date, statement_amount_kurus,
            paid_amount_kurus, minimum_payment_kurus)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        accountId,
        statement.periodEnd,
        statement.dueDate,
        statement.statementAmountKurus,
        statement.paidAmountKurus,
        statement.minimumPaymentKurus,
      );
      result.cardStatements++;
    }

    // --- Butceler ---
    for (const budget of payload.budgets) {
      const categoryId = categoryIdMap.get(budget.categoryId);
      if (categoryId === undefined) continue;

      db.prepare(
        `INSERT OR IGNORE INTO budgets (user_id, category_id, year_month, limit_kurus)
         VALUES (?, ?, ?, ?)`,
      ).run(userId, categoryId, budget.yearMonth, budget.limitKurus);
      result.budgets++;
    }

    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
