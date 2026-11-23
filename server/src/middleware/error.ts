import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.ts';
import { env } from '../config/env.ts';
import type { Logger } from 'pino';
import { logger as defaultLogger } from '../lib/logger.ts';

function ensureError(err: unknown): unknown {
  return err ? err : new Error('Bilinmeyen hata');
}

/**
 * Express 4 async handler'lardan firlayan hatalari kendiliginden yakalamaz.
 * Her async route bu sarmalayiciyla kaydedilir.
 */
export function asyncHandler(fn: (...args: Parameters<RequestHandler>) => unknown): RequestHandler {
  return (req, res, next) => {
    // Senkron firlatilan hatalar da (ornegin zod parse) next'e iletilir.
    // Falsy (undefined/null/0/'') firlatmalar next()'e "hata yok" gibi gider;
    // bu yuzden Error'a sarilir.
    try {
      Promise.resolve(fn(req, res, next)).catch((err: unknown) => next(ensureError(err)));
    } catch (err) {
      next(ensureError(err));
    }
  };
}

/** Tanimsiz /api yollari icin JSON 404 (HTML fallback'e dusmesin). */
export const apiNotFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint bulunamadi' } });
};

type ClientError = { code: string; message: string };

const CLIENT_ERROR_BY_TYPE: Record<string, ClientError> = {
  'entity.parse.failed': { code: 'INVALID_JSON', message: 'Gecersiz JSON govdesi' },
  'entity.too.large': { code: 'PAYLOAD_TOO_LARGE', message: 'Istek govdesi cok buyuk' },
  'encoding.unsupported': { code: 'UNSUPPORTED_ENCODING', message: 'Desteklenmeyen kodlama' },
  'charset.unsupported': { code: 'UNSUPPORTED_CHARSET', message: 'Desteklenmeyen karakter seti' },
  'request.aborted': { code: 'REQUEST_ABORTED', message: 'Istek yarida kesildi' },
  'entity.verify.failed': { code: 'FORBIDDEN', message: 'Istek govdesi dogrulanamadi' },
  'request.size.invalid': { code: 'BAD_REQUEST', message: 'Istek boyutu gecersiz' },
  'parameters.too.many': { code: 'PAYLOAD_TOO_LARGE', message: 'Cok fazla parametre' },
};

const CLIENT_ERROR_BY_STATUS: Record<number, ClientError> = {
  400: { code: 'BAD_REQUEST', message: 'Gecersiz istek' },
  401: { code: 'UNAUTHORIZED', message: 'Kimlik dogrulamasi gerekli' },
  403: { code: 'FORBIDDEN', message: 'Bu islem icin yetkiniz yok' },
  404: { code: 'NOT_FOUND', message: 'Kaynak bulunamadi' },
  405: { code: 'METHOD_NOT_ALLOWED', message: 'Yontem desteklenmiyor' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Istek govdesi cok buyuk' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Desteklenmeyen icerik tipi' },
  429: { code: 'TOO_MANY_REQUESTS', message: 'Cok fazla istek' },
};

const DEFAULT_CLIENT_ERROR: ClientError = { code: 'BAD_REQUEST', message: 'Gecersiz istek' };

/**
 * Istemci hatasi (4xx) sayilanlar: (a) body-parser hatalari (err.type
 * CLIENT_ERROR_BY_TYPE'ta), (c) URIError + status 400 (bozuk URL kodlamasi) veya (b) http-errors deseni (expose === true ve
 * numerik status/statusCode 400-499). Baska "status alanli" hatalar (ornegin
 * upstream HTTP istemcisi 404'u) 5xx yoluna duser. Mesaj ve govde istemciye/loga
 * ASLA aktarilmaz: V8 JSON.parse mesaji ham govdeden parca icerir.
 */
function isUriError(err: Error): boolean {
  try {
    return err instanceof URIError;
  } catch {
    return false;
  }
}

function clientErrorOf(err: Error): (ClientError & { status: number; type: string | null }) | null {
  const e = err as { status?: unknown; statusCode?: unknown; type?: unknown; expose?: unknown };
  const raw = typeof e.status === 'number' ? e.status : e.statusCode;
  const status = typeof raw === 'number' && raw >= 400 && raw <= 499 ? raw : null;
  const type = typeof e.type === 'string' ? e.type : null;
  const byType = type !== null ? CLIENT_ERROR_BY_TYPE[type] : undefined;
  if (byType) return { ...byType, status: status ?? 400, type };
  // Express 4 decode_param: bozuk yol parametresinde URIError + status 400 (expose yok).
  if (isUriError(err) && status === 400) {
    return { ...CLIENT_ERROR_BY_STATUS[400]!, status, type: 'URIError' };
  }
  if (e.expose === true && status !== null) {
    return { ...(CLIENT_ERROR_BY_STATUS[status] ?? DEFAULT_CLIENT_ERROR), status, type };
  }
  return null;
}

export function createErrorHandler(log: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    if (err instanceof AppError) {
      if (err.status >= 500) {
        log.error(
          { event: 'app_error', code: err.code, status: err.status, err },
          'uygulama hatasi',
        );
      }
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details ?? undefined },
      });
      return;
    }

    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Gonderilen veri gecersiz',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }

    // Error olmayan deger (next('raw ...')): ham deger loga/yanita girmesin.
    const wrapped = err instanceof Error ? err : new Error('Error olmayan hata degeri');

    // Istemci hatasi: 4xx doner. Log'a err/mesaj girmez; yalnizca tur ve status.
    const client = clientErrorOf(wrapped);
    if (client) {
      log.warn({
        event: 'client_error',
        type: client.type === null ? null : client.type.slice(0, 100),
        status: client.status,
      });
      res.status(client.status).json({ error: { code: client.code, message: client.message } });
      return;
    }

    // Beklenmeyen hata: istemciye ic detay sizdirmayiz, sunucuya log dusuruz
    // (err, logger'in serializeErr'i ile allowlist'e indirgenir).
    log.error({ event: 'unhandled_error', err: wrapped }, 'beklenmeyen hata');
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Beklenmeyen bir hata olustu',
        details: env.isProd
          ? undefined
          : err instanceof Error
            ? String(err.stack ?? err.message)
            : `[${typeof err}]`,
      },
    });
  };
}

export const errorHandler: ErrorRequestHandler = createErrorHandler(defaultLogger);
