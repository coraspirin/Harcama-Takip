import { useState } from 'react';
import { AlertTriangle, Copy, Gauge, Plus, Target, Trash2 } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { budgetService, categoryService } from '../services/finance.ts';
import { ApiError } from '../services/api.ts';
import type { Budget, MonthOverview } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { SelectField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.tsx';
import { MoneyInput } from '../components/MoneyInput.tsx';
import { Money } from '../components/Money.tsx';
import { MonthPicker, currentYearMonth } from '../components/MonthPicker.tsx';
import { formatTRY } from '../lib/format.ts';

/** Formdaki hedef secimi: genel limit veya bir kategori id'si. */
const GENERAL = 'general';

function budgetLabel(budget: Budget): string {
  if (budget.isGeneral) return 'Genel aylik limit';
  return `${budget.categoryName ?? 'Kategori'}${budget.categoryArchived ? ' (arsivli)' : ''}`;
}

function BudgetBar({ budget }: { budget: Budget }) {
  // Cubuk %100'u gecmez; asim ayri renk ve metinle anlatilir
  const width = Math.min(100, budget.usagePercent);
  const tone = budget.exceeded
    ? 'bg-red-500'
    : budget.usagePercent >= 80
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  return (
    <div className="mt-2">
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs">
        <span className={budget.exceeded ? 'font-medium text-red-600' : 'text-slate-500'}>
          {budget.exceeded
            ? `%${budget.usagePercent} — limit asildi`
            : `%${budget.usagePercent} kullanildi`}
        </span>
        <span className={budget.exceeded ? 'text-red-600' : 'text-slate-500'}>
          {budget.exceeded ? 'Asim: ' : 'Kalan: '}
          <Money kurus={Math.abs(budget.remainingKurus)} />
        </span>
      </div>
    </div>
  );
}

/** Gunluk harcanabilir tutar ve mevcut hizla ay sonu tahmini. */
function PaceLine({ budget }: { budget: Budget }) {
  if (budget.dailyAllowanceKurus === null) return null;

  return (
    <p className="mt-2 text-xs text-slate-600">
      Gunde en fazla{' '}
      <strong className="text-slate-900">
        <Money kurus={budget.dailyAllowanceKurus} />
      </strong>{' '}
      (bugun dahil {budget.daysLeft} gun)
      {budget.projectedExceeds && !budget.exceeded && (
        <span className="text-amber-700">
          {' '}
          · bu hizla ay sonu <Money kurus={budget.projectedSpendKurus} />
        </span>
      )}
    </p>
  );
}

function OverviewTile({
  label,
  kurus,
  note,
  tone = '',
}: {
  label: string;
  kurus: number;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${tone}`}>
        <Money kurus={kurus} />
      </p>
      {note && <p className="mt-0.5 text-xs text-slate-400">{note}</p>}
    </div>
  );
}

function MonthStatus({ overview }: { overview: MonthOverview }) {
  const free = overview.freeKurus;
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <OverviewTile
        label="Beklenen gelir"
        kurus={overview.expectedIncomeKurus}
        note={
          overview.incomeIsEstimate
            ? 'Bu ay gelir girilmedi; onceki aylarin ortalamasi'
            : overview.pendingIncomeKurus > 0
              ? 'Bekleyen alacaklar dahil'
              : undefined
        }
      />
      <OverviewTile label="Harcanan" kurus={overview.spentKurus} />
      <OverviewTile
        label="Bekleyen odemeler"
        kurus={overview.pendingExpenseKurus}
        note={
          overview.unknownAmountCount > 0
            ? `${overview.unknownAmountCount} kaydin tutari henuz girilmedi`
            : undefined
        }
      />
      <OverviewTile
        label="Serbest para"
        kurus={free}
        tone={free < 0 ? 'text-red-600' : 'text-emerald-600'}
        note={
          overview.reserveKurus > 0
            ? `Yillik giderler icin ${formatTRY(overview.reserveKurus)} kenara ayrildiktan sonra`
            : free < 0
              ? 'Bu gidisle ay acikla kapanir'
              : 'Ay sonuna kadar harcanabilir'
        }
      />
    </div>
  );
}

export default function Butce() {
  const [month, setMonth] = useState(currentYearMonth());
  const budgets = useAsync(() => budgetService.list(month), [month]);
  const overview = useAsync(() => budgetService.overview(month), [month]);
  const categories = useAsync(() => categoryService.list(), []);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [target, setTarget] = useState<string>('');
  const [limitKurus, setLimitKurus] = useState<number | null>(null);

  const general = budgets.data?.general ?? null;
  const list = budgets.data?.budgets ?? [];
  const totals = budgets.data?.totals;

  // Butce yalnizca gider kategorileri icin; zaten butcesi olanlar listelenmez
  const availableCategories = (categories.data ?? []).filter(
    (c) => c.kind === 'expense' && !list.some((b) => b.categoryId === c.id),
  );

  /**
   * Genel limit onerisi: beklenen gelirden bekleyen odemeler ve yillik
   * giderlerin aylik payi dusuldukten sonra kalan, yani bu ay harcamaya
   * ayrilabilecek en yuksek tutar.
   */
  const suggestedGeneralKurus = overview.data
    ? overview.data.expectedIncomeKurus -
      overview.data.pendingExpenseKurus -
      overview.data.reserveKurus
    : null;

  function openCreate(initialTarget?: string) {
    setEditing(null);
    const first = availableCategories[0];
    setTarget(initialTarget ?? (general ? (first ? String(first.id) : '') : GENERAL));
    setLimitKurus(
      initialTarget === GENERAL && suggestedGeneralKurus !== null && suggestedGeneralKurus > 0
        ? suggestedGeneralKurus
        : null,
    );
    setError(null);
    setFormOpen(true);
  }

  function openEdit(budget: Budget) {
    setEditing(budget);
    setTarget(budget.isGeneral ? GENERAL : String(budget.categoryId));
    setLimitKurus(budget.limitKurus);
    setError(null);
    setFormOpen(true);
  }

  async function reloadAll() {
    await Promise.all([budgets.reload(), overview.reload()]);
  }

  async function handleSave() {
    if (limitKurus === null || limitKurus <= 0) {
      setError('Limit sifirdan buyuk olmali');
      return;
    }
    if (!editing && target === '') {
      setError('Genel limit veya bir kategori secin');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await budgetService.update(editing.id, limitKurus);
      } else {
        await budgetService.create({
          categoryId: target === GENERAL ? null : Number(target),
          yearMonth: month,
          limitKurus,
        });
      }
      setFormOpen(false);
      await reloadAll();
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
      await budgetService.remove(deleting.id);
      setDeleting(null);
      await reloadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await budgetService.copyFromPreviousMonth(month);
      setNotice(
        res.copied === 0
          ? 'Onceki aydan kopyalanacak yeni limit bulunamadi.'
          : `${res.copied} limit onceki aydan kopyalandi.`,
      );
      await reloadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kopyalanamadi');
    } finally {
      setBusy(false);
    }
  }

  const nothingYet = !budgets.loading && !general && list.length === 0;

  return (
    <>
      <PageHeader
        title="Butce"
        description="Aylik harcama limiti, gunluk harcanabilir tutar ve ay sonu gidisati"
        actions={
          <>
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void handleCopy()}>
              <Copy className="h-4 w-4" aria-hidden />
              Onceki aydan kopyala
            </Button>
            <Button size="sm" onClick={() => openCreate()}>
              <Plus className="h-4 w-4" aria-hidden />
              Limit ekle
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <MonthPicker value={month} onChange={setMonth} />
      </div>

      {(budgets.error || overview.error) && (
        <div className="mb-4">
          <Alert tone="error">{budgets.error ?? overview.error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}

      {overview.data && <MonthStatus overview={overview.data} />}

      <div className="mb-6">
        {general ? (
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start justify-between gap-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(general)}>
                <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <Gauge className="h-4 w-4 text-brand-600" aria-hidden />
                  Genel aylik limit
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  <Money kurus={general.spentKurus} /> / <Money kurus={general.limitKurus} />
                  <span className="text-slate-400"> · tum giderler</span>
                </p>
              </button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(general)} aria-label="Sil">
                <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
              </Button>
            </div>
            <BudgetBar budget={general} />
            {general.dailyAllowanceKurus !== null && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">
                    Gunluk harcanabilir (bugun dahil {general.daysLeft} gun)
                  </p>
                  <p className="mt-0.5 text-xl font-semibold text-slate-900">
                    <Money kurus={general.dailyAllowanceKurus} />
                  </p>
                </div>
                <div
                  className={`rounded-lg p-3 ${
                    general.projectedExceeds ? 'bg-amber-50' : 'bg-slate-50'
                  }`}
                >
                  <p className="text-xs text-slate-500">Bu hizla ay sonu harcama</p>
                  <p
                    className={`mt-0.5 flex items-center gap-1.5 text-xl font-semibold ${
                      general.projectedExceeds ? 'text-amber-700' : 'text-slate-900'
                    }`}
                  >
                    {general.projectedExceeds && <AlertTriangle className="h-4 w-4" aria-hidden />}
                    <Money kurus={general.projectedSpendKurus} />
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          !budgets.loading && (
            <Card>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                    <Gauge className="h-4 w-4 text-brand-600" aria-hidden />
                    Genel aylik limit belirlenmemis
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Tum giderler icin tek bir ust sinir koyun; gunluk ne kadar harcayabileceginizi
                    gosterelim.
                    {suggestedGeneralKurus !== null && suggestedGeneralKurus > 0 && (
                      <>
                        {' '}
                        Oneri: <Money kurus={suggestedGeneralKurus} /> (beklenen gelir − bekleyen
                        odemeler − kenara ayrilacak pay).
                      </>
                    )}
                  </p>
                </div>
                <Button size="sm" onClick={() => openCreate(GENERAL)}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Genel limit koy
                </Button>
              </div>
            </Card>
          )
        )}
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-700">Kategori limitleri</h2>

      {totals && list.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <OverviewTile label="Kategori limitleri toplami" kurus={totals.limitKurus} />
          <OverviewTile label="Bu kategorilerde harcanan" kurus={totals.spentKurus} />
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Asilan limit</p>
            <p
              className={`mt-0.5 text-lg font-semibold ${
                totals.exceededCount > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {totals.exceededCount}
            </p>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        !budgets.loading && (
          <Card>
            <EmptyState
              icon={Target}
              title={nothingYet ? 'Bu ay icin limit belirlenmemis' : 'Kategori limiti yok'}
              description="Market, yemek gibi bir gider kategorisine ayri limit koyarak o kalemi kontrol altinda tutun."
              action={
                availableCategories.length > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openCreate(String(availableCategories[0]!.id))}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    Kategori limiti ekle
                  </Button>
                ) : undefined
              }
            />
          </Card>
        )
      ) : (
        <div className="space-y-3">
          {list.map((budget) => (
            <div key={budget.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(budget)}>
                  <p className="truncate font-medium text-slate-900">{budgetLabel(budget)}</p>
                  <p className="text-sm text-slate-500">
                    <Money kurus={budget.spentKurus} /> / <Money kurus={budget.limitKurus} />
                  </p>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleting(budget)}
                  aria-label="Sil"
                >
                  <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                </Button>
              </div>
              <BudgetBar budget={budget} />
              <PaceLine budget={budget} />
            </div>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Limiti duzenle' : 'Limit ekle'}
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
          {editing ? (
            <p className="text-sm text-slate-600">
              <strong>{budgetLabel(editing)}</strong>
            </p>
          ) : (
            <SelectField
              label="Neye limit konacak?"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              hint="Genel limit tum giderleri kapsar; kategori limitleri ayrica takip edilir."
              required
            >
              <option value="">Secin</option>
              {!general && <option value={GENERAL}>Genel aylik limit (tum giderler)</option>}
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          )}

          <MoneyInput
            label="Aylik limit"
            valueKurus={limitKurus}
            onChangeKurus={setLimitKurus}
            required
            autoFocus
          />

          {target === GENERAL && suggestedGeneralKurus !== null && suggestedGeneralKurus > 0 && (
            <p className="text-xs text-slate-500">
              Oneri: <Money kurus={suggestedGeneralKurus} /> — bu ayin beklenen gelirinden bekleyen
              odemeler ve yillik giderlerin aylik payi dusulmus hali.
            </p>
          )}

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Limiti sil"
        loading={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message={
          <>
            <strong>{deleting ? budgetLabel(deleting) : ''}</strong> icin bu aya ait limit
            silinecek. Islemleriniz etkilenmez.
          </>
        }
      />
    </>
  );
}
