import { useState } from 'react';
import { CalendarClock, Check, ChevronDown, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { categoryService } from '../services/finance.ts';
import { occurrenceService, scheduledService } from '../services/scheduled.ts';
import { ApiError } from '../services/api.ts';
import {
  BILL_PERIOD_LABELS,
  type BillPeriod,
  type Occurrence,
  type ScheduledItem,
  type ScheduledKind,
} from '../types/index.ts';
import { Button } from './ui/Button.tsx';
import { SelectField, TextField } from './ui/Field.tsx';
import { Alert } from './ui/Alert.tsx';
import { Card, EmptyState } from './ui/Card.tsx';
import { TekrarOnerileri } from './TekrarOnerileri.tsx';
import type { RecurrenceSuggestion } from '../services/matching.ts';
import { ConfirmDialog, Modal } from './ui/Modal.tsx';
import { MoneyInput } from './MoneyInput.tsx';
import { Money } from './Money.tsx';
import { formatDate, formatYearMonth, todayIso } from '../lib/format.ts';

/** Sekme: zamanlanmis kayit turu veya abonelik (sabit tutarli fatura). */
export type ScheduledView = ScheduledKind | 'subscription';

type Copy = {
  title: string;
  description: string;
  addLabel: string;
  emptyTitle: string;
  emptyDescription: string;
};

const COPY: Record<ScheduledView, Copy> = {
  planned: {
    title: 'Planlanan odemeler',
    description: 'Gelecekte yapilacak odemeler ve beklenen alacaklar',
    addLabel: 'Planlanan ekle',
    emptyTitle: 'Planlanan kayit yok',
    emptyDescription:
      'Ileri tarihli bir odeme veya alacagi buraya ekleyin; vadesi geldiginde uyarilirsiniz. Onaylayana kadar raporlara girmez.',
  },
  installment: {
    title: 'Taksitli odemeler',
    description: 'Taksitlerin ilerlemesi ve kalan borcunuz',
    addLabel: 'Taksit ekle',
    emptyTitle: 'Taksitli odeme yok',
    emptyDescription:
      'Toplam tutari ve taksit sayisini girin; aylik taksitler otomatik olusturulur.',
  },
  bill: {
    title: 'Faturalar',
    description: 'Duzenli tekrar eden faturalariniz',
    addLabel: 'Fatura ekle',
    emptyTitle: 'Fatura tanimi yok',
    emptyDescription:
      'Elektrik, su, internet gibi duzenli faturalarinizi tanimlayin; her donem icin odenecek kayit otomatik acilir.',
  },
  subscription: {
    title: 'Abonelikler',
    description: 'Her donem ayni tutarda tekrar eden odemeler',
    addLabel: 'Abonelik ekle',
    emptyTitle: 'Abonelik yok',
    emptyDescription:
      'Dizi platformu, muzik, spor salonu, telefon hatti gibi sabit tutarli odemelerinizi ekleyin; aylik ve yillik toplamini gorun.',
  },
};

const PERIOD_STEP: Record<BillPeriod, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Ilk vadeden yenilenme ayina kadar (dahil) kac odeme olusacagi. */
function countPayments(startDate: string, period: BillPeriod, endMonth: string): number {
  const [sy, sm] = startDate.split('-').map(Number) as [number, number];
  const [ey, em] = endMonth.split('-').map(Number) as [number, number];
  const span = ey * 12 + em - (sy * 12 + sm);
  return span < 0 ? 0 : Math.floor(span / PERIOD_STEP[period]) + 1;
}

function statusTone(occurrence: Occurrence, today: string): string {
  if (occurrence.status === 'confirmed') return 'text-emerald-600';
  if (occurrence.dueDate < today) return 'text-red-600';
  return 'text-slate-500';
}

function statusLabel(occurrence: Occurrence, today: string): string {
  if (occurrence.status === 'confirmed') return 'Odendi';
  if (occurrence.dueDate < today) return 'Gecikti';
  if (occurrence.dueDate === today) return 'Bugun';
  return 'Bekliyor';
}

export function ZamanlanmisListe({
  view,
  onChanged,
}: {
  view: ScheduledView;
  /** Kayit eklenip silindiginde ust sayfadaki ozetin tazelenmesi icin */
  onChanged?: () => void;
}) {
  const copy = COPY[view];
  const kind: ScheduledKind = view === 'subscription' ? 'bill' : view;
  const isSubscription = view === 'subscription';
  const today = todayIso();

  // Abonelikler ve faturalar ayni turdedir; bayrakla ayrilir.
  const items = useAsync(
    () =>
      scheduledService
        .list(kind)
        .then((rows) => (kind === 'bill' ? rows.filter((r) => r.isSubscription === isSubscription) : rows)),
    [kind, isSubscription],
  );
  const categories = useAsync(() => categoryService.list(), []);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<ScheduledItem | null>(null);
  const [amountModal, setAmountModal] = useState<Occurrence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // --- form ---
  const [name, setName] = useState('');
  const [direction, setDirection] = useState<'income' | 'expense'>('expense');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [counterparty, setCounterparty] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [amountKurus, setAmountKurus] = useState<number | null>(null);
  const [totalAmountKurus, setTotalAmountKurus] = useState<number | null>(null);
  const [installmentCount, setInstallmentCount] = useState('12');
  const [period, setPeriod] = useState<BillPeriod>('monthly');
  const [endMonth, setEndMonth] = useState('');
  const [excludeFromBudget, setExcludeFromBudget] = useState(false);

  // --- vade tutari girisi ---
  const [occurrenceAmount, setOccurrenceAmount] = useState<number | null>(null);
  const [occurrenceDate, setOccurrenceDate] = useState(today);

  function openCreate() {
    setName('');
    setDirection('expense');
    setCategoryId(null);
    setCounterparty('');
    setStartDate(today);
    setAmountKurus(null);
    setTotalAmountKurus(null);
    setInstallmentCount('12');
    setPeriod('monthly');
    setEndMonth('');
    setExcludeFromBudget(false);
    setError(null);
    setFormOpen(true);
  }

  /** Tekrar onerisini forma on-doldurur; kayit yine kullanici onayiyla olusur. */
  function useSuggestion(suggestion: RecurrenceSuggestion) {
    openCreate();
    setName(suggestion.name);
    setCategoryId(suggestion.categoryId);
    setAmountKurus(suggestion.amountKurus);
    setPeriod('monthly');

    if (suggestion.installmentTotal !== null) {
      setInstallmentCount(String(suggestion.installmentTotal));
      setTotalAmountKurus(suggestion.amountKurus * suggestion.installmentTotal);
    }
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await scheduledService.create({
        kind,
        name: name.trim(),
        direction: kind === 'planned' ? direction : 'expense',
        categoryId,
        counterparty: counterparty.trim() || null,
        description: null,
        startDate,
        excludeFromBudget: kind !== 'planned' && excludeFromBudget,
        ...(kind === 'planned' && { amountKurus }),
        ...(kind === 'installment' && {
          totalAmountKurus,
          installmentCount: Number(installmentCount),
        }),
        ...(kind === 'bill' && {
          period,
          amountKurus,
          isSubscription,
          endMonth: isSubscription && endMonth ? endMonth : null,
        }),
      });
      setFormOpen(false);
      await items.reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await scheduledService.remove(deleting.id);
      setNotice(
        res.keptTransactions > 0
          ? `Kayit silindi. Onaylanmis ${res.keptTransactions} islem korundu — gerceklesmis harcamalar raporlarinizda kaliyor.`
          : 'Kayit silindi.',
      );
      setDeleting(null);
      await items.reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(occurrence: Occurrence) {
    // Fatura gibi tutari olmayan kayitlarda once tutar sorulur
    if (occurrence.amountKurus === null) {
      setOccurrenceAmount(null);
      setOccurrenceDate(occurrence.dueDate);
      setAmountModal(occurrence);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await occurrenceService.confirm(occurrence.id);
      await items.reload();
      setExpandedId(occurrence.scheduledItemId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Onaylanamadi');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmWithAmount() {
    if (!amountModal || occurrenceAmount === null) {
      setError('Tutar girin');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await occurrenceService.confirm(amountModal.id, {
        amountKurus: occurrenceAmount,
        date: occurrenceDate,
      });
      setAmountModal(null);
      await items.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Onaylanamadi');
    } finally {
      setBusy(false);
    }
  }

  async function handleBudgetToggle(item: ScheduledItem, exclude: boolean) {
    setBusy(true);
    setError(null);
    try {
      await scheduledService.setExcludeFromBudget(item.id, exclude);
      await items.reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnconfirm(occurrence: Occurrence) {
    setBusy(true);
    setError(null);
    try {
      await occurrenceService.unconfirm(occurrence.id);
      await items.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Geri alinamadi');
    } finally {
      setBusy(false);
    }
  }

  const list = items.data ?? [];
  const availableCategories = (categories.data ?? []).filter((c) =>
    kind === 'planned' ? c.kind === direction : c.kind === 'expense',
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-500">{copy.description}</p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden />
          {copy.addLabel}
        </Button>
      </div>

      {(items.error || error) && (
        <div className="mb-4">
          <Alert tone="error">{items.error ?? error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}

      {view !== 'planned' && <TekrarOnerileri kind={view} onUse={useSuggestion} />}

      {!items.loading && list.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                {copy.addLabel}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((item) => (
            <ScheduledCard
              key={item.id}
              item={item}
              kind={kind}
              today={today}
              expanded={expandedId === item.id}
              busy={busy}
              onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onDelete={() => setDeleting(item)}
              onConfirm={handleConfirm}
              onUnconfirm={handleUnconfirm}
              onBudgetToggle={(exclude) => handleBudgetToggle(item, exclude)}
            />
          ))}
        </div>
      )}

      {/* --- Kayit formu --- */}
      <Modal
        open={formOpen}
        title={copy.addLabel}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>
              Vazgec
            </Button>
            <Button loading={busy} onClick={() => void handleSave()}>
              Kaydet
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField
            label="Ad"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              isSubscription
                ? 'Ornek: Dizi platformu'
                : kind === 'bill'
                  ? 'Ornek: Elektrik'
                  : kind === 'installment'
                    ? 'Ornek: Telefon'
                    : ''
            }
            autoFocus
            required
          />

          {kind === 'planned' && (
            <SelectField
              label="Tur"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as 'income' | 'expense');
                setCategoryId(null);
              }}
            >
              <option value="expense">Odeme (gider)</option>
              <option value="income">Alacak (gelir)</option>
            </SelectField>
          )}

          {kind === 'installment' ? (
            <>
              <MoneyInput
                label="Toplam tutar"
                valueKurus={totalAmountKurus}
                onChangeKurus={setTotalAmountKurus}
                hint="Taksitlere bolunecek toplam"
                required
              />
              <TextField
                label="Taksit sayisi"
                type="number"
                min={2}
                max={120}
                value={installmentCount}
                onChange={(e) => setInstallmentCount(e.target.value)}
                required
              />
            </>
          ) : kind === 'bill' ? (
            <>
              <SelectField
                label="Periyot"
                value={period}
                onChange={(e) => setPeriod(e.target.value as BillPeriod)}
              >
                {Object.entries(BILL_PERIOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>
              {isSubscription ? (
                <MoneyInput
                  label="Tutar"
                  valueKurus={amountKurus}
                  onChangeKurus={setAmountKurus}
                  hint="Her donem odenen sabit tutar"
                  required
                />
              ) : (
                <MoneyInput
                  label="Tahmini tutar"
                  valueKurus={amountKurus}
                  onChangeKurus={setAmountKurus}
                  hint="Istege bagli. Uc aylik / yillik faturada aylik pay bununla hesaplanir; bos ise son odenen tutar kullanilir."
                />
              )}
            </>
          ) : (
            <MoneyInput
              label="Tutar"
              valueKurus={amountKurus}
              onChangeKurus={setAmountKurus}
              required
            />
          )}

          <TextField
            label={kind === 'installment' ? 'Ilk taksit tarihi' : kind === 'bill' ? 'Ilk vade tarihi' : 'Vade tarihi'}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />

          {isSubscription && (
            <TextField
              label="Yenilenme ayi"
              type="month"
              value={endMonth}
              min={startDate.slice(0, 7)}
              onChange={(e) => setEndMonth(e.target.value)}
              hint={
                endMonth
                  ? `${formatYearMonth(startDate.slice(0, 7))} – ${formatYearMonth(endMonth)} arasi ${countPayments(startDate, period, endMonth)} odeme olusur (yenilenme ayi dahil).`
                  : 'Istege bagli. Secerseniz odeme bu aya kadar tekrarlanir; bos ise suresiz devam eder.'
              }
            />
          )}

          {kind !== 'planned' && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={excludeFromBudget}
                onChange={(e) => setExcludeFromBudget(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span>
                Butceye yansitma
                <span className="block text-xs text-slate-500">
                  Kayit listede kalir ama serbest paraya, limitlere, borclara ve raporlara
                  girmez. Odendi olarak isaretlediginizde islem kaydi olusmaz.
                </span>
              </span>
            </label>
          )}

          <SelectField
            label="Kategori"
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Kategorisiz</option>
            {availableCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>

          {kind === 'planned' && (
            <TextField
              label="Karsi taraf"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              placeholder="Istege bagli"
            />
          )}

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      {/* --- Tutar girip onaylama (fatura) --- */}
      <Modal
        open={amountModal !== null}
        title="Odemeyi onayla"
        onClose={() => setAmountModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAmountModal(null)}>
              Vazgec
            </Button>
            <Button loading={busy} onClick={() => void handleConfirmWithAmount()}>
              Onayla
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <strong>{amountModal?.itemName}</strong> — vade {amountModal && formatDate(amountModal.dueDate)}
          </p>
          <MoneyInput
            label="Odenen tutar"
            valueKurus={occurrenceAmount}
            onChangeKurus={setOccurrenceAmount}
            required
            autoFocus
          />
          <TextField
            label="Odeme tarihi"
            type="date"
            value={occurrenceDate}
            onChange={(e) => setOccurrenceDate(e.target.value)}
          />
          <Alert tone="info">
            Onayladiginizda gercek bir gider kaydi yazilir ve raporlara dahil edilir.
          </Alert>
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Kaydi sil"
        loading={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message={
          (deleting?.progress.confirmed ?? 0) > 0 ? (
            <>
              <strong>{deleting?.name}</strong> ve bekleyen vadeleri silinecek. Daha once
              onayladiginiz <strong>{deleting?.progress.confirmed} islem korunur</strong> —
              gerceklesmis harcamalar raporlarinizdan kaybolmaz.
            </>
          ) : (
            <>
              <strong>{deleting?.name}</strong> ve tum vadeleri silinecek.
            </>
          )
        }
      />
    </>
  );
}

function ScheduledCard({
  item,
  kind,
  today,
  expanded,
  busy,
  onToggle,
  onDelete,
  onConfirm,
  onUnconfirm,
  onBudgetToggle,
}: {
  item: ScheduledItem;
  kind: ScheduledKind;
  today: string;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onConfirm: (occurrence: Occurrence) => void;
  onUnconfirm: (occurrence: Occurrence) => void;
  onBudgetToggle: (exclude: boolean) => void;
}) {
  const occurrences = useAsync(
    () => (expanded ? scheduledService.occurrences(item.id) : Promise.resolve([])),
    [expanded, item.id, item.progress.confirmed],
  );

  const progressPercent =
    item.progress.total === 0
      ? 0
      : Math.round((item.progress.confirmed / item.progress.total) * 100);

  const overdue = item.nextDueDate !== null && item.nextDueDate < today;

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start gap-3 p-4">
        <button className="min-w-0 flex-1 text-left" onClick={onToggle}>
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-slate-900">{item.name}</p>
            {!item.active && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                pasif
              </span>
            )}
            {item.excludeFromBudget && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200">
                butce disi
              </span>
            )}
          </div>

          <p className="mt-0.5 text-sm text-slate-500">
            {[
              kind === 'installment' && `${item.progress.confirmed}/${item.progress.total} taksit`,
              kind === 'bill' && item.period && BILL_PERIOD_LABELS[item.period],
              item.endMonth && `yenilenme ${formatYearMonth(item.endMonth)}`,
              item.categoryName,
              item.counterparty,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <p className={`mt-1 text-sm ${overdue ? 'font-medium text-red-600' : 'text-slate-600'}`}>
            {item.nextDueDate
              ? `${overdue ? 'Gecikti' : 'Siradaki vade'}: ${formatDate(item.nextDueDate)}`
              : 'Bekleyen vade yok'}
          </p>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <div className="mr-1 text-right">
            <p className="text-xs text-slate-500">
              {kind === 'installment' ? 'Kalan' : 'Tutar'}
            </p>
            <p className="font-medium text-slate-900">
              <Money
                kurus={
                  kind === 'installment'
                    ? item.remainingKurus
                    : (item.amountKurus ?? item.remainingKurus)
                }
              />
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Sil">
            <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={onToggle} aria-label="Vadeleri goster">
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </Button>
        </div>
      </div>

      {kind === 'installment' && item.progress.total > 0 && (
        <div className="px-4 pb-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3">
          {kind !== 'planned' && (
            <label className="mb-3 flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={item.excludeFromBudget}
                disabled={busy}
                onChange={(e) => onBudgetToggle(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span>
                Butceye yansitma
                <span className="block text-xs text-slate-500">
                  Listede kalir; serbest paraya, limitlere ve raporlara girmez.
                </span>
              </span>
            </label>
          )}
          {occurrences.loading && <p className="text-sm text-slate-500">Vadeler yukleniyor...</p>}

          {occurrences.data && occurrences.data.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {occurrences.data.map((occurrence) => (
                <li key={occurrence.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-900">
                      {occurrence.seq !== null && `${occurrence.seq}. taksit · `}
                      {formatDate(occurrence.dueDate)}
                    </p>
                    <p className={`text-xs ${statusTone(occurrence, today)}`}>
                      {statusLabel(occurrence, today)}
                    </p>
                  </div>

                  <span className="tabular text-sm font-medium text-slate-900">
                    {occurrence.amountKurus === null ? (
                      <span className="text-slate-400">tutar girilmedi</span>
                    ) : (
                      <Money kurus={occurrence.amountKurus} />
                    )}
                  </span>

                  {occurrence.status === 'confirmed' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onUnconfirm(occurrence)}
                      aria-label="Onayi geri al"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onConfirm(occurrence)}
                    >
                      <Check className="h-4 w-4" aria-hidden />
                      Onayla
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
