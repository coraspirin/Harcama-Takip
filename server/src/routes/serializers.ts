import type { BankRow } from '../db/banks.ts';
import type { AccountWithBalance } from '../db/accounts.ts';
import type { CategoryRow } from '../db/categories.ts';
import type { TransactionWithNames } from '../db/transactions.ts';

/**
 * Veritabani satirlari snake_case, API camelCase konusur. Donusum tek yerde
 * toplanir ki bir sutun eklendiginde istemciye sizmasi bilincli bir karar olsun.
 */

export function serializeBank(row: BankRow) {
  return {
    id: row.id,
    name: row.name,
    monthlyInterestBp: row.monthly_interest_bp,
    taxesIncluded: row.taxes_included === 1,
    createdAt: row.created_at,
  };
}

export function serializeAccount(row: AccountWithBalance) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    bankId: row.bank_id,
    bankName: row.bank_name,
    openingBalanceKurus: row.opening_balance_kurus,
    balanceKurus: row.balance_kurus,
    transactionCount: row.transaction_count,
    archived: row.archived === 1,
    statementDay: row.statement_day,
    dueDay: row.due_day,
    creditLimitKurus: row.credit_limit_kurus,
    createdAt: row.created_at,
  };
}

export function serializeCategory(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    isDefault: row.is_default === 1,
    archived: row.archived === 1,
  };
}

export function serializeTransaction(row: TransactionWithNames) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    type: row.type,
    amountKurus: row.amount_kurus,
    date: row.date,
    description: row.description,
    transferGroupId: row.transfer_group_id,
    counterpartyAccountName: row.counterparty_account_name,
    source: row.source,
    createdAt: row.created_at,
  };
}
