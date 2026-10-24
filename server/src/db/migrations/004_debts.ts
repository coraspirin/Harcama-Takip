import type { Migration } from '../migrate.ts';

export const migration004Debts: Migration = {
  id: 4,
  name: 'debts',
  sql: `
    -- Borclar ve alacaklar.
    --
    -- Borc odemesi GIDER DEGILDIR: harcama yapildigi anda gider olarak girilir;
    -- karti veya krediyi odemek o parayi ikinci kez saydirirdi. Bu yuzden
    -- odemeler transactions'a degil debt_payments'a yazilir.
    --
    -- Taksitler burada tutulmaz: scheduled_items (kind = 'installment')
    -- uzerinden borc listesine salt-okunur olarak eklenir.
    CREATE TABLE debts (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind                  TEXT    NOT NULL CHECK (kind IN ('loan', 'credit_card', 'personal')),
      -- 'lent': kullanicinin baskasina verdigi borc (alacak). Yalnizca
      -- kisilerle olan borclarda anlamlidir.
      direction             TEXT    NOT NULL DEFAULT 'owe' CHECK (direction IN ('owe', 'lent')),
      name                  TEXT    NOT NULL,
      counterparty          TEXT,
      -- Ilerleme cubugu icin baslangic tutari.
      original_kurus        INTEGER NOT NULL CHECK (original_kurus >= 0),
      -- Kullanicinin son bildirdigi bakiye ve tarihi (ekstre, banka uygulamasi).
      -- Guncel bakiye = bu tutar - bu tarihten SONRAKI odemeler.
      balance_kurus         INTEGER NOT NULL CHECK (balance_kurus >= 0),
      balance_date          TEXT    NOT NULL,
      -- Aylik akdi faiz, baz puan: %4,25 -> 425.
      monthly_interest_bp   INTEGER NOT NULL DEFAULT 0
                                    CHECK (monthly_interest_bp >= 0 AND monthly_interest_bp <= 10000),
      -- KKDF + BSMV faize eklensin mi (kart ve tuketici kredisinde evet).
      taxes_included        INTEGER NOT NULL DEFAULT 0 CHECK (taxes_included IN (0, 1)),
      -- Her ay odenmesi planlanan tutar (taksit, asgari odeme). Bitme tahmini
      -- bunun uzerinden yapilir.
      monthly_payment_kurus INTEGER CHECK (monthly_payment_kurus IS NULL OR monthly_payment_kurus > 0),
      note                  TEXT,
      closed                INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      CHECK (kind = 'personal' OR direction = 'owe')
    );

    CREATE INDEX idx_debts_user ON debts(user_id, closed);

    CREATE TABLE debt_payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      debt_id      INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
      date         TEXT    NOT NULL,
      amount_kurus INTEGER NOT NULL CHECK (amount_kurus > 0),
      note         TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_debt_payments_debt ON debt_payments(user_id, debt_id, date);
  `,
};
