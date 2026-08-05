import { getDb } from './connection.ts';

export type BankRow = {
  id: number;
  user_id: number;
  name: string;
  monthly_interest_bp: number;
  taxes_included: number;
  created_at: string;
  updated_at: string;
};

/**
 * DIKKAT: Bu modulun HER sorgusu user_id ile filtrelenir. Bir kullanicinin
 * baskasinin kaydina erismesi, id'yi bilse bile mumkun degildir.
 */

export function listBanks(userId: number): BankRow[] {
  return getDb()
    .prepare('SELECT * FROM banks WHERE user_id = ? ORDER BY name COLLATE NOCASE')
    .all(userId) as BankRow[];
}

export function findBank(userId: number, id: number): BankRow | null {
  const row = getDb()
    .prepare('SELECT * FROM banks WHERE user_id = ? AND id = ?')
    .get(userId, id) as BankRow | undefined;
  return row ?? null;
}

export function bankNameExists(userId: number, name: string, exceptId?: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM banks
       WHERE user_id = ? AND name = ? COLLATE NOCASE AND id <> ?`,
    )
    .get(userId, name, exceptId ?? -1) as { id: number } | undefined;
  return row !== undefined;
}

export type CreateBankInput = {
  name: string;
  monthlyInterestBp: number;
  taxesIncluded: boolean;
};

export function createBank(userId: number, input: CreateBankInput): BankRow {
  const result = getDb()
    .prepare(
      `INSERT INTO banks (user_id, name, monthly_interest_bp, taxes_included)
       VALUES (?, ?, ?, ?)`,
    )
    .run(userId, input.name, input.monthlyInterestBp, input.taxesIncluded ? 1 : 0);

  const created = findBank(userId, Number(result.lastInsertRowid));
  if (!created) throw new Error('Banka olusturuldu ancak okunamadi');
  return created;
}

export function updateBank(userId: number, id: number, input: CreateBankInput): BankRow | null {
  getDb()
    .prepare(
      `UPDATE banks
       SET name = ?, monthly_interest_bp = ?, taxes_included = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .run(input.name, input.monthlyInterestBp, input.taxesIncluded ? 1 : 0, userId, id);

  return findBank(userId, id);
}

/** Silme onayindan once kullaniciya gosterilecek etki ozeti. */
export function bankDeletionImpact(
  userId: number,
  bankId: number,
): { accounts: number; transactions: number } {
  const db = getDb();

  const accounts = db
    .prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ? AND bank_id = ?')
    .get(userId, bankId) as { n: number };

  const transactions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions
       WHERE user_id = ?
         AND account_id IN (SELECT id FROM accounts WHERE user_id = ? AND bank_id = ?)`,
    )
    .get(userId, userId, bankId) as { n: number };

  return { accounts: Number(accounts.n), transactions: Number(transactions.n) };
}

/** Bagli hesaplar ve onlarin islemleri ON DELETE CASCADE ile birlikte silinir. */
export function deleteBank(userId: number, id: number): boolean {
  const result = getDb().prepare('DELETE FROM banks WHERE user_id = ? AND id = ?').run(userId, id);
  return Number(result.changes) > 0;
}
