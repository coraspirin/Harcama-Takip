import { getDb } from '../db/connection.ts';
import { foldTurkish } from './ocr/statementParser.ts';

/**
 * Gecmis islemlerden tekrar eden odemeleri bulur ve zamanlanmis kayit onerir.
 *
 * Iki mekanizma:
 *   a) EKSTRENIN KENDI YAZDIGI taksit imzasi ("03/03 TAKSIT") - en guvenilir,
 *      sira ve toplam dogrudan okunur.
 *   b) Istatistiksel tekrar - ayni imzali islemler aylik araliklarla tekrar
 *      ediyorsa fatura/planlanan odeme onerilir.
 *
 * Hicbir oneri kendiliginden kayit olusturmaz: zamanlanmis kayitlar bildirim
 * uretir ve onaysiz olusmasi gurultu yaratirdi.
 */

export type RecurrenceKind = 'installment' | 'bill' | 'planned';

export type RecurrenceSuggestion = {
  signature: string;
  kind: RecurrenceKind;
  /** Kullaniciya gosterilecek ad; imzanin okunabilir hali. */
  name: string;
  occurrences: number;
  /** Sabit tutarlilarda tutar, degiskenlerde ortalama. */
  amountKurus: number;
  amountVaries: boolean;
  firstDate: string;
  lastDate: string;
  averageIntervalDays: number;
  categoryId: number | null;
  accountId: number;
  /** Taksitte okunan sira/toplam ("03/03" -> 3 ve 3). */
  installmentSeq: number | null;
  installmentTotal: number | null;
};

/** "03/03 TAKSIT", "12/24 TAKSIT TAHS." gibi ifadeler. */
const INSTALLMENT_RE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*taksit/i;

/** En az kac tekrar goruldugunde oneri uretilir. */
const MIN_OCCURRENCES = 3;

/** Aylik sayilan aralik penceresi (gun). */
const MONTHLY_MIN = 25;
const MONTHLY_MAX = 35;

/** Tutar bu orandan fazla sapiyorsa "degisken tutarli" sayilir (bp). */
const FIXED_TOLERANCE_BP = 200; // %2

/**
 * Aciklamayi TEKRAR IMZASINA cevirir.
 *
 * Her ay degisen parcalar atilir: abone/fatura/referans numaralari. Bunlar
 * atilmazsa ayni fatura her ay farkli bir kayit gibi gorunur ve hicbir tekrar
 * tespit edilemez. Ornek:
 *   "SUPERONLINE Tes:0054438464 Fat:19844591604" -> "superonline"
 */
export function recurrenceSignature(description: string): string {
  return foldTurkish(description)
    // 4+ haneli sayi dizileri: abone/fatura/referans numarasi
    .replace(/\d{4,}/g, ' ')
    // Kalan kisa sayilar da ay/gun bilgisi tasiyabilir
    .replace(/\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Row = {
  id: number;
  account_id: number;
  category_id: number | null;
  amount_kurus: number;
  date: string;
  description: string | null;
};

function averageInterval(dates: string[]): number {
  if (dates.length < 2) return 0;
  const sorted = [...dates].sort();
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    total +=
      (Date.parse(`${sorted[i]}T00:00:00Z`) - Date.parse(`${sorted[i - 1]}T00:00:00Z`)) /
      86_400_000;
  }
  return Math.round(total / (sorted.length - 1));
}

function readableName(rows: Row[]): string {
  // Ham aciklamalardan en kisasi genelde en az gurultuluidur.
  const shortest = rows
    .map((row) => (row.description ?? '').trim())
    .filter((value) => value !== '')
    .sort((a, b) => a.length - b.length)[0];
  return (shortest ?? 'Bilinmeyen').slice(0, 80);
}

export function detectRecurrences(userId: number): RecurrenceSuggestion[] {
  const rows = getDb()
    .prepare(
      `SELECT id, account_id, category_id, amount_kurus, date, description
       FROM transactions
       WHERE user_id = ? AND type = 'expense'
       ORDER BY date`,
    )
    .all(userId) as Row[];

  const rejected = new Set(
    (
      getDb()
        .prepare('SELECT signature FROM recurrence_rejections WHERE user_id = ?')
        .all(userId) as { signature: string }[]
    ).map((row) => row.signature),
  );

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const signature = recurrenceSignature(row.description ?? '');
    if (signature.length < 3) continue;
    const group = groups.get(signature) ?? [];
    group.push(row);
    groups.set(signature, group);
  }

  const suggestions: RecurrenceSuggestion[] = [];

  for (const [signature, group] of groups) {
    if (group.length < MIN_OCCURRENCES) continue;
    if (rejected.has(signature)) continue;

    const dates = group.map((row) => row.date);
    const interval = averageInterval(dates);
    if (interval < MONTHLY_MIN || interval > MONTHLY_MAX) continue;

    const amounts = group.map((row) => row.amount_kurus);
    const max = Math.max(...amounts);
    const min = Math.min(...amounts);
    const average = Math.round(amounts.reduce((sum, value) => sum + value, 0) / amounts.length);
    // Sabit tutar: sapma ortalamanin binde 200'unden (%2) az.
    const amountVaries = max - min > Math.round((average * FIXED_TOLERANCE_BP) / 10_000);

    // Ekstre taksit ilerlemesini kendisi yaziyorsa dogrudan okunur.
    const installmentMatch = group
      .map((row) => INSTALLMENT_RE.exec(row.description ?? ''))
      .filter((match): match is RegExpExecArray => match !== null)
      .sort((a, b) => Number(b[1]) - Number(a[1]))[0];

    const kind: RecurrenceKind = installmentMatch
      ? 'installment'
      : amountVaries
        ? 'bill'
        : 'planned';

    const last = group[group.length - 1]!;

    suggestions.push({
      signature,
      kind,
      name: readableName(group),
      occurrences: group.length,
      amountKurus: amountVaries ? average : (amounts[0] ?? 0),
      amountVaries,
      firstDate: dates[0]!,
      lastDate: dates[dates.length - 1]!,
      averageIntervalDays: interval,
      categoryId: last.category_id,
      accountId: last.account_id,
      installmentSeq: installmentMatch ? Number(installmentMatch[1]) : null,
      installmentTotal: installmentMatch ? Number(installmentMatch[2]) : null,
    });
  }

  return suggestions.sort((a, b) => b.occurrences - a.occurrences);
}

export function rejectRecurrence(userId: number, signature: string): void {
  getDb()
    .prepare(
      `INSERT INTO recurrence_rejections (user_id, signature) VALUES (?, ?)
       ON CONFLICT(user_id, signature) DO NOTHING`,
    )
    .run(userId, signature);
}
