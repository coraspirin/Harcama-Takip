import crypto from 'node:crypto';
import { getDb } from './connection.ts';

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer_in', 'transfer_out'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type TransactionSource = 'manual' | 'ocr' | 'scheduled';

export type TransactionRow = {
  id: number;
  user_id: number;
  account_id: number;
  category_id: number | null;
  type: TransactionType;
  amount_kurus: number;
  date: string;
  description: string | null;
  transfer_group_id: string | null;
  /** Transfer nasil kuruldu: elle olusturulanlarda NULL. */
  transfer_matched: 'auto' | 'confirmed' | null;
  source: TransactionSource;
  source_ref_id: number | null;
  external_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type TransactionWithNames = TransactionRow & {
  account_name: string;
  category_name: string | null;
  /** Transferin karsi tarafindaki hesabin adi (transfer olmayanlarda null). */
  counterparty_account_name: string | null;
};

const SELECT_WITH_NAMES = `
  SELECT t.*,
         a.name AS account_name,
         c.name AS category_name,
         (SELECT a2.name
            FROM transactions t2
            JOIN accounts a2 ON a2.id = t2.account_id
           WHERE t2.transfer_group_id = t.transfer_group_id
             AND t2.user_id = t.user_id
             AND t2.id <> t.id
           LIMIT 1) AS counterparty_account_name
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
  LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
`;

export type TransactionFilters = {
  from?: string;
  to?: string;
  accountId?: number;
  categoryId?: number;
  /** 'transfer' hem transfer_in hem transfer_out kayitlarini kapsar. */
  kind?: 'income' | 'expense' | 'transfer';
  minAmountKurus?: number;
  maxAmountKurus?: number;
  search?: string;
  includeTransfers?: boolean;
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
  if (f.accountId !== undefined) {
    clauses.push('t.account_id = ?');
    params.push(f.accountId);
  }
  if (f.categoryId !== undefined) {
    clauses.push('t.category_id = ?');
    params.push(f.categoryId);
  }
  if (f.kind === 'transfer') {
    clauses.push("t.type IN ('transfer_in', 'transfer_out')");
  } else if (f.kind) {
    clauses.push('t.type = ?');
    params.push(f.kind);
  }
  if (f.includeTransfers === false) {
    clauses.push("t.type IN ('income', 'expense')");
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

/** Filtreye uyan kayitlarin gelir/gider toplami (transferler haric). */
export function sumTransactions(
  userId: number,
  filters: TransactionFilters,
): { incomeKurus: number; expenseKurus: number } {
  const { where, params } = buildFilters(userId, { ...filters, includeTransfers: false });
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

export function findTransferGroup(userId: number, groupId: string): TransactionWithNames[] {
  return getDb()
    .prepare(`${SELECT_WITH_NAMES} WHERE t.user_id = ? AND t.transfer_group_id = ?`)
    .all(userId, groupId) as TransactionWithNames[];
}

export type ContentKey = {
  accountId: number;
  date: string;
  amountKurus: number;
  type: 'income' | 'expense';
  /** foldTurkish'ten gecirilmis, bosluklari sadelestirilmis aciklama. */
  normalizedDescription: string;
};

/**
 * Ayni ICERIGE sahip kac islem var?
 *
 * Mukerrer tespitinin temeli. Eskiden external_hash uzerinden bakiliyordu; o
 * yaklasim ELLE GIRILMIS kayitlari tamamen kaciriyordu (onlarda hash NULL).
 *
 * Aciklama karsilastirmasi bilerek SQL'de degil JS'te yapilir: SQLite'in
 * LOWER() fonksiyonu Turkce harfleri katlamaz, dolayisiyla SQL tarafi ile
 * foldTurkish kullanan JS tarafi sessizce farkli sonuc verirdi. Ucuz ve
 * indeksli on eleme SQL'de, kesin karsilastirma JS'te.
 */
export function countContentMatches(
  userId: number,
  key: ContentKey,
  normalize: (value: string) => string,
): number {
  const rows = getDb()
    .prepare(
      `SELECT description FROM transactions
       WHERE user_id = ? AND account_id = ? AND date = ? AND amount_kurus = ? AND type = ?`,
    )
    .all(userId, key.accountId, key.date, key.amountKurus, key.type) as {
    description: string | null;
  }[];

  return rows.filter((row) => normalize(row.description ?? '') === key.normalizedDescription)
    .length;
}

export type CreateTransactionInput = {
  accountId: number;
  categoryId: number | null;
  type: TransactionType;
  amountKurus: number;
  date: string;
  description: string | null;
  transferGroupId?: string | null;
  source?: TransactionSource;
  sourceRefId?: number | null;
  externalHash?: string | null;
};

export function insertTransaction(userId: number, input: CreateTransactionInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO transactions
         (user_id, account_id, category_id, type, amount_kurus, date, description,
          transfer_group_id, source, source_ref_id, external_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.accountId,
      input.categoryId,
      input.type,
      input.amountKurus,
      input.date,
      input.description,
      input.transferGroupId ?? null,
      input.source ?? 'manual',
      input.sourceRefId ?? null,
      input.externalHash ?? null,
    );
  return Number(result.lastInsertRowid);
}

export type UpdateTransactionInput = {
  accountId: number;
  categoryId: number | null;
  type: 'income' | 'expense';
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
       SET account_id = ?, category_id = ?, type = ?, amount_kurus = ?, date = ?,
           description = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ? AND transfer_group_id IS NULL`,
    )
    .run(
      input.accountId,
      input.categoryId,
      input.type,
      input.amountKurus,
      input.date,
      input.description,
      userId,
      id,
    );

  return findTransaction(userId, id);
}

export function deleteTransaction(userId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM transactions WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return Number(result.changes) > 0;
}

/** Transferin iki bacagi birlikte silinir; tek bacak birakilmaz. */
export type TransferCandidateRow = {
  expense_id: number;
  expense_account_id: number;
  expense_account_name: string;
  expense_account_type: 'cash' | 'bank' | 'credit_card';
  expense_date: string;
  expense_description: string | null;
  income_id: number;
  income_account_id: number;
  income_account_name: string;
  income_account_type: 'cash' | 'bank' | 'credit_card';
  income_date: string;
  income_description: string | null;
  amount_kurus: number;
};

/**
 * Ayni tutarli gider/gelir ciftlerini bulur: kullanicinin KENDI hesaplari
 * arasindaki bir transfer, iki ekstrede ayri ayri gider ve gelir olarak
 * gorunur ve raporlarda hem geliri hem gideri sisirir.
 *
 * Yalnizca ADAY dondurur. Hangisinin gercekten transfer oldugu ayri bir karar
 * (bkz. transferMatcher): tutar ve tarih eslesmesi tek basina kanit degildir.
 */
export function findTransferCandidates(
  userId: number,
  dayWindow: number,
): TransferCandidateRow[] {
  return getDb()
    .prepare(
      `SELECT
         e.id AS expense_id, e.account_id AS expense_account_id,
         ea.name AS expense_account_name, ea.type AS expense_account_type,
         e.date AS expense_date, e.description AS expense_description,
         i.id AS income_id, i.account_id AS income_account_id,
         ia.name AS income_account_name, ia.type AS income_account_type,
         i.date AS income_date, i.description AS income_description,
         e.amount_kurus AS amount_kurus
       FROM transactions e
       JOIN transactions i
         ON i.user_id = e.user_id
        AND i.type = 'income'
        AND i.amount_kurus = e.amount_kurus
        AND i.account_id <> e.account_id
        AND i.transfer_group_id IS NULL
        AND ABS(julianday(i.date) - julianday(e.date)) <= ?
       JOIN accounts ea ON ea.id = e.account_id AND ea.user_id = e.user_id
       JOIN accounts ia ON ia.id = i.account_id AND ia.user_id = i.user_id
       WHERE e.user_id = ?
         AND e.type = 'expense'
         AND e.transfer_group_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM transfer_match_rejections r
           WHERE r.user_id = e.user_id AND r.expense_id = e.id AND r.income_id = i.id
         )
       ORDER BY ABS(julianday(i.date) - julianday(e.date)), e.date DESC, e.id`,
    )
    .all(dayWindow, userId) as TransferCandidateRow[];
}

/**
 * Iki mevcut islemi transfer cifti haline getirir.
 *
 * Satirlar SILINMEZ, turleri degistirilir: kayitlar gercek para hareketleridir,
 * yalnizca gelir/gider sayilmamalari gerekir. Rapor sorgulari zaten
 * transfer_in/out'u disliyor, bakiye sorgusu ise sayiyor; bu yuzden dogru
 * sonuc rapor kodunda tek satir degisiklik olmadan elde edilir.
 *
 * Sema `CHECK ((type IN ('transfer_in','transfer_out')) = (transfer_group_id
 * IS NOT NULL))` tasidigi icin tur ve grup BIRLIKTE guncellenmek zorundadir.
 *
 * `transfer_group_id IS NULL` sarti yarista ikinci kez baglanmayi engeller.
 */
export function linkAsTransfer(
  userId: number,
  expenseId: number,
  incomeId: number,
  matched: 'auto' | 'confirmed',
): string | null {
  const db = getDb();
  const groupId = crypto.randomUUID();

  const out = db
    .prepare(
      `UPDATE transactions
       SET type = 'transfer_out', transfer_group_id = ?, transfer_matched = ?,
           category_id = NULL, updated_at = datetime('now')
       WHERE user_id = ? AND id = ? AND type = 'expense' AND transfer_group_id IS NULL`,
    )
    .run(groupId, matched, userId, expenseId);

  if (Number(out.changes) === 0) return null;

  const income = db
    .prepare(
      `UPDATE transactions
       SET type = 'transfer_in', transfer_group_id = ?, transfer_matched = ?,
           category_id = NULL, updated_at = datetime('now')
       WHERE user_id = ? AND id = ? AND type = 'income' AND transfer_group_id IS NULL`,
    )
    .run(groupId, matched, userId, incomeId);

  if (Number(income.changes) === 0) {
    // Gider bacagi guncellendi ama gelir bacagi guncellenemedi: tek bacakli
    // bir transfer sema kisitini ihlal etmese de anlamsizdir, geri alinir.
    db.prepare(
      `UPDATE transactions
       SET type = 'expense', transfer_group_id = NULL, transfer_matched = NULL
       WHERE user_id = ? AND id = ?`,
    ).run(userId, expenseId);
    return null;
  }

  return groupId;
}

/**
 * Transfer eslestirmesini geri alir: satirlar tekrar gider/gelir olur.
 *
 * deleteTransferGroup BU IS ICIN KULLANILMAZ - o iki satiri siler ve gercek
 * islemleri yok ederdi.
 */
export function unlinkTransfer(userId: number, groupId: string): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, type FROM transactions
       WHERE user_id = ? AND transfer_group_id = ? AND transfer_matched IS NOT NULL`,
    )
    .all(userId, groupId) as { id: number; type: TransactionType }[];

  if (rows.length === 0) return 0;

  let changed = 0;
  for (const row of rows) {
    const restored = row.type === 'transfer_out' ? 'expense' : 'income';
    const result = db
      .prepare(
        `UPDATE transactions
         SET type = ?, transfer_group_id = NULL, transfer_matched = NULL,
             updated_at = datetime('now')
         WHERE user_id = ? AND id = ?`,
      )
      .run(restored, userId, row.id);
    changed += Number(result.changes);
  }

  return changed;
}

/** Eslestirici tarafindan kurulmus transferler (elle olusturulanlar haric). */
export function listMatchedTransfers(userId: number): TransactionWithNames[] {
  return getDb()
    .prepare(
      `${SELECT_WITH_NAMES}
       WHERE t.user_id = ? AND t.transfer_matched IS NOT NULL AND t.type = 'transfer_out'
       ORDER BY t.date DESC, t.id DESC
       LIMIT 200`,
    )
    .all(userId) as TransactionWithNames[];
}

export function rejectTransferCandidate(
  userId: number,
  expenseId: number,
  incomeId: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO transfer_match_rejections (user_id, expense_id, income_id)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, expense_id, income_id) DO NOTHING`,
    )
    .run(userId, expenseId, incomeId);
}

export function deleteTransferGroup(userId: number, groupId: string): number {
  const result = getDb()
    .prepare('DELETE FROM transactions WHERE user_id = ? AND transfer_group_id = ?')
    .run(userId, groupId);
  return Number(result.changes);
}
