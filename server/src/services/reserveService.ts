import { type IsoDate, type YearMonth } from '../lib/date.ts';

/**
 * Seyrek giderlerin AYLIK PAYI ("kenara ayir").
 *
 * Kasko, emlak vergisi, yillik abonelik gibi uc aylik / yillik odemeler
 * geldigi ay butceyi sarsar. Tutar periyoda bolunup her ay kenara
 * ayrilirsa o ay surpriz olmaz. Saf fonksiyonlardir.
 */

export type ReservePeriod = 'monthly' | 'quarterly' | 'yearly';

const PERIOD_MONTHS: Record<ReservePeriod, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** Periyodik tutarin aylik karsiligi (kurusa yuvarlanir). */
export function monthlyEquivalent(amountKurus: number, period: ReservePeriod): number {
  return Math.round(amountKurus / PERIOD_MONTHS[period]);
}

export type ReserveItem = {
  id: number;
  name: string;
  period: ReservePeriod;
  /** Tahmini veya son odenen tutar; bilinmiyorsa null */
  amountKurus: number | null;
  /** Ilk vade; sonraki vadeler periyotla bundan turetilir */
  startDate: IsoDate;
};

function monthIndex(ym: YearMonth): number {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return y * 12 + (m - 1);
}

/**
 * Verilen ayda bu kalemin vadesi var mi? Uretilmis vade kayitlarina
 * bakilmaz: faturalar yalnizca belirli bir ufka kadar onceden uretilir ve
 * uzak bir ay icin kayit henuz olmayabilir.
 */
export function isDueInMonth(startDate: IsoDate, period: ReservePeriod, month: YearMonth): boolean {
  const diff = monthIndex(month) - monthIndex(startDate.slice(0, 7));
  return diff >= 0 && diff % PERIOD_MONTHS[period] === 0;
}

export type ReserveLine = ReserveItem & {
  monthlyShareKurus: number;
  /** Vadesi bu ay: tutarin tamami zaten bekleyen odemelerde */
  dueThisMonth: boolean;
};

export type Reserve = {
  items: ReserveLine[];
  /** Bu ay kenara ayrilmasi gereken toplam */
  monthlyKurus: number;
  /** Tutari bilinmedigi icin hesaba katilamayan kalem sayisi */
  unknownCount: number;
};

/**
 * Yalnizca aylik OLMAYAN kalemler hesaba katilir: aylik odemeler zaten her
 * ay bekleyen odemelerde gorunur. Vadesi bu ay olan kalemin payi o ay
 * ayrilmaz - tutarin tamami bekleyen odemelerdedir, iki kez dusulmez.
 */
export function calculateReserve(items: ReserveItem[], month: YearMonth): Reserve {
  const lines: ReserveLine[] = [];
  let unknownCount = 0;

  for (const item of items) {
    if (item.period === 'monthly') continue;
    if (item.amountKurus === null) {
      unknownCount++;
      continue;
    }
    lines.push({
      ...item,
      monthlyShareKurus: monthlyEquivalent(item.amountKurus, item.period),
      dueThisMonth: isDueInMonth(item.startDate, item.period, month),
    });
  }

  return {
    items: lines,
    monthlyKurus: lines
      .filter((line) => !line.dueThisMonth)
      .reduce((sum, line) => sum + line.monthlyShareKurus, 0),
    unknownCount,
  };
}
