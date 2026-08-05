import type { RequestHandler } from 'express';
import { ACCESS_COOKIE, verifyAccessToken } from '../lib/auth.ts';
import { AppError, forbidden, unauthorized } from '../lib/errors.ts';
import { findUserById } from '../db/users.ts';
import type { Role } from '../types.ts';

export type RequireAuthOptions = {
  /** Bos birakilirsa her rol gecer. */
  roles?: readonly Role[];
  /** Sifre degistirme ekraninin kendisi gibi, kilidi bypass etmesi gereken uclar. */
  allowPendingPasswordChange?: boolean;
};

/**
 * Access token'i dogrular ve kullaniciyi VERITABANINDAN tazeler.
 * Token'daki role/aktiflik bilgisine guvenmeyiz: super admin bir hesabi pasife
 * aldiginda, elindeki gecerli token ile islem yapmaya devam edememelidir.
 */
export function requireAuth(options: RequireAuthOptions = {}): RequestHandler {
  return (req, _res, next) => {
    const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    if (!token) return next(unauthorized());

    const payload = verifyAccessToken(token);
    if (!payload) return next(unauthorized('Oturum suresi doldu'));

    const user = findUserById(Number(payload.sub));
    if (!user) return next(unauthorized());
    if (user.is_active !== 1) return next(forbidden('Hesabiniz devre disi birakilmis'));

    if (options.roles && !options.roles.includes(user.role)) {
      return next(forbidden('Bu bolume erisim yetkiniz yok'));
    }

    if (user.must_change_password === 1 && !options.allowPendingPasswordChange) {
      return next(
        new AppError(
          403,
          'PASSWORD_CHANGE_REQUIRED',
          'Devam etmek icin sifrenizi degistirmelisiniz',
        ),
      );
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: user.must_change_password === 1,
    };
    next();
  };
}

/**
 * Normal kullanici uclari. super_admin bu middleware'den GECEMEZ: super admin'in
 * hicbir finansal veriye erisimi olmadigi kurali burada, backend'de zorlanir.
 */
export const requireUser: RequestHandler = requireAuth({ roles: ['user'] });

export const requireSuperAdmin: RequestHandler = requireAuth({ roles: ['super_admin'] });

/** Rol farketmeksizin oturum sarti (or. /auth/me, sifre degistirme). */
export const requireAnyRole: RequestHandler = requireAuth({ allowPendingPasswordChange: true });

/** req.user'i tip guvenli okumak icin; middleware'den sonra cagrilir. */
export function currentUser(req: { user?: import('../types.ts').AuthUser }) {
  if (!req.user) throw unauthorized();
  return req.user;
}
