import type { Migration } from '../migrate.ts';

export const migration009AutoConfirm: Migration = {
  id: 9,
  name: 'auto_confirm',
  sql: `
    -- Vadesi gelen odeme kullanici onayi beklemeden "odendi" sayilir (or.
    -- karttan otomatik cekilen abonelik). Gunluk tarama tetikler.
    ALTER TABLE scheduled_items ADD COLUMN auto_confirm INTEGER NOT NULL DEFAULT 0
      CHECK (auto_confirm IN (0, 1));
  `,
};
