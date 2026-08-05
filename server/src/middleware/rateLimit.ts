import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env.ts';

/**
 * IPv6'da her aboneye genelde bir /64 blok verilir; ham adrese gore
 * sinirlamak, saldirganin blok icinde adres degistirerek limiti asmasina
 * izin verir. IPv6 adresleri /64 onekine indirgenir.
 */
function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  return `${ip.split(':').slice(0, 4).join(':')}::/64`;
}

/**
 * Testler varsayilan olarak limitten muaftir; aksi halde her test dosyasi
 * onceki testin sayacini miras alir. Rate limit'in kendisini test eden dosya
 * RATE_LIMIT_IN_TEST=1 ile limiti acar.
 */
function skipInTests(): boolean {
  return env.isTest && process.env.RATE_LIMIT_IN_TEST !== '1';
}

function jsonHandler(message: string): Options['handler'] {
  return (_req, res) => {
    res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message } });
  };
}

/**
 * Giris denemeleri: IP + kullanici adi birlikte anahtarlanir.
 * Yalnizca IP'ye bakmak, ayni ag arkasindaki mesru kullanicilari birbirine
 * kilitler; yalnizca kullanici adina bakmak ise saldirgana kullanici adini
 * degistirerek sinirsiz deneme imkani verir.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  // IPv6 normalizasyonu ipKey icinde yapildigi icin kutuphanenin kendi
  // dogrulamasi kapatilir (yalnizca bu limiter'da ozel keyGenerator var).
  validate: false,
  keyGenerator: (req) => {
    const username =
      typeof req.body?.username === 'string' ? req.body.username.toLowerCase().slice(0, 64) : '-';
    return `${ipKey(req.ip ?? '')}|${username}`;
  },
  handler: jsonHandler('Cok fazla giris denemesi yaptiniz. Lutfen 15 dakika sonra tekrar deneyin.'),
});

/** Kurulum ucu: tek seferlik olsa da kaba kuvvete karsi siniri vardir. */
export const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  handler: jsonHandler('Cok fazla kurulum denemesi. Lutfen daha sonra tekrar deneyin.'),
});

/** Token yenileme: mesru istemci 15 dakikada bir yeniler, limit genis tutulur. */
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  handler: jsonHandler('Cok fazla istek. Lutfen biraz bekleyin.'),
});

/** Sifre degistirme / sifirlama gibi hassas islemler. */
export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  handler: jsonHandler('Cok fazla istek. Lutfen biraz bekleyin.'),
});
