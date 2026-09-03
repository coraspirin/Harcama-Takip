import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementText, splitLabel } from './statementParser.ts';
import { findParserById } from './parserRegistry.ts';
import { checkBalanceChain } from './balanceChain.ts';

/**
 * Enpara bicimi Garanti'den iki yapisal noktada ayrilir:
 *   1. "Hareket tipi" sutunu aciklamanin BASINDA (Garanti'de sonunda),
 *   2. aciklama sutunu dar -> uzun aciklamalar UC satira kadar sariliyor.
 *
 * Fixture'lar gercek bir Enpara hesap hareketinin duzenini taklit eder;
 * isimler ve tutarlar anonimlestirilmistir.
 */

function enpara() {
  const parser = findParserById('enpara');
  assert.ok(parser, 'enpara ayristiricisi tanimli olmali');
  return parser;
}

/** Tek satira sigan, saglam Enpara ekstresi. */
const DUZ = [
  'Enpara Bank A.Ş. Büyük Mükellefler Vergi Dairesi',
  'Tarih Hareket tipi Açıklama İşlem Tutarı Bakiye',
  '26.08.2026 Giden Transfer Ali Veli, Borç ödeme -50.000,00 TL -96.350,00 TL',
  '10.08.2026 Giden Transfer Ornek Kisi, kendime -52.000,00 TL -46.350,00 TL',
  '07.08.2026 Gelen Transfer Ayse Yilmaz, 2.150,00 TL 5.650,00 TL',
].join('\n');

describe('Enpara: hareket tipi aciklamanin BASINDA', () => {
  test('onek etiket ayrilir, aciklama temizlenir', () => {
    const lines = enpara().parse(DUZ);

    assert.equal(lines.length, 3);
    assert.equal(lines[0]?.label, 'Giden Transfer');
    assert.equal(lines[0]?.description, 'Ali Veli, Borç ödeme');
  });

  test('gelen transfer isaretsiz tutarla GELIR sayilir', () => {
    const lines = enpara().parse(DUZ);
    const gelen = lines.find((l) => l.label === 'Gelen Transfer');

    assert.equal(gelen?.type, 'income');
    assert.equal(gelen?.amountKurus, 215_000);
  });

  test('onek etiket sondan kirpilmaya calisilmaz', () => {
    // Garanti sozlugu sonda arar; Enpara'nin oneki sonda bulunmamali.
    const { label } = splitLabel('Giden Transfer Ali Veli', ['Giden Transfer'], 'suffix');
    assert.equal(label, null);
  });

  test('sozlukte olmayan hareket tipi kirpilmaz', () => {
    const { description, label } = splitLabel(
      'Bilinmeyen Tip Ali Veli',
      ['Giden Transfer'],
      'prefix',
    );
    assert.equal(label, null);
    assert.equal(description, 'Bilinmeyen Tip Ali Veli');
  });
});

describe('Enpara: uc satira sarilan kayit', () => {
  // Dar aciklama sutununda uzun bir aciklama boyle bolunur.
  const SARILMIS = [
    'Enpara Bank A.Ş.',
    '26.08.2026 Giden Transfer Ali Veli, Borç ödeme,',
    'EFT (FAST) sorgu',
    'no: 4773565098 -50.000,00 TL -96.350,00 TL',
    '10.08.2026 Giden Transfer Ornek Kisi, kendime -52.000,00 TL -46.350,00 TL',
  ].join('\n');

  test('kayit KAYBOLMAZ', () => {
    // Onceki surum yalnizca iki satirlik sarmayi birlestiriyordu; bu kayit
    // tamamen dusuyordu (ilk satirda tutar yok, digerlerinde tarih yok).
    const lines = enpara().parse(SARILMIS);

    assert.equal(lines.length, 2, 'sarilan kayit da okunmali');
    assert.equal(lines[0]?.date, '2026-08-26');
    assert.equal(lines[0]?.amountKurus, 5_000_000);
    assert.equal(lines[0]?.balanceKurus, -9_635_000, 'bakiye de dogru okunmali');
  });

  test('parcalar dogru sirayla birlesir', () => {
    const lines = enpara().parse(SARILMIS);
    assert.match(lines[0]?.description ?? '', /Ali Veli/);
    assert.match(lines[0]?.description ?? '', /4773565098/);
  });

  test('sarilmis kayitla zincir yine tutar', () => {
    const chain = checkBalanceChain(enpara().parse(SARILMIS));
    assert.equal(chain.status, 'ok');
  });
});

describe('birlestirmenin SINIRLARI', () => {
  test('tutar bulunamazsa satirlar yapistirilmaz', () => {
    // Tarihli ama tutarsiz bir baslik satiri, ardindan ilgisiz metin.
    const lines = parseStatementText(
      ['01.08.2026 - 31.08.2026 donemi', 'Ad soyad', 'IBAN TR78 0015', 'Sayfa 1'].join('\n'),
    );
    assert.equal(lines.length, 0, 'ilgisiz metin kayda donusturulmemeli');
  });

  test('sinirdan uzun bosluk kaydi yutmaz', () => {
    // 4 devam satiri MAX_CONTINUATION'i asar; birlestirme yapilmaz.
    const lines = parseStatementText(
      [
        '01.08.2026 TARIHLI AMA TUTARSIZ',
        'devam bir',
        'devam iki',
        'devam uc',
        'devam dort',
        'cok sonra gelen -99,00 100,00',
      ].join('\n'),
    );
    assert.equal(lines.length, 0, 'uzak tutar bu kayda baglanmamali');
  });

  test('araya yeni tarih girerse birlestirme durur', () => {
    const lines = parseStatementText(
      [
        '01.08.2026 TUTARSIZ SATIR',
        '02.08.2026 GECERLI KAYIT -10,00 990,00',
      ].join('\n'),
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.date, '2026-08-02');
    assert.equal(lines[0]?.amountKurus, 1_000, 'ilk satirin tutari calinmamali');
  });
});

describe('zincir denetiminin KAPSAMI', () => {
  test('dogrulanan ve dogrulanamayan gecis sayisi bildirilir', () => {
    const lines = enpara().parse(DUZ);
    const chain = checkBalanceChain(lines);

    assert.equal(chain.status, 'ok');
    assert.equal(chain.checkedPairs, 2, '3 satir -> 2 gecis');
    assert.equal(chain.uncheckedPairs, 0);
  });

  test('bakiyesi okunamayan satir DOGRULANMAMIS olarak sayilir', () => {
    // Ortadaki satirin bakiye sutunu okunamamis olsun (tek tutar var).
    const eksikBakiye = [
      'Enpara Bank A.Ş.',
      '26.08.2026 Giden Transfer Ali Veli -50.000,00 TL -96.350,00 TL',
      '10.08.2026 Giden Transfer Bakiyesiz Satir -52.000,00 TL',
      '07.08.2026 Gelen Transfer Ayse Yilmaz 2.150,00 TL 5.650,00 TL',
    ].join('\n');

    const chain = checkBalanceChain(enpara().parse(eksikBakiye));

    assert.equal(chain.uncheckedPairs > 0, true, 'kapsam eksigi raporlanmali');
    assert.equal(
      chain.checkedPairs + chain.uncheckedPairs,
      2,
      'her gecis ya dogrulanmis ya dogrulanmamis sayilmali',
    );
  });
});
