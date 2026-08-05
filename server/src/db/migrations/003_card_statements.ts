import type { Migration } from '../migrate.ts';

export const migration003CardStatements: Migration = {
  id: 3,
  name: 'card_statements',
  sql: `
    -- Kredi karti hesaplarina ozgu alanlar
    ALTER TABLE accounts ADD COLUMN statement_day      INTEGER;
    ALTER TABLE accounts ADD COLUMN due_day            INTEGER;
    ALTER TABLE accounts ADD COLUMN credit_limit_kurus INTEGER;

    -- Ekstre kayitlari. Hesap bakiyesi HER ZAMAN islemlerden turetilir; ekstre
    -- ayri bir kayittir ve yalnizca (a) tahmini faiz hesabinda, (b) islemlerle
    -- mutabakat kontrolunde kullanilir. Ikisi arasindaki fark kullaniciya
    -- uyari olarak gosterilir, sessizce birinin lehine cozulmez.
    CREATE TABLE card_statements (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id             INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      -- Ekstre kesim tarihi (donem sonu)
      period_end             TEXT    NOT NULL,
      -- Son odeme tarihi
      due_date               TEXT,
      statement_amount_kurus INTEGER NOT NULL,
      paid_amount_kurus      INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_kurus >= 0),
      minimum_payment_kurus  INTEGER,
      created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_card_statements_period
      ON card_statements(user_id, account_id, period_end);

    CREATE INDEX idx_card_statements_account
      ON card_statements(user_id, account_id, period_end DESC);
  `,
};
