import type { IncomingMessage } from 'node:http';
import { pinoHttp } from 'pino-http';
import type { RequestHandler } from 'express';
import { logger } from '../lib/logger.ts';

/** Query string olmadan yol: arama metni gibi kullanici girdisi loga dusmesin. */
function pathOf(req: IncomingMessage & { originalUrl?: string }): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
}

/**
 * HTTP istek logu. Yalnizca method, yol (query yok), status, sure ve varsa
 * userId yazilir; govde, baslik ve cookie ASLA yazilmaz (serializer'lar
 * varsayilan olarak baslik iceren nesneyi daraltir).
 *
 * userId, istek BITTIginde okunur; boylece requireAuth'un req.user'i
 * doldurmasindan sonra dogru deger alinir.
 */
export const requestLogger: RequestHandler = pinoHttp<IncomingMessage & { user?: { id: number } }>({
  logger,
  // Docker 30 sn'de bir /api/health cagirir; log'u bogmasin.
  autoLogging: { ignore: (req) => pathOf(req) === '/api/health' },
  serializers: {
    req: (req: IncomingMessage) => ({ method: req.method, path: pathOf(req) }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode}`,
  customProps: (req) => {
    const userId = (req as { user?: { id: number } }).user?.id;
    return userId === undefined ? {} : { userId };
  },
  // Istek kimligi uretme: kullanilmiyor, satiri sisirmesin.
  genReqId: () => 0,
});
