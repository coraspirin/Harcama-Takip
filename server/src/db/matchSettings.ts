import { getDb } from './connection.ts';

export type MatchSettingsRow = {
  user_id: number;
  /** Transferin iki bacagi arasinda kac gun fark olabilir. 0 = ayni gun. */
  day_window: number;
  auto_link: number;
  /** Kullanicinin kendi ad yazimlari; satir veya virgulle ayrilir. */
  self_aliases: string;
  updated_at: string;
};

const DEFAULTS: Omit<MatchSettingsRow, 'user_id' | 'updated_at'> = {
  day_window: 0,
  auto_link: 1,
  self_aliases: '',
};

/** Kayit yoksa varsayilanlar doner; ayar ekrani acilmadan da calisir. */
export function getMatchSettings(userId: number): MatchSettingsRow {
  const row = getDb()
    .prepare('SELECT * FROM match_settings WHERE user_id = ?')
    .get(userId) as MatchSettingsRow | undefined;

  return row ?? { user_id: userId, ...DEFAULTS, updated_at: '' };
}

export type MatchSettingsInput = {
  dayWindow: number;
  autoLink: boolean;
  selfAliases: string;
};

export function saveMatchSettings(userId: number, input: MatchSettingsInput): void {
  getDb()
    .prepare(
      `INSERT INTO match_settings (user_id, day_window, auto_link, self_aliases)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         day_window = excluded.day_window,
         auto_link = excluded.auto_link,
         self_aliases = excluded.self_aliases,
         updated_at = datetime('now')`,
    )
    .run(userId, input.dayWindow, input.autoLink ? 1 : 0, input.selfAliases);
}
