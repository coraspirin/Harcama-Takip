import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementText } from './statementParser.ts';
import { checkBalanceChain } from './balanceChain.ts';
import { detectParser, findParserById } from './parserRegistry.ts';

/**
 * Fixture'lar anonimlestirilmis, tipik Turk banka ekstresi metinleridir.
 * Gercek PDF'ler kisisel finansal veri oldugu icin repoya girmez
 * (bkz. .gitignore, sample_ekstre/).
 */

const HESAP_HAREKETI = `
Türkiye İş Bankası
Hesap Hareketleri
Tarih       Açıklama                        Tutar        Bakiye
05.08.2026  MIGROS MARKET ANKARA          -1.234,56    12.345,67
06.08.2026  MAAS ODEMESI                  25.000,00    37.345,67
07.08.2026  SHELL AKARYAKIT                 -850,00    36.495,67
08.08.2026  ATM PARA CEKME               -2.000,00    34.495,67
Devreden Bakiye                                        34.495,67
`;

const KREDI_KARTI_EKSTRESI = `
Garanti BBVA
Kredi Kartı Ekstresi
Dönem Borcu: 4.567,89
Asgari Ödeme Tutarı: 913,58
Son Ödeme Tarihi: 25.08.2026

İşlem Tarihi  Açıklama                      Tutar
02.08.2026    TRENDYOL                      1.299,90
03.08.2026    GETIR MARKET                    245,50
04.08.2026    IADE - TRENDYOL                 199,00
10.08.2026    SPOTIFY ABONELIK                 59,99
`;

describe('hesap hareketi ayristirma', () => {
  const { lines } = parseStatementText(HESAP_HAREKETI);

  test('yalnizca islem satirlari ayristirilir', () => {
    assert.equal(lines.length, 4, 'baslik ve devreden bakiye satirlari atlanmali');
  });

  test('tarih ISO bicimine cevrilir', () => {
    assert.equal(lines[0]?.date, '2026-08-05');
  });

  test('eksi isaretli tutar gider, artisi gelir sayilir', () => {
    assert.equal(lines[0]?.type, 'expense');
    assert.equal(lines[0]?.amountKurus, 123_456);
    assert.equal(lines[1]?.type, 'income');
    assert.equal(lines[1]?.amountKurus, 2_500_000);
  });

  test('BAKIYE sutunu tutar sanilmaz', () => {
    // 12.345,67 bakiyedir; tutar 1.234,56 olmali
    assert.equal(lines[0]?.amountKurus, 123_456);
    assert.notEqual(lines[0]?.amountKurus, 1_234_567);
  });

  test('aciklama tarih ile tutar arasindan alinir', () => {
    assert.equal(lines[0]?.description, 'MIGROS MARKET ANKARA');
    assert.equal(lines[3]?.description, 'ATM PARA CEKME');
  });

  test('tutar her zaman pozitif tutulur, yon type ile verilir', () => {
    for (const line of lines) {
      assert.ok(line.amountKurus > 0, `${line.raw} tutari pozitif olmali`);
    }
  });
});

describe('kredi karti ekstresi ayristirma', () => {
  const parser = findParserById('kredi-karti');
  assert.ok(parser);
  const { lines } = parser.parse(KREDI_KARTI_EKSTRESI);

  test('isaretsiz tutarlar HARCAMA sayilir', () => {
    const trendyol = lines.find((l) => l.description.includes('TRENDYOL') && !l.description.includes('IADE'));
    assert.ok(trendyol);
    assert.equal(trendyol.type, 'expense');
    assert.equal(trendyol.amountKurus, 129_990);
  });

  test('IADE satiri gelir olarak isaretlenir', () => {
    const iade = lines.find((l) => l.description.includes('IADE'));
    assert.ok(iade);
    assert.equal(iade.type, 'income');
    assert.equal(iade.amountKurus, 19_900);
  });

  test('son odeme tarihi ve asgari odeme satirlari islem sayilmaz', () => {
    assert.ok(!lines.some((l) => l.raw.includes('Son Ödeme')));
    assert.ok(!lines.some((l) => l.raw.includes('Asgari')));
  });

  test('dort islem satiri bulunur', () => {
    assert.equal(lines.length, 4);
  });
});

