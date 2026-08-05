import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementText } from './statementParser.ts';
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
  const lines = parseStatementText(HESAP_HAREKETI);

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
  const lines = parser.parse(KREDI_KARTI_EKSTRESI);

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
    assert.deepEqual(parseStatementText(''), []);
    assert.deepEqual(parseStatementText('   \n\n  '), []);
  });

  test('gecersiz tarih iceren satir atlanir', () => {
    const lines = parseStatementText('32.13.2026  GECERSIZ TARIH  -100,00');
    assert.equal(lines.length, 0);
  });

  test('tutarsiz satir atlanir', () => {
    const lines = parseStatementText('05.08.2026  TUTARSIZ ACIKLAMA SATIRI');
    assert.equal(lines.length, 0);
  });

  test('sifir tutarli satir atlanir', () => {
    const lines = parseStatementText('05.08.2026  SIFIR ISLEM  0,00  100,00');
    assert.equal(lines.length, 0);
  });

  test('iki haneli yil dogru yuzyila cevrilir', () => {
    const lines = parseStatementText('05.08.26  ESKI BICIM  -100,00');
    assert.equal(lines[0]?.date, '2026-08-05');
  });

  test('farkli tarih ayraclari desteklenir', () => {
    assert.equal(parseStatementText('05/08/2026 EGIK CIZGI -100,00')[0]?.date, '2026-08-05');
    assert.equal(parseStatementText('05-08-2026 TIRE -100,00')[0]?.date, '2026-08-05');
  });

  test('sonda eksi isareti (muhasebe bicimi) tanininir', () => {
    const lines = parseStatementText('05.08.2026  SONDA EKSI  1.500,00-');
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

    const lines = parseStatementText(wrapped);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.date, '2026-08-03');
    assert.equal(lines[0]?.amountKurus, 5_720_000);
    assert.equal(lines[0]?.type, 'expense');
    assert.match(lines[0]?.description ?? '', /ACIKLAMA/);
  });

  test('birlestirme bagimsiz satirlari birbirine yapistirmaz', () => {
    // Iki tam kayit arka arkaya: her ikisinde de tarih VE tutar var,
    // dolayisiyla birlestirilmemeliler.
    const lines = parseStatementText(
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
    const lines = parseStatementText(noisy);
    assert.equal(lines.length, 2, 'okunamayan satirlar atlanmali, gecerliler kalmali');
  });
});
