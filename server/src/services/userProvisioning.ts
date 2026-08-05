import { getDb } from '../db/connection.ts';
import { createUser, type CreateUserInput } from '../db/users.ts';
import { seedDefaultCategories } from '../db/categories.ts';
import type { UserRow } from '../types.ts';

/**
 * Yeni kullanici olusturmanin TEK dogru yolu. Hesap ve varsayilan kategoriler
 * tek transaction icinde olusur; kategorisiz bir kullanici olusamaz.
 *
 * Not: Burada olusturulan sey demo/ornek veri DEGILDIR - yalnizca kullanicinin
 * ilk islemini girebilmesi icin gereken kategori iskeletidir. Hesap, islem
 * veya butce kaydi olusturulmaz; kullanici bos durum ekraniyla karsilanir.
 */
export function provisionUser(input: CreateUserInput): UserRow {
  const db = getDb();

  db.exec('BEGIN');
  try {
    const user = createUser(input);
    if (user.role === 'user') seedDefaultCategories(user.id);
    db.exec('COMMIT');
    return user;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
