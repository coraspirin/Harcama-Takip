import { useState } from 'react';
import { CheckCircle2, LifeBuoy, Minus, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { savingsService, type GoalInput } from '../services/savings.ts';
import { ApiError } from '../services/api.ts';
import type { SavingsGoal } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.tsx';
import { MoneyInput } from '../components/MoneyInput.tsx';
import { Money } from '../components/Money.tsx';
import { formatDate, formatYearMonth, todayIso } from '../lib/format.ts';

function GoalStatus({ goal }: { goal: SavingsGoal }) {
  const p = goal.progress;
  if (p.reached) {
    return (
      <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
        <CheckCircle2 className="h-4 w-4" aria-hidden />
        Hedefe ulasildi
      </p>
    );
  }

  return (
    <div className="space-y-0.5 text-sm">
      {goal.targetDate && p.requiredMonthlyKurus !== null && (
        <p className="text-slate-700">
          {formatDate(goal.targetDate)} icin ayda{' '}
          <strong>
            <Money kurus={p.requiredMonthlyKurus} />
          </strong>{' '}
          ayirmalisiniz ({p.monthsLeft} ay)
        </p>
      )}
      {p.projectedMonth ? (
        <p className={p.onTrack === false ? 'text-amber-700' : 'text-slate-500'}>
          Bu tempoyla ({<Money kurus={p.averageMonthlyKurus} />}/ay){' '}
          {formatYearMonth(p.projectedMonth)} ayinda ulasilir
          {p.onTrack === false && ' — hedef tarihine yetismiyor'}
        </p>
      ) : (
        <p className="text-slate-500">Henuz duzenli katki yok; tahmin icin katki girin.</p>
      )}
    </div>
  );
}

const EMPTY_FORM = {
  name: '',
  targetKurus: null as number | null,
  targetDate: '',
  monthlyPlanKurus: null as number | null,
  isEmergencyFund: false,
  note: '',
  closed: false,
};

export default function Birikimler() {
  const [showClosed, setShowClosed] = useState(false);
  const overview = useAsync(() => savingsService.overview(showClosed), [showClosed]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [contributing, setContributing] = useState<{ goal: SavingsGoal; withdraw: boolean } | null>(
    null,
  );
  const [historyOf, setHistoryOf] = useState<SavingsGoal | null>(null);
  const [deleting, setDeleting] = useState<SavingsGoal | null>(null);
  const [amountKurus, setAmountKurus] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = useAsync(
    () => (historyOf ? savingsService.detail(historyOf.id) : Promise.resolve(null)),
    [historyOf?.id],
  );

  const data = overview.data;
  const goals = data?.goals ?? [];
  const open = goals.filter((g) => !g.closed);
  const closed = goals.filter((g) => g.closed);
  const hasEmergencyGoal = open.some((g) => g.isEmergencyFund);
  const emergency = data?.emergencyFund;

  function patchForm(patch: Partial<typeof EMPTY_FORM>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function openCreate(prefill?: Partial<typeof EMPTY_FORM>) {
    setEditing(null);
    setForm({ ...EMPTY_FORM, ...prefill });
    setError(null);
    setFormOpen(true);
  }

  function openEdit(goal: SavingsGoal) {
    setEditing(goal);
    setForm({
      name: goal.name,
      targetKurus: goal.targetKurus,
      targetDate: goal.targetDate ?? '',
      monthlyPlanKurus: goal.monthlyPlanKurus,
      isEmergencyFund: goal.isEmergencyFund,
      note: goal.note ?? '',
      closed: goal.closed,
    });
    setError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    if (form.targetKurus === null || form.targetKurus <= 0) {
      setError('Hedef tutari girin');
      return;
    }
    const input: GoalInput = {
      name: form.name.trim(),
      targetKurus: form.targetKurus,
      targetDate: form.targetDate || null,
      monthlyPlanKurus: form.monthlyPlanKurus,
      isEmergencyFund: form.isEmergencyFund,
      note: form.note.trim() || null,
    };

    setBusy(true);
    setError(null);
    try {
      if (editing) await savingsService.update(editing.id, { ...input, closed: form.closed });
      else await savingsService.create(input);
      setFormOpen(false);
      await overview.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  function openContribution(goal: SavingsGoal, withdraw: boolean) {
    setContributing({ goal, withdraw });
    setAmountKurus(withdraw ? null : goal.monthlyPlanKurus);
    setDate(todayIso());
    setNote('');
    setError(null);
  }

  async function handleContribution() {
    if (!contributing || amountKurus === null || amountKurus <= 0) {
      setError('Tutar girin');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await savingsService.contribute(contributing.goal.id, {
        date,
        amountKurus: contributing.withdraw ? -amountKurus : amountKurus,
        note: note.trim() || null,
      });
      setContributing(null);
      await overview.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function removeContribution(contributionId: number) {
    if (!historyOf) return;
    try {
      await savingsService.removeContribution(historyOf.id, contributionId);
      await Promise.all([history.reload(), overview.reload()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await savingsService.remove(deleting.id);
      setDeleting(null);
      setFormOpen(false);
      await overview.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Birikimler"
        description="Hedefleriniz, birikiminiz ve ne zaman ulasacaginiz"
        actions={
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="h-4 w-4" aria-hidden />
            Hedef ekle
          </Button>
        }
      />

      {overview.error && (
        <div className="mb-4">
          <Alert tone="error">{overview.error}</Alert>
        </div>
      )}

      {data && open.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Toplam birikim</p>
            <p className="mt-0.5 text-lg font-semibold">
              <Money kurus={data.totals.savedKurus} />
            </p>
            <p className="text-xs text-slate-400">
              <Money kurus={data.totals.targetKurus} /> hedefin
            </p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Aylik plan</p>
            <p className="mt-0.5 text-lg font-semibold">
              <Money kurus={data.totals.monthlyPlanKurus} />
            </p>
            <p className="text-xs text-slate-400">Serbest paradan dusulur</p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Bu ay ayrilan</p>
            <p className="mt-0.5 text-lg font-semibold">
              <Money kurus={data.totals.contributedThisMonthKurus} />
            </p>
          </div>
        </div>
      )}

      {emergency && !hasEmergencyGoal && (
        <div className="mb-6">
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <LifeBuoy className="h-4 w-4 text-brand-600" aria-hidden />
                  Acil durum fonu
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {emergency.averageFixedExpenseKurus > 0 ? (
                    <>
                      Son {emergency.basedOnMonths} ayin ortalama sabit gideri{' '}
                      <Money kurus={emergency.averageFixedExpenseKurus} />. Is kaybi veya hastalik
                      gibi durumlar icin en az <Money kurus={emergency.minKurus} /> (3 ay), rahat
                      bir seviye icin <Money kurus={emergency.comfortableKurus} /> (6 ay) onerilir.
                    </>
                  ) : (
                    'Kira, fatura gibi kategorileri "sabit" isaretleyip birkac ay gider girdiginizde, size uygun acil durum fonu tutarini hesaplariz.'
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  openCreate({
                    name: 'Acil durum fonu',
                    isEmergencyFund: true,
                    targetKurus: emergency.minKurus > 0 ? emergency.minKurus : null,
                  })
                }
              >
                <Plus className="h-4 w-4" aria-hidden />
                Hedef olarak ekle
              </Button>
            </div>
          </Card>
        </div>
      )}

      {!overview.loading && open.length === 0 && closed.length === 0 ? (
        <Card>
          <EmptyState
            icon={PiggyBank}
            title="Birikim hedefi yok"
            description="Tatil, araba, ev pesinati gibi bir hedef ekleyin; ne kadar ayirmaniz gerektigini ve ne zaman ulasacaginizi gosterelim."
            action={
              <Button size="sm" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" aria-hidden />
                Hedef ekle
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {open.map((goal) => (
            <div key={goal.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <button className="block w-full text-left" onClick={() => openEdit(goal)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate font-medium text-slate-900">
                      {goal.isEmergencyFund && (
                        <LifeBuoy className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      )}
                      {goal.name}
                    </p>
                    {goal.monthlyPlanKurus !== null && (
                      <p className="text-xs text-slate-500">
                        Plan: ayda <Money kurus={goal.monthlyPlanKurus} />
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">
                      <Money kurus={goal.progress.savedKurus} />
                    </p>
                    <p className="text-xs text-slate-500">
                      / <Money kurus={goal.targetKurus} />
                    </p>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.min(100, Math.max(0, goal.progress.percent))}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  %{goal.progress.percent} · kalan <Money kurus={goal.progress.remainingKurus} />
                </p>
                <div className="mt-2">
                  <GoalStatus goal={goal} />
                </div>
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => openContribution(goal, false)}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Para ekle
                </Button>
                <Button size="sm" variant="secondary" onClick={() => openContribution(goal, true)}>
                  <Minus className="h-4 w-4" aria-hidden />
                  Cek
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setHistoryOf(goal)}>
                  Gecmis
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showClosed && closed.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Kapatilan hedefler</h2>
          <Card>
            <ul className="-my-2 divide-y divide-slate-100">
              {closed.map((goal) => (
                <li key={goal.id} className="flex items-center justify-between py-2.5">
                  <button className="text-left font-medium text-slate-500" onClick={() => openEdit(goal)}>
                    {goal.name}
                  </button>
                  <Money kurus={goal.progress.savedKurus} className="text-sm text-slate-500" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <label className="mt-6 inline-flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={showClosed}
          onChange={(e) => setShowClosed(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
        />
        Kapatilan hedefleri de goster
      </label>

      <Modal
        open={formOpen}
        title={editing ? 'Hedefi duzenle' : 'Hedef ekle'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            {editing && (
              <Button variant="ghost" onClick={() => setDeleting(editing)}>
                <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                Sil
              </Button>
            )}
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
            value={form.name}
            onChange={(e) => patchForm({ name: e.target.value })}
            placeholder="or. Yaz tatili"
            required
            autoFocus
          />
          <MoneyInput
            label="Hedef tutar"
            valueKurus={form.targetKurus}
            onChangeKurus={(v) => patchForm({ targetKurus: v })}
            required
          />
          <TextField
            label="Hedef tarihi"
            type="date"
            value={form.targetDate}
            onChange={(e) => patchForm({ targetDate: e.target.value })}
            hint="Istege bagli. Girerseniz ayda ne kadar ayirmaniz gerektigini hesaplariz."
          />
          <MoneyInput
            label="Aylik ayirmayi planladiginiz tutar"
            valueKurus={form.monthlyPlanKurus}
            onChangeKurus={(v) => patchForm({ monthlyPlanKurus: v })}
            hint="Istege bagli. Butcedeki serbest para hesabindan dusulur."
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isEmergencyFund}
              onChange={(e) => patchForm({ isEmergencyFund: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            <span className="text-slate-700">Bu bir acil durum fonu</span>
          </label>
          <TextField
            label="Not"
            value={form.note}
            onChange={(e) => patchForm({ note: e.target.value })}
            placeholder="Istege bagli"
          />
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.closed}
                onChange={(e) => patchForm({ closed: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-slate-700">Kapatildi (listede ve toplamlarda gorunmez)</span>
            </label>
          )}
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <Modal
        open={contributing !== null}
        title={contributing?.withdraw ? 'Hedeften para cek' : 'Hedefe para ekle'}
        onClose={() => setContributing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setContributing(null)}>
              Vazgec
            </Button>
            <Button loading={busy} onClick={() => void handleContribution()}>
              Kaydet
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <strong>{contributing?.goal.name}</strong> · birikim{' '}
            <Money kurus={contributing?.goal.progress.savedKurus ?? 0} />
          </p>
          <MoneyInput label="Tutar" valueKurus={amountKurus} onChangeKurus={setAmountKurus} required autoFocus />
          <TextField label="Tarih" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <TextField label="Not" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Istege bagli" />
          <p className="text-xs text-slate-500">
            Birikime ayrilan para gider sayilmaz; islemlerinize yazilmaz.
          </p>
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <Modal open={historyOf !== null} title={historyOf?.name ?? ''} onClose={() => setHistoryOf(null)}>
        {(history.data?.contributions.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">Henuz kayit yok.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.data!.contributions.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm">
                    <Money kurus={c.amountKurus} signed />
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {formatDate(c.date)}
                    {c.note && ` · ${c.note}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void removeContribution(c.id)}
                  aria-label="Kaydi sil"
                >
                  <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Hedefi sil"
        loading={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message={
          <>
            <strong>{deleting?.name}</strong> ve tum katki kayitlari kalici olarak silinecek. Hedefe
            ulastiysaniz silmek yerine "Kapatildi" olarak isaretleyebilirsiniz.
          </>
        }
      />
    </>
  );
}
