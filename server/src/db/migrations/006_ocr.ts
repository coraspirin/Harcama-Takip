import type { Migration } from '../migrate.ts';

export const migration006Ocr: Migration = {
  id: 6,
  name: 'ocr',
  sql: `
    -- Yuklenen her ekstre bir "ice aktarim" kaydidir. Once taslak olarak durur,
    -- kullanici onaylayinca islemler yazilir.
    CREATE TABLE ocr_imports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      filename    TEXT    NOT NULL,
      -- Dosyanin SHA-256'si: ayni ekstre iki kez yuklenemez.
      file_hash   TEXT    NOT NULL,
      -- Hangi banka ayristiricisinin secildigi
      parser_id   TEXT    NOT NULL,
      -- 'text': PDF'in metin katmani okundu, 'ocr': goruntuye cevrilip taranди
      extraction  TEXT    NOT NULL CHECK (extraction IN ('text', 'ocr')),
      page_count  INTEGER NOT NULL DEFAULT 0,
      status      TEXT    NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'applied', 'discarded')),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      applied_at  TEXT
    );

    CREATE UNIQUE INDEX idx_ocr_imports_hash ON ocr_imports(user_id, file_hash);
    CREATE INDEX idx_ocr_imports_user ON ocr_imports(user_id, created_at DESC);

    -- Ayristirilan satirlar. Kullanici onaylamadan once duzenleyebilir veya
    -- listeden cikarabilir.
    CREATE TABLE ocr_draft_lines (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      import_id     INTEGER NOT NULL REFERENCES ocr_imports(id) ON DELETE CASCADE,
      line_no       INTEGER NOT NULL,
      date          TEXT    NOT NULL,
      description   TEXT    NOT NULL,
      amount_kurus  INTEGER NOT NULL,
      type          TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
      category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      -- Mevcut bir islemle ayni parmak izine sahipse isaretlenir; kullanici
      -- isterse yine de ekleyebilir ama varsayilan olarak haric tutulur.
      external_hash TEXT    NOT NULL,
      is_duplicate  INTEGER NOT NULL DEFAULT 0 CHECK (is_duplicate IN (0, 1)),
      excluded      INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0, 1)),
      raw           TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_ocr_lines_import ON ocr_draft_lines(user_id, import_id, line_no);
  `,
};
