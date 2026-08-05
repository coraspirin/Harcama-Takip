import type { Migration } from '../migrate.ts';

export const migration005Scheduled: Migration = {
  id: 5,
  name: 'scheduled',
  sql: `
    -- Planlanan odeme/alacak, taksitli odeme ve fatura UCUNUN de ayni sey
    -- oldugu gozlemine dayanir: gelecege tarihli, onaylandiginda gercek
    -- islem haline gelen kayitlar. Uc ayri tablo yerine tek tablo + kind.
    CREATE TABLE scheduled_items (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind               TEXT    NOT NULL CHECK (kind IN ('planned', 'installment', 'bill')),
      name               TEXT    NOT NULL,
      -- Planlanan bir ALACAK da olabilir; taksit ve fatura her zaman giderdir.
      direction          TEXT    NOT NULL CHECK (direction IN ('income', 'expense')),
      account_id         INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
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
      -- Home Assistant'a iletildiyse zaman damgasi (Faz 10)
      sent_ha_at   TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(user_id, dedupe_key);
    CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at, created_at DESC);
  `,
};
