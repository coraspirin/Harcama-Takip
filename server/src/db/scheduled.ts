import { getDb } from './connection.ts';

export const SCHEDULED_KINDS = ['planned', 'installment', 'bill'] as const;
export type ScheduledKind = (typeof SCHEDULED_KINDS)[number];

export const BILL_PERIODS = ['monthly', 'quarterly', 'yearly'] as const;
export type BillPeriod = (typeof BILL_PERIODS)[number];

export type OccurrenceStatus = 'pending' | 'confirmed' | 'skipped';

export type ScheduledItemRow = {
  id: number;
  user_id: number;
  kind: ScheduledKind;
  name: string;
  direction: 'income' | 'expense';
  category_id: number | null;
  counterparty: string | null;
  description: string | null;
  total_amount_kurus: number | null;
  installment_count: number | null;
  period: BillPeriod | null;
  amount_kurus: number | null;
  start_date: string;
  active: number;
  created_at: string;
  updated_at: string;
};

export type ScheduledItemWithProgress = ScheduledItemRow & {
  category_name: string | null;
  occurrence_count: number;
  confirmed_count: number;
  pending_count: number;
  next_due_date: string | null;
  remaining_kurus: number;
};

export type OccurrenceRow = {
  id: number;
  user_id: number;
  scheduled_item_id: number;
  due_date: string;
  amount_kurus: number | null;
  status: OccurrenceStatus;
  transaction_id: number | null;
  seq: number | null;
  total_seq: number | null;
  created_at: string;
  updated_at: string;
};

export type OccurrenceWithItem = OccurrenceRow & {
  item_name: string;
  kind: ScheduledKind;
  direction: 'income' | 'expense';
  category_id: number | null;
  category_name: string | null;
};

const SELECT_ITEM = `
  SELECT i.*,
         c.name AS category_name,
         COALESCE((SELECT COUNT(*) FROM scheduled_occurrences o
                   WHERE o.scheduled_item_id = i.id AND o.user_id = i.user_id), 0) AS occurrence_count,
         COALESCE((SELECT COUNT(*) FROM scheduled_occurrences o
                   WHERE o.scheduled_item_id = i.id AND o.user_id = i.user_id
                     AND o.status = 'confirmed'), 0) AS confirmed_count,
         COALESCE((SELECT COUNT(*) FROM scheduled_occurrences o
                   WHERE o.scheduled_item_id = i.id AND o.user_id = i.user_id
                     AND o.status = 'pending'), 0) AS pending_count,
         (SELECT MIN(o.due_date) FROM scheduled_occurrences o
          WHERE o.scheduled_item_id = i.id AND o.user_id = i.user_id
            AND o.status = 'pending') AS next_due_date,
         COALESCE((SELECT SUM(o.amount_kurus) FROM scheduled_occurrences o
                   WHERE o.scheduled_item_id = i.id AND o.user_id = i.user_id
                     AND o.status = 'pending'), 0) AS remaining_kurus
  FROM scheduled_items i
  LEFT JOIN categories c ON c.id = i.category_id AND c.user_id = i.user_id
`;

export function listScheduledItems(
  userId: number,
  kind?: ScheduledKind,
): ScheduledItemWithProgress[] {
  return getDb()
    .prepare(
      `${SELECT_ITEM}
       WHERE i.user_id = ? AND (? IS NULL OR i.kind = ?)
       ORDER BY i.active DESC, next_due_date IS NULL, next_due_date, i.name COLLATE NOCASE`,
    )
    .all(userId, kind ?? null, kind ?? null) as ScheduledItemWithProgress[];
}

export function findScheduledItem(userId: number, id: number): ScheduledItemWithProgress | null {
  const row = getDb()
    .prepare(`${SELECT_ITEM} WHERE i.user_id = ? AND i.id = ?`)
    .get(userId, id) as ScheduledItemWithProgress | undefined;
  return row ?? null;
}

export type CreateScheduledItemInput = {
  kind: ScheduledKind;
  name: string;
  direction: 'income' | 'expense';
  categoryId: number | null;
  counterparty: string | null;
  description: string | null;
  totalAmountKurus: number | null;
  installmentCount: number | null;
  period: BillPeriod | null;
  amountKurus: number | null;
  startDate: string;
};

export function insertScheduledItem(userId: number, input: CreateScheduledItemInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO scheduled_items
         (user_id, kind, name, direction, category_id, counterparty, description,
          total_amount_kurus, installment_count, period, amount_kurus, start_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.kind,
      input.name,
      input.direction,
      input.categoryId,
      input.counterparty,
      input.description,
      input.totalAmountKurus,
      input.installmentCount,
      input.period,
      input.amountKurus,
      input.startDate,
    );
  return Number(result.lastInsertRowid);
}

export type UpdateScheduledItemInput = {
  name: string;
  categoryId: number | null;
  counterparty: string | null;
  description: string | null;
  active: boolean;
};

export function updateScheduledItem(
  userId: number,
  id: number,
  input: UpdateScheduledItemInput,
): void {
  // Tutar/taksit sayisi/periyot DEGISTIRILMEZ: uretilmis vadeler ve onlara
  // bagli islemler tutarsiz kalirdi. Degisiklik icin kayit silinip yeniden
  // olusturulur.
  getDb()
    .prepare(
      `UPDATE scheduled_items
       SET name = ?, category_id = ?, counterparty = ?, description = ?, active = ?,
           updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      input.name,
      input.categoryId,
      input.counterparty,
      input.description,
      input.active ? 1 : 0,
      userId,
      id,
    );
}

export function deleteScheduledItem(userId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM scheduled_items WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return Number(result.changes) > 0;
}

/** Onaylanmis vadelerden dogan islem sayisi - silme onayinda gosterilir. */
export function countConfirmedOccurrences(userId: number, itemId: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM scheduled_occurrences
       WHERE user_id = ? AND scheduled_item_id = ? AND status = 'confirmed'`,
    )
    .get(userId, itemId) as { n: number };
  return Number(row.n);
}

