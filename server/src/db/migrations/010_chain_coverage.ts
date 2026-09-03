import type { Migration } from '../migrate.ts';

export const migration010ChainCoverage: Migration = {
  id: 10,
  name: 'chain_coverage',
  sql: `
    -- Bakiye zinciri denetiminin KAPSAMI.
    --
    -- Denetim, bakiyesi okunamayan satirlari atlayarak calisir. Kapsam
    -- saklanmazsa "zincir tutuyor" ifadesi, aslinda 14 satirin yalnizca
    -- 2'sinin dogrulandigi bir ice aktarimda da temiz bir rapor gibi okunur.
    ALTER TABLE ocr_imports ADD COLUMN balance_checked_pairs INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ocr_imports ADD COLUMN balance_unchecked_pairs INTEGER NOT NULL DEFAULT 0;
  `,
};
