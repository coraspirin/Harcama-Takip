import type { Migration } from '../migrate.ts';

export const migration007BillEndMonth: Migration = {
  id: 7,
  name: 'bill_end_month',
  sql: `
    -- Aboneligin yenilenme ayi ("YYYY-MM", bu ay DAHIL). Vadeler bu aya kadar
    -- uretilir; NULL = suresiz.
    ALTER TABLE scheduled_items ADD COLUMN end_month TEXT;
  `,
};
