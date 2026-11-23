import cron from 'node-cron';
import { env } from '../config/env.ts';
import { addDays, daysBetween, formatTR, todayIso } from '../lib/date.ts';
import { formatTRY } from '../lib/money.ts';
import { createNotification, listUnsentToHa, markSentToHa } from '../db/notifications.ts';
import { listAllUpcomingOccurrences } from '../db/scheduled.ts';
import { purgeExpiredTokens } from '../db/sessions.ts';
import { listEnabledHaSettings, recordHaResult } from '../db/haSettings.ts';
import { autoConfirmDueOccurrences, extendAllBillHorizons } from './scheduledService.ts';
import { decryptSecret } from './cryptoService.ts';
import { sendNotification } from './haNotificationService.ts';
import { runInsightScan, type InsightResult } from './alertService.ts';
import { logger } from '../lib/logger.ts';
import { setLastScan } from './scanStatus.ts';

/** Vadesine bu kadar gun kala uyari uretilir. */
export const REMINDER_DAYS_AHEAD = 3;

export type ScanResult = {
  notificationsCreated: number;
  billOccurrencesCreated: number;
  autoConfirmed: number;
  insights: InsightResult;
};

/**
 * Uretilmis ve henuz iletilmemis bildirimleri Home Assistant uzerinden
 * telefona gonderir.
 *
 * Tasarim: uygulama-ici bildirim HER ZAMAN once olusur, HA yalnizca ek bir
 * CIKIS KANALIdir. HA kapali/erisilemez olsa da kullanici uyariyi uygulamada
 * gorur - bildirim kaybolmaz.
 */
export async function dispatchHomeAssistantNotifications(): Promise<number> {
  let sent = 0;

  for (const settings of listEnabledHaSettings()) {
    if (!settings.notify_target) continue;

    let token: string;
    try {
      token = decryptSecret(settings.token_encrypted);
    } catch (err) {
      recordHaResult(settings.user_id, (err as Error).message);
      continue;
    }

    const pending = listUnsentToHa(settings.user_id);
    if (pending.length === 0) continue;

    for (const notification of pending) {
      try {
        await sendNotification(
          settings.base_url,
          token,
          settings.notify_target,
          notification.title,
          notification.body ?? '',
        );
        markSentToHa(notification.id);
        sent++;
      } catch (err) {
        // Hata kullaniciya ayarlar ekraninda gosterilir; token loglanmaz.
        recordHaResult(settings.user_id, (err as Error).message.slice(0, 300));
        // Bu kullanici icin kalan bildirimleri deneme - buyuk olasilikla
        // hepsi ayni nedenle basarisiz olur.
        break;
      }
    }

    recordHaResult(settings.user_id, null);
  }

  return sent;
}

/**
 * Gunluk tarama. IDEMPOTENT: ayni gun icinde tekrar calistirilirsa yeni
 * bildirim uretmez (notifications.dedupe_key benzersizdir) ve mevcut vadeleri
 * cogaltmaz (scheduled_occurrences benzersiz indeksi).
 *
 * Bu, yalnizca bir zarafet degil gereklilik: container yeniden basladiginda
 * veya gorev elle tetiklendiginde kullanici ayni uyariyi ikinci kez gormemeli.
 */
