import { useMemo, useState } from 'react';
import { ArrowLeftRight, Filter, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import {
  accountService,
  categoryService,
  transactionService,
  type TransactionQuery,
} from '../services/finance.ts';
import { ApiError } from '../services/api.ts';
import type { Transaction } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { SelectField, TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.tsx';
import { MoneyInput } from '../components/MoneyInput.tsx';
import { Money, SignedAmount } from '../components/Money.tsx';
import { formatDate, todayIso } from '../lib/format.ts';

const PAGE_SIZE = 50;

export default function Islemler() {
  const accounts = useAsync(() => accountService.list(true), []);
  const categories = useAsync(() => categoryService.list(), []);

  const [filters, setFilters] = useState<TransactionQuery>({ page: 1, pageSize: PAGE_SIZE });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = useMemo(() => ({ ...filters }), [filters]);
  const list = useAsync(() => transactionService.list(query), [query]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [accountId, setAccountId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amountKurus, setAmountKurus] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState('');

  const availableCategories = (categories.data ?? []).filter((c) => c.kind === type);

  function openCreate() {
    setEditing(null);
    setAccountId(accounts.data?.[0]?.id ?? null);
    setCategoryId(null);
    setType('expense');
    setAmountKurus(null);
    setDate(todayIso());
    setDescription('');
    setError(null);
    setFormOpen(true);
  }

  function openEdit(tx: Transaction) {
    setEditing(tx);
    setAccountId(tx.accountId);
    setCategoryId(tx.categoryId);
    setType(tx.type === 'income' ? 'income' : 'expense');
    setAmountKurus(tx.amountKurus);
    setDate(tx.date);
    setDescription(tx.description ?? '');
    setError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    if (accountId === null || amountKurus === null) {
      setError('Hesap ve tutar zorunlu');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const input = {
        accountId,
        categoryId,
        type,
        amountKurus,
        date,
        description: description.trim() || null,
      };
      if (editing) await transactionService.update(editing.id, input);
      else await transactionService.create(input);
      setFormOpen(false);
      await Promise.all([list.reload(), accounts.reload()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await transactionService.bulkDelete([...selected]);
      // Silinen satir sayisi secimden FAZLA olabilir: transferin tek bacagi
      // secilse bile cift birlikte gider.
      const extra = res.removedRows - selected.size;
      setNotice(
        `${res.removedRows} islem silindi` +
          (extra > 0 ? ` (${extra} tanesi secilen transferlerin karsi bacagi).` : '.'),
      );
      setSelected(new Set());
      setBulkDeleting(false);
      await list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await transactionService.remove(deleting.id);
      setDeleting(null);
      await Promise.all([list.reload(), accounts.reload()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  function updateFilter(patch: Partial<TransactionQuery>) {
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  }

  const activeFilterCount = [
    filters.from,
    filters.to,
    filters.accountId,
    filters.categoryId,
    filters.kind,
    filters.search,
  ].filter(Boolean).length;

  const transactions = list.data?.transactions ?? [];
  const totals = list.data?.totals;
  const pagination = list.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Islemler"
        description="Gelir ve giderlerinizin tam listesi"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setFiltersOpen((v) => !v)}>
              <Filter className="h-4 w-4" aria-hidden />
              Filtrele{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              Islem ekle
            </Button>
          </>
        }
      />

      {filtersOpen && (
        <Card className="mb-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              label="Baslangic tarihi"
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => updateFilter({ from: e.target.value || undefined })}
            />
            <TextField
              label="Bitis tarihi"
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => updateFilter({ to: e.target.value || undefined })}
            />
            <SelectField
              label="Tur"
              value={filters.kind ?? ''}
              onChange={(e) =>
                updateFilter({ kind: (e.target.value || undefined) as TransactionQuery['kind'] })
              }
            >
              <option value="">Tumu</option>
              <option value="income">Gelir</option>
              <option value="expense">Gider</option>
              <option value="transfer">Transfer</option>
            </SelectField>
            <SelectField
              label="Hesap"
              value={filters.accountId ?? ''}
              onChange={(e) =>
                updateFilter({ accountId: e.target.value ? Number(e.target.value) : undefined })
              }
            >
              <option value="">Tumu</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Kategori"
              value={filters.categoryId ?? ''}
              onChange={(e) =>
                updateFilter({ categoryId: e.target.value ? Number(e.target.value) : undefined })
              }
            >
              <option value="">Tumu</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Aciklamada ara"
              value={filters.search ?? ''}
              onChange={(e) => updateFilter({ search: e.target.value || undefined })}
              placeholder="Ornek: market"
            />
          </div>

          {activeFilterCount > 0 && (
            <div className="mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({ page: 1, pageSize: PAGE_SIZE })}
              >
                <X className="h-4 w-4" aria-hidden />
                Filtreleri temizle
              </Button>
            </div>
          )}
        </Card>
      )}

      {totals && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Gelir</p>
            <p className="mt-0.5 text-lg font-semibold text-emerald-600">
              <Money kurus={totals.incomeKurus} />
            </p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Gider</p>
            <p className="mt-0.5 text-lg font-semibold text-red-600">
              <Money kurus={totals.expenseKurus} />
            </p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Net</p>
            <p className="mt-0.5 text-lg font-semibold">
              <Money kurus={totals.incomeKurus - totals.expenseKurus} signed />
            </p>
          </div>
        </div>
      )}

      {(list.error || error) && (
        <div className="mb-4">
          <Alert tone="error">{list.error ?? error}</Alert>
        </div>
      )}

      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 p-3">
          <span className="text-sm font-medium text-brand-900">
            {selected.size} islem secili
          </span>
          <Button size="sm" variant="danger" onClick={() => setBulkDeleting(true)}>
            <Trash2 className="h-4 w-4" aria-hidden />
            Secilenleri sil
          </Button>
          <button
            type="button"
            className="text-sm text-slate-500 underline"
            onClick={() => setSelected(new Set())}
          >
            Secimi temizle
          </button>
        </div>
      )}

      <Card className="overflow-hidden">
        {!list.loading && transactions.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title={activeFilterCount > 0 ? 'Filtreye uyan islem yok' : 'Henuz islem yok'}
            description={
              activeFilterCount > 0
                ? 'Filtreleri gevseterek tekrar deneyin.'
                : 'Ilk gelir veya gider kaydinizi ekleyerek baslayin.'
            }
            action={
              activeFilterCount === 0 ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Islem ekle
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="-my-2 divide-y divide-slate-100">
            {transactions.map((tx) => {
              const isTransfer = tx.transferGroupId !== null;
              return (
                <li key={tx.id} className="flex items-center gap-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(tx.id)}
                    onChange={() => toggleSelect(tx.id)}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                    aria-label="Bu islemi sec"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {tx.description || tx.categoryName || (isTransfer ? 'Transfer' : 'Islem')}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {formatDate(tx.date)} · {tx.accountName}
                      {isTransfer
                        ? ` → ${tx.counterpartyAccountName ?? '?'}`
                        : tx.categoryName
                          ? ` · ${tx.categoryName}`
                          : ''}
                    </p>
                  </div>

                  <SignedAmount kurus={tx.amountKurus} type={tx.type} />

                  <div className="flex shrink-0 gap-0.5">
                    {!isTransfer && (
                      <Button size="sm" variant="ghost" onClick={() => openEdit(tx)} aria-label="Duzenle">
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleting(tx)}
                      aria-label="Sil"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {pagination && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {pagination.total} kayit · sayfa {pagination.page}/{totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={pagination.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
            >
              Onceki
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pagination.page >= totalPages}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
            >
              Sonraki
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Islemi duzenle' : 'Islem ekle'}
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
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setType('expense');
                setCategoryId(null);
              }}
              className={`rounded-lg py-2 text-sm font-medium ring-1 ring-inset transition-colors ${
                type === 'expense'
                  ? 'bg-red-50 text-red-700 ring-red-300'
                  : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              Gider
            </button>
            <button
              type="button"
              onClick={() => {
                setType('income');
                setCategoryId(null);
              }}
              className={`rounded-lg py-2 text-sm font-medium ring-1 ring-inset transition-colors ${
                type === 'income'
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-300'
                  : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              Gelir
            </button>
          </div>

          <MoneyInput
            label="Tutar"
            valueKurus={amountKurus}
            onChangeKurus={setAmountKurus}
            required
            autoFocus
          />

          <TextField
            label="Tarih"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />

          <SelectField
            label="Hesap"
            value={accountId ?? ''}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}
            required
          >
            <option value="">Secin</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>

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

          <TextField
            label="Aciklama"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Istege bagli"
          />

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={bulkDeleting}
        title={`${selected.size} islem silinsin mi?`}
        loading={busy}
        onClose={() => setBulkDeleting(false)}
        onConfirm={() => void handleBulkDelete()}
        message="Secilen islemler kalici olarak silinir. Secim bir transferin bacagini iceriyorsa, hesaplar tutarsiz kalmasin diye transferin diger bacagi da silinir."
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Islemi sil"
        loading={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message={
          deleting?.transferGroupId ? (
            <>
              Bu bir transfer kaydi. Silinirse transferin <strong>her iki bacagi</strong> da
              kaldirilir ve iki hesabin bakiyesi eski haline doner.
            </>
          ) : (
            <>Bu islem kalici olarak silinecek ve hesap bakiyesi guncellenecek.</>
          )
        }
      />
    </>
  );
}
