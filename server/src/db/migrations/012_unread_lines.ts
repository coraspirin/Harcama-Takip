import type { Migration } from '../migrate.ts';

export const migration012UnreadLines: Migration = {
  id: 12,
  name: 'unread_lines',
  sql: `
    -- AYRISTIRICININ OKUYAMADIGI SATIRLAR.
    --
    -- Ayristirici cozemedigi satiri sessizce atiyordu. Iki Garanti ekstresinde
    -- bakiye zinciri 47 kopukluk bildirdiginde, hangi satirlarin kayboldugunu
    -- gosterecek hicbir kayit yoktu: sebep ancak canli veritabani kazilarak
    -- daraltilabildi ve yine de kesinlesmedi.
    --
    -- Bu tablo, atilan her "kayit gorunumlu" satiri ham haliyle ve sebebiyle
    -- saklar. Kopukluk cikan bir ice aktarimda kullanici, hangi metnin
    -- okunamadigini dogrudan gorur.
    CREATE TABLE ocr_unread_lines (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id  INTEGER NOT NULL REFERENCES ocr_imports(id) ON DELETE CASCADE,
      seq        INTEGER NOT NULL,
      reason     TEXT    NOT NULL,
      raw        TEXT    NOT NULL
    );

    CREATE INDEX idx_ocr_unread_import ON ocr_unread_lines(import_id, seq);
  `,
};
