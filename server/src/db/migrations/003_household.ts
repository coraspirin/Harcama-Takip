import type { Migration } from '../migrate.ts';

export const migration003Household: Migration = {
  id: 3,
  name: 'household',
  sql: `
    -- Ev muhasebesi semasi. Islem bir hesaba bagli degildir: tarih + tutar +
    -- gelir/gider + kategori + aciklama.

    CREATE TABLE categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      kind       TEXT    NOT NULL CHECK (kind IN ('income', 'expense')),
      -- 'fixed': her ay buyuk olcude ayni tutarda tekrar eder (kira, fatura).
      -- Tahminler sabit ve degisken kalemleri ayri ortalar.
      nature     TEXT    NOT NULL DEFAULT 'variable' CHECK (nature IN ('fixed', 'variable')),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      -- Kategoriler silinmez, arsivlenir: gecmis islemlerin kategorisi kaybolmaz.
      archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_categories_user_name_kind ON categories(user_id, name, kind);

    -- Tutar her zaman POZITIF tutulur; yon "type" alanindan gelir.
    --
    -- Borc odemesi ve birikime ayrilan para burada TUTULMAZ: kartla yapilan
    -- harcama, yapildigi anda gider olarak girilir; karti odemek ikinci bir
    -- gider degildir.
    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      type          TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
      amount_kurus  INTEGER NOT NULL CHECK (amount_kurus > 0),
      date          TEXT    NOT NULL,
      description   TEXT,
      -- Kaydin nereden geldigi: elle veya zamanlanmis bir kaydin onaylanmasi.
      source        TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'scheduled')),
      source_ref_id INTEGER,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_transactions_user_date     ON transactions(user_id, date DESC, id DESC);
    CREATE INDEX idx_transactions_user_category ON transactions(user_id, category_id);

    -- Aylik harcama limiti. category_id NULL ise GENEL limittir (o ayin tum
    -- giderleri); doluysa yalnizca o kategorinin limiti.
    CREATE TABLE budgets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      year_month  TEXT    NOT NULL,
      limit_kurus INTEGER NOT NULL CHECK (limit_kurus > 0),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- NULL'lar UNIQUE indekste birbirinden farkli sayilir; IFNULL ile ayni ay
    -- icin ikinci bir genel limit olusmasi engellenir.
    CREATE UNIQUE INDEX idx_budgets_category_month
      ON budgets(user_id, IFNULL(category_id, 0), year_month);
    CREATE INDEX idx_budgets_month ON budgets(user_id, year_month);

    -- Planlanan odeme/alacak, taksit ve fatura: gelecege tarihli, onaylandiginda
    -- gercek islem haline gelen kayitlar. Uc ayri tablo yerine tek tablo + kind.
    CREATE TABLE scheduled_items (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind               TEXT    NOT NULL CHECK (kind IN ('planned', 'installment', 'bill')),
      name               TEXT    NOT NULL,
      -- Planlanan bir ALACAK da olabilir; taksit ve fatura her zaman giderdir.
      direction          TEXT    NOT NULL CHECK (direction IN ('income', 'expense')),
      category_id        INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      counterparty       TEXT,
      description        TEXT,
      -- Taksit: toplam tutar kac taksite bolunecek
      total_amount_kurus INTEGER,
      installment_count  INTEGER,
      -- Fatura: hangi periyotta tekrarlar
      period             TEXT CHECK (period IN ('monthly', 'quarterly', 'yearly')),
      -- Planlanan: tek seferlik tutar. Faturada tahmini tutar (bos olabilir).
      amount_kurus       INTEGER,
      start_date         TEXT    NOT NULL,
      active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_scheduled_items_user ON scheduled_items(user_id, kind, active);

    -- Tek tek vadeler. Onaylanana kadar RAPORLARA GIRMEZ; onaylandiginda
    -- transactions tablosuna gercek bir kayit yazilir ve buraya baglanir.
    CREATE TABLE scheduled_occurrences (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scheduled_item_id INTEGER NOT NULL REFERENCES scheduled_items(id) ON DELETE CASCADE,
      due_date          TEXT    NOT NULL,
      -- Faturada tutari kullanici vadesi gelince girer; o ana kadar NULL.
      amount_kurus      INTEGER,
      status            TEXT    NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'confirmed', 'skipped')),
      transaction_id    INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
      -- Taksit ilerlemesi: 3/12
      seq               INTEGER,
      total_seq         INTEGER,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Ayni vade icin ikinci kayit olusamaz: zamanlanmis gorevin tekrar
    -- calismasi mukerrer vade uretmez.
    CREATE UNIQUE INDEX idx_occurrences_item_due
      ON scheduled_occurrences(user_id, scheduled_item_id, due_date);
    CREATE INDEX idx_occurrences_due ON scheduled_occurrences(user_id, status, due_date);

    -- Uygulama ici uyarilar. dedupe_key sayesinde zamanlanmis gorev gunde iki
    -- kez calissa bile ayni uyari bir kez olusur.
    CREATE TABLE notifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type         TEXT    NOT NULL,
      title        TEXT    NOT NULL,
      body         TEXT,
      related_type TEXT,
      related_id   INTEGER,
      due_date     TEXT,
      dedupe_key   TEXT    NOT NULL,
      read_at      TEXT,
      -- Home Assistant'a iletildiyse zaman damgasi
      sent_ha_at   TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(user_id, dedupe_key);
    CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at, created_at DESC);

    -- Reddedilen tekrar onerileri: imza bir daha onerilmez.
    CREATE TABLE recurrence_rejections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      signature  TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_recurrence_rejections
      ON recurrence_rejections(user_id, signature);
  `,
};
