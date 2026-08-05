/** Uygulama genelinde paylasilan temel tipler. */

export const ROLES = ['user', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

/** Veritabanindaki ham users satiri. */
export type UserRow = {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  role: Role;
  is_active: number;
  must_change_password: number;
  created_at: string;
  updated_at: string;
};

/** Istemciye donen kullanici gorunumu - password_hash asla disari cikmaz. */
export type PublicUser = {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
  };
}

/** requireAuth sonrasi req.user'a yazilan oturum bilgisi. */
export type AuthUser = {
  id: number;
  username: string;
  role: Role;
  mustChangePassword: boolean;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
