import type { Request } from 'express';

/**
 * Cookie degerini guvenli okur. cookie-parser "j:" onekli degerleri JSON olarak
 * parse edip obje dondurebildiginden, string olmayan her deger "cookie yok"
 * sayilir; boylece bozuk cookie 500 yerine normal 401/yok akisina duser.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' ? value : undefined;
}
