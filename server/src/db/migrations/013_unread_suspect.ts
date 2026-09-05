import type { Migration } from '../migrate.ts';

export const migration013UnreadSuspect: Migration = {
  id: 13,
  name: 'unread_suspect',
  sql: `
    -- Okunamayan satirin KAYIP ISLEM olma ihtimali.
    --
    -- Atilan her satiri esit sesle bildirmek denetimi degersiz kilar: bir
    -- kredi karti ekstresinin 30 satiri baslik, bonus ozeti ve ucret
    -- tablosudur. "30 satir okunamadi" uyarisi bir dahaki sefere GERCEK bir
    -- kayip cikinca da gormezden gelinir.
    --
    -- Eski kayitlar 0 kalir: o zaman siniflandirma yapilmiyordu ve geriye
    -- donuk tahmin yurutmek, olmayan bir kesinlik uretirdi.
    ALTER TABLE ocr_unread_lines ADD COLUMN suspect INTEGER NOT NULL DEFAULT 0;
  `,
};
