import { useState } from 'react';
import { Archive, ArrowLeftRight, Banknote, CreditCard, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { accountService, bankService, transactionService } from '../services/finance.ts';
import { ApiError } from '../services/api.ts';
import { ACCOUNT_TYPE_LABELS, type Account, type AccountType } from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { SelectField, TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.tsx';
import { MoneyInput } from '../components/MoneyInput.tsx';
import { Money } from '../components/Money.tsx';
import { todayIso } from '../lib/format.ts';

const TYPE_ICONS: Record<AccountType, typeof Wallet> = {
  cash: Banknote,
  bank: Wallet,
  credit_card: CreditCard,
};

export default function Hesaplar() {
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useAsync(() => accountService.list(showArchived), [showArchived]);
  const banks = useAsync(() => bankService.list(), []);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- hesap formu ---
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [bankId, setBankId] = useState<number | null>(null);
  const [openingKurus, setOpeningKurus] = useState<number | null>(0);
  const [archived, setArchived] = useState(false);

  // --- transfer formu ---
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [transferKurus, setTransferKurus] = useState<number | null>(null);
  const [transferDate, setTransferDate] = useState(todayIso());
  const [transferNote, setTransferNote] = useState('');

  function openCreate() {
    setEditing(null);
    setName('');
    setType('bank');
    setBankId(null);
    setOpeningKurus(0);
    setArchived(false);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(account: Account) {
    setEditing(account);
    setName(account.name);
    setType(account.type);
    setBankId(account.bankId);
    setOpeningKurus(account.openingBalanceKurus);
    setArchived(account.archived);
    setError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        type,
        // Nakit hesap bankaya baglanamaz - formda secilmis olsa da temizlenir
        bankId: type === 'cash' ? null : bankId,
        openingBalanceKurus: openingKurus ?? 0,
        archived,
      };
      if (editing) await accountService.update(editing.id, input);
      else await accountService.create(input);
      setFormOpen(false);
      await accounts.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(force: boolean) {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await accountService.remove(deleting.id, force);
      setDeleting(null);
      await accounts.reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Islemi olan hesap: kullanici onaylarsa force ile tekrar denenir
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Silinemedi');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleTransfer() {
    if (fromId === null || toId === null || transferKurus === null) {
      setError('Kaynak hesap, hedef hesap ve tutar zorunlu');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await transactionService.transfer({
        fromAccountId: fromId,
        toAccountId: toId,
        amountKurus: transferKurus,
        date: transferDate,
        description: transferNote.trim() || null,
      });
      setTransferOpen(false);
      setTransferKurus(null);
      setTransferNote('');
      await accounts.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Transfer yapilamadi');
    } finally {
      setBusy(false);
    }
  }

  const activeAccounts = accounts.data ?? [];
  const totalKurus = activeAccounts
    .filter((a) => !a.archived)
    .reduce((sum, a) => sum + a.balanceKurus, 0);

  return (
    <>
      <PageHeader
        title="Hesaplar"
        description="Nakit, banka hesabi ve kredi kartlariniz"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
              Transfer
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              Hesap ekle
            </Button>
          </>
        }
      />

      {accounts.error && (
        <div className="mb-4">
          <Alert tone="error">{accounts.error}</Alert>
        </div>
      )}

      {activeAccounts.length > 0 && (
        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm text-slate-500">Toplam varlik (borclar dusulmus)</p>
          <p className="mt-1 text-2xl font-semibold">
            <Money kurus={totalKurus} signed />
          </p>
        </div>
      )}

      {!accounts.loading && activeAccounts.length === 0 && (
        <Card>
          <EmptyState
            icon={Wallet}
            title="Henuz hesap yok"
            description="Nakit cuzdaniniz, banka hesabiniz veya kredi kartinizi ekleyerek baslayin."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                Hesap ekle
              </Button>
            }
          />
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {activeAccounts.map((account) => {
          const Icon = TYPE_ICONS[account.type];
          return (
            <div
              key={account.id}
              className={`rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${
                account.archived ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{account.name}</p>
                    <p className="text-sm text-slate-500">
                      {ACCOUNT_TYPE_LABELS[account.type]}
                      {account.bankName && ` · ${account.bankName}`}
                      {account.archived && ' · arsivlenmis'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(account)} aria-label="Duzenle">
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDeleting(account);
                      setError(null);
                    }}
                    aria-label="Sil"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-xs text-slate-500">
                    {account.type === 'credit_card' ? 'Guncel borc/bakiye' : 'Bakiye'}
                  </p>
                  <p className="text-xl font-semibold">
                    <Money kurus={account.balanceKurus} signed />
                  </p>
                </div>
                <p className="text-xs text-slate-400">{account.transactionCount} islem</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <label className="inline-flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
          />
          <Archive className="h-4 w-4" aria-hidden />
          Arsivlenmis hesaplari da goster
        </label>
      </div>

      {/* --- Hesap formu --- */}
      <Modal
        open={formOpen}
        title={editing ? 'Hesabi duzenle' : 'Hesap ekle'}
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
            label="Hesap adi"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ornek: Vadesiz TL"
            autoFocus
            required
          />

          <SelectField
            label="Hesap turu"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            <option value="cash">Nakit</option>
            <option value="bank">Banka hesabi</option>
            <option value="credit_card">Kredi karti</option>
          </SelectField>

          {type !== 'cash' && (
            <SelectField
              label="Banka"
              value={bankId ?? ''}
              onChange={(e) => setBankId(e.target.value === '' ? null : Number(e.target.value))}
              hint={
                type === 'credit_card'
                  ? 'Faiz hesabi icin bankanin secilmesi gerekir'
                  : 'Istege bagli'
              }
            >
              <option value="">Secilmedi</option>
              {(banks.data ?? []).map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name}
                </option>
              ))}
            </SelectField>
          )}

          <MoneyInput
            label="Acilis bakiyesi"
            valueKurus={openingKurus}
            onChangeKurus={setOpeningKurus}
            hint="Bu hesabin uygulamaya baslarken sahip oldugu tutar. Kredi karti borcu icin eksi deger girin."
          />

          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-slate-700">
                Arsivle (gecmis islemler korunur, listelerde gizlenir)
              </span>
            </label>
          )}

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      {/* --- Transfer formu --- */}
      <Modal
        open={transferOpen}
        title="Hesaplar arasi transfer"
        onClose={() => setTransferOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTransferOpen(false)}>
              Vazgec
            </Button>
            <Button loading={busy} onClick={() => void handleTransfer()}>
              Transferi kaydet
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="info">
            Transferler gelir veya gider sayilmaz; yalnizca iki hesap arasinda para hareketi olarak
            kaydedilir ve raporlara dahil edilmez.
          </Alert>

          <SelectField
            label="Kaynak hesap"
            value={fromId ?? ''}
            onChange={(e) => setFromId(e.target.value === '' ? null : Number(e.target.value))}
            required
          >
            <option value="">Secin</option>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Hedef hesap"
            value={toId ?? ''}
            onChange={(e) => setToId(e.target.value === '' ? null : Number(e.target.value))}
            required
          >
            <option value="">Secin</option>
            {activeAccounts
              .filter((a) => a.id !== fromId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </SelectField>

          <MoneyInput label="Tutar" valueKurus={transferKurus} onChangeKurus={setTransferKurus} required />

          <TextField
            label="Tarih"
            type="date"
            value={transferDate}
            onChange={(e) => setTransferDate(e.target.value)}
            required
          />

          <TextField
            label="Aciklama"
            value={transferNote}
            onChange={(e) => setTransferNote(e.target.value)}
            placeholder="Istege bagli"
          />

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      {/* --- Silme onayi --- */}
      <ConfirmDialog
        open={deleting !== null}
        title="Hesabi sil"
        loading={busy}
        confirmLabel={
          deleting && deleting.transactionCount > 0 ? 'Islemlerle birlikte sil' : 'Evet, sil'
        }
        onClose={() => {
          setDeleting(null);
          setError(null);
        }}
        onConfirm={() => void handleDelete((deleting?.transactionCount ?? 0) > 0)}
        message={
          deleting && deleting.transactionCount > 0 ? (
            <>
              <strong>{deleting.name}</strong> hesabina bagli{' '}
              <strong>{deleting.transactionCount} islem kaydi</strong> da kalici olarak silinecek.
              Gecmisi korumak istiyorsaniz silmek yerine <strong>arsivleyin</strong>.
            </>
          ) : (
            <>
              <strong>{deleting?.name}</strong> silinecek. Bu hesaba bagli islem bulunmuyor.
            </>
          )
        }
      />
    </>
  );
}
