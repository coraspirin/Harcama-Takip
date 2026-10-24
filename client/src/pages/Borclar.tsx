import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarCheck,
  HandCoins,
  Landmark,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { debtService, type DebtInput } from '../services/debts.ts';
import { ApiError } from '../services/api.ts';
import {
  DEBT_KIND_LABELS,
  type Debt,
  type DebtDirection,
  type DebtKind,
  type StrategyResult,
} from '../types/index.ts';
import { Button } from '../components/ui/Button.tsx';
import { SelectField, TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { ConfirmDialog, Modal } from '../components/ui/Modal.tsx';
import { MoneyInput } from '../components/MoneyInput.tsx';
import { Money } from '../components/Money.tsx';
import { BorcDetayi, payoffSentence } from '../components/BorcDetayi.tsx';
import { formatDate, formatYearMonth, todayIso } from '../lib/format.ts';

/** "4,25" -> 425 baz puan. Bos veya gecersizse null. */
function parsePercentToBp(text: string): number | null {
  const normalized = text.trim().replace('%', '').replace(',', '.');
  if (normalized === '') return 0;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 100);
}

function bpToPercentText(bp: number): string {
  return bp === 0 ? '' : (bp / 100).toLocaleString('tr-TR');
}

function Tile({
  label,
  children,
  note,
  tone = '',
}: {
  label: string;
  children: React.ReactNode;
  note?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${tone}`}>{children}</p>
      {note && <p className="mt-0.5 text-xs text-slate-400">{note}</p>}
    </div>
  );
}

function DebtCard({
  debt,
  onOpen,
  onPay,
  onBalance,
}: {
  debt: Debt;
  onOpen: () => void;
  onPay: () => void;
  onBalance: () => void;
}) {
  const lent = debt.direction === 'lent';
  const paidShare =
    debt.originalKurus > 0
      ? Math.min(100, Math.round(((debt.originalKurus - debt.currentBalanceKurus) / debt.originalKurus) * 100))
      : 0;
  const status = debt.forecast?.status;
  const warn = status === 'never';

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <button className="block w-full text-left" onClick={onOpen}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{debt.name}</p>
            <p className="truncate text-sm text-slate-500">
              {[DEBT_KIND_LABELS[debt.kind], debt.counterparty].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">
              <Money kurus={debt.currentBalanceKurus} />
            </p>
            {debt.monthlyPaymentKurus !== null && (
              <p className="text-xs text-slate-500">
                ayda <Money kurus={debt.monthlyPaymentKurus} />
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${lent ? 'bg-sky-500' : 'bg-emerald-500'}`}
            style={{ width: `${paidShare}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          %{paidShare} {lent ? 'tahsil edildi' : 'odendi'} ·{' '}
          <Money kurus={debt.originalKurus} /> uzerinden
        </p>

        <p
          className={`mt-2 flex items-center gap-1.5 text-sm ${
            warn ? 'font-medium text-red-600' : status === 'ends' ? 'text-slate-700' : 'text-slate-500'
          }`}
        >
          {warn ? (
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <CalendarCheck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          )}
          {payoffSentence(debt.forecast, lent)}
          {status === 'ends' && (debt.forecast?.totalInterestKurus ?? 0) > 0 && (
            <span className="text-slate-500">
              {' '}
              · faiz ~<Money kurus={debt.forecast!.totalInterestKurus!} />
            </span>
          )}
        </p>
        {warn && debt.forecast && (
          <p className="mt-0.5 text-xs text-red-600">
            Aylik faiz yaklasik <Money kurus={debt.forecast.firstMonthInterestKurus} />; odeme
            bunun uzerinde olmali.
          </p>
        )}
      </button>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onPay}>
          <Plus className="h-4 w-4" aria-hidden />
          {lent ? 'Tahsilat gir' : 'Odeme gir'}
        </Button>
        <Button size="sm" variant="secondary" onClick={onBalance}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Bakiye guncelle
        </Button>
      </div>
    </div>
  );
}

function StrategyColumn({ title, hint, result }: { title: string; hint: string; result: StrategyResult }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="font-medium text-slate-900">{title}</p>
      <p className="text-xs text-slate-500">{hint}</p>
      {result.status === 'ends' ? (
        <>
          <p className="mt-2 text-sm">
            Hepsi <strong>{formatYearMonth(result.payoffMonth!)}</strong> ayinda biter ({result.months}{' '}
            ay)
          </p>
          <p className="text-sm text-slate-600">
            Toplam faiz ~<Money kurus={result.totalInterestKurus ?? 0} />
          </p>
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
            {result.order.map((item) => (
              <li key={item.id}>
                {item.name} — {formatYearMonth(item.payoffMonth)}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="mt-2 text-sm text-red-600">Bu butceyle borclar bitmiyor.</p>
      )}
    </div>
  );
}

const EMPTY_FORM = {
  kind: 'loan' as DebtKind,
  direction: 'owe' as DebtDirection,
  name: '',
  counterparty: '',
  balanceKurus: null as number | null,
  originalKurus: null as number | null,
  monthlyPaymentKurus: null as number | null,
  interestText: '',
  taxesIncluded: false,
  note: '',
  closed: false,
};

export default function Borclar() {
  const [showClosed, setShowClosed] = useState(false);
  const list = useAsync(() => debtService.list(showClosed), [showClosed]);
  const [extraKurus, setExtraKurus] = useState<number | null>(null);
  const plan = useAsync(() => debtService.plan(extraKurus ?? 0), [extraKurus]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detailOf, setDetailOf] = useState<Debt | null>(null);
  const [paying, setPaying] = useState<Debt | null>(null);
  const [rebalancing, setRebalancing] = useState<Debt | null>(null);
  const [deleting, setDeleting] = useState<Debt | null>(null);
  const [amountKurus, setAmountKurus] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [paymentNote, setPaymentNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const data = list.data;
  const debts = data?.debts ?? [];
  const owe = debts.filter((d) => d.direction === 'owe' && !d.closed);
  const lent = debts.filter((d) => d.direction === 'lent' && !d.closed);
  const closed = debts.filter((d) => d.closed);
  const installments = data?.installments ?? [];
  const totals = data?.totals;

  async function reloadAll() {
    await Promise.all([list.reload(), plan.reload()]);
  }

  function patchForm(patch: Partial<typeof EMPTY_FORM>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(debt: Debt) {
    setDetailOf(null);
    setEditing(debt);
    setForm({
      kind: debt.kind,
      direction: debt.direction,
      name: debt.name,
      counterparty: debt.counterparty ?? '',
      balanceKurus: debt.currentBalanceKurus,
      originalKurus: debt.originalKurus,
      monthlyPaymentKurus: debt.monthlyPaymentKurus,
      interestText: bpToPercentText(debt.monthlyInterestBp),
      taxesIncluded: debt.taxesIncluded,
      note: debt.note ?? '',
      closed: debt.closed,
    });
    setError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    const bp = parsePercentToBp(form.interestText);
    if (bp === null) {
      setError('Faiz orani 0 ile 100 arasinda bir yuzde olmali (or. 4,25)');
      return;
    }
    if (!editing && (form.balanceKurus === null || form.balanceKurus < 0)) {
      setError('Kalan borc tutarini girin');
      return;
    }

    const base: DebtInput = {
      kind: form.kind,
      direction: form.kind === 'personal' ? form.direction : 'owe',
      name: form.name.trim(),
      counterparty: form.counterparty.trim() || null,
      monthlyInterestBp: bp,
      taxesIncluded: form.kind !== 'personal' && form.taxesIncluded,
      monthlyPaymentKurus: form.monthlyPaymentKurus,
      note: form.note.trim() || null,
    };

    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await debtService.update(editing.id, {
          ...base,
          originalKurus: form.originalKurus ?? editing.originalKurus,
          closed: form.closed,
        });
      } else {
        await debtService.create({
          ...base,
          balanceKurus: form.balanceKurus!,
          originalKurus: form.originalKurus,
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

  function openPayment(debt: Debt) {
    setPaying(debt);
    setAmountKurus(debt.monthlyPaymentKurus);
    setDate(todayIso());
    setPaymentNote('');
    setError(null);
  }

  function openBalance(debt: Debt) {
    setRebalancing(debt);
    setAmountKurus(debt.currentBalanceKurus);
    setDate(todayIso());
    setError(null);
  }

  async function handlePayment() {
    if (!paying || amountKurus === null || amountKurus <= 0) {
      setError('Tutar girin');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await debtService.addPayment(paying.id, {
        date,
        amountKurus,
        note: paymentNote.trim() || null,
      });
      setNotice(
        res.affectsBalance
          ? null
          : `Odeme kaydedildi ancak ${formatDate(paying.balanceDate)} tarihli bildirilen bakiyeden once oldugu icin bakiyeyi degistirmedi.`,
      );
      setPaying(null);
      await reloadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function handleBalance() {
    if (!rebalancing || amountKurus === null || amountKurus < 0) {
      setError('Bakiye girin');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await debtService.setBalance(rebalancing.id, amountKurus, date);
      setRebalancing(null);
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
      await debtService.remove(deleting.id);
      setDeleting(null);
      setFormOpen(false);
      await reloadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusy(false);
    }
  }

  const nothing = !list.loading && debts.length === 0 && installments.length === 0;

  return (
    <>
      <PageHeader
        title="Borclar"
        description="Borclariniz, alacaklariniz ve ne zaman bitecekleri"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            Borc ekle
          </Button>
        }
      />

      {list.error && (
        <div className="mb-4">
          <Alert tone="error">{list.error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="info">{notice}</Alert>
        </div>
      )}

      {nothing ? (
        <Card>
          <EmptyState
            icon={Landmark}
            title="Kayitli borc yok"
            description="Kredi, kredi karti borcu veya bir yakininizla aranizdaki borc/alacagi ekleyin; ne zaman bitecegini hesaplayalim."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden />
                Borc ekle
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {totals && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Toplam borc" note="Taksitler dahil">
                <Money kurus={totals.oweKurus} />
              </Tile>
              <Tile label="Aylik odeme">
                <Money kurus={totals.monthlyPaymentKurus} />
              </Tile>
              <Tile label="Kalan tahmini faiz">
                <Money kurus={totals.remainingInterestKurus} />
              </Tile>
              <Tile
                label="Borcsuz kalma"
                tone={totals.debtFreeMonth ? 'text-emerald-600' : 'text-slate-500'}
                note={
                  totals.unknownForecastCount > 0
                    ? `${totals.unknownForecastCount} borcun bitisi hesaplanamiyor`
                    : 'Mevcut odemelerle, tahmini'
                }
              >
                {totals.debtFreeMonth ? formatYearMonth(totals.debtFreeMonth) : '—'}
              </Tile>
            </div>
          )}

          <p className="mb-4 text-xs text-slate-500">
            Borc odemeleri gider sayilmaz: kartla yaptiginiz harcamayi yaptiginiz anda gider olarak
            girin, karti veya krediyi odediginizde buraya odeme girin. Boylece ayni para iki kez
            sayilmaz.
          </p>

          {owe.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Borclar</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {owe.map((debt) => (
                  <DebtCard
                    key={debt.id}
                    debt={debt}
                    onOpen={() => setDetailOf(debt)}
                    onPay={() => openPayment(debt)}
                    onBalance={() => openBalance(debt)}
                  />
                ))}
              </div>
            </section>
          )}

          {installments.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Taksitler</h2>
                <Link to="/taksitler" className="text-sm font-medium text-brand-600 hover:underline">
                  Taksitlere git
                </Link>
              </div>
              <Card>
                <ul className="-my-2 divide-y divide-slate-100">
                  {installments.map((item) => (
                    <li key={item.itemId} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{item.name}</p>
                        <p className="text-sm text-slate-500">
                          {item.remainingCount} taksit kaldi
                          {item.lastDueDate && ` · son taksit ${formatYearMonth(item.lastDueDate.slice(0, 7))}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">
                          <Money kurus={item.remainingKurus} />
                        </p>
                        {item.monthlyKurus !== null && (
                          <p className="text-xs text-slate-500">
                            ayda <Money kurus={item.monthlyKurus} />
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {owe.length > 0 && (
            <section className="mb-6">
              <Card
                title="Fazladan odeme plani"
                description="Her ay borclara ek bir tutar ayirirsaniz hangi sirayla odemeli?"
              >
                <div className="max-w-xs">
                  <MoneyInput
                    label="Aylik ek tutar"
                    valueKurus={extraKurus}
                    onChangeKurus={setExtraKurus}
                    hint="Kapanan borcun aylik odemesi de siradakine aktarilir"
                  />
                </div>
                {plan.data && (
                  <>
                    {plan.data.baseline.status === 'ends' && (
                      <p className="mt-3 text-sm text-slate-600">
                        Ek odeme olmadan: hepsi {formatYearMonth(plan.data.baseline.payoffMonth!)} (
                        {plan.data.baseline.months} ay), faiz ~
                        <Money kurus={plan.data.baseline.totalInterestKurus ?? 0} />
                      </p>
                    )}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <StrategyColumn
                        title="Cig yontemi"
                        hint="En yuksek faizli borc once — en az faiz"
                        result={plan.data.avalanche}
                      />
                      <StrategyColumn
                        title="Kartopu yontemi"
                        hint="En kucuk borc once — borc sayisi hizla azalir"
                        result={plan.data.snowball}
                      />
                    </div>
                  </>
                )}
              </Card>
            </section>
          )}

          {lent.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <HandCoins className="h-4 w-4" aria-hidden />
                Alacaklar
                {totals && (
                  <span className="font-normal text-slate-500">
                    {' '}
                    · toplam <Money kurus={totals.lentKurus} />
                  </span>
                )}
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {lent.map((debt) => (
                  <DebtCard
                    key={debt.id}
                    debt={debt}
                    onOpen={() => setDetailOf(debt)}
                    onPay={() => openPayment(debt)}
                    onBalance={() => openBalance(debt)}
                  />
                ))}
              </div>
            </section>
          )}

          {showClosed && closed.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Kapatilanlar</h2>
              <Card>
                <ul className="-my-2 divide-y divide-slate-100">
                  {closed.map((debt) => (
                    <li key={debt.id} className="flex items-center justify-between py-2.5">
                      <button className="text-left" onClick={() => openEdit(debt)}>
                        <p className="font-medium text-slate-500">{debt.name}</p>
                        <p className="text-xs text-slate-400">{DEBT_KIND_LABELS[debt.kind]}</p>
                      </button>
                      <Money kurus={debt.paidTotalKurus} className="text-sm text-slate-500" />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            Kapatilan borclari da goster
          </label>
        </>
      )}

      {detailOf && (
        <BorcDetayi
          debt={debts.find((d) => d.id === detailOf.id) ?? detailOf}
          onClose={() => setDetailOf(null)}
          onEdit={() => openEdit(detailOf)}
          onChanged={reloadAll}
        />
      )}

      <Modal
        open={formOpen}
        title={editing ? 'Borcu duzenle' : 'Borc ekle'}
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
          <SelectField
            label="Tur"
            value={form.kind}
            onChange={(e) => patchForm({ kind: e.target.value as DebtKind })}
          >
            <option value="loan">Kredi (ihtiyac, konut, tasit)</option>
            <option value="credit_card">Kredi karti</option>
            <option value="personal">Kisiye borc / alacak</option>
          </SelectField>

          {form.kind === 'personal' && (
            <SelectField
              label="Yon"
              value={form.direction}
              onChange={(e) => patchForm({ direction: e.target.value as DebtDirection })}
            >
              <option value="owe">Ben borcluyum</option>
              <option value="lent">Bana borclu (alacak)</option>
            </SelectField>
          )}

          <TextField
            label="Ad"
            value={form.name}
            onChange={(e) => patchForm({ name: e.target.value })}
            placeholder={form.kind === 'credit_card' ? 'or. Bonus kart' : 'or. Ihtiyac kredisi'}
            required
            autoFocus
          />

          <TextField
            label={form.kind === 'personal' ? 'Kisi' : 'Banka / kurum'}
            value={form.counterparty}
            onChange={(e) => patchForm({ counterparty: e.target.value })}
            placeholder="Istege bagli"
          />

          {!editing ? (
            <MoneyInput
              label={form.direction === 'lent' && form.kind === 'personal' ? 'Kalan alacak' : 'Kalan borc'}
              valueKurus={form.balanceKurus}
              onChangeKurus={(v) => patchForm({ balanceKurus: v })}
              hint="Bugunku guncel bakiye (ekstre veya banka uygulamasindan)"
              required
            />
          ) : (
            <p className="text-sm text-slate-600">
              Guncel bakiye: <Money kurus={editing.currentBalanceKurus} /> — degistirmek icin
              "Bakiye guncelle"yi kullanin.
            </p>
          )}

          <MoneyInput
            label="Baslangic tutari"
            valueKurus={form.originalKurus}
            onChangeKurus={(v) => patchForm({ originalKurus: v })}
            hint="Ilerleme cubugu icin; bos birakilirsa kalan borc kullanilir"
          />

          <MoneyInput
            label={form.direction === 'lent' && form.kind === 'personal' ? 'Aylik beklenen tahsilat' : 'Aylik odeme'}
            valueKurus={form.monthlyPaymentKurus}
            onChangeKurus={(v) => patchForm({ monthlyPaymentKurus: v })}
            hint={
              form.kind === 'credit_card'
                ? 'Her ay odemeyi planladiginiz tutar (asgari veya daha fazlasi)'
                : 'Taksit tutari; bitis tarihi bununla hesaplanir'
            }
          />

          <TextField
            label="Aylik faiz orani (%)"
            value={form.interestText}
            onChange={(e) => patchForm({ interestText: e.target.value })}
            placeholder={form.kind === 'personal' ? 'Genelde faizsiz — bos birakin' : 'or. 4,25'}
            inputMode="decimal"
            hint="Yillik degil AYLIK oran. Sabit taksitli kredide sozlesmedeki aylik orani girin."
          />

          {form.kind !== 'personal' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.taxesIncluded}
                onChange={(e) => patchForm({ taxesIncluded: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-slate-700">Faize KKDF + BSMV ekle (%30)</span>
            </label>
          )}

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
        open={paying !== null}
        title={paying?.direction === 'lent' ? 'Tahsilat gir' : 'Odeme gir'}
        onClose={() => setPaying(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPaying(null)}>
              Vazgec
            </Button>
            <Button loading={busy} onClick={() => void handlePayment()}>
              Kaydet
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <strong>{paying?.name}</strong> · kalan <Money kurus={paying?.currentBalanceKurus ?? 0} />
          </p>
          <MoneyInput label="Tutar" valueKurus={amountKurus} onChangeKurus={setAmountKurus} required autoFocus />
          <TextField label="Tarih" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <TextField
            label="Not"
            value={paymentNote}
            onChange={(e) => setPaymentNote(e.target.value)}
            placeholder="Istege bagli"
          />
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <Modal
        open={rebalancing !== null}
        title="Bakiye guncelle"
        onClose={() => setRebalancing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRebalancing(null)}>
              Vazgec
            </Button>
            <Button loading={busy} onClick={() => void handleBalance()}>
              Kaydet
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Ekstrenizde veya banka uygulamanizda gorunen guncel tutari girin. Bu tarihe kadarki
            odemelerin bu tutara yansidigi kabul edilir; faiz tahmini de boylece duzelir.
          </p>
          <MoneyInput label="Guncel bakiye" valueKurus={amountKurus} onChangeKurus={setAmountKurus} required autoFocus />
          <TextField label="Tarih" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Borcu sil"
        loading={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void handleDelete()}
        message={
          <>
            <strong>{deleting?.name}</strong> ve tum odeme kayitlari kalici olarak silinecek. Borc
            bittiyse silmek yerine "Kapatildi" olarak isaretleyebilirsiniz.
          </>
        }
      />
    </>
  );
}
