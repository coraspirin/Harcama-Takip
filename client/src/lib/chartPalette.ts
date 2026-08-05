/**
 * Grafik renk paleti ve ortak eksen/izgara ayarlari.
 *
 * Kategorik slotlar SABIT SIRAYLA atanir, dondurulmez: 9. bir kategori uretilmez,
 * "Diger" altinda toplanir. Renk kategoriye gore verilir, siraya gore degil.
 *
 * Palet, beyaz kart yuzeyine (#ffffff) karsi dogrulandi:
 *   - CVD ayrimi (en kotu komsu cift) ΔE 9.1  (hedef >= 8)
 *   - Normal gorus ΔE 19.6                     (taban >= 15)
 *   - Kontrast: aqua/sari/magenta 3:1 altinda -> yaninda MUTLAKA sayisal
 *     liste (tablo gorunumu) gosterilir; renk tek basina anlam tasimaz.
 */
export const CATEGORICAL_COLORS = [
  '#2a78d6', // mavi
  '#eb6834', // turuncu
  '#1baf7a', // deniz yesili
  '#eda100', // sari
  '#e87ba4', // magenta
  '#008300', // yesil
] as const;

/** Pasta/halka grafikte en fazla bu kadar dilim; gerisi "Diger"e katlanir. */
export const MAX_PIE_SLICES = 6;

/** Kalan dilimler icin notr gri (kategorik slot degildir). */
export const OTHER_COLOR = '#898781';

/**
 * Gelir/gider anlamsal cifti. Uygulamanin her yerinde tutarli olsun diye
 * tutar renkleriyle ayni; ikili olarak dogrulandi (CVD ΔE 8.6, normal 32.0,
 * ikisi de yuzeye karsi 3:1 uzerinde). Efsane + dogrudan etiket her zaman
 * bulundugu icin kimlik yalnizca renge birakilmaz.
 */
export const INCOME_COLOR = '#059669';
export const EXPENSE_COLOR = '#dc2626';

/** Grafik kromu - yuzeyden bir ton uzak, geri planda kalan degerler. */
export const CHART_CHROME = {
  surface: '#ffffff',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  text: '#0b0b0b',
} as const;

export function categoryColor(index: number): string {
  return CATEGORICAL_COLORS[index] ?? OTHER_COLOR;
}

/** Eksen etiketleri icin kisa tutar: 1250000 kurus -> "12,5 B" */
export function compactLira(kurus: number): string {
  const lira = kurus / 100;
  if (Math.abs(lira) >= 1_000_000) return `${(lira / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (Math.abs(lira) >= 1_000) return `${(lira / 1_000).toFixed(1).replace('.', ',')} B`;
  return String(Math.round(lira));
}
