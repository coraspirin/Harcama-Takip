import { getDb } from './connection.ts';
import { DEFAULT_CATEGORIES } from './defaultCategories.ts';

export type CategoryKind = 'income' | 'expense';
export type CategoryNature = 'fixed' | 'variable';

export type CategoryRow = {
  id: number;
  user_id: number;
  name: string;
  kind: CategoryKind;
  nature: CategoryNature;
  is_default: number;
  archived: number;
  created_at: string;
};

export function seedDefaultCategories(userId: number): void {
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO categories (user_id, name, kind, nature, is_default)
     VALUES (?, ?, ?, ?, 1)`,
  );
  for (const category of DEFAULT_CATEGORIES) {
    stmt.run(userId, category.name, category.kind, category.nature);
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

export function createCategory(
  userId: number,
  name: string,
  kind: CategoryKind,
  nature: CategoryNature = 'variable',
): CategoryRow {
  const result = getDb()
    .prepare(
      'INSERT INTO categories (user_id, name, kind, nature, is_default) VALUES (?, ?, ?, ?, 0)',
    )
    .run(userId, name, kind, nature);

  const created = findCategory(userId, Number(result.lastInsertRowid));
  if (!created) throw new Error('Kategori olusturuldu ancak okunamadi');
  return created;
}

export function updateCategory(
  userId: number,
  id: number,
  name: string,
  archived: boolean,
  nature: CategoryNature,
): CategoryRow | null {
  // kind degistirilemez: gecmis islemlerin isareti bozulmasin
  getDb()
    .prepare(
      'UPDATE categories SET name = ?, archived = ?, nature = ? WHERE user_id = ? AND id = ?',
    )
    .run(name, archived ? 1 : 0, nature, userId, id);
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
