import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { assembleRows, type TextFragment } from './textExtraction.ts';
import { parseStatementText } from './statementParser.ts';

/**
 * Bu testler GERCEK bir uretim arizasindan sonra yazildi: 14 sayfalik bir
 * Garanti BBVA hesap hareketi PDF'inden yalnizca 2 kayit cikarilabiliyordu.
 *
 * Sebep pdfjs parcalarinin satira dizilmesindeydi, ayristiricida degil.
 * Fixture'lar anonimlestirilmistir; gercek ekstre repoya girmez.
 */

/** Yardimci: tek satirlik parca listesi kurar. */
function frag(x: number, y: number, width: number, text: string): TextFragment {
  return { x, y, width, text };
}

describe('assembleRows - pdfjs parcalarini satira dizme', () => {
  test('bitisik parcalar arasina BOSLUK KOYULMAZ', () => {
    // Garanti tutari kurus kismini kucuk puntoyla AYRI parca olarak yazar.
    // Kosulsuz bosluk konursa "-820, 00 TL" olusur ve para deseni eslesmez.
    const rows = assembleRows([
      frag(400, 700, 18, '-820,'),
      frag(418, 700, 20, '00 TL'),
    ]);

    assert.deepEqual(rows, ['-820,00 TL']);
  });

  test('ayri sutunlar arasina bosluk konur', () => {
    const rows = assembleRows([
      frag(100, 700, 40, '05.08.2026'),
      frag(200, 700, 60, 'TELEKOM FATURASI'),
      frag(400, 700, 18, '-820,'),
      frag(418, 700, 20, '00 TL'),
    ]);

    assert.deepEqual(rows, ['05.08.2026 TELEKOM FATURASI -820,00 TL']);
  });

  test('ayni satirdaki kucuk y farklari satiri BOLMEZ', () => {
    // Kalin tutar ile normal metnin taban cizgisi ondalik pt kayabilir.
    // Yuvarlayarak kova olusturan eski kod, kova sinirina denk gelen bu iki
    // hucreyi (500,9 / 501,2) ayri satirlara atardi.
    const rows = assembleRows([
      frag(100, 500.9, 40, '05.08.2026'),
      frag(200, 501.2, 60, 'MARKET'),
      frag(400, 500.4, 30, '-99,90'),
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0], '05.08.2026 MARKET -99,90');
  });

  test('gercekten ayri satirlar ayri kalir', () => {
    const rows = assembleRows([
      frag(100, 700, 40, '05.08.2026'),
      frag(400, 700, 30, '-99,90'),
      frag(100, 680, 40, '06.08.2026'),
      frag(400, 680, 30, '-11,50'),
    ]);

    assert.deepEqual(rows, ['05.08.2026 -99,90', '06.08.2026 -11,50']);
  });

  test('satirlar yukaridan asagi siralanir', () => {
    // Girdi bilerek karisik: pdfjs parcalari cizim sirasina gore dondurur.
    const rows = assembleRows([
      frag(100, 600, 20, 'ORTA'),
      frag(100, 700, 20, 'UST'),
      frag(100, 500, 20, 'ALT'),
    ]);

    assert.deepEqual(rows, ['UST', 'ORTA', 'ALT']);
  });
});

describe('bolunmus tutar -> ayristirici (uctan uca)', () => {
  test('parcali yazilmis tutar dogru okunur', () => {
    // Garanti duzeni: Tarih | Aciklama | Etiket | Tutar | Bakiye
    // Tutar ve bakiye ikiser parca (tam kisim + kurus kismi).
    const fragments: TextFragment[] = [
      frag(60, 700, 45, '05.08.2026'),
      frag(130, 700, 90, 'TELEKOM FATURASI'),
      frag(330, 700, 70, 'Telekomünikasyon'),
      frag(440, 700, 22, '-820,'),
      frag(462, 700, 24, '00 TL'),
      frag(530, 700, 40, '-238.217,'),
      frag(570, 700, 24, '82 TL'),
    ];

    const text = assembleRows(fragments).join('\n');
    assert.match(text, /-820,00 TL/, 'kurus kismi tam kisma bitisik olmali');

    const { lines } = parseStatementText(text);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.date, '2026-08-05');
    assert.equal(lines[0]?.amountKurus, 82_000, 'bakiye degil tutar alinmali');
    assert.equal(lines[0]?.type, 'expense');
  });
});
