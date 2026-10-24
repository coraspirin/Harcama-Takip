import { getDb } from '../db/connection.ts';
import { addMonths, todayIso, toYearMonth } from '../lib/date.ts';
import { splitInstallments } from '../lib/money.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';
import {
  deleteTransaction,
  insertTransaction,
} from '../db/transactions.ts';
import {
  findOccurrence,
  findScheduledItem,
  insertOccurrence,
  insertScheduledItem,
  lastOccurrenceDate,
  listActiveBills,
  setOccurrenceStatus,
  type BillPeriod,
  type CreateScheduledItemInput,
  type ScheduledItemRow,
} from '../db/scheduled.ts';

/** Fatura vadeleri bu kadar ay ileriye kadar onceden uretilir. */
export const BILL_HORIZON_MONTHS = 12;

const PERIOD_MONTHS: Record<BillPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * Zamanlanmis kaydi ve VADELERINI tek transaction icinde olusturur.
 *
 * - planned     : tek vade, tutar belli
 * - installment : n aylik vade. Tutar splitInstallments ile bolunur; artan
 *                 kurus ilk taksitlere dagitilir, toplam daima korunur.
 * - bill        : periyoda gore ufka kadar vade. Tutar BOS birakilir,
 *                 kullanici fatura gelince girer.
 */
export function createScheduledItemWithOccurrences(
  userId: number,
  input: CreateScheduledItemInput,
): number {
  const db = getDb();

  db.exec('BEGIN');
  try {
    const itemId = insertScheduledItem(userId, input);

    if (input.kind === 'planned') {
      if (input.amountKurus === null) throw badRequest('Planlanan kayit icin tutar zorunlu');
      insertOccurrence(userId, itemId, input.startDate, input.amountKurus, null, null);
    } else if (input.kind === 'installment') {
      if (input.totalAmountKurus === null || input.installmentCount === null) {
        throw badRequest('Taksit icin toplam tutar ve taksit sayisi zorunlu');
      }
      const parts = splitInstallments(input.totalAmountKurus, input.installmentCount);
      parts.forEach((amount, index) => {
        insertOccurrence(
          userId,
          itemId,
          addMonths(input.startDate, index),
          amount,
          index + 1,
          input.installmentCount,
        );
      });
    } else {
      if (input.period === null) throw badRequest('Fatura icin periyot zorunlu');
      generateBillOccurrences(
        userId,
        itemId,
        input.startDate,
        input.period,
        input.amountKurus,
        input.endMonth ?? null,
      );
    }

    db.exec('COMMIT');
    return itemId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Faturanin vadelerini ufka (ve varsa bitis ayina, dahil) kadar doldurur.
 * Zaten var olan vadeler benzersiz indeks sayesinde atlanir, bu yuzden gonul
 * rahatligiyla tekrar cagrilabilir.
 */
export function generateBillOccurrences(
  userId: number,
  itemId: number,
  startDate: string,
  period: BillPeriod,
  estimatedAmountKurus: number | null,
  endMonth: string | null = null,
): number {
  const step = PERIOD_MONTHS[period];
  const horizon = addMonths(todayIso(), BILL_HORIZON_MONTHS);

  const last = lastOccurrenceDate(userId, itemId);
  let cursor = startDate;

  // Mevcut son vadeden devam et
  if (last !== null) {
    while (cursor <= last) cursor = addMonths(cursor, step);
  }

  let created = 0;
  // Ust sinir: sonsuz donguye karsi guvenlik
  for (let i = 0; cursor <= horizon && i < 200; i++) {
    if (endMonth !== null && toYearMonth(cursor) > endMonth) break;
    insertOccurrence(userId, itemId, cursor, estimatedAmountKurus, null, null);
    created++;
    cursor = addMonths(cursor, step);
  }

  return created;
}

/** Tum aktif faturalarin vade ufkunu tazeler (zamanlanmis gorevden cagrilir). */
export function extendAllBillHorizons(): number {
  let total = 0;
  for (const bill of listActiveBills()) {
    if (bill.period === null) continue;
    total += generateBillOccurrences(
      bill.user_id,
      bill.id,
      bill.start_date,
      bill.period,
      bill.amount_kurus,
      bill.end_month,
    );
  }
  return total;
}

export type ConfirmInput = {
  /** Faturada tutar vadesi gelince girilir; digerlerinde bos birakilabilir. */
  amountKurus?: number;
  /** Gercek odeme tarihi vadeden farkli olabilir. */
  date?: string;
};

/**
 * Vadeyi onaylar: gercek bir islem kaydi olusturur ve vadeye baglar.
 * Onaylanana kadar kayit raporlara girmez - bu fonksiyon o esigi gecirir.
 */
export function confirmOccurrence(userId: number, occurrenceId: number, input: ConfirmInput) {
  const occurrence = findOccurrence(userId, occurrenceId);
  if (!occurrence) throw notFound('Vade kaydi bulunamadi');
  if (occurrence.status === 'confirmed') throw conflict('Bu kayit zaten onaylanmis');

  const amountKurus = input.amountKurus ?? occurrence.amount_kurus;
  if (amountKurus === null || amountKurus <= 0) {
    throw badRequest('Onaylamak icin tutar girilmeli');
  }

  const item = findScheduledItem(userId, occurrence.scheduled_item_id);
  if (!item) throw notFound('Zamanlanmis kayit bulunamadi');

  const db = getDb();
  db.exec('BEGIN');
  try {
    const transactionId = insertTransaction(userId, {
      categoryId: item.category_id,
      type: item.direction,
      amountKurus,
      date: input.date ?? occurrence.due_date,
      description: buildDescription(item, occurrence.seq, occurrence.total_seq),
      source: 'scheduled',
      sourceRefId: occurrence.id,
    });

    setOccurrenceStatus(userId, occurrenceId, 'confirmed', transactionId, amountKurus);
    db.exec('COMMIT');
    return transactionId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Onayi geri alir: olusturulan islem silinir, vade tekrar bekliyor olur. */
export function unconfirmOccurrence(userId: number, occurrenceId: number): void {
  const occurrence = findOccurrence(userId, occurrenceId);
  if (!occurrence) throw notFound('Vade kaydi bulunamadi');
  if (occurrence.status !== 'confirmed') throw conflict('Bu kayit onaylanmamis');

  const db = getDb();
  db.exec('BEGIN');
  try {
    if (occurrence.transaction_id !== null) {
      deleteTransaction(userId, occurrence.transaction_id);
    }
    setOccurrenceStatus(userId, occurrenceId, 'pending', null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function buildDescription(
  item: ScheduledItemRow & { name: string },
  seq: number | null,
  totalSeq: number | null,
): string {
  if (seq !== null && totalSeq !== null) return `${item.name} (${seq}/${totalSeq})`;
  return item.name;
}
