// Ortam degiskenleri ILK SIRADA yuklenmeli (bkz. test/env.ts).
import '../test/env.ts';

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, maskSecret } from './cryptoService.ts';

describe('gizli deger sifreleme', () => {
  test('sifrelenen deger aynen geri cozulur', () => {
    const secret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.uzun-bir-ha-token-degeri';
    assert.equal(decryptSecret(encryptSecret(secret)), secret);
  });

  test('turkce karakterler korunur', () => {
    const secret = 'şifre-ığüöçİĞÜÖÇ';
    assert.equal(decryptSecret(encryptSecret(secret)), secret);
  });

  test('sifreli metin duz metni ICERMEZ', () => {
    const secret = 'gizli-token-12345';
    assert.ok(!encryptSecret(secret).includes(secret), 'duz metin sifreli ciktida gorunmemeli');
  });

  test('ayni deger her seferinde FARKLI sifrelenir (rastgele IV)', () => {
    const secret = 'ayni-deger';
    assert.notEqual(encryptSecret(secret), encryptSecret(secret));
  });

  test('kurcalanmis sifreli metin cozulemez (butunluk korumasi)', () => {
    const parts = encryptSecret('gizli').split('.');
    const ciphertextPart = parts[3];
    assert.ok(ciphertextPart);

    // Sifreli metnin son baytini boz
    const ciphertext = Buffer.from(ciphertextPart, 'base64');
    const lastIndex = ciphertext.length - 1;
    ciphertext[lastIndex] = (ciphertext[lastIndex] ?? 0) ^ 0xff;

    const tampered = [parts[0], parts[1], parts[2], ciphertext.toString('base64')].join('.');
    assert.throws(() => decryptSecret(tampered), /cozulemedi/i);
  });

  test('bozuk bicim acik hata verir', () => {
    assert.throws(() => decryptSecret('duz-metin'), /bicim gecersiz/i);
    assert.throws(() => decryptSecret('v2.a.b.c'), /bicim gecersiz/i);
  });

  test("maskeleme token'in kendisini sizdirmaz", () => {
    assert.equal(maskSecret('abcdefghijklmnop'), 'abcd••••mnop');
    assert.equal(maskSecret('kisa'), '••••');
  });
});
