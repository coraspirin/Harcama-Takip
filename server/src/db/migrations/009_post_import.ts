import type { Migration } from '../migrate.ts';

export const migration009PostImport: Migration = {
  id: 9,
  name: 'post_import',
  sql: `
    -- Bir transfer ciftinin NASIL kuruldugu.
    --   NULL        : kullanici elle transfer olusturdu
    --   'auto'      : eslestirici kendisi birlestirdi
    --   'confirmed' : eslestirici onerdi, kullanici onayladi
    --
    -- Otomatik birlestirme sessiz kalmamali: bu sutun sayesinde ekranda
    -- ayirt edilir ve tek tikla geri alinabilir.
    ALTER TABLE transactions ADD COLUMN transfer_matched TEXT
      CHECK (transfer_matched IN ('auto', 'confirmed'));

    -- Aday arama: tutar + tarih uzerinden.
    CREATE INDEX idx_transactions_amount ON transactions(user_id, amount_kurus, date);

    -- "Ilgisiz, bir daha sorma" kalici olmali; aksi halde her taramada ayni
    -- cift tekrar onerilir.
    CREATE TABLE transfer_match_rejections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expense_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      income_id  INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_transfer_rejections
      ON transfer_match_rejections(user_id, expense_id, income_id);

    -- Eslestirme ayarlari (kullanici basina tek kayit).
    --
    -- self_aliases: kullanicinin kendi ad yazimlari, satir satir. Ekstre
    -- aciklamalarinda "ABDULLAH MUCAHID ERDOGAN" gibi kendi adi geciyorsa bu
    -- guclu bir "kendine transfer" sinyalidir; ama uygulamada ad alani yok,
    -- kullanicidan alinmasi gerekir.
    CREATE TABLE match_settings (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      -- Iki bacak arasinda kac gun fark olabilir. 0 = yalnizca ayni gun.
      day_window    INTEGER NOT NULL DEFAULT 0 CHECK (day_window >= 0 AND day_window <= 7),
      auto_link     INTEGER NOT NULL DEFAULT 1 CHECK (auto_link IN (0, 1)),
      self_aliases  TEXT    NOT NULL DEFAULT '',
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

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
