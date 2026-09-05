import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectParser, findParserById } from './parserRegistry.ts';
import { parseStatementText } from './statementParser.ts';

/**
 * GARANTI KREDI KARTI EKSTRESI.
 *
 * Bicim gercek bir ekstreden alindi; isimler, kart numarasi ve tutarlar
 * degistirildi, sutun duzeni ve yazim korundu. Bu belgeden onceden TEK BIR
 * SATIR bile okunamiyordu: tarihler ay ADIYLA yaziliyor ("26 Temmuz 2026")
 * ve ayristirici yalnizca gg.aa.yyyy taniyordu, dolayisiyla her satir
 * "tarih yok" diye eleniyordu.
 *
 * Kart ekstresinde bakiye sutunu yoktur, yani bakiye zinciri denetim
 * YAPAMAZ. Dogrulama bu yuzden ekstrenin kendi toplamlariyla yapiliyor.
 */
const KART_EKSTRESI = `
Bonus Flexi Card Bilgileriniz
Kart Limiti 100.000,00 TL
Nakit Avans Limiti 25.000,00 TL
Hesap Kesim Tarihi 24 Ağustos 2026
Son Ödeme Tarihi 03 Eylül 2026
Dönem Borcunuz 6.000,00 TL
Min. Ödeme Tutarı 2.000,00 TL
Ekstre Sayfası 1 / 3
İşlem Tarihi Dönem İçi İşlemler Kalan Borç / Taksit Bonus (TL) Tutar (TL)
ÖNCEKİ DÖNEMDEN DEVİR EDİLEN TUTAR 9.000,00
03 Ağustos 2026 ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ 9.000,00+
DİĞER HARCAMALARINIZ
26 Temmuz 2026 SGK ÖDEMESİ 1.000,00x3=3.000,00 1.Taksit 1.000,00
04 Ağustos 2026 ORNEK MAGAZA 2.000,00x6=12.000,00 1.Taksit 2.000,00
BONUS PROGRAM ORTAKLARI DIŞI HARCAMALARINIZ - Bonus isyerlerini tercih edin!
30 Temmuz 2026 ORNEK SIGORTA 500,00x9=4.500,00 7.Taksit 12,50 500,00
13 Ağustos 2026 ORNEK EMEKLILIK 1,81 1.550,00
YURT DIŞI HARCAMALARINIZ
01 Ağustos 2026 Ornek Abonelik 50,00 TL 50,00+
08 Ağustos 2026 ORNEKGAMES.COM 34,99 USD 1.000,00
Toplam 14,31 6.000,00
`;

describe('kredi karti ekstresi: ay adiyla yazilmis tarihler', () => {
  const { lines, rejected } = findParserById('kredi-karti')!.parse(KART_EKSTRESI);

  test('belge artik okunabiliyor', () => {
    assert.equal(lines.length, 7, 'bir odeme + bir iade + bes harcama');
  });

  test('ay adi ISO tarihe cevrilir', () => {
    assert.equal(lines[0]?.date, '2026-08-03');
    assert.equal(lines[1]?.date, '2026-07-26');
    assert.equal(lines[6]?.date, '2026-08-08');
  });

  test('tutar EN SAGDAKI sutundan alinir', () => {
    // Onunde "Kalan Borc / Taksit" ve "Bonus" sutunlari var; soldan sayan
    // kural bonus puanini ya da taksit anaparasini tutar saniyordu.
    const emeklilik = lines.find((l) => l.description.includes('EMEKLILIK'));
    assert.equal(emeklilik?.amountKurus, 155_000, 'bonus 1,81 degil tutar 1.550,00');

    const sigorta = lines.find((l) => l.description.includes('SIGORTA'));
    assert.equal(sigorta?.amountKurus, 50_000);

    const oyun = lines.find((l) => l.description.includes('ORNEKGAMES'));
    assert.equal(oyun?.amountKurus, 100_000, 'USD tutari degil TL tutari');
  });

  test('bakiye sutunu olmadigi icin bakiye null', () => {
    assert.ok(lines.every((l) => l.balanceKurus === null));
  });

  test('SONDAKI arti alacak demektir', () => {
    const abonelik = lines.find((l) => l.description.includes('Abonelik'));
    assert.equal(abonelik?.type, 'income', '50,00+ bir iadedir');
    assert.equal(abonelik?.amountKurus, 5_000);
  });

  test('karta yapilan odeme gelir sayilir', () => {
    const odeme = lines.find((l) => l.description.includes('TESEKKUR') || l.raw.includes('TEŞEKKÜR'));
    assert.equal(odeme?.type, 'income');
    assert.equal(odeme?.amountKurus, 900_000);
  });

  test('"SGK ODEMESI" harcamadir: odeme kelimesi tek basina gelir yapmaz', () => {
    const sgk = lines.find((l) => l.description.includes('SGK'));
    assert.equal(sgk?.type, 'expense');
    assert.equal(sgk?.amountKurus, 100_000);
  });

  test('EKSTRENIN KENDI TOPLAMIYLA tutar', () => {
    // Bakiye zinciri yok; tek aritmetik dogrulama bu.
    const gider = lines
      .filter((l) => l.type === 'expense')
      .reduce((sum, l) => sum + l.amountKurus, 0);
    const iade = lines
      .filter((l) => l.type === 'income' && l.amountKurus < 900_000)
      .reduce((sum, l) => sum + l.amountKurus, 0);

    assert.equal(gider - iade, 600_000, 'Donem Borcunuz 6.000,00 TL');
  });

  test('baslik ve ozet satirlari islem sayilmaz', () => {
    assert.ok(!lines.some((l) => l.raw.includes('DEVİR')));
    assert.ok(!lines.some((l) => l.raw.startsWith('Toplam')));
    assert.ok(!lines.some((l) => l.raw.includes('Kart Limiti')));
  });

  test('okunamayan satirlarda gercek islem yok', () => {
    for (const r of rejected) {
      assert.ok(
        /Limit|Borcu|Tutar|Toplam|DEVİR|Kesim|Sayfası|Ödeme/i.test(r.raw),
        `beklenmeyen okunamayan satir: ${r.raw}`,
      );
    }
  });
});

