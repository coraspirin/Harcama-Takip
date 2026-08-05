import crypto from 'node:crypto';
import { env } from '../config/env.ts';
import { AppError } from '../lib/errors.ts';

/**
 * Hassas alanlarin (su an yalnizca Home Assistant token'i) sifrelenmesi.
 *
 * AES-256-GCM secildi: yalnizca gizlilik degil BUTUNLUK de saglar - sifreli
 * metin kurcalanirsa cozme islemi hata verir, sessizce bozuk veri donmez.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM icin onerilen uzunluk
const PREFIX = 'v1';

function getKey(): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  } catch {
    key = Buffer.alloc(0);
  }

  if (key.length !== 32) {
    throw new AppError(
      500,
      'ENCRYPTION_KEY_INVALID',
      'ENCRYPTION_KEY gecerli degil. 32 baytlik base64 bir anahtar olmali. ' +
        'Uretmek icin: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  return key;
}

/** Sonuc bicimi: v1.<iv>.<authTag>.<ciphertext> (hepsi base64) */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new AppError(500, 'DECRYPT_FAILED', 'Saklanan gizli deger okunamadi (bicim gecersiz)');
  }

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(parts[1]!, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(parts[2]!, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(parts[3]!, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Anahtar degistiyse veya veri kurcalandiysa buraya duseriz.
    throw new AppError(
      500,
      'DECRYPT_FAILED',
      'Saklanan gizli deger cozulemedi. ENCRYPTION_KEY degistirilmis olabilir; ' +
        'bu durumda Home Assistant token\'ini yeniden girmeniz gerekir.',
    );
  }
}

/** Token'in kendisini degil, taninabilir bir ozetini gosterir. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
