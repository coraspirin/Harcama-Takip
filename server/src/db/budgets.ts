import { getDb } from './connection.ts';

export type BudgetRow = {
  id: number;
  user_id: number;
  category_id: number;
  year_month: string;
  limit_kurus: number;
  created_at: string;
  updated_at: string;
};

export type BudgetWithSpent = BudgetRow & {
  category_name: string;
  category_archived: number;
  spent_kurus: number;
};

/**
 * Butceler harcamalariyla birlikte doner. Harcama toplami transferleri HARIC
 * tutar (type = 'expense'), aksi halde hesaplar arasi para transferi butceyi
 * yakiyormus gibi gorunurdu.
 */
export function listBudgets(userId: number, yearMonth: string): BudgetWithSpent[] {
  return getDb()
    .prepare(
      `SELECT b.*,
              c.name     AS category_name,
              c.archived AS category_archived,
              COALESCE((
                SELECT SUM(t.amount_kurus)
                FROM transactions t
                WHERE t.user_id = b.user_id
                  AND t.category_id = b.category_id
                  AND t.type = 'expense'
                  AND substr(t.date, 1, 7) = b.year_month
              ), 0) AS spent_kurus
       FROM budgets b
       JOIN categories c ON c.id = b.category_id AND c.user_id = b.user_id
       WHERE b.user_id = ? AND b.year_month = ?
       ORDER BY c.name COLLATE NOCASE`,
    )
    .all(userId, yearMonth) as BudgetWithSpent[];
}

export function findBudget(userId: number, id: number): BudgetRow | null {
  const row = getDb().prepare('SELECT * FROM budgets WHERE user_id = ? AND id = ?').get(userId, id) as
    | BudgetRow
    | undefined;
  return row ?? null;
}

export function budgetExistsForCategory(
  userId: number,
  categoryId: number,
  yearMonth: string,
  exceptId?: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM budgets
       WHERE user_id = ? AND category_id = ? AND year_month = ? AND id <> ?`,
    )
    .get(userId, categoryId, yearMonth, exceptId ?? -1) as { id: number } | undefined;
  return row !== undefined;
}

export function createBudget(
  userId: number,
  categoryId: number,
  yearMonth: string,
  limitKurus: number,
): BudgetRow {
  const result = getDb()
    .prepare('INSERT INTO budgets (user_id, category_id, year_month, limit_kurus) VALUES (?, ?, ?, ?)')
    .run(userId, categoryId, yearMonth, limitKurus);

  const created = findBudget(userId, Number(result.lastInsertRowid));
  if (!created) throw new Error('Butce olusturuldu ancak okunamadi');
  return created;
}

export function updateBudget(userId: number, id: number, limitKurus: number): BudgetRow | null {
  getDb()
    .prepare(`UPDATE budgets SET limit_kurus = ?, updated_at = datetime('now') WHERE user_id = ? AND id = ?`)
    .run(limitKurus, userId, id);
  return findBudget(userId, id);
}

export function deleteBudget(userId: number, id: number): boolean {
  const result = getDb().prepare('DELETE FROM budgets WHERE user_id = ? AND id = ?').run(userId, id);
  return Number(result.changes) > 0;
}

/** Bir onceki ayin butcelerini yeni aya kopyalar; mevcut kayitlar korunur. */
export function copyBudgets(userId: number, fromMonth: string, toMonth: string): number {
  const result = getDb()
    .prepare(
      `INSERT INTO budgets (user_id, category_id, year_month, limit_kurus)
       SELECT user_id, category_id, ?, limit_kurus
       FROM budgets
       WHERE user_id = ? AND year_month = ?
         AND category_id NOT IN (
           SELECT category_id FROM budgets WHERE user_id = ? AND year_month = ?
         )`,
    )
    .run(toMonth, userId, fromMonth, userId, toMonth);
  return Number(result.changes);
}
