/**
 * Ekranda gosterim yardimcilari. Sunucu tarafiyla ayni kurallar:
 * tutarlar kurus (integer) gelir, burada TL'ye cevrilip formatlanir.
 */

/** 123456 -> "1.234,56" */
export function formatKurus(kurus: number): string {
  const neg = kurus < 0;
  const abs = Math.abs(Math.trunc(kurus));
  const lira = Math.floor(abs / 100);
  const kr = abs % 100;
  return `${neg ? '-' : ''}${lira.toLocaleString('tr-TR')},${String(kr).padStart(2, '0')}`;
}

/** 123456 -> "1.234,56 ₺" */
export function formatTRY(kurus: number): string {
  return `${formatKurus(kurus)} ₺`;
}

/** "1.234,56" / "1234.56" -> 123456 kurus */
export function parseKurus(input: string): number {
  let s = input.trim().replace(/\s|₺|TL/gi, '');
  if (s === '') throw new Error('Tutar bos olamaz');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    s = s.length - lastComma - 1 === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot !== -1) {
    if (s.length - lastDot - 1 === 3 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('Gecersiz tutar');
  return Math.round(n * 100);
}

/** "2026-07-22" -> "22.07.2026" */
export function formatDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** ISO zaman damgasi -> "22.07.2026 14:30" */
export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

/** Bugunun tarihi "YYYY-MM-DD" (form varsayilanlari icin) */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** "2026-07" -> "Temmuz 2026" */
export function formatYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const label = new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(
    new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 1)),
  );
  return `${label} ${y}`;
}
