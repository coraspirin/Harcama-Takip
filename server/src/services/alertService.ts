import { addMonthsToYearMonth, toYearMonth, type IsoDate } from '../lib/date.ts';
import { formatTRY } from '../lib/money.ts';
import { createNotification } from '../db/notifications.ts';
import { listBudgets } from '../db/budgets.ts';
import { categoryMonthlyTotals } from '../db/reports.ts';
import { listActiveRegularUserIds } from '../db/users.ts';
import { budgetAlertLevel, detectAnomalies } from './insightService.ts';
import { getMonthClosing } from './closingService.ts';

/** Anormal harcama icin geriye bakilan ay sayisi (bu ay haric). */
const ANOMALY_HISTORY_MONTHS = 6;

export type InsightResult = {
  budgetAlerts: number;
  anomalyAlerts: number;
  closingAlerts: number;
};

/** Limit %80'e geldiginde ve asildiginda; her esik ayda bir kez. */
function scanBudgets(userId: number, today: IsoDate): number {
  const month = toYearMonth(today);
  let created = 0;

  for (const budget of listBudgets(userId, month)) {
    const level = budgetAlertLevel(budget.spent_kurus, budget.limit_kurus);
    if (!level) continue;

    const name = budget.category_id === null ? 'Genel aylik limit' : budget.category_name ?? 'Kategori';
    const percent = Math.round((budget.spent_kurus / budget.limit_kurus) * 100);
    const ok = createNotification(userId, {
      type: level === 'exceeded' ? 'budget.exceeded' : 'budget.warning',
      title:
        level === 'exceeded'
          ? `Limit asildi: ${name}`
          : `Limitin %${percent}'ine ulastiniz: ${name}`,
      body: `${formatTRY(budget.spent_kurus)} / ${formatTRY(budget.limit_kurus)} harcandi.`,
      relatedType: 'budget',
      relatedId: budget.id,
      // Ayni esik ayda bir kez; "asildi" ayrica gelir.
      dedupeKey: `budget:${budget.id}:${level}:${month}`,
    });
    if (ok) created++;
  }
  return created;
}

/** Kategori harcamasi gecmis ortalamasinin cok ustune ciktiginda; ayda bir kez. */
function scanAnomalies(userId: number, today: IsoDate): number {
  const month = toYearMonth(today);
  const rows = categoryMonthlyTotals(
    userId,
    addMonthsToYearMonth(month, -ANOMALY_HISTORY_MONTHS),
    month,
  );

  const current = new Map<number, number>();
  const history = new Map<number, number[]>();
  const names = new Map<number, string>();
  for (const row of rows) {
    names.set(row.category_id, row.category_name);
    if (row.year_month === month) {
      current.set(row.category_id, Number(row.total_kurus));
    } else {
      const list = history.get(row.category_id) ?? [];
      list.push(Number(row.total_kurus));
      history.set(row.category_id, list);
    }
  }

  let created = 0;
  for (const anomaly of detectAnomalies(current, history)) {
    const name = names.get(anomaly.categoryId) ?? 'Kategori';
    const ok = createNotification(userId, {
      type: 'spending.anomaly',
      title: `${name} harcamasi alisilmadik yuksek`,
      body:
        `Bu ay ${formatTRY(anomaly.currentKurus)}; son aylarin ortalamasi ` +
        `${formatTRY(anomaly.averageKurus)} (${anomaly.ratio.toLocaleString('tr-TR')} kat).`,
      relatedType: 'category',
      relatedId: anomaly.categoryId,
      dedupeKey: `anomaly:${anomaly.categoryId}:${month}`,
    });
    if (ok) created++;
  }
  return created;
}

/**
 * Onceki ayin kapanis ozeti. Ayin 1'ine bagli degildir: sunucu o gun kapali
 * olsa da sonraki ilk taramada bir kez uretilir.
 */
function scanClosing(userId: number, today: IsoDate): number {
  const previous = addMonthsToYearMonth(toYearMonth(today), -1);
  const closing = getMonthClosing(userId, previous);
  if (!closing.hasData) return 0;

  const parts = [
    `Gelir ${formatTRY(closing.incomeKurus)}, gider ${formatTRY(closing.expenseKurus)}, net ${formatTRY(closing.netKurus)}.`,
  ];
  if (closing.limit) {
    parts.push(closing.limit.kept ? 'Genel limite uyuldu.' : 'Genel limit asildi.');
  }
  if (closing.savedKurus > 0) parts.push(`Birikime ${formatTRY(closing.savedKurus)} ayrildi.`);
  if (closing.debtPaidKurus > 0) parts.push(`Borca ${formatTRY(closing.debtPaidKurus)} odendi.`);

  const ok = createNotification(userId, {
    type: 'month.closing',
    title: `Ay kapanisi: ${previous}`,
    body: parts.join(' '),
    relatedType: 'month',
    dedupeKey: `closing:${previous}`,
  });
  return ok ? 1 : 0;
}

/**
 * Tum aktif kullanicilar icin gunluk icgoru taramasi. IDEMPOTENT: her uyari
 * dedupe_key ile bir kez uretilir; gorev gunde kac kez calisirsa calissin.
 */
export function runInsightScan(today: IsoDate): InsightResult {
  const result: InsightResult = { budgetAlerts: 0, anomalyAlerts: 0, closingAlerts: 0 };
  for (const userId of listActiveRegularUserIds()) {
    result.budgetAlerts += scanBudgets(userId, today);
    result.anomalyAlerts += scanAnomalies(userId, today);
    result.closingAlerts += scanClosing(userId, today);
  }
  return result;
}
