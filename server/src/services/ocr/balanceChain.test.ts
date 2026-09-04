import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkBalanceChain } from './balanceChain.ts';
import { parseStatementText, splitLabel } from './statementParser.ts';
import { findParserById } from './parserRegistry.ts';

/**
 * Bakiye zinciri, okunan tutarlarin dogrulugunu TAHMIN ETMEZ, kanitlar.
 * Fixture'lar gercek Garanti duzenini taklit eder ama anonimdir.
 */

/** Garanti duzeni: tarih · aciklama · etiket · tutar · bakiye */
const GARANTI = [
  'T. Garanti Bankası A.Ş.',
  'Tarih Açıklama Etiket Tutar Bakiye',
  '05.08.2026 TELEKOM FATURASI Telekomünikasyon -820,00 TL -238.217,82 TL',
  '05.08.2026 DOGALGAZ Kurum Ödemesi -136,00 TL -237.397,82 TL',
  '03.08.2026 GELEN HAVALE Para Transferi +11.884,45 TL -237.261,82 TL',
  '03.08.2026 KENDIME GONDERIM Para Transferi -57.200,00 TL -249.146,27 TL',
].join('\n');

function parseGaranti(text: string) {
  const parser = findParserById('garanti');
  assert.ok(parser, 'garanti ayristiricisi tanimli olmali');
  return parser.parse(text).lines;
}

describe('etiket sutununun ayrilmasi', () => {
  test('etiket aciklamadan ayrilir', () => {
    const lines = parseGaranti(GARANTI);
    const telekom = lines.find((l) => l.description.includes('TELEKOM'));

    assert.equal(telekom?.label, 'Telekomünikasyon');
    assert.equal(telekom?.description, 'TELEKOM FATURASI', 'etiket aciklamada kalmamali');
  });

  test('sozlukte olmayan son kelime KIRPILMAZ', () => {
    const { description, label } = splitLabel('MARKET ALISVERISI', ['Telekomünikasyon']);
    assert.equal(description, 'MARKET ALISVERISI');
    assert.equal(label, null);
  });

  test('eslesme aksan ve buyuk-kucuk harf duyarsizdir', () => {
    const { description, label } = splitLabel('KIRA MART KIRA ODEMESI', ['Kira Ödemesi']);
    assert.equal(label, 'Kira Ödemesi');
    assert.equal(description, 'KIRA MART');
  });

  test('uzun etiket kisa olana tercih edilir', () => {
    const { label } = splitLabel('BIR SEY Kart Ödemesi', ['Ödemesi', 'Kart Ödemesi']);
    assert.equal(label, 'Kart Ödemesi');
  });

  test('aciklamanin tamami etiketse kirpilmaz', () => {
    // Aciklamasiz bir satirda etiketi aciklama olarak birakmak, satiri bos
    // birakmaktan daha bilgilendiricidir.
    const { description, label } = splitLabel('Kira Ödemesi', ['Kira Ödemesi']);
    assert.equal(description, 'Kira Ödemesi');
    assert.equal(label, null);
  });
});

describe('bakiye zinciri denetimi', () => {
  test('saglam ekstrede zincir tutar', () => {
    const result = checkBalanceChain(parseGaranti(GARANTI));

    assert.equal(result.status, 'ok');
    assert.equal(result.gaps.length, 0);
    assert.equal(result.order, 'desc', 'Garanti yeniden eskiye siralar');
  });

  test('bakiye okunur ve isaretlidir', () => {
    const lines = parseGaranti(GARANTI);
    assert.equal(lines[0]?.balanceKurus, -23_821_782);
    assert.equal(lines[0]?.amountKurus, 82_000, 'bakiye tutar sanilmamali');
  });

  test('EKSIK SATIR zinciri koparir ve tutari bildirir', () => {
    // Ortadaki dogalgaz satiri (-136,00) OCR tarafindan kacirilmis olsun.
    const eksik = GARANTI.split('\n')
      .filter((line) => !line.includes('DOGALGAZ'))
      .join('\n');

    const result = checkBalanceChain(parseGaranti(eksik));

    assert.equal(result.status, 'gaps');
    assert.equal(result.gaps.length, 1);
    assert.equal(
      Math.abs(result.gaps[0]!.differenceKurus),
      13_600,
      'kayip satirin tutari birebir bulunmali',
    );
  });

  test('YANLIS OKUNAN tutar zinciri koparir', () => {
    const bozuk = GARANTI.replace('-820,00 TL', '-830,00 TL');
    const result = checkBalanceChain(parseGaranti(bozuk));

    assert.equal(result.status, 'gaps');
    assert.equal(Math.abs(result.gaps[0]!.differenceKurus), 1_000);
  });

  test('eskiden yeniye sirali ekstrede yon otomatik bulunur', () => {
    const artan = [
      'Tarih Açıklama Tutar Bakiye',
      '01.09.2026 ILK -100,00 900,00',
      '02.09.2026 IKINCI -200,00 700,00',
      '03.09.2026 UCUNCU +50,00 750,00',
    ].join('\n');

    const result = checkBalanceChain(parseStatementText(artan).lines);

    assert.equal(result.order, 'asc');
    assert.equal(result.status, 'ok');
  });

  test('bakiye sutunu olmayan ekstrede denetim yapilamaz (hata degil)', () => {
    const bakiyesiz = [
      'Islem Tarihi Aciklama Tutar',
      '01.09.2026 MARKET -100,00',
      '02.09.2026 BENZIN -200,00',
    ].join('\n');

    const result = checkBalanceChain(parseStatementText(bakiyesiz, { lastAmountIsBalance: false }).lines);

    assert.equal(result.status, 'unavailable');
    assert.equal(result.order, null);
  });

  test('bos girdi hata firlatmaz', () => {
    assert.equal(checkBalanceChain([]).status, 'unavailable');
  });
});