// --- Vadeler ---

const SELECT_OCCURRENCE = `
  SELECT o.*,
         i.name      AS item_name,
         i.kind      AS kind,
         i.direction AS direction,
         i.category_id,
         c.name      AS category_name
  FROM scheduled_occurrences o
  JOIN scheduled_items i ON i.id = o.scheduled_item_id AND i.user_id = o.user_id
  LEFT JOIN categories c ON c.id = i.category_id AND c.user_id = i.user_id
`;

export function listOccurrences(userId: number, itemId: number): OccurrenceWithItem[] {
  return getDb()
    .prepare(`${SELECT_OCCURRENCE} WHERE o.user_id = ? AND o.scheduled_item_id = ? ORDER BY o.due_date`)
    .all(userId, itemId) as OccurrenceWithItem[];
}

export function findOccurrence(userId: number, id: number): OccurrenceWithItem | null {
  const row = getDb()
    .prepare(`${SELECT_OCCURRENCE} WHERE o.user_id = ? AND o.id = ?`)
    .get(userId, id) as OccurrenceWithItem | undefined;
  return row ?? null;
}

/** Belirli bir tarihe kadar vadesi gelen/gecen bekleyen kayitlar. */
export function listUpcomingOccurrences(
  userId: number,
  untilDate: string,
  limit = 50,
): OccurrenceWithItem[] {
  return getDb()
    .prepare(
      `${SELECT_OCCURRENCE}
       WHERE o.user_id = ? AND o.status = 'pending' AND o.due_date <= ? AND i.active = 1
       ORDER BY o.due_date LIMIT ?`,
    )
    .all(userId, untilDate, limit) as OccurrenceWithItem[];
}

export type PendingTotals = {
  incomeKurus: number;
  expenseKurus: number;
  /** Tutari henuz girilmemis bekleyen vadeler (genelde faturalar) */
  unknownAmountCount: number;
};

/** Bir tarih araligindaki bekleyen vadelerin yon bazinda toplami. */
export function sumPendingOccurrences(userId: number, from: string, to: string): PendingTotals {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN i.direction = 'income'  THEN o.amount_kurus ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN i.direction = 'expense' THEN o.amount_kurus ELSE 0 END), 0) AS expense,
         COALESCE(SUM(CASE WHEN o.amount_kurus IS NULL THEN 1 ELSE 0 END), 0) AS unknown
       FROM scheduled_occurrences o
       JOIN scheduled_items i ON i.id = o.scheduled_item_id AND i.user_id = o.user_id
       WHERE o.user_id = ? AND o.status = 'pending' AND i.active = 1
         AND o.due_date >= ? AND o.due_date <= ?`,
    )
    .get(userId, from, to) as { income: number; expense: number; unknown: number };

  return {
    incomeKurus: Number(row.income),
    expenseKurus: Number(row.expense),
    unknownAmountCount: Number(row.unknown),
  };
}

/** Tum kullanicilarda vadesi yaklasan kayitlar - zamanlanmis gorev icin. */
export function listAllUpcomingOccurrences(untilDate: string): OccurrenceWithItem[] {
  return getDb()
    .prepare(
      `${SELECT_OCCURRENCE}
       WHERE o.status = 'pending' AND o.due_date <= ? AND i.active = 1
       ORDER BY o.user_id, o.due_date`,
    )
    .all(untilDate) as OccurrenceWithItem[];
}

export function insertOccurrence(
  userId: number,
  itemId: number,
  dueDate: string,
  amountKurus: number | null,
  seq: number | null,
  totalSeq: number | null,
): void {
  // Ayni vade zaten varsa sessizce atlanir (benzersiz indeks + IGNORE):
  // vade uretimi bu sayede tekrar tekrar calistirilabilir.
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO scheduled_occurrences
         (user_id, scheduled_item_id, due_date, amount_kurus, seq, total_seq)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, itemId, dueDate, amountKurus, seq, totalSeq);
}

export function updateOccurrenceAmount(
  userId: number,
  id: number,
  amountKurus: number | null,
  dueDate: string,
): void {
  getDb()
    .prepare(
      `UPDATE scheduled_occurrences
       SET amount_kurus = ?, due_date = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ? AND status = 'pending'`,
    )
    .run(amountKurus, dueDate, userId, id);
}

export function setOccurrenceStatus(
  userId: number,
  id: number,
  status: OccurrenceStatus,
  transactionId: number | null,
  amountKurus?: number,
): void {
  getDb()
    .prepare(
      `UPDATE scheduled_occurrences
       SET status = ?, transaction_id = ?,
           amount_kurus = COALESCE(?, amount_kurus),
           updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .run(status, transactionId, amountKurus ?? null, userId, id);
}

/** Faturanin en ileri vadesi - ufuk doldurma icin. */
export function lastOccurrenceDate(userId: number, itemId: number): string | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(due_date) AS d FROM scheduled_occurrences
       WHERE user_id = ? AND scheduled_item_id = ?`,
    )
    .get(userId, itemId) as { d: string | null };
  return row.d;
}

export function listActiveBills(): ScheduledItemRow[] {
  return getDb()
    .prepare(`SELECT * FROM scheduled_items WHERE kind = 'bill' AND active = 1`)
    .all() as ScheduledItemRow[];
}
