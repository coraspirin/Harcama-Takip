import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementText } from './statementParser.ts';

/**
 * OKUNAMAYAN SATIRLARIN SINIFLANDIRILMASI.
 *
 * Atilan her satiri esit sesle bildirmek denetimi degersiz kilar. Gercek
 * bir kredi karti ekstresi 23 islemi kusursuz okundugu halde "30 satir
 * okunamadi" uyarisi verdi; otuzunun da tamami baslik, bonus ozeti ve
 * ucret tablosuydu. Boyle bir uyari, bir dahaki sefere GERCEK bir kayip
 * cikinca da gormezden gelinir.
 *
 * Olcutler uc gercek belgeden cikarildi; her biri burada sinaniyor.
 */

const ISLEM = (gun: string, ad: string, tutar: string, bakiye: string) =>
  `${gun} ${ad} ${tutar} TL ${bakiye} TL`;

describe('islem blogunun DISINDA kalan satirlar supheli degildir', () => {
  test('bastaki baslik blogu', () => {
    const { lines, rejected } = parseStatementText(
      [
        'Ad Soyad / Unvan : ORNEK KISI Bakiye : -222.673,26 TL',
        'Hesap Numarasi : 747 - 6632550 Kullanilabilir Bakiye : 27.326,74 TL',
        ISLEM('01.09.2026', 'ILK KAYIT', '-100,00', '900,00'),
        ISLEM('31.08.2026', 'IKINCI KAYIT', '-200,00', '1.000,00'),
      ].join('\n'),
    );

    assert.equal(lines.length, 2);
    assert.equal(rejected.length, 2, 'iki baslik satiri kaydedilmeli');
    assert.ok(
      rejected.every((r) => !r.suspect),
      'islem blogundan ONCE gelenler kayip islem sayilmaz',
    );
  });

  test('sondaki ozet blogu', () => {
    const { rejected } = parseStatementText(
      [
        ISLEM('01.09.2026', 'ILK KAYIT', '-100,00', '900,00'),
        ISLEM('31.08.2026', 'IKINCI KAYIT', '-200,00', '1.000,00'),
        'Toplam 48,11 58.280,22',
        'Aylik guncel faiz oranlari: Akdi faiz: 3,75 , Gecikme faizi: 4,05',
      ].join('\n'),
    );

    assert.ok(rejected.length > 0);
    assert.ok(rejected.every((r) => !r.suspect), 'islem blogundan SONRA gelenler de degil');
  });
});

describe('islem blogunun ICINDE kalan satirlar SUPHELIDIR', () => {
  test('sahipsiz govde ve bas parcasi bildirilir', () => {
    // Garanti'de kaybolan kayitlarin bicimi: govde ile bas ayri satirlarda
    // ve ikisi de tek basina gecersiz. Uc kayit arasina sikismis bir cift
    // burada BIRLESIR; birlesemeyecek bir parca ise supheli kalmalidir.
    const { rejected } = parseStatementText(
      [
        ISLEM('01.09.2026', 'ILK KAYIT', '-100,00', '900,00'),
        'ORNEK GONDEREN tarafindan +400,00 TL',
        ISLEM('31.08.2026', 'IKINCI KAYIT', '-200,00', '1.000,00'),
      ].join('\n'),
    );

    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.suspect, true, 'iki kayit ARASINDA kalan parca supheli');
  });
});

describe('her sayfada tekrarlayan metin supheli degildir', () => {
  test('ayni dipnot ucuncu tekrarindan itibaren gurultu sayilir', () => {
    // Enpara'nin 9 sayfalik ekstresinde ayni dipnot 9 kez geciyordu.
    const dipnot = '01.01.2026 tarihi oncesindeki hareketler icin bankaniza basvurun';
    const { rejected } = parseStatementText(
      [
        ISLEM('01.09.2026', 'ILK KAYIT', '-100,00', '900,00'),
        dipnot,
        ISLEM('31.08.2026', 'IKINCI KAYIT', '-200,00', '1.000,00'),
        dipnot,
        ISLEM('30.08.2026', 'UCUNCU KAYIT', '-300,00', '1.200,00'),
        dipnot,
        ISLEM('29.08.2026', 'DORDUNCU KAYIT', '-400,00', '1.500,00'),
      ].join('\n'),
    );

    assert.equal(rejected.length, 3);
    assert.ok(rejected.every((r) => !r.suspect), 'uc kez tekrarlayan metin dipnottur');
  });

  test('bir kez gecen ayni sekilli satir SUPHELI kalir', () => {
    const { rejected } = parseStatementText(
      [
        ISLEM('01.09.2026', 'ILK KAYIT', '-100,00', '900,00'),
        'ORNEK GONDEREN tarafindan +400,00 TL',
        ISLEM('31.08.2026', 'IKINCI KAYIT', '-200,00', '1.000,00'),
      ].join('\n'),
    );

    assert.equal(rejected[0]?.suspect, true);
  });
});

describe('tutarsiz UZUN metin supheli degildir', () => {
  test('duz yazi paragrafi gurultu, kisa bas parcasi sinyaldir', () => {
    const paragraf =
      '01.01.2026 tarihinden itibaren gecerli olmak uzere hesap isletim ucreti ' +
      'ile ilgili duzenlemeler hakkinda detayli bilgi subelerimizden alinabilir';

    const { rejected } = parseStatementText(
      [
        ISLEM('01.09.2026', 'ILK KAYIT', '-100,00', '900,00'),
        paragraf,
        '15.08.2026 Para Transferi',
        ISLEM('31.08.2026', 'IKINCI KAYIT', '-200,00', '1.000,00'),
      ].join('\n'),
    );

    const uzun = rejected.find((r) => r.raw.startsWith('01.01.2026 tarihinden'));
    const kisa = rejected.find((r) => r.raw === '15.08.2026 Para Transferi');

    assert.equal(uzun?.suspect, false, 'tutarsiz uzun metin duz yazidir');
    assert.equal(kisa?.suspect, true, 'kisa bas parcasi kayip bir kaydin isaretidir');
  });
});

describe('hicbir kayit okunamadiysa TUM satirlar supheli', () => {
  test('bos taslak en yuksek sesle bildirilir', () => {
    // Kredi karti ekstresi duzeltilmeden once tam olarak boyleydi: tarihler
    // ay adiyla yazildigi icin tek bir satir bile okunamiyordu.
    const { lines, rejected } = parseStatementText(
      [
        '26 Temmuz 2026 ORNEK HARCAMA 1.304,00',
        '29 Temmuz 2026 BASKA HARCAMA 1.852,95',
      ]
        .map((satir) => satir.replace(/\d{4}/, 'YYYY'))
        .join('\n'),
    );

    assert.equal(lines.length, 0);
    assert.ok(rejected.length > 0);
    assert.ok(
      rejected.every((r) => r.suspect),
      'hicbir kaydin okunamadigi belgede her satir suphelidir',
    );
  });
});
