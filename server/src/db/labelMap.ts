import { getDb } from './connection.ts';
import { foldTurkish } from '../services/ocr/statementParser.ts';

/**
 * Banka etiketi -> kullanicinin kategorisi eslemesi.
 *
 * Etiket, aksan/buyuk-kucuk harf duyarsiz olsun diye foldTurkish'ten
 * gecirilmis haliyle saklanir; boylece "Kira Odemesi" ile "KIRA ÖDEMESİ" ayni
 * kayda dusar ve kullaniciya iki kez sorulmaz.
 */

export type LabelMapRow = {
  id: number;
  user_id: number;
  parser_id: string;
  label: string;
  category_id: number | null;
  created_at: string;
};

/** parser_id icin etiket -> kategori haritasi (anahtar: foldTurkish'li etiket). */
export function listLabelMap(userId: number, parserId: string): Map<string, number | null> {
  const rows = getDb()
    .prepare('SELECT label, category_id FROM label_category_map WHERE user_id = ? AND parser_id = ?')
    .all(userId, parserId) as { label: string; category_id: number | null }[];

  return new Map(rows.map((row) => [row.label, row.category_id]));
}

export function listLabelMapRows(userId: number): LabelMapRow[] {
  return getDb()
    .prepare('SELECT * FROM label_category_map WHERE user_id = ? ORDER BY parser_id, label')
    .all(userId) as LabelMapRow[];
}

/**
 * Eslemeyi yazar/gunceller. categoryId null verilirse etiket "bilerek
 * kategorisiz" olarak isaretlenir ve bir daha sorulmaz.
 */
export function upsertLabelMap(
  userId: number,
  parserId: string,
  label: string,
  categoryId: number | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO label_category_map (user_id, parser_id, label, category_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, parser_id, label)
       DO UPDATE SET category_id = excluded.category_id`,
    )
    .run(userId, parserId, foldTurkish(label), categoryId);
}
