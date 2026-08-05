import type { Migration } from '../migrate.ts';

export const migration004Budgets: Migration = {
  id: 4,
  name: 'budgets',
  sql: `
    -- Kategori bazli aylik harcama limiti. Donem "YYYY-MM" metni olarak
    -- tutulur; her ay icin ayri kayit olusur, boylece gecmis aylarin limiti
    -- degistirilmeden korunur.
    CREATE TABLE budgets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      year_month  TEXT    NOT NULL,
      limit_kurus INTEGER NOT NULL CHECK (limit_kurus > 0),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_budgets_category_month
      ON budgets(user_id, category_id, year_month);

    CREATE INDEX idx_budgets_month ON budgets(user_id, year_month);
  `,
};
