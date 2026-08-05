import { getDb } from './connection.ts';
import type { Role, UserRow } from '../types.ts';

/**
 * Kullanici adlari her zaman kucuk harfe cevrilerek saklanir ve aranir.
 * Turkce'ye ozgu I/i donusumu sorun cikarmasin diye kullanici adi karakter
 * kumesi zaten [a-z0-9._-] ile sinirlandirilmistir (bkz. validation.ts).
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function findUserById(id: number): UserRow | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ?? null;
}

export function findUserByUsername(username: string): UserRow | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(normalizeUsername(username)) as UserRow | undefined;
  return row ?? null;
}

export function usernameExists(username: string): boolean {
  return findUserByUsername(username) !== null;
}

export function emailExists(email: string): boolean {
  const row = getDb()
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(normalizeEmail(email)) as { id: number } | undefined;
  return row !== undefined;
}

export type CreateUserInput = {
  username: string;
  email?: string | null;
  passwordHash: string;
  role: Role;
  mustChangePassword?: boolean;
};

export function createUser(input: CreateUserInput): UserRow {
  const result = getDb()
    .prepare(
      `INSERT INTO users (username, email, password_hash, role, must_change_password)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      normalizeUsername(input.username),
      normalizeEmail(input.email),
      input.passwordHash,
      input.role,
      input.mustChangePassword ? 1 : 0,
    );

  const created = findUserById(Number(result.lastInsertRowid));
  if (!created) throw new Error('Kullanici olusturuldu ancak okunamadi');
  return created;
}

export function listUsers(): UserRow[] {
  return getDb()
    .prepare('SELECT * FROM users ORDER BY created_at DESC, id DESC')
    .all() as UserRow[];
}

export function countUsersByRole(role: Role): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE role = ?').get(role) as {
    n: number;
  };
  return Number(row.n);
}

export function setUserActive(id: number, isActive: boolean): void {
  getDb()
    .prepare(`UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isActive ? 1 : 0, id);
}

export function setUserPassword(
  id: number,
  passwordHash: string,
  mustChangePassword: boolean,
): void {
  getDb()
    .prepare(
      `UPDATE users
       SET password_hash = ?, must_change_password = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(passwordHash, mustChangePassword ? 1 : 0, id);
}

export function deleteUser(id: number): void {
  // Kullaniciya bagli tum veri ON DELETE CASCADE ile birlikte silinir.
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}