describe('banka tespiti', () => {
  test('icerikten banka taninir', () => {
    assert.equal(detectParser(HESAP_HAREKETI, 'ekstre.pdf').id, 'isbank');
    assert.equal(detectParser('GARANTI BBVA hesap ozeti', 'x.pdf').id, 'garanti');
  });

  test('dosya adindan banka taninir', () => {
    assert.equal(detectParser('bos icerik', 'yapikredi_agustos.pdf').id, 'yapikredi');
    assert.equal(detectParser('bos icerik', 'akbank-2026-08.pdf').id, 'akbank');
  });

  test('taninmayan bankada genel ayristirici kullanilir', () => {
    const parser = detectParser('Bilinmeyen Banka A.S. hesap dokumu', 'dosya.pdf');
    assert.equal(parser.id, 'generic');
  });
});

describe('bozuk/eksik girdiye dayaniklilik', () => {
  test('bos metin bos sonuc doner, hata firlatmaz', () => {
    assert.deepEqual(parseStatementText('').lines, []);
    assert.deepEqual(parseStatementText('   \n\n  ').lines, []);
  });

  test('gecersiz tarih iceren satir atlanir', () => {
    const { lines } = parseStatementText('32.13.2026  GECERSIZ TARIH  -100,00');
    assert.equal(lines.length, 0);
  });

  test('tutarsiz satir atlanir', () => {
    const { lines } = parseStatementText('05.08.2026  TUTARSIZ ACIKLAMA SATIRI');
    assert.equal(lines.length, 0);
  });

  test('sifir tutarli satir atlanir', () => {
    const { lines } = parseStatementText('05.08.2026  SIFIR ISLEM  0,00  100,00');
    assert.equal(lines.length, 0);
  });

  test('iki haneli yil dogru yuzyila cevrilir', () => {
    const { lines } = parseStatementText('05.08.26  ESKI BICIM  -100,00');
    assert.equal(lines[0]?.date, '2026-08-05');
  });

  test('farkli tarih ayraclari desteklenir', () => {
    assert.equal(parseStatementText('05/08/2026 EGIK CIZGI -100,00').lines[0]?.date, '2026-08-05');
    assert.equal(parseStatementText('05-08-2026 TIRE -100,00').lines[0]?.date, '2026-08-05');
  });

  test('sonda eksi isareti (muhasebe bicimi) tanininir', () => {
    const { lines } = parseStatementText('05.08.2026  SONDA EKSI  1.500,00-');
    assert.equal(lines[0]?.type, 'expense');
    assert.equal(lines[0]?.amountKurus, 150_000);
  });

  test('aciklamasi iki satira tasan kayit kaybolmaz', () => {
    // Gercek Garanti ekstresinde uzun aciklama sariliyor ve TUTAR ikinci
    // satira dusuyor. Birlestirme olmadan kayit iki kez elenip yok olurdu:
    // ilk satirda tutar yok, ikinci satirda tarih yok.
    const wrapped = [
      '03.08.2026 ornek alici-ACIKLAMA -FAST-CEP',
      'SUBE-7125000222 Para Transferi -57.200,00 TL -249.146,27 TL',
    ].join('\n');

    const { lines } = parseStatementText(wrapped);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.date, '2026-08-03');
    assert.equal(lines[0]?.amountKurus, 5_720_000);
    assert.equal(lines[0]?.type, 'expense');
    assert.match(lines[0]?.description ?? '', /ACIKLAMA/);
  });

  test('birlestirme bagimsiz satirlari birbirine yapistirmaz', () => {
    // Iki tam kayit arka arkaya: her ikisinde de tarih VE tutar var,
    // dolayisiyla birlestirilmemeliler.
    const { lines } = parseStatementText(
      ['05.08.2026 BIRINCI -100,00 TL 900,00 TL', '06.08.2026 IKINCI -200,00 TL 700,00 TL'].join(
        '\n',
      ),
    );
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.amountKurus, 10_000);
    assert.equal(lines[1]?.amountKurus, 20_000);
  });

  test('OCR gurultusu ayristirmayi durdurmaz', () => {
    const noisy = `
      ~~~ garbled header |||
      05.08.2026  MARKET ALISVERISI  -1.234,56  12.345,67
      ### unreadable ###
      06.08.2026  BENZIN  -850,00  11.495,67
    `;
    const { lines } = parseStatementText(noisy);
    assert.equal(lines.length, 2, 'okunamayan satirlar atlanmali, gecerliler kalmali');
  });
});

