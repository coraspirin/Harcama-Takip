import type { Migration } from '../migrate.ts';

export const migration008ExcludeFromBudget: Migration = {
  id: 8,
  name: 'exclude_from_budget',
  sql: `
    -- Listede takip edilen ama butceye yansimayan kayit (or. baskasinin
    -- odedigi fatura): bekleyen toplamlara, aylik paya ve borca girmez,
    -- onaylaninca islem kaydi olusmaz.
    ALTER TABLE scheduled_items ADD COLUMN exclude_from_budget INTEGER NOT NULL DEFAULT 0
      CHECK (exclude_from_budget IN (0, 1));
  `,
};