describe('kart ekstresi ayristirici SECIMI', () => {
  test('Garanti kart ekstresi HESAP ayristiricisina dusmez', () => {
    // Belgede ve dosya adinda "Garanti" geciyor; karta ozgu terimler onceliklidir.
    assert.equal(detectParser(KART_EKSTRESI, 'Garanti_Flex_2026_08.pdf').id, 'kredi-karti');
  });

  test('hesap hareketi belgesi kart ayristiricisina KAYMAZ', () => {
    const hesap = [
      'T. Garanti Bankası A.Ş.',
      'Ad Soyad / Unvan : ORNEK KISI Bakiye : -222.673,26 TL',
      'Hesap Numarası : 747 - 6632550 Kullanılabilir Bakiye : 27.326,74 TL',
      '01.09.2026 ORNEK ALICI Para Transferi -81.000,00 TL -80.482,05 TL',
    ].join('\n');

    assert.equal(detectParser(hesap, 'yakuplu.pdf').id, 'garanti');
  });

  test('Enpara ekstresindeki "kredi karti odemesi" HAREKETI ayristirici degistirmez', () => {
    const enpara = [
      'Enpara.com hesap hareketleri',
      '03.04.2026 Ödeme Enpara.com kredi kartı ödemesi, ORNEK KISI -9.000,02 TL 0,00 TL',
    ].join('\n');

    assert.equal(detectParser(enpara, 'Enpara.pdf').id, 'enpara');
  });
});

describe('ay adiyla yazilmis tarihler (genel)', () => {
  test('butun aylar taninir', () => {
    const aylar = [
      ['05 Ocak 2026', '2026-01-05'],
      ['05 Şubat 2026', '2026-02-05'],
      ['05 Mart 2026', '2026-03-05'],
      ['05 Nisan 2026', '2026-04-05'],
      ['05 Mayıs 2026', '2026-05-05'],
      ['05 Haziran 2026', '2026-06-05'],
      ['05 Temmuz 2026', '2026-07-05'],
      ['05 Ağustos 2026', '2026-08-05'],
      ['05 Eylül 2026', '2026-09-05'],
      ['05 Ekim 2026', '2026-10-05'],
      ['05 Kasım 2026', '2026-11-05'],
      ['05 Aralık 2026', '2026-12-05'],
    ] as const;

    for (const [yazili, iso] of aylar) {
      const { lines } = parseStatementText(`${yazili} ORNEK HARCAMA 100,00`);
      assert.equal(lines[0]?.date, iso, yazili);
    }
  });

  test('aksani kaybolmus ay adi da taninir (OCR)', () => {
    const { lines } = parseStatementText('05 Agustos 2026 ORNEK HARCAMA 100,00');
    assert.equal(lines[0]?.date, '2026-08-05');
  });

  test('ay adi olmayan kelime tarih yapmaz', () => {
    const { lines, rejected } = parseStatementText('05 Filanca 2026 ORNEK 100,00');
    assert.equal(lines.length, 0);
    assert.equal(rejected[0]?.reason, 'tarih-yok');
  });

  test('sayisal ve yazili tarih ayni satirdaysa ONCE gelen alinir', () => {
    const { lines } = parseStatementText(
      '05 Ağustos 2026 12/07/2026 tarihli fatura -100,00 TL 900,00 TL',
    );
    assert.equal(lines[0]?.date, '2026-08-05');
  });
});