/**
 * TUTAR SUTUNU: aciklamanin ICINDE gecen tutarlar.
 *
 * Gercek bir Enpara ekstresinde bulundu; metin anonimlestirildi, bicim
 * korundu. Eski kural ("tarihten sonraki ilk parasal deger tutardir") bu
 * satirlari 100.000,00 TL'lik hayali GELIR diye kaydediyor, tek bir belgede
 * 47 satiri bozuyordu. Bakiye zinciri her birinde tam -100.050,85 kopukluk
 * bildirdigi icin hata gorulebildi.
 */
describe('tutar, bakiyenin hemen solundaki sutundur', () => {
  const KREDI_SATIRI =
    '03.04.2026 Vergi Kesintisi 100.000,00 TL 12 ay vadeli ihtiyaç kredinizin ' +
    'erken kapaması - KKDF -50,85 TL 9.000,02 TL';

  test('aciklamadaki tutar, islem tutari SANILMAZ', () => {
    const { lines } = parseStatementText(KREDI_SATIRI);

    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.amountKurus, 5_085, 'tutar -50,85 olmali');
    assert.equal(lines[0]?.type, 'expense');
    assert.equal(lines[0]?.balanceKurus, 900_002);
  });

  test('aciklama, icindeki tutari KORUR', () => {
    const { lines } = parseStatementText(KREDI_SATIRI);

    assert.match(lines[0]?.description ?? '', /100\.000,00 TL/);
    assert.match(lines[0]?.description ?? '', /KKDF/);
  });

  test('iki sutunlu klasik satirda davranis degismez', () => {
    const { lines } = parseStatementText('05.08.2026 MARKET -1.234,56 TL 12.345,67 TL');

    assert.equal(lines[0]?.amountKurus, 123_456);
    assert.equal(lines[0]?.balanceKurus, 1_234_567);
    assert.equal(lines[0]?.description, 'MARKET');
  });

  test('ayni sayi hem aciklamada hem tutar sutununda gecebilir', () => {
    // indexOf ile arandiginda aciklamadaki ilk "500,00" bulunur ve aciklama
    // yanlis yerden kesilirdi.
    const { lines } = parseStatementText('05.08.2026 FATURA 500,00 TL TAKSIT -500,00 TL 250,00 TL');

    assert.equal(lines[0]?.amountKurus, 50_000);
    assert.equal(lines[0]?.type, 'expense');
    assert.match(lines[0]?.description ?? '', /FATURA 500,00 TL TAKSIT/);
  });

  test('bakiye sutunu olmayan ekstrede (kredi karti) ilk tutar alinir', () => {
    const { lines } = parseStatementText('02.08.2026 MAGAZA 3 TAKSIT 1.299,90', {
      lastAmountIsBalance: false,
    });

    assert.equal(lines[0]?.amountKurus, 129_990);
    assert.equal(lines[0]?.balanceKurus, null);
  });

  test('bakiye zinciri artik tutuyor', () => {
    const enparaKredi = [
      '03.04.2026 Vergi Kesintisi 100.000,00 TL 12 ay vadeli kredi - BSMV -50,85 TL 9.050,87 TL',
      '03.04.2026 Vergi Kesintisi 100.000,00 TL 12 ay vadeli kredi - KKDF -50,85 TL 9.101,72 TL',
      '03.04.2026 Ödeme Referanslı Kredi Kapama -11.508,28 TL 9.152,57 TL',
    ].join('\n');

    const chain = checkBalanceChain(parseStatementText(enparaKredi).lines);
    assert.equal(chain.status, 'ok');
    assert.equal(chain.checkedPairs, 2);
  });
});

