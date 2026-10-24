/**
 * Tum parasal tutarlar KURUS cinsinden tam sayi (integer) olarak tutulur.
 * Float kullanmak faiz ve taksit hesaplarinda yuvarlama hatasi biriktirir.
 * Ekrana cikarken TL'ye cevrilip formatlanir.
 */

const KURUS = 100;

/**
 * Kullanicidan gelen metni kurusa cevirir.
 * Kabul edilen bicimler:  "1.234,56"  "1234,56"  "1234.56"  "1234"  1234.56
 */
export function parseKurus(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Gecersiz tutar');
    return Math.round(input * KURUS);
  }

  let s = input.trim().replace(/\s|₺|TL/gi, '');
  if (s === '') throw new Error('Tutar bos olamaz');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    // Iki ayrac birlikte: sonda gelen ondalik ayracidir ("1.234,56" / "1,234.56")
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // Yalniz virgul: 2 haneli kuyruk ondalik, degilse binlik ayraci
    s = s.length - lastComma - 1 === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot !== -1) {
    if (s.length - lastDot - 1 === 3 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Gecersiz tutar: ${input}`);
  return Math.round(n * KURUS);
}

/** Kurusu "1.234,56" bicimine cevirir (sembol olmadan). */
export function formatKurus(kurus: number): string {
  const neg = kurus < 0;
  const abs = Math.abs(Math.trunc(kurus));
  const lira = Math.floor(abs / KURUS);
  const kr = abs % KURUS;
  const liraStr = lira.toLocaleString('tr-TR');
  return `${neg ? '-' : ''}${liraStr},${String(kr).padStart(2, '0')}`;
}

/** Kurusu "1.234,56 ₺" bicimine cevirir. */
export function formatTRY(kurus: number): string {
  return `${formatKurus(kurus)} ₺`;
}

/**
 * Toplam tutari n taksite boler. Taban tutar asagi yuvarlanir, artan kurus
 * ILK taksitlere birer birer dagitilir; boylece taksitlerin toplami her zaman
 * ana tutara esittir.  Ornek: 100000 / 3 -> [33334, 33333, 33333]
 */
export function splitInstallments(totalKurus: number, count: number): number[] {
  if (!Number.isInteger(totalKurus)) throw new Error('Tutar kurus cinsinden tam sayi olmali');
  if (!Number.isInteger(count) || count < 1) throw new Error('Taksit sayisi en az 1 olmali');

  const sign = totalKurus < 0 ? -1 : 1;
  const abs = Math.abs(totalKurus);
  const base = Math.floor(abs / count);
  const remainder = abs - base * count;

  return Array.from({ length: count }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/**
 * Tutara baz puan (basis point) cinsinden oran uygular.
 * 1 bp = %0.01  ->  aylik %3.11 faiz = 311 bp
 */
export function applyBasisPoints(amountKurus: number, bp: number): number {
  if (!Number.isInteger(amountKurus)) throw new Error('Tutar kurus cinsinden tam sayi olmali');
  return Math.round((amountKurus * bp) / 10_000);
}

/** Yuzde degisim; onceki deger 0 ise oran tanimsizdir (null doner). */
export function percentChange(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
