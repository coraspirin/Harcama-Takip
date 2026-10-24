import { getDb } from './connection.ts';

export const DEBT_KINDS = ['loan', 'credit_card', 'personal'] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];
export type DebtDirection = 'owe' | 'lent';

export type DebtRow = {
  id: number;
  user_id: number;
  kind: DebtKind;
  direction: DebtDirection;
  name: string;
  counterparty: string | null;
  original_kurus: number;
  balance_kurus: number;
  balance_date: string;
  monthly_interest_bp: number;
  taxes_included: number;
  monthly_payment_kurus: number | null;
  note: string | null;
  closed: number;
  created_at: string;
  updated_at: string;
};

export type DebtWithBalance = DebtRow & {
  /** Bildirilen bakiyeden SONRA yapilan odemelerin toplami */
  paid_since_kurus: number;
  /** Tum odemelerin toplami */
  paid_total_kurus: number;
  payment_count: number;
  last_payment_date: string | null;
};

export type DebtPaymentRow = {
  id: number;
  user_id: number;
  debt_id: number;
  date: string;
  amount_kurus: number;
  note: string | null;
  created_at: string;
};

/**
 * Guncel bakiye = bildirilen bakiye - bildirim tarihinden SONRAKI odemeler.
 * Bildirim tarihindeki ve oncesindeki odemelerin bildirilen bakiyeye zaten
 * yansidigi varsayilir.
 */
const SELECT_DEBT = `
  SELECT d.*,
         COALESCE((SELECT SUM(p.amount_kurus) FROM debt_payments p
                   WHERE p.debt_id = d.id AND p.user_id = d.user_id
                     AND p.date > d.balance_date), 0) AS paid_since_kurus,
         COALESCE((SELECT SUM(p.amount_kurus) FROM debt_payments p
                   WHERE p.debt_id = d.id AND p.user_id = d.user_id), 0) AS paid_total_kurus,
         (SELECT COUNT(*) FROM debt_payments p
          WHERE p.debt_id = d.id AND p.user_id = d.user_id) AS payment_count,
         (SELECT MAX(p.date) FROM debt_payments p
          WHERE p.debt_id = d.id AND p.user_id = d.user_id) AS last_payment_date
  FROM debts d
`;

export function currentBalanceKurus(row: DebtWithBalance): number {
  return Math.max(0, row.balance_kurus - Number(row.paid_since_kurus));
}

export function listDebts(userId: number, includeClosed = false): DebtWithBalance[] {
  return getDb()
    .prepare(
      `${SELECT_DEBT}
       WHERE d.user_id = ? AND (? = 1 OR d.closed = 0)
       ORDER BY d.closed, d.direction, d.name COLLATE NOCASE`,
    )
    .all(userId, includeClosed ? 1 : 0) as DebtWithBalance[];
}

export function findDebt(userId: number, id: number): DebtWithBalance | null {
  const row = getDb()
    .prepare(`${SELECT_DEBT} WHERE d.user_id = ? AND d.id = ?`)
    .get(userId, id) as DebtWithBalance | undefined;
  return row ?? null;
}

export type DebtInput = {
  kind: DebtKind;
  direction: DebtDirection;
  name: string;
  counterparty: string | null;
  originalKurus: number;
  monthlyInterestBp: number;
  taxesIncluded: boolean;
  monthlyPaymentKurus: number | null;
  note: string | null;
};

