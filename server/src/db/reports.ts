import { getDb } from './connection.ts';

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
       WHERE t.user_id = ? AND t.type = ?
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
       WHERE t.user_id = ?
         AND substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ?
       GROUP BY year_month
       ORDER BY year_month`,
    )
    .all(userId, fromMonth, toMonth) as MonthlyTotalsRow[];
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

export type MonthlyNatureRow = {
  year_month: string;
  income_kurus: number;
  fixed_expense_kurus: number;
  variable_expense_kurus: number;
};

/**
 * Aylik gelir ve giderin sabit/degisken kirilimi. Kategorisiz gider degisken
 * sayilir: sabit bir kalemi kategorisiz birakmak, onu ortalamadan
 * dusurmekten daha az yaniltir.
 */
export function monthlyNatureTotals(
  userId: number,
  fromMonth: string,
  toMonth: string,
): MonthlyNatureRow[] {
  return getDb()
    .prepare(
      `SELECT substr(t.date, 1, 7) AS year_month,
              COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount_kurus ELSE 0 END), 0) AS income_kurus,
              COALESCE(SUM(CASE WHEN t.type = 'expense' AND c.nature = 'fixed'
                                THEN t.amount_kurus ELSE 0 END), 0) AS fixed_expense_kurus,
              COALESCE(SUM(CASE WHEN t.type = 'expense' AND (c.nature IS NULL OR c.nature = 'variable')
                                THEN t.amount_kurus ELSE 0 END), 0) AS variable_expense_kurus
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
       WHERE t.user_id = ?
         AND substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ?
       GROUP BY year_month
       ORDER BY year_month`,
    )
    .all(userId, fromMonth, toMonth) as MonthlyNatureRow[];
}

export type CategoryMonthRow = {
  year_month: string;
  category_id: number;
  category_name: string;
  total_kurus: number;
};

/** Kategori x ay gider toplamlari (kategorisiz giderler haric). */
export function categoryMonthlyTotals(
  userId: number,
  fromMonth: string,
  toMonth: string,
): CategoryMonthRow[] {
  return getDb()
    .prepare(
      `SELECT substr(t.date, 1, 7) AS year_month,
              t.category_id,
              c.name AS category_name,
              SUM(t.amount_kurus) AS total_kurus
       FROM transactions t
       JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
       WHERE t.user_id = ? AND t.type = 'expense'
         AND substr(t.date, 1, 7) >= ? AND substr(t.date, 1, 7) <= ?
       GROUP BY year_month, t.category_id`,
    )
    .all(userId, fromMonth, toMonth) as CategoryMonthRow[];
}

/** Gun bazinda gelir/gider toplamlari (takvim icin). */
export function dailyTotals(
  userId: number,
  from: string,
  to: string,
): { date: string; income_kurus: number; expense_kurus: number }[] {
  return getDb()
    .prepare(
      `SELECT t.date,
              COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount_kurus ELSE 0 END), 0) AS income_kurus,
              COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount_kurus ELSE 0 END), 0) AS expense_kurus
       FROM transactions t
       WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
       GROUP BY t.date`,
    )
    .all(userId, from, to) as { date: string; income_kurus: number; expense_kurus: number }[];
}
