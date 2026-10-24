import type { CategoryRow } from '../db/categories.ts';
import type { TransactionWithNames } from '../db/transactions.ts';

/**
 * Veritabani satirlari snake_case, API camelCase konusur. Donusum tek yerde
 * toplanir ki bir sutun eklendiginde istemciye sizmasi bilincli bir karar olsun.
 */

export function serializeCategory(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    nature: row.nature,
    isDefault: row.is_default === 1,
    archived: row.archived === 1,
  };
}

export function serializeTransaction(row: TransactionWithNames) {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    type: row.type,
    amountKurus: row.amount_kurus,
    date: row.date,
    description: row.description,
    source: row.source,
    createdAt: row.created_at,
  };
}
