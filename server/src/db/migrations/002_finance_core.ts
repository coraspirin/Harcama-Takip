import type { Migration } from '../migrate.ts';

export const migration002FinanceCore: Migration = {
  id: 2,
  name: 'finance_core',
  sql: `
    -- Kullanicinin kendi banka tanimlari. Faiz orani baz puan (bp) cinsinden
    -- tam sayidir: 1 bp = %0.01, yani aylik %3.11 -> 311.
    CREATE TABLE banks (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                TEXT    NOT NULL,
      monthly_interest_bp INTEGER NOT NULL DEFAULT 0 CHECK (monthly_interest_bp >= 0),
      -- Turkiye'de kredi karti faizine KKDF + BSMV eklenir. Acikken tahmini
      -- faiz bu vergilerle birlikte hesaplanir (bkz. interestService, Faz 3).
      taxes_included      INTEGER NOT NULL DEFAULT 1 CHECK (taxes_included IN (0, 1)),
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_banks_user_name ON banks(user_id, name);

    CREATE TABLE accounts (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Banka silindiginde ona bagli hesaplar (ve zincirleme islemleri) da
      -- silinir; kullanici bu etkiyi silme oncesi onaylar.
      bank_id               INTEGER REFERENCES banks(id) ON DELETE CASCADE,
      name                  TEXT    NOT NULL,
      type                  TEXT    NOT NULL CHECK (type IN ('cash', 'bank', 'credit_card')),
      opening_balance_kurus INTEGER NOT NULL DEFAULT 0,
      archived              INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
      -- Nakit hesap bir bankaya bagli olamaz.
      CHECK (type <> 'cash' OR bank_id IS NULL)
    );

    CREATE UNIQUE INDEX idx_accounts_user_name ON accounts(user_id, name);
    CREATE INDEX idx_accounts_user_bank ON accounts(user_id, bank_id);

    CREATE TABLE categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      kind       TEXT    NOT NULL CHECK (kind IN ('income', 'expense')),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      -- Kategoriler silinmez, arsivlenir: gecmis islemlerin kategorisi kaybolmaz.
      archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_categories_user_name_kind ON categories(user_id, name, kind);

    -- Tutar her zaman POZITIF tutulur; yon "type" alanindan gelir.
    -- Transfer, ayni transfer_group_id'yi paylasan bir transfer_out +
    -- transfer_in ciftidir ve gelir/gider raporlarina DAHIL EDILMEZ.
    CREATE TABLE transactions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      category_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      type              TEXT    NOT NULL CHECK (type IN ('income', 'expense', 'transfer_in', 'transfer_out')),
      amount_kurus      INTEGER NOT NULL CHECK (amount_kurus > 0),
      date              TEXT    NOT NULL,
      description       TEXT,
      transfer_group_id TEXT,
      -- Kaydin nereden geldigi: elle, OCR ile ice aktarim, veya zamanlanmis
      -- bir kaydin onaylanmasi (Faz 6/8).
      source            TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ocr', 'scheduled')),
      source_ref_id     INTEGER,
      -- OCR ile gelen satirlarda mukerrer kaydi engellemek icin (Faz 8).
      external_hash     TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      CHECK ((type IN ('transfer_in', 'transfer_out')) = (transfer_group_id IS NOT NULL))
    );

    CREATE INDEX idx_transactions_user_date     ON transactions(user_id, date DESC, id DESC);
    CREATE INDEX idx_transactions_user_account  ON transactions(user_id, account_id);
    CREATE INDEX idx_transactions_user_category ON transactions(user_id, category_id);
    CREATE INDEX idx_transactions_transfer      ON transactions(transfer_group_id);

    -- Ayni ekstre satiri iki kez ice aktarilamaz.
    CREATE UNIQUE INDEX idx_transactions_external
      ON transactions(user_id, external_hash)
      WHERE external_hash IS NOT NULL;
  `,
};
