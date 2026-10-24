import { getDb } from './connection.ts';

export const TRANSACTION_TYPES = ['income', 'expense'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type TransactionSource = 'manual' | 'scheduled';

export type TransactionRow = {
  id: number;
  user_id: number;
  category_id: number | null;
  type: TransactionType;
  amount_kurus: number;
  date: string;
  description: string | null;
  source: TransactionSource;
  source_ref_id: number | null;
  created_at: string;
  updated_at: string;
};

export type TransactionWithNames = TransactionRow & {
  category_name: string | null;
};

const SELECT_WITH_NAMES = `
  SELECT t.*,
         c.name AS category_name
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
`;

export type TransactionFilters = {
  from?: string;
  to?: string;
  categoryId?: number;
  kind?: TransactionType;
  minAmountKurus?: number;
  maxAmountKurus?: number;
  search?: string;
};

type SqlFragment = { where: string; params: (string | number)[] };

function buildFilters(userId: number, f: TransactionFilters): SqlFragment {
  const clauses = ['t.user_id = ?'];
  const params: (string | number)[] = [userId];

  if (f.from) {
    clauses.push('t.date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    clauses.push('t.date <= ?');
    params.push(f.to);
  }
  if (f.categoryId !== undefined) {
    clauses.push('t.category_id = ?');
    params.push(f.categoryId);
  }
  if (f.kind) {
    clauses.push('t.type = ?');
    params.push(f.kind);
  }
  if (f.minAmountKurus !== undefined) {
    clauses.push('t.amount_kurus >= ?');
    params.push(f.minAmountKurus);
  }
  if (f.maxAmountKurus !== undefined) {
    clauses.push('t.amount_kurus <= ?');
    params.push(f.maxAmountKurus);
  }
  if (f.search) {
    clauses.push('t.description LIKE ? ESCAPE ?');
    // LIKE joker karakterlerini kullanicinin arama metninden kacir
    params.push(`%${f.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, '\\');
  }

  return { where: clauses.join(' AND '), params };
}

export function listTransactions(
  userId: number,
  filters: TransactionFilters,
  limit: number,
  offset: number,
): TransactionWithNames[] {
  const { where, params } = buildFilters(userId, filters);
  return getDb()
    .prepare(
      `${SELECT_WITH_NAMES} WHERE ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as TransactionWithNames[];
}

export function countTransactions(userId: number, filters: TransactionFilters): number {
  const { where, params } = buildFilters(userId, filters);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM transactions t WHERE ${where}`)
    .get(...params) as { n: number };
  return Number(row.n);
}

/** Filtreye uyan kayitlarin gelir/gider toplami. */
export function sumTransactions(
  userId: number,
  filters: TransactionFilters,
): { incomeKurus: number; expenseKurus: number } {
  const { where, params } = buildFilters(userId, filters);
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount_kurus ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount_kurus ELSE 0 END), 0) AS expense
       FROM transactions t WHERE ${where}`,
    )
    .get(...params) as { income: number; expense: number };

  return { incomeKurus: Number(row.income), expenseKurus: Number(row.expense) };
}

export function findTransaction(userId: number, id: number): TransactionWithNames | null {
  const row = getDb()
    .prepare(`${SELECT_WITH_NAMES} WHERE t.user_id = ? AND t.id = ?`)
    .get(userId, id) as TransactionWithNames | undefined;
  return row ?? null;
}

export type CreateTransactionInput = {
  categoryId: number | null;
  type: TransactionType;
  amountKurus: number;
  date: string;
  description: string | null;
  source?: TransactionSource;
  sourceRefId?: number | null;
};

export function insertTransaction(userId: number, input: CreateTransactionInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO transactions
         (user_id, category_id, type, amount_kurus, date, description, source, source_ref_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.categoryId,
      input.type,
      input.amountKurus,
      input.date,
      input.description,
      input.source ?? 'manual',
      input.sourceRefId ?? null,
    );
  return Number(result.lastInsertRowid);
}

export type UpdateTransactionInput = {
  categoryId: number | null;
  type: TransactionType;
  amountKurus: number;
  date: string;
  description: string | null;
};

export function updateTransaction(
  userId: number,
  id: number,
  input: UpdateTransactionInput,
): TransactionWithNames | null {
  getDb()
    .prepare(
      `UPDATE transactions
       SET category_id = ?, type = ?, amount_kurus = ?, date = ?,
           description = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .run(input.categoryId, input.type, input.amountKurus, input.date, input.description, userId, id);

  return findTransaction(userId, id);
}

export function deleteTransaction(userId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM transactions WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return Number(result.changes) > 0;
}

/** Secili islemleri topluca siler. */
export function bulkDeleteTransactions(userId: number, ids: number[]): number {
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(', ');

  const result = getDb()
    .prepare(`DELETE FROM transactions WHERE user_id = ? AND id IN (${placeholders})`)
    .run(userId, ...ids);

  return Number(result.changes);
}
