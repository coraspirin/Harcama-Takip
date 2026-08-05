import { useState } from 'react';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync.ts';
import { bankService, type BankInput } from '../../services/finance.ts';
import { ApiError } from '../../services/api.ts';
import type { Bank } from '../../types/index.ts';
import { Button } from '../../components/ui/Button.tsx';
import { TextField } from '../../components/ui/Field.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { Card, EmptyState } from '../../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../../components/ui/Modal.tsx';

/** Baz puani ekranda yuzdeye cevirir: 311 -> "3,11" */
function bpToPercentText(bp: number): string {
  return (bp / 100).toFixed(2).replace('.', ',');
}

function percentTextToBp(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') return 0;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export default function BankalarBolumu() {
  const banks = useAsync(() => bankService.list(), []);

  const [editing, setEditing] = useState<Bank | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Bank | null>(null);
  const [impact, setImpact] = useState<{ accounts: number; transactions: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [interestText, setInterestText] = useState('0,00');
  const [taxesIncluded, setTaxesIncluded] = useState(true);

  function openCreate() {
    setName('');
    setInterestText('0,00');
    setTaxesIncluded(true);
    setError(null);
    setCreating(true);
  }

  function openEdit(bank: Bank) {
    setName(bank.name);
    setInterestText(bpToPercentText(bank.monthlyInterestBp));
    setTaxesIncluded(bank.taxesIncluded);
    setError(null);
    setEditing(bank);
  }

  async function handleSave() {
    const bp = percentTextToBp(interestText);
    if (bp === null) {
      setError('Faiz orani gecerli bir sayi olmali');
      return;
    }

    const input: BankInput = { name: name.trim(), monthlyInterestBp: bp, taxesIncluded };

    setBusy(true);
    setError(null);
    try {
      if (editing) await bankService.update(editing.id, input);
      else await bankService.create(input);
      setCreating(false);
      setEditing(null);
      await banks.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function openDelete(bank: Bank) {
    setDeleting(bank);
    setImpact(null);
    try {
      setImpact(await bankService.impact(bank.id));
    } catch {
      /* etki okunamazsa uyari genel metinle gosterilir */
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await bankService.remove(deleting.id);
      setDeleting(null);
      await banks.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  const formOpen = creating || editing !== null;

  return (
    <>
      <Card
        title="Bankalar"
        description="Kredi karti faiz hesabinda kullanilacak banka tanimlari"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            Banka ekle
          </Button>
        }
      >
        {banks.error && <Alert tone="error">{banks.error}</Alert>}

        {!banks.loading && banks.data?.length === 0 && (
          <EmptyState
            icon={Building2}
            title="Henuz banka eklenmemis"
            description="Kredi karti borcu uzerinden tahmini faiz hesaplanabilmesi icin bankanizi ve aylik faiz oranini ekleyin."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                Banka ekle
              </Button>
            }
          />
        )}

        {banks.data && banks.data.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {banks.data.map((bank) => (
              <li key={bank.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{bank.name}</p>
                  <p className="text-sm text-slate-500">
                    Aylik faiz: <span className="tabular">%{bpToPercentText(bank.monthlyInterestBp)}</span>
                    {bank.taxesIncluded && ' · KKDF + BSMV dahil'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(bank)} aria-label="Duzenle">
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void openDelete(bank)}
                    aria-label="Sil"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={formOpen}
        title={editing ? 'Bankayi duzenle' : 'Banka ekle'}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
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
            label="Banka adi"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ornek: Is Bankasi"
            autoFocus
            required
          />

          <TextField
            label="Aylik faiz orani (%)"
            value={interestText}
            onChange={(e) => setInterestText(e.target.value)}
            inputMode="decimal"
            className="tabular"
            hint="Kredi kartinin aylik akdi faiz orani. Ornek: 3,11"
          />

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={taxesIncluded}
              onChange={(e) => setTaxesIncluded(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            <span>
              <span className="font-medium text-slate-700">Vergiler dahil hesapla</span>
              <span className="block text-slate-500">
                Faiz uzerine KKDF ve BSMV eklenir (toplam %30). Bankalarin uyguladigi standart
                yontemdir.
              </span>
            </span>
          </label>

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Bankayi sil"
        loading={busy}
        confirmLabel="Evet, sil"
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message={
          impact && (impact.accounts > 0 || impact.transactions > 0) ? (
            <>
              <strong>{deleting?.name}</strong> silinirse bu bankaya bagli{' '}
              <strong>{impact.accounts} hesap</strong> ve{' '}
              <strong>{impact.transactions} islem kaydi</strong> da kalici olarak silinecek. Bu
              islem geri alinamaz.
            </>
          ) : (
            <>
              <strong>{deleting?.name}</strong> silinecek. Bu bankaya bagli hesap veya islem
              bulunmuyor.
            </>
          )
        }
      />
    </>
  );
}
