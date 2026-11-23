import { addDays, daysBetween, todayIso } from '../lib/date.ts';
import { foldTurkish } from '../lib/text.ts';
import { listSuggestionCandidates, type TransactionType } from '../db/transactions.ts';

const WINDOW_DAYS = 365;
const RECENT_DAYS = 90;
const MAX_CANDIDATES = 2000;
const MAX_SUGGESTIONS = 3;

export type CategorySuggestion = {
  categoryId: number;
  categoryName: string;
  confidence: number;
  matchCount: number;
};

/** Kucuk harf + Turkce sadelestirme; rakam/noktalama bosluk; 2 karakterden kisa token'lar atilir. */
export function tokenize(text: string): string[] {
  return foldTurkish(text.toLocaleLowerCase('tr-TR'))
    .replace(/[^\p{L}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length >= 2);
}

/**
 * Ham puan: birebir eslesme 3; aksi halde Jaccard >= 0.5 ise 1, ayrica sorgu
 * token'larindan biri islemin ilk token'iyla ayniysa +0.5 (Jaccard'dan bagimsiz).
 */
export function scoreMatch(query: string[], candidate: string[]): number {
  if (query.length === 0 || candidate.length === 0) return 0;
  if (query.join(' ') === candidate.join(' ')) return 3;

  const q = new Set(query);
  const c = new Set(candidate);
  let inter = 0;
  for (const t of q) if (c.has(t)) inter++;
  const union = q.size + c.size - inter;

  let score = 0;
  if (inter > 0 && inter / union >= 0.5) score += 1;
  if (q.has(candidate[0] as string)) score += 0.5;
  return score;
}

export function suggestCategories(
  userId: number,
  type: TransactionType,
  description: string,
): CategorySuggestion[] {
  const query = tokenize(description);
  if (query.length === 0) return [];

  const today = todayIso();
  const rows = listSuggestionCandidates(userId, type, addDays(today, -WINDOW_DAYS), MAX_CANDIDATES);

  const byCategory = new Map<number, { name: string; score: number; count: number }>();
  for (const row of rows) {
    let score = scoreMatch(query, tokenize(row.description));
    if (score <= 0) continue;
    if (daysBetween(row.date, today) <= RECENT_DAYS) score *= 1.5;

    const entry = byCategory.get(row.category_id) ?? {
      name: row.category_name,
      score: 0,
      count: 0,
    };
    entry.score += score;
    entry.count += 1;
    byCategory.set(row.category_id, entry);
  }

  const total = [...byCategory.values()].reduce((sum, e) => sum + e.score, 0);
  if (total === 0) return [];

  return [...byCategory.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[1].name.localeCompare(b[1].name, 'tr'))
    .slice(0, MAX_SUGGESTIONS)
    .map(([categoryId, e]) => ({
      categoryId,
      categoryName: e.name,
      confidence: Math.round((e.score / total) * 100) / 100,
      matchCount: e.count,
    }));
}
