import { getDb } from './connection.ts';

export type CategoryKind = 'income' | 'expense';

export type CategoryRow = {
  id: number;
  user_id: number;
  name: string;
  kind: CategoryKind;
  is_default: number;
  archived: number;
  created_at: string;
};

/**
 * Yeni kullanici olusturulurken eklenen varsayilan kategoriler.
 * Bu bir "demo veri" degildir: kullanicinin ilk islemini kategorisiz girmek
 * zorunda kalmamasi icin gereken minimum iskelet.
 */
export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind }[] = [
  { name: 'Market', kind: 'expense' },
  { name: 'Yemek', kind: 'expense' },
  { name: 'Ulasim', kind: 'expense' },
  { name: 'Fatura', kind: 'expense' },
  { name: 'Kira', kind: 'expense' },
  { name: 'Saglik', kind: 'expense' },
  { name: 'Giyim', kind: 'expense' },
  { name: 'Eglence', kind: 'expense' },
  { name: 'Egitim', kind: 'expense' },
  { name: 'Abonelik', kind: 'expense' },
  { name: 'Diger gider', kind: 'expense' },
  { name: 'Maas', kind: 'income' },
  { name: 'Ek gelir', kind: 'income' },
  { name: 'Yatirim geliri', kind: 'income' },
  { name: 'Diger gelir', kind: 'income' },
];

export function seedDefaultCategories(userId: number): void {
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO categories (user_id, name, kind, is_default)
     VALUES (?, ?, ?, 1)`,
  );
  for (const category of DEFAULT_CATEGORIES) {
    stmt.run(userId, category.name, category.kind);
  }
}

export function listCategories(userId: number, includeArchived = false): CategoryRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM categories
       WHERE user_id = ? AND (? = 1 OR archived = 0)
       ORDER BY kind, name COLLATE NOCASE`,
    )
    .all(userId, includeArchived ? 1 : 0) as CategoryRow[];
}

export function findCategory(userId: number, id: number): CategoryRow | null {
  const row = getDb()
    .prepare('SELECT * FROM categories WHERE user_id = ? AND id = ?')
    .get(userId, id) as CategoryRow | undefined;
  return row ?? null;
}

export function categoryExists(userId: number, id: number): boolean {
  return findCategory(userId, id) !== null;
}

export function categoryNameExists(
  userId: number,
  name: string,
  kind: CategoryKind,
  exceptId?: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM categories
       WHERE user_id = ? AND name = ? COLLATE NOCASE AND kind = ? AND id <> ?`,
    )
    .get(userId, name, kind, exceptId ?? -1) as { id: number } | undefined;
  return row !== undefined;
}

export function createCategory(userId: number, name: string, kind: CategoryKind): CategoryRow {
  const result = getDb()
    .prepare('INSERT INTO categories (user_id, name, kind, is_default) VALUES (?, ?, ?, 0)')
    .run(userId, name, kind);

  const created = findCategory(userId, Number(result.lastInsertRowid));
  if (!created) throw new Error('Kategori olusturuldu ancak okunamadi');
  return created;
}

export function updateCategory(
  userId: number,
  id: number,
  name: string,
  archived: boolean,
): CategoryRow | null {
  // kind degistirilemez: gecmis islemlerin isareti bozulmasin
  getDb()
    .prepare('UPDATE categories SET name = ?, archived = ? WHERE user_id = ? AND id = ?')
    .run(name, archived ? 1 : 0, userId, id);
  return findCategory(userId, id);
}

export function countCategoryUsage(userId: number, categoryId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND category_id = ?')
    .get(userId, categoryId) as { n: number };
  return Number(row.n);
}

/**
 * Kullanimda olan kategori SILINMEZ, arsivlenir: gecmis islemlerin kategorisi
 * kaybolmamali. Silme yalnizca hic kullanilmamis kategoriler icin gecerlidir.
 */
export function deleteCategory(userId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM categories WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return Number(result.changes) > 0;
}
