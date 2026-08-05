import { getDb } from './connection.ts';

export const ACCOUNT_TYPES = ['cash', 'bank', 'credit_card'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type AccountRow = {
  id: number;
  user_id: number;
  bank_id: number | null;
  name: string;
  type: AccountType;
  opening_balance_kurus: number;
  archived: number;
  /** Kredi kartina ozgu alanlar (diger turlerde null) */
  statement_day: number | null;
  due_day: number | null;
  credit_limit_kurus: number | null;
  created_at: string;
  updated_at: string;
};

export type AccountWithBalance = AccountRow & {
  bank_name: string | null;
  balance_kurus: number;
  transaction_count: number;
};

/**
 * Bakiye her zaman islemlerden turetilir (acilis bakiyesi + hareketler).
 * Ayri bir "guncel bakiye" sutunu tutulmaz: silinen/duzenlenen islemlerde
 * senkron kalmayan bir sayi, kullanicinin guvenini yitiren en hizli yoldur.
 *
 * Kredi karti hesaplarinda harcama bakiyeyi negatife iter; negatif bakiye
 * "borc" demektir.
 */
const BALANCE_EXPR = `
  a.opening_balance_kurus + COALESCE((
    SELECT SUM(CASE WHEN t.type IN ('income', 'transfer_in') THEN t.amount_kurus
                    ELSE -t.amount_kurus END)
    FROM transactions t
    WHERE t.account_id = a.id AND t.user_id = a.user_id
  ), 0)
`;

const COUNT_EXPR = `
  COALESCE((SELECT COUNT(*) FROM transactions t
            WHERE t.account_id = a.id AND t.user_id = a.user_id), 0)
`;

const SELECT_WITH_BALANCE = `
  SELECT a.*,
         b.name AS bank_name,
         ${BALANCE_EXPR} AS balance_kurus,
         ${COUNT_EXPR}   AS transaction_count
  FROM accounts a
  LEFT JOIN banks b ON b.id = a.bank_id AND b.user_id = a.user_id
`;

export function listAccounts(userId: number, includeArchived = false): AccountWithBalance[] {
  return getDb()
    .prepare(
      `${SELECT_WITH_BALANCE}
       WHERE a.user_id = ? AND (? = 1 OR a.archived = 0)
       ORDER BY a.archived, a.type, a.name COLLATE NOCASE`,
    )
    .all(userId, includeArchived ? 1 : 0) as AccountWithBalance[];
}

export function findAccount(userId: number, id: number): AccountWithBalance | null {
  const row = getDb()
    .prepare(`${SELECT_WITH_BALANCE} WHERE a.user_id = ? AND a.id = ?`)
    .get(userId, id) as AccountWithBalance | undefined;
  return row ?? null;
}

export function accountExists(userId: number, id: number): boolean {
  const row = getDb()
    .prepare('SELECT id FROM accounts WHERE user_id = ? AND id = ?')
    .get(userId, id) as { id: number } | undefined;
  return row !== undefined;
}

export function accountNameExists(userId: number, name: string, exceptId?: number): boolean {
  const row = getDb()
    .prepare(
      'SELECT id FROM accounts WHERE user_id = ? AND name = ? COLLATE NOCASE AND id <> ?',
    )
    .get(userId, name, exceptId ?? -1) as { id: number } | undefined;
  return row !== undefined;
}

export type CreateAccountInput = {
  name: string;
  type: AccountType;
  bankId: number | null;
  openingBalanceKurus: number;
  statementDay?: number | null;
  dueDay?: number | null;
  creditLimitKurus?: number | null;
};

export function createAccount(userId: number, input: CreateAccountInput): AccountWithBalance {
  const result = getDb()
    .prepare(
      `INSERT INTO accounts
         (user_id, bank_id, name, type, opening_balance_kurus,
          statement_day, due_day, credit_limit_kurus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.bankId,
      input.name,
      input.type,
      input.openingBalanceKurus,
      input.statementDay ?? null,
      input.dueDay ?? null,
      input.creditLimitKurus ?? null,
    );

  const created = findAccount(userId, Number(result.lastInsertRowid));
  if (!created) throw new Error('Hesap olusturuldu ancak okunamadi');
  return created;
}

export type UpdateAccountInput = CreateAccountInput & { archived: boolean };

export function updateAccount(
  userId: number,
  id: number,
  input: UpdateAccountInput,
): AccountWithBalance | null {
  getDb()
    .prepare(
      `UPDATE accounts
       SET name = ?, type = ?, bank_id = ?, opening_balance_kurus = ?, archived = ?,
           statement_day = ?, due_day = ?, credit_limit_kurus = ?,
           updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      input.name,
      input.type,
      input.bankId,
      input.openingBalanceKurus,
      input.archived ? 1 : 0,
      input.statementDay ?? null,
      input.dueDay ?? null,
      input.creditLimitKurus ?? null,
      userId,
      id,
    );

  return findAccount(userId, id);
}

export function countAccountTransactions(userId: number, accountId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND account_id = ?')
    .get(userId, accountId) as { n: number };
  return Number(row.n);
}

export function deleteAccount(userId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM accounts WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return Number(result.changes) > 0;
}
