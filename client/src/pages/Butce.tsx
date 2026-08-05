import { useState } from 'react';
import { Copy, Plus, Target, Trash2 } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { budgetService, categoryService } from '../services/finance.ts';
import { ApiError } from '../services/api.ts';
import type { Budget } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { SelectField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.tsx';
import { MoneyInput } from '../components/MoneyInput.tsx';
import { Money } from '../components/Money.tsx';
import { MonthPicker, currentYearMonth } from '../components/MonthPicker.tsx';

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

export default function Butce() {
  const [month, setMonth] = useState(currentYearMonth());
  const budgets = useAsync(() => budgetService.list(month), [month]);
  const categories = useAsync(() => categoryService.list(), []);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [limitKurus, setLimitKurus] = useState<number | null>(null);

  const list = budgets.data?.budgets ?? [];
  const totals = budgets.data?.totals;

  // Butce yalnizca gider kategorileri icin; zaten butcesi olanlar listelenmez
  const availableCategories = (categories.data ?? []).filter(
    (c) => c.kind === 'expense' && !list.some((b) => b.categoryId === c.id),
  );

  function openCreate() {
    setEditing(null);
    setCategoryId(availableCategories[0]?.id ?? null);
    setLimitKurus(null);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(budget: Budget) {
    setEditing(budget);
    setCategoryId(budget.categoryId);
    setLimitKurus(budget.limitKurus);
    setError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    if (limitKurus === null || limitKurus <= 0) {
      setError('Limit sifirdan buyuk olmali');
      return;
    }
    if (!editing && categoryId === null) {
      setError('Kategori secin');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (editing) await budgetService.update(editing.id, limitKurus);
      else await budgetService.create({ categoryId: categoryId!, yearMonth: month, limitKurus });
      setFormOpen(false);
      await budgets.reload();
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
      await budgets.reload();
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
          ? 'Onceki aydan kopyalanacak yeni butce bulunamadi.'
          : `${res.copied} butce onceki aydan kopyalandi.`,
      );
      await budgets.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kopyalanamadi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Butce"
        description="Kategori bazli aylik harcama limitleri"
        actions={
          <>
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void handleCopy()}>
              <Copy className="h-4 w-4" aria-hidden />
              Onceki aydan kopyala
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              Butce ekle
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <MonthPicker value={month} onChange={setMonth} />
      </div>

      {budgets.error && (
        <div className="mb-4">
          <Alert tone="error">{budgets.error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}

      {totals && list.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Toplam limit</p>
            <p className="mt-0.5 text-lg font-semibold">
              <Money kurus={totals.limitKurus} />
            </p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Harcanan</p>
            <p className="mt-0.5 text-lg font-semibold">
              <Money kurus={totals.spentKurus} />
            </p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Limiti asan kategori</p>
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

      {!budgets.loading && list.length === 0 ? (
        <Card>
          <EmptyState
            icon={Target}
            title="Bu ay icin butce belirlenmemis"
            description="Bir gider kategorisine aylik limit koyarak harcamalarinizi kontrol altinda tutun."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                Butce ekle
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((budget) => (
            <div key={budget.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(budget)}>
                  <p className="truncate font-medium text-slate-900">
                    {budget.categoryName}
                    {budget.categoryArchived && ' (arsivli)'}
                  </p>
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
            </div>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Butceyi duzenle' : 'Butce ekle'}
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
              Kategori: <strong>{editing.categoryName}</strong>
            </p>
          ) : (
            <SelectField
              label="Kategori"
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
              hint="Yalnizca butcesi olmayan gider kategorileri listelenir"
              required
            >
              <option value="">Secin</option>
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

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Butceyi sil"
        loading={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message={
          <>
            <strong>{deleting?.categoryName}</strong> kategorisinin bu aya ait butce limiti
            silinecek. Islemleriniz etkilenmez.
          </>
        }
      />
    </>
  );
}
