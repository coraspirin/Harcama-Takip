import { getDb } from './connection.ts';

export type CardStatementRow = {
  id: number;
  user_id: number;
  account_id: number;
  period_end: string;
  due_date: string | null;
  statement_amount_kurus: number;
  paid_amount_kurus: number;
  minimum_payment_kurus: number | null;
  created_at: string;
  updated_at: string;
};

export function listStatements(userId: number, accountId: number): CardStatementRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM card_statements
       WHERE user_id = ? AND account_id = ?
       ORDER BY period_end DESC`,
    )
    .all(userId, accountId) as CardStatementRow[];
}

export function findStatement(userId: number, id: number): CardStatementRow | null {
  const row = getDb()
    .prepare('SELECT * FROM card_statements WHERE user_id = ? AND id = ?')
    .get(userId, id) as CardStatementRow | undefined;
  return row ?? null;
}

export function findLatestStatement(userId: number, accountId: number): CardStatementRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM card_statements
       WHERE user_id = ? AND account_id = ?
       ORDER BY period_end DESC LIMIT 1`,
    )
    .get(userId, accountId) as CardStatementRow | undefined;
  return row ?? null;
}

/** Verilen donemden onceki en yakin ekstre - donem baslangicini bulmak icin. */
export function findPreviousStatement(
  userId: number,
  accountId: number,
  periodEnd: string,
): CardStatementRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM card_statements
       WHERE user_id = ? AND account_id = ? AND period_end < ?
       ORDER BY period_end DESC LIMIT 1`,
    )
    .get(userId, accountId, periodEnd) as CardStatementRow | undefined;
  return row ?? null;
}

export type StatementInput = {
  accountId: number;
  periodEnd: string;
  dueDate: string | null;
  statementAmountKurus: number;
  paidAmountKurus: number;
  minimumPaymentKurus: number | null;
};

export function createStatement(userId: number, input: StatementInput): CardStatementRow {
  const result = getDb()
    .prepare(
      `INSERT INTO card_statements
         (user_id, account_id, period_end, due_date, statement_amount_kurus,
          paid_amount_kurus, minimum_payment_kurus)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.accountId,
      input.periodEnd,
      input.dueDate,
      input.statementAmountKurus,
      input.paidAmountKurus,
      input.minimumPaymentKurus,
    );

  const created = findStatement(userId, Number(result.lastInsertRowid));
  if (!created) throw new Error('Ekstre olusturuldu ancak okunamadi');
  return created;
}

export function updateStatement(
  userId: number,
  id: number,
  input: Omit<StatementInput, 'accountId'>,
): CardStatementRow | null {
  getDb()
    .prepare(
      `UPDATE card_statements
       SET period_end = ?, due_date = ?, statement_amount_kurus = ?,
           paid_amount_kurus = ?, minimum_payment_kurus = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      input.periodEnd,
      input.dueDate,
      input.statementAmountKurus,
      input.paidAmountKurus,
      input.minimumPaymentKurus,
      userId,
      id,
    );

  return findStatement(userId, id);
}

export function deleteStatement(userId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM card_statements WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return Number(result.changes) > 0;
}

/**
 * Donem icindeki NET kart hareketi (harcama - iade/odeme), islemlerden.
 * Ekstre tutariyla karsilastirilarak mutabakat yapilir.
 */
export function periodActivityKurus(
  userId: number,
  accountId: number,
  from: string | null,
  to: string,
): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(
         CASE WHEN type IN ('expense', 'transfer_out') THEN amount_kurus
              ELSE -amount_kurus END), 0) AS total
       FROM transactions
       WHERE user_id = ? AND account_id = ?
         AND (? IS NULL OR date >= ?)
         AND date <= ?`,
    )
    .get(userId, accountId, from, from, to) as { total: number };

  return Number(row.total);
}
