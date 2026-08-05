import type { Migration } from '../migrate.ts';

export const migration001Auth: Migration = {
  id: 1,
  name: 'auth',
  sql: `
    -- Uygulama geneli anahtar/deger deposu. Su an yalnizca kurulum durumu
    -- ("setup_completed") icin kullanilir.
    CREATE TABLE app_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE users (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Kullanici adi uygulamada kucuk harfe cevrilerek saklanir; boylece
      -- Turkce buyuk/kucuk harf donusumu (I/i, İ/ı) sorun cikarmaz.
      username             TEXT    NOT NULL UNIQUE,
      email                TEXT    UNIQUE,
      password_hash        TEXT    NOT NULL,
      role                 TEXT    NOT NULL CHECK (role IN ('user', 'super_admin')),
      is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      -- Super admin sifreyi sifirladiginda 1 olur; kullanici degistirene kadar
      -- uygulamanin geri kalanina erisemez.
      must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Refresh token'lar veritabaninda HASH'li tutulur: veritabani sizsa bile
    -- token'lar dogrudan kullanilamaz. "Tum cihazlardan cikis" bu tablo
    -- olmadan mumkun degildir (JWT tek basina iptal edilemez).
    CREATE TABLE refresh_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT    NOT NULL UNIQUE,
      -- Ayni oturumun rotasyon zinciri. Iptal edilmis bir token tekrar
      -- kullanilirsa (calinma belirtisi) tum aile birden iptal edilir.
      family_id   TEXT    NOT NULL,
      expires_at  TEXT    NOT NULL,
      revoked_at  TEXT,
      user_agent  TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_refresh_tokens_user   ON refresh_tokens(user_id);
    CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);

    -- Super admin islem gunlugu. Hedef kullanici silinse bile kaydin anlamli
    -- kalmasi icin kullanici adlari metin olarak da kopyalanir.
    CREATE TABLE audit_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_username  TEXT    NOT NULL,
      action          TEXT    NOT NULL,
      target_user_id  INTEGER,
      target_username TEXT,
      details         TEXT,
      ip              TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
  `,
};
