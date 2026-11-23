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

const MAX_DECIMALS_MESSAGE = 'En fazla 2 ondalık hane girilebilir';

/**
 * "1.234,56" / "1,234.56" / "1234.56" -> 123456 kurus (en fazla 2 ondalik hane).
 * Hesap string uzerinden yapilir (float yok); belirsiz/gecersiz girdi sessizce
 * yorumlanmaz, hata firlatilir.
 * - Yalniz virgul: her zaman ondalik ("1,005" hatadir).
 * - Yalniz nokta: "1.234" gibi gecerli gruplama binliktir, aksi halde ondalik.
 * - Ikisi birden: son gelen ondalik; onceki kisim gecerli binlik gruplamasi olmali.
 */
export function parseKurus(input: string): number {
  const cleaned = input.trim().replace(/\s|₺|TL/gi, '');
  if (cleaned === '') throw new Error('Tutar boş olamaz');

  const neg = cleaned.startsWith('-');
  const s = neg || cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) throw new Error('Geçersiz tutar');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const invalid = new Error('Geçersiz tutar');

  let intPart: string;
  let fracPart = '';

  if (lastComma !== -1 && lastDot !== -1) {
    const decIdx = Math.max(lastComma, lastDot);
    const thousandsSep = lastComma > lastDot ? '.' : ',';
    const head = s.slice(0, decIdx);
    const grouped = thousandsSep === '.' ? /^\d{1,3}(\.\d{3})+$/ : /^\d{1,3}(,\d{3})+$/;
    if (!grouped.test(head)) throw invalid;
    intPart = head.split(thousandsSep).join('');
    fracPart = s.slice(decIdx + 1);
    if (/[.,]/.test(fracPart)) throw invalid;
  } else if (lastComma !== -1) {
    if (lastComma !== s.indexOf(',')) throw invalid;
    intPart = s.slice(0, lastComma);
    fracPart = s.slice(lastComma + 1);
  } else if (lastDot !== -1) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      intPart = s.split('.').join('');
    } else {
      if (lastDot !== s.indexOf('.')) throw invalid;
      intPart = s.slice(0, lastDot);
      fracPart = s.slice(lastDot + 1);
    }
  } else {
    intPart = s;
  }

  if (fracPart.length > 2) throw new Error(MAX_DECIMALS_MESSAGE);

  const lira = intPart === '' ? 0 : Number(intPart);
  const total = lira * 100 + Number(fracPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(total)) throw invalid;
  return neg && total !== 0 ? -total : total;
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
