import { useCallback, useMemo, useState } from 'react';
import { useAsync } from '../hooks/useAsync.ts';
import { useFieldValidity } from '../hooks/useFieldValidity.ts';
import { useCategorySuggestion } from '../hooks/useCategorySuggestion.ts';
import { notifyTransactionsChanged } from '../hooks/useTransactionsChanged.ts';
import { categoryService, getRecentCategories, transactionService } from '../services/finance.ts';
import { ApiError } from '../services/api.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { SelectField, TextField } from './ui/Field.tsx';
import { Modal } from './ui/Modal.tsx';
import { showToast } from './ui/Toast.tsx';
import { MoneyInput } from './MoneyInput.tsx';
import { KategoriOnerileri } from './KategoriOnerileri.tsx';
import { todayIso } from '../lib/format.ts';

type TxType = 'income' | 'expense';

function HizliEkleModal({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<TxType>('expense');
  const [amountKurus, setAmountKurus] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Kaydet ve yeni" sonrasi tutar alanini yeniden kurup odagi geri vermek icin
  const [formKey, setFormKey] = useState(0);
  const amountFields = useFieldValidity();

  const categories = useAsync(() => categoryService.list(), []);
  const recent = useAsync(() => getRecentCategories(type, 6), [type]);

  const typeCategories = useMemo(
    () => (categories.data ?? []).filter((c) => c.kind === type),
    [categories.data, type],
  );
  const validCategoryIds = useMemo(
    () => new Set(typeCategories.map((c) => c.id)),
    [typeCategories],
  );

  const suggest = useCategorySuggestion({
    description,
    type,
    categoryId,
    onSelect: useCallback((id: number) => setCategoryId(id), []),
    validCategoryIds,
    allowAutoSelect: true,
  });

  // Silinmis/arsivli kategoriler ve tur uyusmazligi chip olarak sunulmaz
  const recentChips = (recent.data ?? []).filter((c) => validCategoryIds.has(c.categoryId));

  function changeType(next: TxType) {
    if (next === type) return;
    setType(next);
    setCategoryId(null);
  }

  function pickCategory(id: number | null) {
    suggest.markManual();
    setCategoryId(id);
  }

  async function save(keepOpen: boolean) {
    if (!amountFields.allValid || amountKurus === null) return;

    setBusy(true);
    setError(null);
    try {
      await transactionService.create({
        categoryId,
        type,
        amountKurus,
        date,
        description: description.trim() || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
      setBusy(false);
      return;
    }

    showToast('Kaydedildi');
    notifyTransactionsChanged();
    setBusy(false);

    if (keepOpen) {
      setAmountKurus(null);
      setCategoryId(null);
      setDescription('');
      setDate(todayIso());
      suggest.reset();
      setFormKey((k) => k + 1);
    } else {
      onClose();
    }
  }

  const canSave = amountFields.allValid && amountKurus !== null;

  return (
    <Modal
      open
      title="Hizli islem ekle"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgec
          </Button>
          <Button
            variant="secondary"
            disabled={!canSave}
            loading={busy}
            onClick={() => void save(true)}
          >
            Kaydet ve yeni
          </Button>
          <Button disabled={!canSave} loading={busy} onClick={() => void save(false)}>
            Kaydet
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Islem turu">
          <button
            type="button"
            aria-pressed={type === 'expense'}
            onClick={() => changeType('expense')}
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
            aria-pressed={type === 'income'}
            onClick={() => changeType('income')}
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
          key={formKey}
          label="Tutar"
          valueKurus={amountKurus}
          onChangeKurus={setAmountKurus}
          {...amountFields.register('amountKurus')}
          required
          autoFocus
        />

        {recentChips.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Son kategoriler</p>
            <div className="flex flex-wrap gap-1.5">
              {recentChips.map((c) => {
                const active = c.categoryId === categoryId;
                return (
                  <button
                    key={c.categoryId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pickCategory(c.categoryId)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors ${
                      active
                        ? 'bg-brand-600 text-white ring-brand-600'
                        : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {c.categoryName}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <SelectField
          label="Diger kategoriler"
          value={categoryId ?? ''}
          onChange={(e) => pickCategory(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Kategorisiz</option>
          {typeCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>

        <div>
          <TextField
            label="Aciklama"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Istege bagli"
          />
          <KategoriOnerileri
            suggestions={suggest.suggestions}
            selectedId={categoryId}
            autoSelected={suggest.autoSelected}
            onChoose={suggest.choose}
          />
        </div>

        <TextField
          label="Tarih"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />

        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Hizli islem ekleme modali. Kapaliyken hicbir sey render etmez (acilista form sifirlanir). */
export function HizliEkle({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <HizliEkleModal onClose={onClose} />;
}
