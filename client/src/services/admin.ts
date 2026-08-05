import { api } from './api.ts';

export type AdminUser = {
  id: number;
  username: string;
  email: string | null;
  role: 'user' | 'super_admin';
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

export type AuditLog = {
  id: number;
  actorUserId: number | null;
  actorUsername: string;
  action: string;
  targetUserId: number | null;
  targetUsername: string | null;
  details: unknown;
  ip: string | null;
  createdAt: string;
};

export const adminService = {
  listUsers: () => api.get<{ users: AdminUser[] }>('/api/admin/users').then((r) => r.users),

  createUser: (input: {
    username: string;
    email?: string;
    password: string;
    mustChangePassword: boolean;
  }) => api.post<{ user: AdminUser }>('/api/admin/users', input).then((r) => r.user),

  setActive: (id: number, isActive: boolean) =>
    api.patch<{ user: AdminUser }>(`/api/admin/users/${id}/active`, { isActive }).then((r) => r.user),

  resetPassword: (id: number) =>
    api.post<{ temporaryPassword: string; note: string }>(`/api/admin/users/${id}/reset-password`),

  deleteUser: (id: number) => api.delete<{ deleted: boolean }>(`/api/admin/users/${id}`),

  auditLog: (page = 1, pageSize = 50) =>
    api.get<{
      logs: AuditLog[];
      pagination: { page: number; pageSize: number; total: number };
    }>(`/api/admin/audit-log?page=${page}&pageSize=${pageSize}`),
};

/** Islem gunlugundeki teknik kodlarin okunabilir karsiliklari. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'setup.super_admin_created': 'Super admin hesabi olusturuldu (kurulum)',
  'user.created': 'Kullanici olusturuldu',
  'user.activated': 'Kullanici aktif edildi',
  'user.deactivated': 'Kullanici devre disi birakildi',
  'user.deleted': 'Kullanici silindi',
  'user.password_reset': 'Sifre sifirlandi',
};
