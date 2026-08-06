import { useState } from 'react';
import { ArrowLeftRight, RefreshCw, RotateCcw, Sparkles, X } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { matchingService, type TransferCandidate } from '../services/matching.ts';
import { ApiError } from '../services/api.ts';
import { Button } from '../components/ui/Button.tsx';
import { SelectField, TextField } from '../components/ui/Field.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { Money } from '../components/Money.tsx';
import { formatDate } from '../lib/format.ts';

export default function Transferler() {
  const data = useAsync(() => matchingService.candidates(), []);
  const settings = useAsync(() => matchingService.settings(), []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [dayWindow, setDayWindow] = useState<number | null>(null);
  const [selfAliases, setSelfAliases] = useState<string | null>(null);

  async function run<T>(action: () => Promise<T>, message?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (message) setNotice(message);
      await data.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Islem basarisiz');
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    const current = settings.data;
    if (!current) return;
    await run(async () => {
      await matchingService.saveSettings({
        dayWindow: dayWindow ?? current.dayWindow,
        autoLink: current.autoLink,
        selfAliases: selfAliases ?? current.selfAliases,
      });
      await settings.reload();
    }, 'Ayarlar kaydedildi.');
    setShowSettings(false);
  }

  const candidates = data.data?.candidates ?? [];
  const matched = data.data?.matched ?? [];
  const autoMatched = matched.filter((m) => m.matched === 'auto');

  return (
    <>
      <PageHeader
        title="Hesap arasi transferler"
        description="Kendi hesaplariniz arasindaki para hareketleri gelir/gider sayilmaz"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowSettings((v) => !v)}>
              Ayarlar
            </Button>
            <Button
              size="sm"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const res = await matchingService.scan();
                  setNotice(
                    `${res.result.linked} cift otomatik birlestirildi, ` +
                      `${res.result.pending} cift onayinizi bekliyor.`,
                  );
                })
              }
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Yeniden tara
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      <div className="mb-4">
        <Alert tone="info">
          Bir hesabinizdan digerine para gonderdiginizde bu hareket iki ekstrede birden gorunur:
          birinde <strong>gider</strong>, digerinde <strong>gelir</strong>. Eslestirilmezse aylik
          toplam gelir ve giderinizi birlikte sisirir. Eslestirilen ciftler raporlardan cikarilir,
          <strong> hesap bakiyeleriniz degismez</strong>.
        </Alert>
      </div>

      {showSettings && settings.data && (
        <Card title="Eslestirme ayarlari" className="mb-6">
          <div className="space-y-4">
            <SelectField
              label="Iki bacak arasinda izin verilen gun farki"
              value={dayWindow ?? settings.data.dayWindow}
              onChange={(e) => setDayWindow(Number(e.target.value))}
              hint="EFT hafta sonuna denk geldiginde karsi hesaba gecikmeli dusebilir."
            >
              <option value={0}>Yalnizca ayni gun</option>
              <option value={1}>±1 gun</option>
              <option value={3}>±3 gun</option>
              <option value={7}>±7 gun</option>
            </SelectField>

            <TextField
              label="Kendi ad yazimlariniz"
              value={selfAliases ?? settings.data.selfAliases}
              onChange={(e) => setSelfAliases(e.target.value)}
              hint="Virgulle ayirin. Ekstre aciklamasinda bu isimlerden biri gecerse cift kendine transfer sayilir."
              placeholder="AHMET YILMAZ, A. YILMAZ"
            />

            <Button loading={busy} onClick={() => void saveSettings()}>
              Kaydet
            </Button>
          </div>
        </Card>
      )}

      {/* Otomatik birlestirilenler EN USTTE: sessiz kalmamalilar */}
      {autoMatched.length > 0 && (
        <Card
          title="Otomatik eslestirilenler"
          description="Uygulama bunlari kesin transfer sayip birlestirdi. Yanlissa geri alin."
          className="mb-6"
        >
          <ul className="-my-2 divide-y divide-slate-100">
            {autoMatched.map((item) => (
              <li key={item.transferGroupId} className="flex flex-wrap items-center gap-3 py-3">
                <Sparkles className="h-4 w-4 shrink-0 text-brand-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">
                    {item.fromAccountName} → {item.toAccountName ?? '?'}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {formatDate(item.date)} · {item.description ?? 'Aciklama yok'}
                  </p>
                </div>
                <span className="tabular shrink-0 font-medium text-slate-900">
                  <Money kurus={item.amountKurus} />
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => matchingService.unlink(item.transferGroupId),
                      'Transfer geri alindi; islemler yeniden gelir/gider sayiliyor.',
                    )
                  }
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Bu transfer degil
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Onayinizi bekleyenler"
        description={`${candidates.length} olasi cift bulundu`}
      >
        {candidates.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="Bekleyen eslestirme yok"
            description="Ayni tutarli gider/gelir cifti bulunamadi. Ekstre yukledikten sonra tekrar bakin."
          />
        ) : (
          <ul className="space-y-3">
            {candidates.map((candidate) => (
              <CandidateRow
                key={`${candidate.expenseId}-${candidate.incomeId}`}
                candidate={candidate}
                busy={busy}
                onLink={() =>
                  void run(
                    () => matchingService.link(candidate.expenseId, candidate.incomeId),
                    'Transfer olarak isaretlendi.',
                  )
                }
                onReject={() =>
                  void run(
                    () => matchingService.reject(candidate.expenseId, candidate.incomeId),
                    'Bu cift bir daha onerilmeyecek.',
                  )
                }
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function CandidateRow({
  candidate,
  busy,
  onLink,
  onReject,
}: {
  candidate: TransferCandidate;
  busy: boolean;
  onLink: () => void;
  onReject: () => void;
}) {
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="tabular text-lg font-semibold text-slate-900">
          <Money kurus={candidate.amountKurus} />
        </span>
        {candidate.reason && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
            {candidate.reason}
          </span>
        )}
        {candidate.dayDifference > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            {candidate.dayDifference} gun fark
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-red-50 p-2.5">
          <p className="text-xs font-medium text-red-700">Cikan · {candidate.expenseAccountName}</p>
          <p className="text-sm text-slate-700">{formatDate(candidate.expenseDate)}</p>
          <p className="break-words text-sm text-slate-600">{candidate.expenseDescription}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2.5">
          <p className="text-xs font-medium text-emerald-700">
            Giren · {candidate.incomeAccountName}
          </p>
          <p className="text-sm text-slate-700">{formatDate(candidate.incomeDate)}</p>
          <p className="break-words text-sm text-slate-600">{candidate.incomeDescription}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onLink}>
          <ArrowLeftRight className="h-4 w-4" aria-hidden />
          Transfer say
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
          <X className="h-4 w-4" aria-hidden />
          Ilgisiz, bir daha sorma
        </Button>
      </div>
    </li>
  );
}
