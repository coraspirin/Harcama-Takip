import type { Migration } from '../migrate.ts';

export const migration011DropTransferSplit: Migration = {
  id: 11,
  name: 'drop_transfer_split',
  sql: `
    -- HESAP ARASI TRANSFER AYRIMI KALDIRILDI.
    --
    -- Transfer satirlari gelir/gider toplamlarindan disliniyordu; kullanici
    -- bunlarin ekranda gri gorunup hesaba katilmamasini sorun olarak bildirdi
    -- ve ayrimin tamamen kalkmasina karar verdi. Artik her satir siradan bir
    -- gelir veya giderdir.
    --
    -- Sema kisiti:
    --   (type IN ('transfer_in','transfer_out')) = (transfer_group_id IS NOT NULL)
    -- Tur ve grup AYNI ifadede guncellendigi icin kisit her adimda saglanir.
    --
    -- HESAP BAKIYELERI DEGISMEZ: accounts.ts icindeki BALANCE_EXPR zaten
    -- transfer_in'i arti, transfer_out'u eksi sayiyordu; income/expense de ayni
    -- yonde sayiliyor.
    UPDATE transactions
       SET type = 'expense', transfer_group_id = NULL, transfer_matched = NULL
     WHERE type = 'transfer_out';

    UPDATE transactions
       SET type = 'income', transfer_group_id = NULL, transfer_matched = NULL
     WHERE type = 'transfer_in';

    -- KATEGORILERIN GERI YUKLENMESI
    --
    -- Eslestirici, iki satiri transfer olarak baglarken category_id'yi NULL
    -- yapiyordu ve geri alma bunu geri yuklemiyordu; yani otomatik bir islem
    -- kullanici onayi olmadan kategorileri siliyordu.
    --
    -- Veri aslinda kayip degil: ice aktarim, islemi taslak satirinin
    -- external_hash'i ile yaziyor. Taslak satirlarindaki category_id yerinde
    -- duruyor, buradan geri yuklenir.
    UPDATE transactions
       SET category_id = (
             SELECT l.category_id FROM ocr_draft_lines l
              WHERE l.user_id = transactions.user_id
                AND l.external_hash = transactions.external_hash
           )
     WHERE category_id IS NULL
       AND external_hash IS NOT NULL
       AND EXISTS (
             SELECT 1 FROM ocr_draft_lines l
              WHERE l.user_id = transactions.user_id
                AND l.external_hash = transactions.external_hash
                AND l.category_id IS NOT NULL
           );

    -- transfer_match_rejections ve match_settings tablolari BILEREK birakildi:
    -- kullanilmaz hale geliyorlar ama SQLite'ta tablo dusurmek geri alinamaz ve
    -- hicbir sey kazandirmaz.
  `,
};
