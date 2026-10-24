import { addMonthsToYearMonth, todayIso, toYearMonth } from '../lib/date.ts';
import {
  currentBalanceKurus,
  listDebts,
  listInstallmentDebts,
  type DebtWithBalance,
  type InstallmentDebtRow,
} from '../db/debts.ts';
import { simulatePayoff, type Payoff, type PayoffInput } from './debtForecastService.ts';

/**
 * Tahminler bir SONRAKI aydan baslar: odeme gunu bilinmedigi icin bu ayin
 * odemesinin yapilip yapilmadigini varsaymayiz; yapildiysa odeme olarak
 * girilir ve bakiyeden zaten duser.
 */
export function forecastStartMonth(): string {
  return addMonthsToYearMonth(toYearMonth(todayIso()), 1);
}

export function payoffInput(row: DebtWithBalance): PayoffInput {
  return {
    balanceKurus: currentBalanceKurus(row),
    monthlyInterestBp: row.monthly_interest_bp,
    taxesIncluded: row.taxes_included === 1,
    paymentKurus: row.monthly_payment_kurus,
    startMonth: forecastStartMonth(),
  };
}

export function summarizePayoff(payoff: Payoff) {
  return {
    status: payoff.status,
    months: payoff.months,
    payoffMonth: payoff.payoffMonth,
    totalInterestKurus: payoff.totalInterestKurus,
    totalPaidKurus: payoff.totalPaidKurus,
    firstMonthInterestKurus: payoff.firstMonthInterestKurus,
  };
}

export function serializeDebt(row: DebtWithBalance) {
  const balance = currentBalanceKurus(row);
  return {
    id: row.id,
    kind: row.kind,
    direction: row.direction,
    name: row.name,
    counterparty: row.counterparty,
    originalKurus: row.original_kurus,
    reportedBalanceKurus: row.balance_kurus,
    balanceDate: row.balance_date,
    paidSinceKurus: Number(row.paid_since_kurus),
    currentBalanceKurus: balance,
    paidTotalKurus: Number(row.paid_total_kurus),
    paymentCount: Number(row.payment_count),
    lastPaymentDate: row.last_payment_date,
    monthlyInterestBp: row.monthly_interest_bp,
    taxesIncluded: row.taxes_included === 1,
    monthlyPaymentKurus: row.monthly_payment_kurus,
    note: row.note,
    closed: row.closed === 1,
    forecast: row.closed === 1 ? null : summarizePayoff(simulatePayoff(payoffInput(row))),
  };
}

export type SerializedDebt = ReturnType<typeof serializeDebt>;

export function serializeInstallment(row: InstallmentDebtRow) {
  return {
    itemId: row.item_id,
    name: row.name,
    remainingKurus: Number(row.remaining_kurus),
    remainingCount: Number(row.remaining_count),
    totalCount: row.total_count,
    nextDueDate: row.next_due_date,
    lastDueDate: row.last_due_date,
    monthlyKurus: row.monthly_kurus,
  };
}

/**
 * Borclar, taksitler ve toplamlar. Borclar sayfasi, ozet ekrani ve gidisat
 * raporu ayni hesabi kullanir.
 */
export function getDebtOverview(userId: number, includeClosed = false) {
  const debts = listDebts(userId, includeClosed).map(serializeDebt);
  const installments = listInstallmentDebts(userId).map(serializeInstallment);

  const openOwe = debts.filter((d) => !d.closed && d.direction === 'owe');
  const openLent = debts.filter((d) => !d.closed && d.direction === 'lent');

  // Borcsuz kalma ayi: tum borclarin ve taksitlerin en gec biten ayi.
  // Bitme tarihi hesaplanamayan bir borc varsa tarih verilmez; yanlis bir
  // iyimserlik yerine nedeni ekranda gosterilir.
  const unknown = openOwe.filter(
    (d) => d.forecast && d.forecast.status !== 'ends' && d.forecast.status !== 'paid',
  );
  const endMonths = [
    ...openOwe.map((d) => d.forecast?.payoffMonth).filter((m): m is string => !!m),
    ...installments.map((i) => i.lastDueDate?.slice(0, 7)).filter((m): m is string => !!m),
  ];
  const debtFreeMonth =
    unknown.length > 0 || endMonths.length === 0 ? null : [...endMonths].sort().at(-1)!;

  return {
    debts,
    installments,
    totals: {
      oweKurus:
        openOwe.reduce((sum, d) => sum + d.currentBalanceKurus, 0) +
        installments.reduce((sum, i) => sum + i.remainingKurus, 0),
      lentKurus: openLent.reduce((sum, d) => sum + d.currentBalanceKurus, 0),
      monthlyPaymentKurus:
        openOwe.reduce((sum, d) => sum + (d.monthlyPaymentKurus ?? 0), 0) +
        installments.reduce((sum, i) => sum + (i.monthlyKurus ?? 0), 0),
      remainingInterestKurus: openOwe.reduce(
        (sum, d) => sum + (d.forecast?.totalInterestKurus ?? 0),
        0,
      ),
      debtFreeMonth,
      unknownForecastCount: unknown.length,
    },
  };
}
