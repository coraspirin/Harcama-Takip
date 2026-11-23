import { types } from 'node:util';
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

const MASKED_MESSAGE = '[gizlendi: JSON parse hatasi]';
const NON_ERROR_MESSAGE = '[Error olmayan deger]';
const MAX_TEXT = 2000;
const MAX_CAUSE_DEPTH = 3;
const MAX_AGGREGATE = 5;
/** Maskeleme icin zincir taramasinin (cause/aggregate) derinlik ve genislik siniri. */
const MAX_SCAN_DEPTH = 16;
const MAX_SCAN_AGGREGATE = 100;

function isErr(v: unknown): v is Error {
  return v instanceof Error || types.isNativeError(v);
}

/** Getter'i firlatabilen/tuhaf nesnelere karsi guvenli alan okuma. */
function get(obj: object, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function cap(v: string): string {
  return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}...[kirpildi]` : v;
}

function isParseError(err: Error): boolean {
  return get(err, 'type') === 'entity.parse.failed' || err instanceof SyntaxError;
}

function aggregateOf(err: Error): unknown[] {
  if (!(err instanceof AggregateError)) return [];
  const list = get(err, 'errors');
  return Array.isArray(list) ? list : [];
}

/** Hata ya da cause/aggregate zincirindeki herhangi biri JSON parse hatasi mi? */
function hasParseError(err: Error, depth = 0, seen = new Set<unknown>()): boolean {
  if (depth > MAX_SCAN_DEPTH || seen.has(err)) return false;
  seen.add(err);
  if (isParseError(err)) return true;
  const cause = get(err, 'cause');
  if (isErr(cause) && hasParseError(cause, depth + 1, seen)) return true;
  for (const inner of aggregateOf(err).slice(0, MAX_SCAN_AGGREGATE)) {
    if (isErr(inner) && hasParseError(inner, depth + 1, seen)) return true;
  }
  return false;
}

function nonErrorValue(v: unknown): Record<string, unknown> {
  return { type: typeof v, message: NON_ERROR_MESSAGE };
}

function serializeNode(err: Error, depth: number, seen: Set<unknown>): Record<string, unknown> {
  seen.add(err);
  const masked = hasParseError(err);
  const out: Record<string, unknown> = {};

  const type = get(err, 'type');
  const ctor = get(err, 'constructor');
  out.type =
    typeof type === 'string'
      ? cap(type)
      : typeof ctor === 'function' && typeof ctor.name === 'string'
        ? cap(ctor.name)
        : 'Error';
  const name = get(err, 'name');
  out.name = typeof name === 'string' ? cap(name) : 'Error';
  const message = get(err, 'message');
  out.message = masked ? MASKED_MESSAGE : typeof message === 'string' ? cap(message) : '';
  const stack = get(err, 'stack');
  if (!masked && typeof stack === 'string') out.stack = cap(stack);

  const code = get(err, 'code');
  if (typeof code === 'string') out.code = cap(code);
  else if (typeof code === 'number') out.code = code;
  const status = get(err, 'status');
  if (typeof status === 'number') out.status = status;
  const statusCode = get(err, 'statusCode');
  if (typeof statusCode === 'number') out.statusCode = statusCode;

  const cause = get(err, 'cause');
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    if (isErr(cause)) {
      if (!seen.has(cause)) out.cause = serializeNode(cause, depth + 1, seen);
    } else {
      out.cause = nonErrorValue(cause);
    }
  }

  const inner = aggregateOf(err);
  if (inner.length > 0) {
    out.aggregateCount = inner.length;
    out.aggregateErrors = inner.slice(0, MAX_AGGREGATE).map((item) => {
      if (!isErr(item)) return { name: typeof item, message: NON_ERROR_MESSAGE };
      const n = get(item, 'name');
      const m = get(item, 'message');
      const c = get(item, 'code');
      const entry: Record<string, unknown> = {
        name: typeof n === 'string' ? cap(n) : 'Error',
        message: hasParseError(item) ? MASKED_MESSAGE : typeof m === 'string' ? cap(m) : '',
      };
      if (typeof c === 'string') entry.code = cap(c);
      else if (typeof c === 'number') entry.code = c;
      return entry;
    });
  }
  return out;
}

/**
 * Hata serializer'i (allowlist). Cikti yalnizca type, name, message, stack,
 * code, status, statusCode, cause (en fazla 3 seviye) ve AggregateError icin
 * aggregateCount/aggregateErrors (ilk 5: name, message, code) alanlarini
 * icerir; baska hicbir alan (body, config, response, error, meta...) kopyalanmaz.
 *
 * Zincirde (kendisi, cause, aggregate) JSON parse hatasi varsa o hatanin ve onu
 * saran tum ust hatalarin message'i maskelenir, stack'i kaldirilir. Error
 * olmayan degerler (string, nesne...) hic yazilmaz; yalnizca typeof yazilir.
 */
export function serializeErr(err: unknown): unknown {
  if (!isErr(err)) return nonErrorValue(err);
  return serializeNode(err, 0, new Set());
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
