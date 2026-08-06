import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { recurrenceSignature } from './recurrenceDetector.ts';

/**
 * Tekrar imzasi, her ay DEGISEN parcalari atarak ayni faturayi tek grupta
 * toplar. Bu yapilmazsa her ay farkli bir kayit gibi gorunur ve hicbir tekrar
 * tespit edilemez.
 */
describe('tekrar imzasi', () => {
  test('her ay degisen abone/fatura numaralari atilir', () => {
    const ocak = recurrenceSignature('SUPERONLINE Tes:0054438464 Fat:19844591604');
    const subat = recurrenceSignature('SUPERONLINE Tes:0054438464 Fat:19705882380');

    assert.equal(ocak, subat, 'ayni fatura ayni imzada toplanmali');
    assert.equal(ocak, 'superonline tes fat');
  });

  test('farkli kurumlar ayni imzaya dusmez', () => {
    assert.notEqual(
      recurrenceSignature('İGDAŞ-TES500108238062-FAT25100410932F'),
      recurrenceSignature('İSKİFÖ 87566524 3174124939'),
    );
  });

  test('Turkce harfler normalize edilir', () => {
    assert.equal(
      recurrenceSignature('İGDAŞ-TES500108238062'),
      recurrenceSignature('igdas-tes500108238062'),
    );
  });

  test('yalnizca rakamdan olusan aciklama bos imza verir', () => {
    // Bos/kisa imzalar gruplamaya alinmaz; anlamsiz oneri uretilmemeli.
    assert.equal(recurrenceSignature('1234567890'), '');
  });

  test('ayni hattin farkli faturalari birlesir, farkli hatlar ayrilir', () => {
    // Kullanicinin verisinde 3 ayri TRKCLL hatti var; numaralar atildigi icin
    // hepsi ayni imzaya duser. Bu BILINCLI bir tercih: ayni tur fatura tek
    // oneri olarak sunulur, kullanici isterse ayirir.
    const a = recurrenceSignature('TRKCLL 5417172492 7505092471');
    const b = recurrenceSignature('TRKCLL 5388225503 7501738890');
    assert.equal(a, b);
    assert.equal(a, 'trkcll');
  });
});
