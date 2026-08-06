import {
  findTransferCandidates,
  linkAsTransfer,
  type TransferCandidateRow,
} from '../db/transactions.ts';
import { getMatchSettings } from '../db/matchSettings.ts';
import { foldTurkish } from './ocr/statementParser.ts';

/**
 * Kendi hesaplari arasindaki transferlerin bulunmasi.
 *
 * Neden ice aktarma aninda degil sonrasinda: A hesabinin ekstresi
 * yuklenirken B hesabindaki karsi bacak henuz sistemde olmayabilir. Bu yuzden
 * eslestirme UYGULANMIS islemler uzerinde calisir ve yukleme sirasindan
 * bagimsizdir.
 */

export type TransferCandidate = {
  expenseId: number;
  incomeId: number;
  amountKurus: number;
  expenseAccountId: number;
  expenseAccountName: string;
  expenseDate: string;
  expenseDescription: string;
  incomeAccountId: number;
  incomeAccountName: string;
  incomeDate: string;
  incomeDescription: string;
  dayDifference: number;
  /** Otomatik birlestirme kosullarinin tamamini sagliyor mu? */
  certain: boolean;
  /** Kesinlige yol acan sinyal; kullaniciya gerekce olarak gosterilir. */
  reason: string | null;
};

/** Kart odemesi kaliplari: en guclu "kendine transfer" kaniti. */
const CARD_PAYMENT_PATTERNS = ['k.karti odeme', 'kredi karti odeme', 'kart odeme'];

/** Acik "kendime" ifadeleri. */
const SELF_PATTERNS = ['kendime', 'kendi hesabim', 'hesaplarim arasi', 'virman'];

function daysBetween(a: string, b: string): number {
  const diff = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(Math.abs(diff) / 86_400_000);
}

function containsAny(haystack: string, needles: string[]): boolean {
  const folded = foldTurkish(haystack);
  return needles.some((needle) => folded.includes(foldTurkish(needle)));
}

/**
 * Bir cift icin "kendine transfer" sinyali arar.
 *
 * Tum karsilastirmalar foldTurkish ile yapilir: toLocaleLowerCase('tr')
 * "KENDIME"yi noktasiz i'ya cevirip eslemeyi sessizce bozardi.
 */
function selfTransferReason(
  row: TransferCandidateRow,
  aliases: string[],
): string | null {
  const both = `${row.expense_description ?? ''} ${row.income_description ?? ''}`;

  // En guclu kanit: karsi taraf kredi karti ve aciklama kart odemesi diyor.
  const involvesCard =
    row.income_account_type === 'credit_card' || row.expense_account_type === 'credit_card';
  if (involvesCard && containsAny(both, CARD_PAYMENT_PATTERNS)) {
    return 'Kredi karti odemesi';
  }

  if (containsAny(both, SELF_PATTERNS)) return 'Aciklamada "kendime/virman" geciyor';

  if (aliases.length > 0 && containsAny(both, aliases)) {
    return 'Aciklamada kendi adiniz geciyor';
  }

  return null;
}

function toCandidate(
  row: TransferCandidateRow,
  certain: boolean,
  reason: string | null,
): TransferCandidate {
  return {
    expenseId: row.expense_id,
    incomeId: row.income_id,
    amountKurus: row.amount_kurus,
    expenseAccountId: row.expense_account_id,
    expenseAccountName: row.expense_account_name,
    expenseDate: row.expense_date,
    expenseDescription: row.expense_description ?? '',
    incomeAccountId: row.income_account_id,
    incomeAccountName: row.income_account_name,
    incomeDate: row.income_date,
    incomeDescription: row.income_description ?? '',
    dayDifference: daysBetween(row.expense_date, row.income_date),
    certain,
    reason,
  };
}

/**
 * Aday ciftleri degerlendirir.
 *
 * OTOMATIK birlestirme icin UCU BIRDEN gerekir:
 *   1. tarih tam olarak ayni,
 *   2. TEK ADAYLIK - o gider icin tek gelir, o gelir icin tek gider adayi var,
 *   3. acik bir "kendine transfer" sinyali.
 *
 * Ikinci sart olmadan, ayni gun ayni tutarli iki ilgisiz islem (kullanicinin
 * verisinde 45.000 ve 34.000 gibi yuvarlak tutarlar sik tekrar ediyor) yanlis
 * eslesip GERCEK BIR GIDERI raporlardan silebilirdi.
 */
export function evaluateCandidates(
  rows: TransferCandidateRow[],
  aliases: string[],
): TransferCandidate[] {
  const expenseCounts = new Map<number, number>();
  const incomeCounts = new Map<number, number>();

  for (const row of rows) {
    expenseCounts.set(row.expense_id, (expenseCounts.get(row.expense_id) ?? 0) + 1);
    incomeCounts.set(row.income_id, (incomeCounts.get(row.income_id) ?? 0) + 1);
  }

  return rows.map((row) => {
    const unambiguous =
      expenseCounts.get(row.expense_id) === 1 && incomeCounts.get(row.income_id) === 1;
    const sameDay = row.expense_date === row.income_date;
    const reason = selfTransferReason(row, aliases);

    return toCandidate(row, sameDay && unambiguous && reason !== null, reason);
  });
}

function parseAliases(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 3);
}

export function listCandidates(userId: number): TransferCandidate[] {
  const settings = getMatchSettings(userId);
  const rows = findTransferCandidates(userId, settings.day_window);
  return evaluateCandidates(rows, parseAliases(settings.self_aliases));
}

export type AutoLinkResult = {
  linked: number;
  pending: number;
};

/**
 * Kesin adaylari otomatik birlestirir, kalanlari onay kuyrugunda birakir.
 *
 * Bir cift birlestirildikten sonra diger adaylar gecersizlesebilecegi icin
 * (satirlar artik transfer) her adimda baglanan id'ler isaretlenir.
 */
export function autoLinkTransfers(userId: number): AutoLinkResult {
  const settings = getMatchSettings(userId);
  const candidates = listCandidates(userId);

  if (settings.auto_link === 0) {
    return { linked: 0, pending: candidates.length };
  }

  const used = new Set<number>();
  let linked = 0;

  for (const candidate of candidates) {
    if (!candidate.certain) continue;
    if (used.has(candidate.expenseId) || used.has(candidate.incomeId)) continue;

    const groupId = linkAsTransfer(userId, candidate.expenseId, candidate.incomeId, 'auto');
    if (groupId === null) continue;

    used.add(candidate.expenseId);
    used.add(candidate.incomeId);
    linked++;
  }

  const pending = candidates.filter(
    (c) => !c.certain && !used.has(c.expenseId) && !used.has(c.incomeId),
  ).length;

  return { linked, pending };
}
