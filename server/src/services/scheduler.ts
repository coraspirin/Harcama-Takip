import cron from 'node-cron';
import { env } from '../config/env.ts';
import { addDays, daysBetween, formatTR, todayIso } from '../lib/date.ts';
import { formatTRY } from '../lib/money.ts';
import { createNotification } from '../db/notifications.ts';
import { listAllUpcomingOccurrences } from '../db/scheduled.ts';
import { purgeExpiredTokens } from '../db/sessions.ts';
import { extendAllBillHorizons } from './scheduledService.ts';

/** Vadesine bu kadar gun kala uyari uretilir. */
export const REMINDER_DAYS_AHEAD = 3;

export type ScanResult = {
  notificationsCreated: number;
  billOccurrencesCreated: number;
};

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
      body: `${amountPart} Vade: ${formatTR(occurrence.due_date)} · Hesap: ${occurrence.account_name}`,
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
      try {
        const result = runDailyScan();
        purgeExpiredTokens();
        console.log(
          `[scheduler] gunluk tarama: ${result.notificationsCreated} bildirim, ` +
            `${result.billOccurrencesCreated} yeni fatura vadesi`,
        );
      } catch (err) {
        // Zamanlanmis gorevdeki hata sunucuyu dusurmemeli
        console.error('[scheduler] gunluk tarama basarisiz:', err);
      }
    },
    { timezone: env.TZ },
  );

  console.log(`[scheduler] gunluk tarama 08:00 (${env.TZ}) icin planlandi`);
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
}
