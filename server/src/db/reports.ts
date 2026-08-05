import { getDb } from './connection.ts';

/**
 * Rapor sorgularinin ORTAK kurali: transferler HER ZAMAN dislanir
 * (type IN ('income','expense')). Transfer ayni parayi iki kez saydirir ve
 * gelir/gider toplamlarini sisirir.
 */
const REPORTABLE = "t.type IN ('income', 'expense')";

export type CategoryBreakdownRow = {
  category_id: number | null;
  category_name: string | null;
  total_kurus: number;
  transaction_count: number;
};

export function categoryBreakdown(
  userId: number,
  from: string,
  to: string,
  kind: 'income' | 'expense',
): CategoryBreakdownRow[] {
  return getDb()
    .prepare(
      `SELECT t.category_id,
              c.name AS category_name,
              SUM(t.amount_kurus) AS total_kurus,
              COUNT(*)            AS transaction_count
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
       WHERE t.user_id = ? AND ${REPORTABLE} AND t.type = ?
         AND t.date >= ? AND t.date <= ?
       GROUP BY t.category_id
       ORDER BY total_kurus DESC`,
    )
    .all(userId, kind, from, to) as CategoryBreakdownRow[];
}

export type MonthlyTotalsRow = {
  year_month: string;
  income_kurus: number;
  expense_kurus: number;
};

/** Verilen ay araligindaki aylik gelir/gider toplamlari (bos aylar donmez). */
export function monthlyTotals(
  userId: number,
  fromMonth: string,
  toMonth: string,
): MonthlyTotalsRow[] {
  return getDb()
    .prepare(
      `SELECT substr(t.date, 1, 7) AS year_month,
              COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount_kurus ELSE 0 END), 0) AS income_kurus,
              COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount_kurus ELSE 0 END), 0) AS expense_kurus
       FROM transactions t
       WHERE t.user_id = ? AND ${REPORTABLE}
         AND substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ?
       GROUP BY year_month
       ORDER BY year_month`,
    )
    .all(userId, fromMonth, toMonth) as MonthlyTotalsRow[];
}

export type AccountBreakdownRow = {
  account_id: number;
  account_name: string;
  income_kurus: number;
  expense_kurus: number;
};

export function accountBreakdown(
  userId: number,
  from: string,
  to: string,
): AccountBreakdownRow[] {
  return getDb()
    .prepare(
      `SELECT t.account_id,
              a.name AS account_name,
              COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount_kurus ELSE 0 END), 0) AS income_kurus,
              COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount_kurus ELSE 0 END), 0) AS expense_kurus
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
       WHERE t.user_id = ? AND ${REPORTABLE} AND t.date >= ? AND t.date <= ?
       GROUP BY t.account_id
       ORDER BY expense_kurus DESC`,
    )
    .all(userId, from, to) as AccountBreakdownRow[];
}

/** Bir donemde en cok harcanan kategoriler (limitli). */
export function topCategories(
  userId: number,
  from: string,
  to: string,
  limit: number,
): CategoryBreakdownRow[] {
  return categoryBreakdown(userId, from, to, 'expense').slice(0, limit);
}
