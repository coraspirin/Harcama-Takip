import type { Migration } from '../migrate.ts';

export const migration007HomeAssistant: Migration = {
  id: 7,
  name: 'home_assistant',
  sql: `
    -- Kullanici basina Home Assistant baglanti ayarlari.
    --
    -- token_encrypted: AES-256-GCM ile SIFRELENMIS saklanir. Bu token HA
    -- kurulumunun TAMAMINA erisim verir (isik yakmaktan kamera goruntusune);
    -- veritabani sizsa bile duz metin durmamalidir.
    CREATE TABLE ha_settings (
      user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      base_url        TEXT    NOT NULL,
      token_encrypted TEXT    NOT NULL,
      notify_target   TEXT,
      enabled         INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      last_error      TEXT,
      last_success_at TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `,
};
