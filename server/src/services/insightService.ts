/**
 * Uyari esikleri ve takvim hesabi. Saf fonksiyonlardir; veritabani ve
 * bildirim uretimi alertService'tedir.
 */

/** Limitin bu yuzdesine gelince "yaklasiyor" uyarisi verilir. */
export const BUDGET_WARNING_PERCENT = 80;

export type BudgetAlertLevel = 'warning' | 'exceeded';

export function budgetAlertLevel(spentKurus: number, limitKurus: number): BudgetAlertLevel | null {
  if (limitKurus <= 0) return null;
  if (spentKurus > limitKurus) return 'exceeded';
  if (spentKurus * 100 >= limitKurus * BUDGET_WARNING_PERCENT) return 'warning';
  return null;
}

/** Bir kategori bu ay ortalamasinin bu katini gecerse anormal sayilir. */
export const ANOMALY_FACTOR = 1.5;
/** Ortalama icin en az bu kadar aylik veri gerekir; yoksa her ay "anormal" olur. */
export const ANOMALY_MIN_MONTHS = 3;
/** Kucuk kalemlerde gurultu olmasin: ortalamasi bunun altindaki kategoriler atlanir (200 TL). */
export const ANOMALY_MIN_AVERAGE_KURUS = 20_000;

export type Anomaly = {
  categoryId: number;
  currentKurus: number;
  averageKurus: number;
  /** Ortalamanin kac kati (1 ondalik) */
  ratio: number;
};

/**
 * Bu ayki kategori harcamasini gecmis aylarin ortalamasiyla karsilastirir.
 * Gecmis yalnizca kaydi olan aylardan olusur.
 */
export function detectAnomalies(
  current: Map<number, number>,
  history: Map<number, number[]>,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  for (const [categoryId, currentKurus] of current) {
    const past = history.get(categoryId) ?? [];
    if (past.length < ANOMALY_MIN_MONTHS) continue;
    const averageKurus = Math.round(past.reduce((a, b) => a + b, 0) / past.length);
    if (averageKurus < ANOMALY_MIN_AVERAGE_KURUS) continue;
    if (currentKurus > averageKurus * ANOMALY_FACTOR) {
      anomalies.push({
        categoryId,
        currentKurus,
        averageKurus,
        ratio: Math.round((currentKurus / averageKurus) * 10) / 10,
      });
    }
  }
  return anomalies.sort((a, b) => b.ratio - a.ratio);
}

// --- Takvim ---

export type CalendarPending = {
  id: number;
  name: string;
  direction: 'income' | 'expense';
  amountKurus: number | null;
  dueDate: string;
  overdue: boolean;
  /** Takvimde gorunur ama net akisa girmez */
  excludedFromBudget?: boolean;
};

export type CalendarDay = {
  date: string;
  incomeKurus: number;
  expenseKurus: number;
  pending: CalendarPending[];
  /**
   * Ay basindan bu gunun sonuna kadar net akis: gecmis gunlerde gerceklesen,
   * bugun ve sonrasinda gerceklesen + bekleyen. Hesap bakiyesi tutulmadigi
   * icin baslangic noktasi ay basidir.
   */
  cumulativeKurus: number;
  /** Ay basindan beri net akis eksiye dustu: nakdin sikistigi gun */
  tight: boolean;
};

/**
 * Ayin gunlerini kurar. Vadesi gecmis ama odenmemis kayitlar bugune
 * tasinir: o para hala odenecek. Gelecek gunlerde gerceklesmis islem
 * normalde yoktur; varsa (ileri tarihli giris) o da sayilir.
 */
export function buildCalendar(input: {
  month: string;
  daysInMonth: number;
  today: string;
  totalsByDay: Map<string, { incomeKurus: number; expenseKurus: number }>;
  pending: Omit<CalendarPending, 'overdue'>[];
}): CalendarDay[] {
  const isCurrentMonth = input.today.slice(0, 7) === input.month;
  const pendingByDay = new Map<string, CalendarPending[]>();

  for (const p of input.pending) {
    const overdue = p.dueDate < input.today;
    // Gecmis ayin goruntusunde bekleyenler kendi gununde kalir.
    const day = overdue && isCurrentMonth ? input.today : p.dueDate;
    if (day.slice(0, 7) !== input.month) continue;
    const list = pendingByDay.get(day) ?? [];
    list.push({ ...p, overdue });
    pendingByDay.set(day, list);
  }

  const days: CalendarDay[] = [];
  let cumulative = 0;

  for (let d = 1; d <= input.daysInMonth; d++) {
    const date = `${input.month}-${String(d).padStart(2, '0')}`;
    const totals = input.totalsByDay.get(date) ?? { incomeKurus: 0, expenseKurus: 0 };
    const pending = pendingByDay.get(date) ?? [];

    cumulative += totals.incomeKurus - totals.expenseKurus;
    // Bekleyenler yalnizca bugun ve sonrasinda tahmine girer; gecmis bir gunun
    // bekleyeni (gecmis ay) olmamis bir hareket olarak sayilmaz.
    if (date >= input.today) {
      for (const p of pending) {
        if (p.amountKurus === null || p.excludedFromBudget) continue;
        cumulative += p.direction === 'income' ? p.amountKurus : -p.amountKurus;
      }
    }

    days.push({
      date,
      incomeKurus: totals.incomeKurus,
      expenseKurus: totals.expenseKurus,
      pending,
      cumulativeKurus: cumulative,
      tight: cumulative < 0,
    });
  }

  return days;
}
