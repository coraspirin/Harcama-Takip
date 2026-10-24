import type { Migration } from '../migrate.ts';

export const migration006Savings: Migration = {
  id: 6,
  name: 'savings',
  sql: `
    -- Birikim hedefleri (tatil, acil durum fonu, araba...).
    --
    -- Birikime ayrilan para GIDER DEGILDIR: harcanmadi, kenara kondu. Bu
    -- yuzden katkilar transactions'a degil savings_contributions'a yazilir;
    -- ay durumunda serbest paradan ayrica dusulur.
    CREATE TABLE savings_goals (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name               TEXT    NOT NULL,
      target_kurus       INTEGER NOT NULL CHECK (target_kurus > 0),
      -- Bos ise hedef tarihsizdir; ulasma tarihi mevcut tempoyla tahmin edilir.
      target_date        TEXT,
      -- Her ay ayirmayi planladigi tutar; serbest para hesabi bunu duser.
      monthly_plan_kurus INTEGER CHECK (monthly_plan_kurus IS NULL OR monthly_plan_kurus > 0),
      is_emergency_fund  INTEGER NOT NULL DEFAULT 0 CHECK (is_emergency_fund IN (0, 1)),
      note               TEXT,
      closed             INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
      created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_savings_goals_user ON savings_goals(user_id, closed);

    -- Eksi tutar hedeften cekistir (acil durumda kullanilan para).
    CREATE TABLE savings_contributions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      goal_id      INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
      date         TEXT    NOT NULL,
      amount_kurus INTEGER NOT NULL CHECK (amount_kurus <> 0),
      note         TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_savings_contributions_goal ON savings_contributions(user_id, goal_id, date);
  `,
};
