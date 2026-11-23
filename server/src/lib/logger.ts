import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { env } from '../config/env.ts';

/**
 * Gizlilik: asagidaki yollar log satirinda "[Redacted]" ile degistirilir.
 * Parola, JWT/refresh token, cookie, Authorization basligi ve Home Assistant
 * token'i (sifreli/sifresiz) hicbir kosulda loglanmamalidir. Finansal veri
 * (tutar, aciklama, kategori adi) ise zaten log cagrilarina hic konmaz.
 *
 * pino'da `*` yalnizca TEK seviyeyi kapsar; bu yuzden kok ve bir seviye alt
 * ayri ayri listelenir.
 */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'authorization',
  'cookie',
  'password',
  'token',
  'token_encrypted',
  'password_hash',
  'accessToken',
  'refreshToken',
  'ha_token',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.token',
  '*.token_encrypted',
  '*.password_hash',
  '*.accessToken',
  '*.refreshToken',
  '*.ha_token',
  'err.body',
  '*.body',
];

/** err serilestirmesinde her kosulda dusurulen alanlar (govde/istek/yanit tasiyabilir). */
const ERR_DROPPED_FIELDS = [
  'body',
  'raw',
  'rawBody',
  'config',
  'request',
  'response',
  'headers',
] as const;

/**
 * Hata serializer'i. Standart pino ciktisindan govde tasiyabilen alanlari
 * dusurur; JSON parse hatalarinda (V8 mesaji ve stack'i govdenin bir parcasini
 * icerir) message/stack genel metinle degistirilir.
 */
export function serializeErr(err: unknown): unknown {
  const std = pino.stdSerializers.err(err as Error) as unknown as Record<string, unknown> | null;
  if (!std || typeof std !== 'object') return std;
  // Prototip uzerindeki alanlar (ornegin std serializer'in `raw`'i) da dusmeli;
  // bu yuzden yalnizca kendi alanlari temiz bir nesneye kopyalanir.
  const out: Record<string, unknown> = { ...std };
  for (const k of ERR_DROPPED_FIELDS) delete out[k];
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed' || err instanceof SyntaxError) {
    out.message = '[gizlendi: JSON parse hatasi]';
    delete out.stack;
  }
  return out;
}

/**
 * Logger'i olusturur. Test edilebilmesi icin hedef akis ve seviye disaridan
 * verilebilir; uygulama tek ornegi (`logger`) kullanir.
 */
export function createLogger(options: { level?: string; stream?: DestinationStream } = {}): Logger {
  const base: LoggerOptions = {
    level: options.level ?? (env.isTest ? 'silent' : env.LOG_LEVEL),
    redact: { paths: [...REDACT_PATHS], censor: '[Redacted]' },
    serializers: { err: serializeErr },
  };

  if (options.stream) return pino(base, options.stream);

  // Gelistirmede okunabilir cikti; uretimde (Docker json-file) duz JSON.
  if (!env.isProd && !env.isTest) {
    return pino({ ...base, transport: { target: 'pino-pretty', options: { colorize: true } } });
  }
  return pino(base);
}

export const logger: Logger = createLogger();
