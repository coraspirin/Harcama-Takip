/**
 * Uygulama genelinde tek hata tipi. Route'lar bunu firlatir, merkezi hata
 * middleware'i HTTP yanitina cevirir. Boylece her route'ta res.status(...)
 * tekrar etmez ve yanit sekli her yerde ayni olur.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Oturum acmaniz gerekiyor') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Bu islem icin yetkiniz yok') =>
  new AppError(403, 'FORBIDDEN', message);

/**
 * Baskasinin kaydina erisim denemesinde de bunu kullaniriz: 403 yerine 404
 * donmek, kaydin var olup olmadigini sizdirmaz.
 */
export const notFound = (message = 'Kayit bulunamadi') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);

export const tooManyRequests = (message = 'Cok fazla deneme yaptiniz, lutfen bekleyin') =>
  new AppError(429, 'TOO_MANY_REQUESTS', message);