describe('okunamayan satirlarin raporlanmasi', () => {
  test('tarihi olmayan ama tutari olan satir sebebiyle bildirilir', () => {
    const { lines, rejected } = parseStatementText('TARIHSIZ DEVAM SATIRI -1.500,00 TL');

    assert.equal(lines.length, 0);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.reason, 'tarih-yok');
    assert.match(rejected[0]?.raw ?? '', /TARIHSIZ/);
  });

  test('tarihi olup tutari olmayan satir bildirilir', () => {
    const { rejected } = parseStatementText('05.08.2026 TUTARSIZ ACIKLAMA SATIRI');

    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.reason, 'tutar-yok');
  });

  test('gecersiz tarih ayirt edilir', () => {
    const { rejected } = parseStatementText('32.13.2026 GECERSIZ TARIH -100,00');

    assert.equal(rejected[0]?.reason, 'gecersiz-tarih');
  });

  test('sifir tutarli satir ayirt edilir', () => {
    const { rejected } = parseStatementText('05.08.2026 SIFIR ISLEM 0,00 100,00');

    assert.equal(rejected[0]?.reason, 'tutar-sifir');
  });

  test('duz baslik metni RAPORLANMAZ: kayit gorunumu yok', () => {
    // Ekstrenin yarisi basliktir; hepsini listelemek gercek kaybi bogar.
    const { rejected } = parseStatementText('Hesap Hareketleri Dokumu\nAciklama Tutar Bakiye');

    assert.equal(rejected.length, 0);
  });

  test('gecerli satirlar rapora girmez', () => {
    const { lines, rejected } = parseStatementText('05.08.2026 MARKET -100,00 TL 900,00 TL');

    assert.equal(lines.length, 1);
    assert.equal(rejected.length, 0);
  });
});

/**
 * TERS DIZILMIS SARMA (Garanti).
 *
 * Bicim gercek ekstreden alindi, isimler ve referanslar degistirildi.
 * Aciklamasi iki satira tasan kayitlarda tarih ve etiket ALT satira duser;
 * ileri yonlu birlestirme bu sirayi goremedigi icin iki Garanti ekstresinde
 * 47 kayit tumuyle kaybolmustu.
 */
describe('tarihi ALTTA kalan sarilmis kayit', () => {
  const garanti = () => findParserById('garanti')!;

  const TERS = [
    'AYSE YILMAZ-AYSE YILMAZ tarafından +400,00 TL 400,00 TL',
    '03.08.2026 Para Transferi',
  ].join('\n');

  test('kayit kaybolmaz', () => {
    const { lines } = garanti().parse(TERS);

    assert.equal(lines.length, 1, 'iki parca tek kayda birlesmeli');
    assert.equal(lines[0]?.date, '2026-08-03');
    assert.equal(lines[0]?.amountKurus, 40_000);
    assert.equal(lines[0]?.type, 'income');
    assert.equal(lines[0]?.balanceKurus, 40_000);
  });

  test('etiket sutun sirasi korundugu icin bulunur', () => {
    // Bastaki artik tutarlarin ARKASINA eklenseydi splitLabel etiketi bulamaz,
    // kayit kategorisiz kalirdi.
    const { lines } = garanti().parse(TERS);

    assert.equal(lines[0]?.label, 'Para Transferi');
    assert.equal(lines[0]?.description, 'AYSE YILMAZ-AYSE YILMAZ tarafından');
  });

  test('okunamayan satir olarak raporlanmaz', () => {
    const { rejected } = garanti().parse(TERS);
    assert.equal(rejected.length, 0);
  });

  test('ILERI yon oncelikli: iki bicim ayni belgede bir arada durabilir', () => {
    const karisik = [
      // ileri: tarih ustte
      '01.09.2026 Para Transferi',
      'SUBE-5428000148 ORNEK A.Ş. fatura ödemesi- +168.000,00 TL 168.400,00 TL',
      // ters: tarih altta
      'AYSE YILMAZ-AYSE YILMAZ tarafından +400,00 TL 400,00 TL',
      '03.08.2026 Para Transferi',
    ].join('\n');

    const { lines } = garanti().parse(karisik);

    assert.equal(lines.length, 2, 'iki kayit da okunmali');
    assert.equal(lines[0]?.amountKurus, 16_800_000);
    assert.equal(lines[1]?.amountKurus, 40_000);
    assert.equal(checkBalanceChain(lines).status, 'ok');
  });

  test('BASLIK bloguyla birlestirilmez: donem satiri iki tarih tasir', () => {
    // "Kullanilabilir Bakiye : 27.326,74 TL" satirinin ardindan donem basligi
    // gelir. Korumasiz birakilirsa 27.326,74 TL'lik UYDURMA bir gelir uretirdi.
    const baslik = [
      'Hesap Numarası : 747 - 6632550 Kullanılabilir Bakiye : 27.326,74 TL',
      "04/09/2024 - 04/09/2026 aralığında 144'ten fazla kayıt bulunmuştur.",
    ].join('\n');

    const { lines } = garanti().parse(baslik);
    assert.equal(lines.length, 0, 'baslik blogundan kayit uretilmemeli');
  });

  test('tek parasal degerli satir govde sayilmaz', () => {
    // Govde, tablonun sag ucunu (tutar VE bakiye) tasimali.
    const eksik = ['Ad Soyad / Unvan : ORNEK KISI Bakiye : 1.000,00 TL', '03.08.2026 Para Transferi'].join(
      '\n',
    );

    const { lines } = garanti().parse(eksik);
    assert.equal(lines.length, 0);
  });
});