export function runDailyScan(): ScanResult {
  const today = todayIso();
  const horizon = addDays(today, REMINDER_DAYS_AHEAD);

  const billOccurrencesCreated = extendAllBillHorizons();

  // Otomatik odenen abonelikler hatirlatmadan once kapatilir; vadesi gelmis
  // ama zaten odenmis bir kayit icin "bugun" uyarisi uretilmez.
  const autoConfirmed = autoConfirmDueOccurrences(today);

  let notificationsCreated = 0;

  for (const occurrence of listAllUpcomingOccurrences(horizon)) {
    const daysLeft = daysBetween(today, occurrence.due_date);
    const overdue = daysLeft < 0;

    const label =
      occurrence.kind === 'installment'
        ? 'Taksit'
        : occurrence.kind === 'bill'
          ? 'Fatura'
          : occurrence.direction === 'income'
            ? 'Alacak'
            : 'Odeme';

    const title = overdue
      ? `${label} gecikti: ${occurrence.item_name}`
      : daysLeft === 0
        ? `${label} bugun: ${occurrence.item_name}`
        : `${label} ${daysLeft} gun sonra: ${occurrence.item_name}`;

    const amountPart =
      occurrence.amount_kurus === null
        ? 'Tutar henuz girilmedi.'
        : `Tutar: ${formatTRY(occurrence.amount_kurus)}.`;

    const created = createNotification(occurrence.user_id, {
      type: overdue ? 'occurrence.overdue' : 'occurrence.due',
      title,
      body: `${amountPart} Vade: ${formatTR(occurrence.due_date)}`,
      relatedType: 'occurrence',
      relatedId: occurrence.id,
      dueDate: occurrence.due_date,
      // Gun basina tek uyari: gecikmis kayitlar her gun bir kez hatirlatir,
      // ayni gun icinde tekrar tekrar degil.
      dedupeKey: `occurrence:${occurrence.id}:${overdue ? 'overdue' : 'due'}:${today}`,
    });

    if (created) notificationsCreated++;
  }

  // Limit, anormal harcama ve ay kapanisi uyarilari
  const insights = runInsightScan(today);

  return { notificationsCreated, billOccurrencesCreated, autoConfirmed, insights };
}

export type ScheduledScanDeps = {
  scan: () => ScanResult;
  purgeTokens: () => number;
  dispatchHa: () => Promise<number>;
};

const defaultDeps: ScheduledScanDeps = {
  scan: runDailyScan,
  purgeTokens: purgeExpiredTokens,
  dispatchHa: dispatchHomeAssistantNotifications,
};

/**
 * Cron callback'inin govdesi (test edilebilsin diye ayri). Asla firlatmaz:
 * zamanlanmis gorevdeki hata sunucuyu dusurmemeli.
 *
 * Tarama basarili sayilir; HA gonderimi basarisiz olsa bile (HA yalnizca ek
 * cikis kanali) durum ok:true kalir ve ozet satirina haError:true yazilir.
 * Log satirlarina yalnizca sayaclar girer; kullanici verisi girmez.
 */
export async function runScheduledScan(deps: Partial<ScheduledScanDeps> = {}): Promise<void> {
  const { scan, purgeTokens, dispatchHa } = { ...defaultDeps, ...deps };
  const startedAt = Date.now();
  const at = new Date(startedAt).toISOString();

  try {
    const result = scan();
    const tokensPurged = purgeTokens();

    // HA gonderimi ayri try icinde: basarisiz olsa da yukaridaki
    // uygulama-ici bildirimler yerinde kalir.
    let haSent = 0;
    let haError = false;
    try {
      haSent = await dispatchHa();
    } catch (err) {
      haError = true;
      logger.warn({ event: 'daily_scan_ha', err }, 'Home Assistant gonderimi basarisiz');
    }

    const durationMs = Date.now() - startedAt;
    setLastScan({ at, ok: true, durationMs });
    logger.info(
      {
        event: 'daily_scan',
        durationMs,
        notificationsCreated: result.notificationsCreated,
        billOccurrencesCreated: result.billOccurrencesCreated,
        autoConfirmed: result.autoConfirmed,
        budgetAlerts: result.insights.budgetAlerts,
        anomalyAlerts: result.insights.anomalyAlerts,
        closingAlerts: result.insights.closingAlerts,
        haSent,
        haError,
        tokensPurged,
      },
      'gunluk tarama tamamlandi',
    );
  } catch (err) {
    setLastScan({ at, ok: false, durationMs: Date.now() - startedAt });
    logger.error({ event: 'daily_scan', err }, 'gunluk tarama basarisiz');
  }
}

let task: cron.ScheduledTask | null = null;

/**
 * Her sabah 08:00'de (yapilandirilmis saat diliminde) tarama yapar.
 * Testlerde zamanlayici baslatilmaz; tarama dogrudan runDailyScan ile olculur.
 */
export function startScheduler(): void {
  if (env.isTest || task) return;

  task = cron.schedule(
    '0 8 * * *',
    () => {
      runScheduledScan().catch((err: unknown) => {
        logger.error({ event: 'daily_scan_fatal', err }, 'gunluk tarama beklenmeyen hata');
      });
    },
    { timezone: env.TZ },
  );

  logger.info({ event: 'scheduler_started', tz: env.TZ }, 'gunluk tarama 08:00 icin planlandi');
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
}
