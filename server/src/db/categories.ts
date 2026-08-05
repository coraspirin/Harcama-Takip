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
