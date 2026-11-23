import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.ts';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

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

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
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

  // Beklenmeyen hata: istemciye ic detay sizdirmayiz, sunucuya tam log dusuruz.
  logger.error({ event: 'unhandled_error', err }, 'beklenmeyen hata');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Beklenmeyen bir hata olustu',
      details: env.isProd ? undefined : String((err as Error)?.stack ?? err),
    },
  });
};
