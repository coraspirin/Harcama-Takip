import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.ts';
import { env } from '../config/env.ts';

/**
 * Express 4 async handler'lardan firlayan hatalari kendiliginden yakalamaz.
 * Her async route bu sarmalayiciyla kaydedilir.
 */
export function asyncHandler(
  fn: (...args: Parameters<RequestHandler>) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
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

  // Dosya yukleme hatalari (multer) kullaniciya anlasilir sekilde donmeli
  const uploadCode = (err as { code?: string }).code;
  if (uploadCode === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      error: { code: 'FILE_TOO_LARGE', message: 'Dosya cok buyuk (en fazla 15 MB)' },
    });
    return;
  }
  if (err instanceof Error && err.message === 'Yalnizca PDF dosyasi yuklenebilir') {
    res.status(400).json({ error: { code: 'INVALID_FILE_TYPE', message: err.message } });
    return;
  }

  // Beklenmeyen hata: istemciye ic detay sizdirmayiz, sunucuya tam log dusuruz.
  console.error('[error]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Beklenmeyen bir hata olustu',
      details: env.isProd ? undefined : String((err as Error)?.stack ?? err),
    },
  });
};
