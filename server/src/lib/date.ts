import { env } from '../config/env.ts';

/**
 * Tarihler veritabaninda "YYYY-MM-DD" metni olarak tutulur ve tum aritmetik
 * bu metin uzerinden yapilir. Date nesnesi + saat dilimi karisimi, "ayin son
 * gunu" ve "vadesi bugun mu" gibi hesaplarda bir gun kaymalara yol acar.
 */
export type IsoDate = string; // YYYY-MM-DD
export type YearMonth = string; // YYYY-MM

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Yapilandirilmis saat diliminde bugunun tarihi. */
export function todayIso(): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** "2026-07-22" -> "22.07.2026" */
export function formatTR(iso: IsoDate): string {
  const [y, m, d] = iso.split('-') as [string, string, string];
  return `${d}.${m}.${y}`;
}

export function toYearMonth(iso: IsoDate): YearMonth {
  return iso.slice(0, 7);
}

/**
 * Ay ekler. Hedef ayda gun yoksa ayin son gunune sabitlenir:
 * 31.01 + 1 ay -> 28.02 (veya artik yilda 29.02)
 */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Iki tarih arasindaki tam gun farki (b - a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/** "2026-07" -> { start: "2026-07-01", end: "2026-07-31" } */
export function monthRange(ym: YearMonth): { start: IsoDate; end: IsoDate } {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(daysInMonth(y, m)).padStart(2, '0')}`,
  };
}

/** "2026-07" ve -1 -> "2026-06" */
export function addMonthsToYearMonth(ym: YearMonth, months: number): YearMonth {
  return toYearMonth(addMonths(`${ym}-01`, months));
}

/** ISO 8601 zaman damgasi (UTC) - created_at / updated_at alanlari icin. */
export function nowTimestamp(): string {
  return new Date().toISOString();
}
