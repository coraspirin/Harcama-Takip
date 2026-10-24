import type { Migration } from '../migrate.ts';

export const migration005Subscriptions: Migration = {
  id: 5,
  name: 'subscriptions',
  sql: `
    -- Abonelik (Netflix, spor salonu, telefon hatti...) sabit tutarli bir
    -- faturadir: ayri bir kind yerine faturaya bayrak olarak eklenir.
    -- kind CHECK'ini genisletmek tabloyu yeniden kurmayi gerektirirdi; bu da
    -- foreign key'ler acikken vadeleri silerdi.
    ALTER TABLE scheduled_items ADD COLUMN is_subscription INTEGER NOT NULL DEFAULT 0
      CHECK (is_subscription IN (0, 1));
  `,
};
