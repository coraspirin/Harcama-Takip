import type { IncomingMessage } from 'node:http';
import { pinoHttp } from 'pino-http';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { logger as defaultLogger, serializeErr } from '../lib/logger.ts';

/** Query string olmadan yol: arama metni gibi kullanici girdisi loga dusmesin. */
function pathOf(req: IncomingMessage & { originalUrl?: string }): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
}

/**
 * HTTP istek logu. Yalnizca method, yol (query yok), status, sure ve varsa
 * userId yazilir; govde, baslik ve cookie ASLA yazilmaz (serializer'lar
 * varsayilan olarak baslik iceren nesneyi daraltir).
 *
 * Hata aldiysa errorType (hata kodu/turu) eklenir; ayri hata satiri yazilmaz.
 *
 * userId, istek BITTIginde okunur; boylece requireAuth'un req.user'i
 * doldurmasindan sonra dogru deger alinir.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  let syntheticErr = false;
  return pinoHttp<IncomingMessage & { user?: { id: number } }>({
    logger,
    // Docker 30 sn'de bir /api/health cagirir; log'u bogmasin.
    autoLogging: { ignore: (req) => pathOf(req) === '/api/health' },
    serializers: {
      // pino-http, ne err ne res.err varken 5xx'te sentetik 'failed with status
      // code' err'i uretir (logger.js: err || res.err || new Error(...)) ve onu
      // std serializer'dan gecirip duz nesne olarak verir. Sentetik durum, mesaj
      // oneki yerine customLogLevel'da (ham err/res gorulur) isaretlenir; log
      // cagrisi ayni senkron akista oldugu icin bayrak guvenlidir. errorHandler
      // zaten stack'li log yazdigi icin sentetik err dusurulur.
      err: (err: unknown) => (syntheticErr ? undefined : serializeErr(err)),
      req: (req: IncomingMessage) => ({ method: req.method, path: pathOf(req) }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => {
      syntheticErr = !err && !(res as { err?: unknown }).err && res.statusCode >= 500;
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
    // pino-http res 'finish'te loglar; errorHandler o ana dek res.locals.errorType'i
    // doldurmustur. Yalnizca kisa tur/kod; mesaj ve govde ASLA.
    customProps: (req, res) => {
      const userId = (req as { user?: { id: number } }).user?.id;
      const errorType = (res as { locals?: { errorType?: unknown } }).locals?.errorType;
      return {
        ...(userId === undefined ? {} : { userId }),
        ...(typeof errorType === 'string' ? { errorType } : {}),
      };
    },
    // Istek kimligi uretme: kullanilmiyor, satiri sisirmesin.
    genReqId: () => 0,
  });
}

export const requestLogger: RequestHandler = createRequestLogger(defaultLogger);
