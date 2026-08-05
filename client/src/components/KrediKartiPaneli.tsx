import { useState } from 'react';
import { Info, Plus, ReceiptText, Trash2 } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { statementService } from '../services/finance.ts';
import { ApiError } from '../services/api.ts';
import type { Account, CardStatement } from '../types/index.ts';
import { Button } from './ui/Button.tsx';
import { TextField } from './ui/Field.tsx';
import { Alert } from './ui/Alert.tsx';
import { EmptyState } from './ui/Card.tsx';
import { ConfirmDialog, Modal } from './ui/Modal.tsx';
import { MoneyInput } from './MoneyInput.tsx';
import { Money } from './Money.tsx';
import { formatDate, todayIso } from '../lib/format.ts';

/**
 * Kredi kartinin ekstre kayitlari ve TAHMINI faiz ozeti.
 *
 * Onemli: hesap bakiyesi her zaman islemlerden gelir. Buradaki ekstre tutari
 * ayri bir kayittir; ikisi arasindaki fark kullaniciya uyari olarak gosterilir.
 */
export function KrediKartiPaneli({
  account,
  open,
  onClose,
  onChanged,
}: {
  account: Account;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const summary = useAsync(() => statementService.summary(account.id), [account.id]);
  const statements = useAsync(() => statementService.list(account.id), [account.id]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CardStatement | null>(null);
  const [deleting, setDeleting] = useState<CardStatement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [statementKurus, setStatementKurus] = useState<number | null>(null);
  const [paidKurus, setPaidKurus] = useState<number | null>(0);
  const [minimumKurus, setMinimumKurus] = useState<number | null>(null);

  function openCreate() {
    setEditing(null);
    setPeriodEnd(todayIso());
    setDueDate('');
    setStatementKurus(null);
    setPaidKurus(0);
    setMinimumKurus(null);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(statement: CardStatement) {
    setEditing(statement);
    setPeriodEnd(statement.periodEnd);
    setDueDate(statement.dueDate ?? '');
    setStatementKurus(statement.statementAmountKurus);
    setPaidKurus(statement.paidAmountKurus);
    setMinimumKurus(statement.minimumPaymentKurus);
    setError(null);
    setFormOpen(true);
  }

  async function reloadAll() {
    await Promise.all([summary.reload(), statements.reload()]);
    onChanged();
  }

  async function handleSave() {
    if (statementKurus === null) {
      setError('Ekstre tutari zorunlu');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const input = {
        accountId: account.id,
        periodEnd,
        dueDate: dueDate || null,
        statementAmountKurus: statementKurus,
        paidAmountKurus: paidKurus ?? 0,
        minimumPaymentKurus: minimumKurus,
      };
      if (editing) await statementService.update(editing.id, input);
      else await statementService.create(input);
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
      await statementService.remove(deleting.id);
      setDeleting(null);
      await reloadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  const data = summary.data;
  const interest = data?.interest;
  const reconciliation = data?.reconciliation;

  return (
    <>
      <Modal open={open} title={`${account.name} — ekstre ve faiz`} onClose={onClose} size="lg">
        <div className="space-y-5">
          {data?.warning && <Alert tone="warning">{data.warning}</Alert>}
          {summary.error && <Alert tone="error">{summary.error}</Alert>}

          {/* --- Tahmini borc ozeti --- */}
          {interest && data?.statement ? (
            <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-slate-600">Tahmini kalan borc</p>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  TAHMINI
                </span>
              </div>

              <p className="mt-1 text-2xl font-semibold text-slate-900">
                <Money kurus={interest.estimatedDebtKurus} />
              </p>

              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Ekstre tutari</dt>
                  <dd className="tabular">
                    <Money kurus={data.statement.statementAmountKurus} />
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Odenen</dt>
                  <dd className="tabular">
                    <Money kurus={data.statement.paidAmountKurus} />
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-1.5">
                  <dt className="text-slate-500">Kalan borc</dt>
                  <dd className="tabular font-medium">
                    <Money kurus={interest.unpaidKurus} />
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">
                    Faiz (%{(interest.monthlyInterestBp / 100).toFixed(2).replace('.', ',')} / ay)
                  </dt>
                  <dd className="tabular">
                    <Money kurus={interest.baseInterestKurus} />
                  </dd>
                </div>
                {interest.taxesIncluded && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">KKDF + BSMV</dt>
                    <dd className="tabular">
                      <Money kurus={interest.taxKurus} />
                    </dd>
                  </div>
                )}
              </dl>

              <p className="mt-3 flex gap-2 text-xs text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Bu tutar bir tahmindir. Bankalar faizi gun bazinda ve islem tarihlerine gore
                isletir; gercek ekstre tutari farkli cikabilir.
              </p>
            </div>
          ) : (
            !summary.loading && (
              <EmptyState
                icon={ReceiptText}
                title="Henuz ekstre girilmemis"
                description="Donem borcunuzu ve odediginiz tutari girerek tahmini faizi gorebilirsiniz."
                action={
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Ekstre ekle
                  </Button>
                }
              />
            )
          )}

          {/* --- Mutabakat --- */}
          {reconciliation && !reconciliation.matches && (
            <Alert tone="warning" title="Ekstre ile islemler uyusmuyor">
              Ekstrede <strong>{formatKurusInline(reconciliation.statementAmountKurus)}</strong>,
              girilen islemlerde{' '}
              <strong>{formatKurusInline(reconciliation.transactionsTotalKurus)}</strong> var —{' '}
              <strong>{formatKurusInline(Math.abs(reconciliation.differenceKurus))}</strong> fark.
              {reconciliation.differenceKurus > 0
                ? ' Girilmemis bir harcama olabilir.'
                : ' Fazladan girilmis bir kayit olabilir.'}
            </Alert>
          )}

          {reconciliation?.matches && (
            <Alert tone="success">Ekstre tutari girilen islemlerle birebir uyusuyor.</Alert>
          )}

          {/* --- Ekstre listesi --- */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Ekstre gecmisi</h3>
              <Button size="sm" variant="secondary" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                Ekstre ekle
              </Button>
            </div>

            {statements.data && statements.data.length > 0 ? (
              <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {statements.data.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openEdit(s)}
                      aria-label="Duzenle"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        Kesim: {formatDate(s.periodEnd)}
                        {s.dueDate && ` · Son odeme: ${formatDate(s.dueDate)}`}
                      </p>
                      <p className="text-sm text-slate-500">
                        Ekstre <Money kurus={s.statementAmountKurus} /> · Odenen{' '}
                        <Money kurus={s.paidAmountKurus} />
                      </p>
                    </button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(s)} aria-label="Sil">
                      <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Kayitli ekstre yok.</p>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={formOpen}
        title={editing ? 'Ekstreyi duzenle' : 'Ekstre ekle'}
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
            label="Ekstre kesim tarihi"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            required
          />
          <TextField
            label="Son odeme tarihi"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            hint="Istege bagli"
          />
          <MoneyInput
            label="Ekstre tutari (donem borcu)"
            valueKurus={statementKurus}
            onChangeKurus={setStatementKurus}
            required
          />
          <MoneyInput
            label="Odenen tutar"
            valueKurus={paidKurus}
            onChangeKurus={setPaidKurus}
            hint="Tamami odendiyse ekstre tutariyla ayni girin; faiz sifir olur."
          />
          <MoneyInput
            label="Asgari odeme tutari"
            valueKurus={minimumKurus}
            onChangeKurus={setMinimumKurus}
            hint="Istege bagli"
          />

          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Ekstreyi sil"
        loading={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message="Bu ekstre kaydi silinecek. Hesap bakiyeniz etkilenmez; yalnizca faiz tahmini ve mutabakat bilgisi kaybolur."
      />
    </>
  );
}

/** Alert icinde bilesenin degil metnin gerektigi yerler icin. */
function formatKurusInline(kurus: number): string {
  const lira = Math.floor(Math.abs(kurus) / 100);
  const kr = Math.abs(kurus) % 100;
  return `${kurus < 0 ? '-' : ''}${lira.toLocaleString('tr-TR')},${String(kr).padStart(2, '0')} ₺`;
}