/**
 * ARDISIK ters kayitlar.
 *
 * Ters dizilmis kayitlar arka arkaya geldiginde ileri yonlu birlestirme
 * bas1'i govde2'ye bagliyordu: tarihler bir kayit KAYIYOR ve dizinin iki
 * ucunda birer parca sahipsiz kaliyordu. Iki Garanti ekstresinde ilk
 * duzeltmeden sonra kalan 5 kopukluk (3 + 2) tam olarak bu diziydi;
 * her birinde bir sahipsiz govde ve bir sahipsiz bas satiri artiyordu.
 */
describe('ardisik ters kayitlar', () => {
  const garanti = () => findParserById('garanti')!;

  const DIZI = [
    '20.11.2025 TAM KAYIT Para Transferi -100,00 TL 4.301,90 TL',
    'ZOZAN ERTAS-ZOZAN ERTAS tarafından +4.000,00 TL 4.401,90 TL',
    '12.11.2025 Para Transferi',
    'CUNEYT ERDOGAN-CUNEYT ERDOGAN tarafından +401,90 TL 401,90 TL',
    '08.11.2025 Para Transferi',
    '03.11.2025 TAM KAYIT Para Transferi -50,00 TL 0,00 TL',
  ].join('\n');

  test('dizideki HICBIR kayit kaybolmaz', () => {
    const { lines, rejected } = garanti().parse(DIZI);

    assert.equal(lines.length, 4, 'iki tam + iki sarilmis kayit');
    assert.equal(rejected.length, 0, 'sahipsiz parca kalmamali');
  });

  test('her govde KENDI bas satirinin tarihini alir', () => {
    // Kayan tarih sessiz bir hatadir: bakiye zinciri tarihi denetlemez.
    const { lines } = garanti().parse(DIZI);

    const dortBin = lines.find((l) => l.amountKurus === 400_000);
    const dortYuz = lines.find((l) => l.amountKurus === 40_190);

    assert.equal(dortBin?.date, '2025-11-12');
    assert.equal(dortYuz?.date, '2025-11-08');
  });

  test('bakiye zinciri kopuksuz', () => {
    const { lines } = garanti().parse(DIZI);
    const chain = checkBalanceChain(lines);

    assert.equal(chain.status, 'ok');
    assert.equal(chain.checkedPairs, 3);
  });

  test('ILERI yonlu sarma bu korumadan etkilenmez', () => {
    // Onceki satir tam bir kayit oldugunda bas satiri ileriye baglanmalidir.
    const ileri = [
      '20.11.2025 TAM KAYIT Para Transferi -100,00 TL 900,00 TL',
      '19.11.2025 Para Transferi',
      'SUBE-5428000148 ORNEK A.Ş. fatura ödemesi- +1.000,00 TL 1.000,00 TL',
    ].join('\n');

    const { lines } = garanti().parse(ileri);

    assert.equal(lines.length, 2);
    assert.equal(lines[1]?.date, '2025-11-19');
    assert.equal(lines[1]?.amountKurus, 100_000);
  });
});