export function insertDebt(
  userId: number,
  input: DebtInput & { balanceKurus: number; balanceDate: string },
): number {
  const result = getDb()
    .prepare(
      `INSERT INTO debts
         (user_id, kind, direction, name, counterparty, original_kurus, balance_kurus,
          balance_date, monthly_interest_bp, taxes_included, monthly_payment_kurus, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.kind,
      input.direction,
      input.name,
      input.counterparty,
      input.originalKurus,
      input.balanceKurus,
      input.balanceDate,
      input.monthlyInterestBp,
      input.taxesIncluded ? 1 : 0,
      input.monthlyPaymentKurus,
      input.note,
    );
  return Number(result.lastInsertRowid);
}

export function updateDebt(
  userId: number,
  id: number,
  input: DebtInput & { closed: boolean },
): void {
  getDb()
    .prepare(
      `UPDATE debts
       SET kind = ?, direction = ?, name = ?, counterparty = ?, original_kurus = ?,
           monthly_interest_bp = ?, taxes_included = ?, monthly_payment_kurus = ?, note = ?,
           closed = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      input.kind,
      input.direction,
      input.name,
      input.counterparty,
      input.originalKurus,
      input.monthlyInterestBp,
      input.taxesIncluded ? 1 : 0,
      input.monthlyPaymentKurus,
      input.note,
      input.closed ? 1 : 0,
      userId,
      id,
    );
}

/** Bankadan/ekstreden okunan guncel bakiyeyi bildirir. */
export function setDebtBalance(
  userId: number,
  id: number,
  balanceKurus: number,
  balanceDate: string,
): void {
  getDb()
    .prepare(
      `UPDATE debts SET balance_kurus = ?, balance_date = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .run(balanceKurus, balanceDate, userId, id);
}

export function deleteDebt(userId: number, id: number): boolean {
  const result = getDb().prepare('DELETE FROM debts WHERE user_id = ? AND id = ?').run(userId, id);
  return Number(result.changes) > 0;
}

export function listDebtPayments(userId: number, debtId: number): DebtPaymentRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM debt_payments WHERE user_id = ? AND debt_id = ?
       ORDER BY date DESC, id DESC`,
    )
    .all(userId, debtId) as DebtPaymentRow[];
}

export function insertDebtPayment(
  userId: number,
  debtId: number,
  date: string,
  amountKurus: number,
  note: string | null,
): number {
  const result = getDb()
    .prepare(
      'INSERT INTO debt_payments (user_id, debt_id, date, amount_kurus, note) VALUES (?, ?, ?, ?, ?)',
    )
    .run(userId, debtId, date, amountKurus, note);
  return Number(result.lastInsertRowid);
}

export function deleteDebtPayment(userId: number, debtId: number, paymentId: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM debt_payments WHERE user_id = ? AND debt_id = ? AND id = ?')
    .run(userId, debtId, paymentId);
  return Number(result.changes) > 0;
}

export type InstallmentDebtRow = {
  item_id: number;
  name: string;
  remaining_kurus: number;
  remaining_count: number;
  total_count: number;
  next_due_date: string | null;
  last_due_date: string | null;
  monthly_kurus: number | null;
};

/**
 * Bekleyen taksitler, borc listesinde gosterilmek uzere. Taksitler sabit
 * planlidir: bitis ayi son vadedir, ayrica faiz simulasyonu yapilmaz.
 */
export function listInstallmentDebts(userId: number): InstallmentDebtRow[] {
  return getDb()
    .prepare(
      `SELECT i.id AS item_id,
              i.name,
              COALESCE(SUM(o.amount_kurus), 0) AS remaining_kurus,
              COUNT(o.id)                     AS remaining_count,
              i.installment_count             AS total_count,
              MIN(o.due_date)                 AS next_due_date,
              MAX(o.due_date)                 AS last_due_date,
              (SELECT o2.amount_kurus FROM scheduled_occurrences o2
               WHERE o2.scheduled_item_id = i.id AND o2.status = 'pending'
               ORDER BY o2.due_date LIMIT 1)   AS monthly_kurus
       FROM scheduled_items i
       JOIN scheduled_occurrences o
         ON o.scheduled_item_id = i.id AND o.user_id = i.user_id AND o.status = 'pending'
       WHERE i.user_id = ? AND i.kind = 'installment' AND i.active = 1
       GROUP BY i.id
       ORDER BY last_due_date`,
    )
    .all(userId) as InstallmentDebtRow[];
}
