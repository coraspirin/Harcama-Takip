import { api } from './api.ts';
import type { User } from '../types/index.ts';

export type SetupStatus = { setupCompleted: boolean };
export type MeResponse = { user: User; activeSessions: number };
export type UserResponse = { user: User };

export const authService = {
  setupStatus: () => api.get<SetupStatus>('/api/setup/status'),

  completeSetup: (input: { username: string; email?: string; password: string }) =>
    api.post<UserResponse>('/api/setup', input),

  login: (input: { username: string; password: string }) =>
    api.post<UserResponse>('/api/auth/login', input),

  me: () => api.get<MeResponse>('/api/auth/me'),

  logout: () => api.post<{ ok: boolean }>('/api/auth/logout'),

  logoutAll: () => api.post<{ ok: boolean; revokedSessions: number }>('/api/auth/logout-all'),

  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    api.post<UserResponse>('/api/auth/change-password', input),
};
