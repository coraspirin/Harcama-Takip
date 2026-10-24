import cron from 'node-cron';
import { env } from '../config/env.ts';
import { addDays, daysBetween, formatTR, todayIso } from '../lib/date.ts';
import { formatTRY } from '../lib/money.ts';
import { createNotification, listUnsentToHa, markSentToHa } from '../db/notifications.ts';
import { listAllUpcomingOccurrences } from '../db/scheduled.ts';
import { purgeExpiredTokens } from '../db/sessions.ts';
import { listEnabledHaSettings, recordHaResult } from '../db/haSettings.ts';
import { extendAllBillHorizons } from './scheduledService.ts';
import { decryptSecret } from './cryptoService.ts';
import { sendNotification } from './haNotificationService.ts';

/** Vadesine bu kadar gun kala uyari uretilir. */
export const REMINDER_DAYS_AHEAD = 3;

export type ScanResult = {
  notificationsCreated: number;
  billOccurrencesCreated: number;
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

  return { notificationsCreated, billOccurrencesCreated };
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
      void (async () => {
        try {
          const result = runDailyScan();
          purgeExpiredTokens();
          console.log(
            `[scheduler] gunluk tarama: ${result.notificationsCreated} bildirim, ` +
              `${result.billOccurrencesCreated} yeni fatura vadesi`,
          );

          // HA gonderimi ayri try icinde: basarisiz olsa da yukaridaki
          // uygulama-ici bildirimler yerinde kalir.
          try {
            const sent = await dispatchHomeAssistantNotifications();
            if (sent > 0) console.log(`[scheduler] ${sent} bildirim Home Assistant'a iletildi`);
          } catch (err) {
            console.error('[scheduler] Home Assistant gonderimi basarisiz:', err);
          }
        } catch (err) {
          // Zamanlanmis gorevdeki hata sunucuyu dusurmemeli
          console.error('[scheduler] gunluk tarama basarisiz:', err);
        }
      })();
    },
    { timezone: env.TZ },
  );

  console.log(`[scheduler] gunluk tarama 08:00 (${env.TZ}) icin planlandi`);
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
}
