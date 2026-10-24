import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { debtService } from '../services/debts.ts';
import { ApiError } from '../services/api.ts';
import type { Debt, PayoffSummary } from '../types/index.ts';
import { Button } from './ui/Button.tsx';
import { Alert } from './ui/Alert.tsx';
import { Modal } from './ui/Modal.tsx';
import { MoneyInput } from './MoneyInput.tsx';
import { Money } from './Money.tsx';
import { formatDate, formatYearMonth } from '../lib/format.ts';

/** Tahmin ozetini tek cumleye cevirir. */
export function payoffSentence(forecast: PayoffSummary | null, lent = false): string {
  if (!forecast) return 'Kapatildi';
  switch (forecast.status) {
    case 'paid':
      return lent ? 'Tamami tahsil edildi' : 'Borc bitti';
    case 'no_payment':
      return lent
        ? 'Aylik beklenen tahsilat girilmedi'
        : 'Aylik odeme girin, bitis tarihini hesaplayalim';
    case 'never':
      return 'Aylik odeme faizi karsilamiyor: borc azalmiyor';
    case 'ends':
      return `Tahmini bitis: ${formatYearMonth(forecast.payoffMonth!)} (${forecast.months} ay)`;
  }
}

const SCHEDULE_PREVIEW = 24;

export function BorcDetayi({
  debt,
  onClose,
  onEdit,
  onChanged,
}: {
  debt: Debt;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const [extraKurus, setExtraKurus] = useState<number | null>(null);
  const detail = useAsync(() => debtService.detail(debt.id, extraKurus ?? 0), [debt.id, extraKurus]);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function removePayment(paymentId: number) {
    setError(null);
    try {
      await debtService.removePayment(debt.id, paymentId);
      await Promise.all([detail.reload(), onChanged()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    }
  }

  const data = detail.data;
  const lent = debt.direction === 'lent';
  const schedule = data?.schedule ?? [];
  const visibleSchedule = showAll ? schedule : schedule.slice(0, SCHEDULE_PREVIEW);

  return (
    <Modal
      open
      size="lg"
      title={debt.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden />
            Duzenle
          </Button>
          <Button onClick={onClose}>Kapat</Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-500">{lent ? 'Kalan alacak' : 'Guncel bakiye'}</p>
            <p className="mt-0.5 text-lg font-semibold">
              <Money kurus={debt.currentBalanceKurus} />
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {formatDate(debt.balanceDate)} bakiyesi
              {debt.paidSinceKurus > 0 && ' − sonraki odemeler'}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-500">{lent ? 'Tahsil edilen' : 'Odenen'} (toplam)</p>
            <p className="mt-0.5 text-lg font-semibold">
              <Money kurus={debt.paidTotalKurus} />
            </p>
            <p className="mt-0.5 text-xs text-slate-400">{debt.paymentCount} kayit</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Kalan tahmini faiz</p>
            <p className="mt-0.5 text-lg font-semibold">
              {debt.forecast?.totalInterestKurus != null ? (
                <Money kurus={debt.forecast.totalInterestKurus} />
              ) : (
                '—'
              )}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {debt.monthlyInterestBp > 0
                ? `aylik %${(debt.monthlyInterestBp / 100).toLocaleString('tr-TR')}${
                    debt.taxesIncluded ? ' + KKDF/BSMV' : ''
                  }`
                : 'faizsiz'}
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-700">{payoffSentence(debt.forecast, lent)}</p>

        {!lent && debt.forecast?.status !== 'paid' && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Ayda fazladan odersem?</h3>
            <div className="max-w-xs">
              <MoneyInput
                label="Aylik ek odeme"
                valueKurus={extraKurus}
                onChangeKurus={setExtraKurus}
                hint="Mevcut aylik odemenin USTUNE eklenecek tutar"
              />
            </div>
            {data && (extraKurus ?? 0) > 0 && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                {data.whatIf.improved.status === 'ends' ? (
                  <>
                    Borc <strong>{formatYearMonth(data.whatIf.improved.payoffMonth!)}</strong> ayinda
                    biter ({data.whatIf.improved.months} ay).
                    {data.whatIf.monthsSaved !== null && (
                      <>
                        {' '}
                        <strong>{data.whatIf.monthsSaved} ay</strong> erken ve yaklasik{' '}
                        <strong>
                          <Money kurus={data.whatIf.interestSavedKurus ?? 0} />
                        </strong>{' '}
                        daha az faiz.
                      </>
                    )}
                    {data.whatIf.base.status !== 'ends' &&
                      ' Mevcut odemeyle bitmeyen borc bu tutarla bitiyor.'}
                  </>
                ) : (
                  'Bu ek odemeyle de faiz karsilanamiyor; borc azalmiyor.'
                )}
              </div>
            )}
          </section>
        )}

        {schedule.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Tahmini odeme plani</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-2 font-medium">Ay</th>
                    <th className="pb-2 text-right font-medium">Faiz</th>
                    <th className="pb-2 text-right font-medium">Odeme</th>
                    <th className="pb-2 text-right font-medium">Kalan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleSchedule.map((row) => (
                    <tr key={row.month}>
                      <td className="py-1.5 text-slate-700">{formatYearMonth(row.month)}</td>
                      <td className="tabular py-1.5 text-right text-slate-500">
                        <Money kurus={row.interestKurus} />
                      </td>
                      <td className="tabular py-1.5 text-right">
                        <Money kurus={row.paymentKurus} />
                      </td>
                      <td className="tabular py-1.5 text-right font-medium">
                        <Money kurus={row.closingKurus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {schedule.length > SCHEDULE_PREVIEW && (
              <button
                className="mt-2 text-sm font-medium text-brand-600 hover:underline"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? 'Daha az goster' : `Tum ${schedule.length} ayi goster`}
              </button>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Tahminidir: bankalar faizi gun bazinda isletir. Ekstre veya banka uygulamasindaki
              bakiyeyi ara ara "Bakiye guncelle" ile girerek tahmini duzeltin.
            </p>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">
            {lent ? 'Tahsilatlar' : 'Odemeler'}
          </h3>
          {error && (
            <div className="mb-2">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
          {(data?.payments.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">Henuz kayit yok.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data!.payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900">
                      <Money kurus={payment.amountKurus} />
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {formatDate(payment.date)}
                      {payment.date <= debt.balanceDate && ' · bildirilen bakiyeye dahil'}
                      {payment.note && ` · ${payment.note}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void removePayment(payment.id)}
                    aria-label="Odemeyi sil"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
