export type Role = 'user' | 'super_admin';

export type User = {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
