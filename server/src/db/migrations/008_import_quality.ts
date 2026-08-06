import type { Migration } from '../migrate.ts';

export const migration008ImportQuality: Migration = {
  id: 8,
  name: 'import_quality',
  sql: `
    -- Ekstre satirlarinin BAKIYE sutunu ve banka ETIKETI artik saklanir.
    --
    -- balance_kurus: satirdan SONRAKI bakiye, isaretli. Bankalarin cogu bunu
    -- yazar ve ardisik satirlar arasinda su degismez gecerlidir:
    --     bakiye[i] = bakiye[i+1] + tutar[i]        (yeniden eskiye sirali)
    -- Bu, okunan tutarlari ARITMETIK OLARAK dogrulamayi saglar; bir satir
    -- kacarsa yeri ve tutari kesin olarak bulunur. Daha once bu sutun
    -- okunup atiliyordu.
    --
    -- label: bankanin kendi siniflandirmasi ("Telekomunikasyon", "Kira
    -- Odemesi"...). Onceden aciklamanin sonuna yapisik geliyordu: hem kategori
    -- bilgisi kayboluyor hem aciklama kirleniyordu.
    ALTER TABLE ocr_draft_lines ADD COLUMN label TEXT;
    ALTER TABLE ocr_draft_lines ADD COLUMN balance_kurus INTEGER;

    -- Zincir bu satirda koptuysa 1. Inceleme ekraninda vurgulanir.
    ALTER TABLE ocr_draft_lines ADD COLUMN chain_break INTEGER NOT NULL DEFAULT 0
      CHECK (chain_break IN (0, 1));

    -- Ice aktarim geneli bakiye zinciri denetimi.
    --   'ok'          : zincir bastan sona tutuyor
    --   'gaps'        : kopukluk var (sayisi ve toplam tutari asagida)
    --   'unavailable' : ekstrede bakiye sutunu yok - hata degil
    ALTER TABLE ocr_imports ADD COLUMN balance_check TEXT;
    ALTER TABLE ocr_imports ADD COLUMN balance_gap_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ocr_imports ADD COLUMN balance_gap_kurus INTEGER NOT NULL DEFAULT 0;

    -- Banka etiketi -> kullanicinin kategorisi. Bir kez eslenir, sonraki tum
    -- ice aktarimlarda hatirlanir.
    CREATE TABLE label_category_map (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Ayni etiket adi farkli bankalarda farkli anlama gelebilir.
      parser_id   TEXT    NOT NULL,
      -- foldTurkish'ten gecirilmis hali saklanir: buyuk/kucuk harf ve
      -- diakritik farki ayni etiketi iki kez sormasin.
      label       TEXT    NOT NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_label_map_unique
      ON label_category_map(user_id, parser_id, label);

    -- Mukerrer tespiti artik external_hash yerine ICERIK uzerinden yapiliyor;
    -- boylece elle girilmis kayitlar da (external_hash NULL) karsilastirmaya
    -- girer. Bu indeks o aramanin ucuz kalmasini saglar.
    CREATE INDEX idx_transactions_content
      ON transactions(user_id, account_id, date, amount_kurus, type);
  `,
};
