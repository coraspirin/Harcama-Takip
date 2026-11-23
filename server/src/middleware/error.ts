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
  'entity.verify.failed': { code: 'BAD_REQUEST', message: 'Istek govdesi dogrulanamadi' },
  'request.size.invalid': { code: 'BAD_REQUEST', message: 'Istek boyutu gecersiz' },
  'parameters.too.many': { code: 'PAYLOAD_TOO_LARGE', message: 'Cok fazla parametre' },
};

const CLIENT_ERROR_BY_STATUS: Record<number, ClientError> = {
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Istek govdesi cok buyuk' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Desteklenmeyen icerik tipi' },
};

/**
 * body-parser / http-errors kaynakli istemci hatalarini (4xx) tanir. Mesaj ve
 * govde istemciye/loga ASLA aktarilmaz: V8 JSON.parse mesaji ham govdeden
 * parca icerir.
 */
function clientErrorOf(err: unknown): (ClientError & { status: number }) | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { status?: unknown; statusCode?: unknown; type?: unknown };
  const raw = typeof e.status === 'number' ? e.status : e.statusCode;
  if (typeof raw !== 'number' || raw < 400 || raw > 499) return null;
  const byType = typeof e.type === 'string' ? CLIENT_ERROR_BY_TYPE[e.type] : undefined;
  const picked = byType ??
    CLIENT_ERROR_BY_STATUS[raw] ?? { code: 'BAD_REQUEST', message: 'Gecersiz istek' };
  return { status: raw, ...picked };
}

export function createErrorHandler(log: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
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

    // Istemci hatasi (bozuk/cok buyuk govde vb.): 4xx doner. Ayri log satiri
    // yazilmaz; pino-http zaten bu istek icin warn satiri yazar (cift satir
    // olmasin) ve hicbir satira err nesnesi/mesaji girmez.
    const client = clientErrorOf(err);
    if (client) {
      res.status(client.status).json({ error: { code: client.code, message: client.message } });
      return;
    }

    // Beklenmeyen hata: istemciye ic detay sizdirmayiz, sunucuya log dusuruz
    // (err, logger'in serializeErr'i ile govde/hassas alanlardan arindirilir).
    log.error({ event: 'unhandled_error', err }, 'beklenmeyen hata');
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Beklenmeyen bir hata olustu',
        details: env.isProd ? undefined : String((err as Error)?.stack ?? err),
      },
    });
  };
}

export const errorHandler: ErrorRequestHandler = createErrorHandler(defaultLogger);
