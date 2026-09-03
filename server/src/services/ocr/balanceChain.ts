import type { ParsedLine } from './statementParser.ts';

/**
 * Ekstrenin BAKIYE sutunu bir saglama toplamidir.
 *
 * Ardisik iki satir arasinda su degismez gecerlidir (yeniden eskiye sirali bir
 * ekstrede):
 *
 *     bakiye[i] = bakiye[i+1] + isaretliTutar[i]
 *
 * Bu denetim, okunan tutarlarin dogrulugunu TAHMIN ETMEZ, kanitlar. Bir satir
 * hic okunamadiysa ya da tutari yanlis okunduysa zincir tam o noktada kopar ve
 * eksik tutar birebir hesaplanabilir. Boyle bir denetim olmadigi icin
 * "14 sayfalik ekstreden yalnizca 2 kayit cikti" durumunu uygulama degil
 * kullanici fark etmisti.
 */

export type ChainStatus = 'ok' | 'gaps' | 'unavailable';

export type ChainGap = {
  /** Kopuklugun tespit edildigi satirin dizideki sirasi (0 tabanli). */
  index: number;
  /** Beklenen ile bulunan bakiye arasindaki fark, kurus. Isaret yon verir. */
  differenceKurus: number;
};

export type ChainResult = {
  status: ChainStatus;
  gaps: ChainGap[];
  /** Kopukluklarin toplam mutlak buyuklugu, kurus. */
  totalGapKurus: number;
  /**
   * Zincirin cozuldugu siralama. 'desc': satirlar yeniden eskiye (Garanti),
   * 'asc': eskiden yeniye. Bakiye yoksa null.
   */
  order: 'asc' | 'desc' | null;
  /** Gercekten karsilastirilabilen ardisik satir gecisi sayisi. */
  checkedPairs: number;
  /**
   * Bakiyesi okunamadigi icin DOGRULANAMAYAN gecis sayisi.
   *
   * Bu deger raporlanmak zorunda: denetim, bakiyesi olmayan satirlari sessizce
   * atliyor. Kapsam belirtilmezse "zincir tutuyor" ifadesi, aslinda 14 satirin
   * yalnizca 2'sinin dogrulandigi bir ekstrede de temiz bir rapor gibi
   * okunurdu.
   */
  uncheckedPairs: number;
};

const EMPTY: ChainResult = {
  status: 'unavailable',
  gaps: [],
  totalGapKurus: 0,
  order: null,
  checkedPairs: 0,
  uncheckedPairs: 0,
};

function signedAmount(line: ParsedLine): number {
  return line.type === 'income' ? line.amountKurus : -line.amountKurus;
}

/**
 * Verilen siralama varsayimiyla zinciri denetler.
 *
 * 'desc' (yeniden eskiye): bakiye[i] = bakiye[i+1] + tutar[i]
 * 'asc'  (eskiden yeniye): bakiye[i] = bakiye[i-1] + tutar[i]
 */
function checkOrder(
  lines: ParsedLine[],
  order: 'asc' | 'desc',
): { gaps: ChainGap[]; checked: number; unchecked: number } {
  const gaps: ChainGap[] = [];
  let checked = 0;
  let unchecked = 0;

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]!;
    const previous = order === 'desc' ? lines[i + 1] : lines[i - 1];

    if (previous === undefined) continue;

    if (current.balanceKurus === null || previous.balanceKurus === null) {
      unchecked++;
      continue;
    }

    checked++;
    const expected = previous.balanceKurus + signedAmount(current);
    if (expected !== current.balanceKurus) {
      gaps.push({ index: i, differenceKurus: current.balanceKurus - expected });
    }
  }

  return { gaps, checked, unchecked };
}

/**
 * Bakiye zincirini denetler ve siralama yonunu KENDISI bulur.
 *
 * Yon sabit varsayilamaz: bankalarin bir kismi ekstreyi yeniden eskiye, bir
 * kismi eskiden yeniye yazar. Yanlis varsayim, saglam bir ekstrenin tamamini
 * kopuk gostererek denetimi degersizlestirirdi. Bu yuzden iki yon de denenir ve
 * az kopuk veren secilir.
 */
export function checkBalanceChain(lines: ParsedLine[]): ChainResult {
  const withBalance = lines.filter((line) => line.balanceKurus !== null);

  // Karsilastirilacak en az iki ardisik bakiye yoksa denetim yapilamaz.
  // Bu bir HATA DEGILDIR: her banka bakiye sutunu yazmaz.
  if (withBalance.length < 2) return EMPTY;

  const descending = checkOrder(lines, 'desc');
  const ascending = checkOrder(lines, 'asc');

  const [order, result] =
    descending.gaps.length <= ascending.gaps.length
      ? (['desc', descending] as const)
      : (['asc', ascending] as const);

  const totalGapKurus = result.gaps.reduce(
    (sum, gap) => sum + Math.abs(gap.differenceKurus),
    0,
  );

  return {
    status: result.gaps.length === 0 ? 'ok' : 'gaps',
    gaps: result.gaps,
    totalGapKurus,
    order,
    checkedPairs: result.checked,
    uncheckedPairs: result.unchecked,
  };
}
