import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingDown, TrendingUp, Minus as Flat } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { reportService } from '../services/finance.ts';
import { Alert } from './ui/Alert.tsx';
import { Card, EmptyState } from './ui/Card.tsx';
import { Money } from './Money.tsx';
import { GidisatGrafigi } from './charts/GidisatGrafigi.tsx';
import { formatTRY, formatYearMonth } from '../lib/format.ts';

const BASES = [3, 6, 12] as const;
type Basis = (typeof BASES)[number];

/** Kaydirici adimi: 50 TL */
const CUT_STEP_KURUS = 5_000;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function Row({ label, kurus, sign }: { label: string; kurus: number; sign?: '+' | '−' }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <dt className="text-slate-600">
        {sign && <span className="mr-1 inline-block w-3 text-slate-400">{sign}</span>}
        {label}
      </dt>
      <dd className="tabular text-slate-900">
        <Money kurus={kurus} />
      </dd>
    </div>
  );
}

export function GidisatRaporu() {
  const [basis, setBasis] = useState<Basis>(6);
  const [cutKurus, setCutKurus] = useState(0);
  const debouncedCut = useDebounced(cutKurus, 300);
  const [showTable, setShowTable] = useState(false);

  const forecast = useAsync(() => reportService.forecast(basis, debouncedCut), [basis, debouncedCut]);
  const data = forecast.data;

  if (forecast.error) return <Alert tone="error">{forecast.error}</Alert>;
  if (!data) return null;

  if (!data.hasHistory) {
    return (
      <Card>
        <EmptyState
          icon={TrendingUp}
          title="Tahmin icin gecmis veri yok"
          description="Gidisat, gecmis tam aylarin ortalamasindan hesaplanir. Birkac ay gelir ve gider girdikten sonra burada 12 aylik tahmin goreceksiniz."
        />
      </Card>
    );
  }

  const avg = data.averages;
  const maxCut = Math.max(CUT_STEP_KURUS, Math.floor(avg.variableExpenseKurus / CUT_STEP_KURUS) * CUT_STEP_KURUS);
  const lastMonth = data.projection[data.projection.length - 1]?.month;
  const DirectionIcon =
    data.direction === 'improving' ? TrendingDown : data.direction === 'worsening' ? TrendingUp : Flat;
  const hasDebt = data.start.debtKurus > 0;

  return (
    <div className={forecast.loading ? 'opacity-60 transition-opacity' : ''}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-600">Ortalama:</span>
        <div className="flex gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {BASES.map((b) => (
            <button
              key={b}
              onClick={() => setBasis(b)}
              className={`rounded-md px-3 py-1 text-sm font-medium ${
                basis === b ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Son {b} ay
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          {avg.months} ayin verisi · bu ay yarim oldugu icin dahil degil
        </span>
      </div>

      <div
        className={`mb-6 flex items-start gap-3 rounded-xl p-4 ring-1 ${
          data.direction === 'improving'
            ? 'bg-emerald-50 ring-emerald-200'
            : data.direction === 'worsening'
              ? 'bg-red-50 ring-red-200'
              : 'bg-slate-50 ring-slate-200'
        }`}
      >
        <DirectionIcon
          className={`mt-0.5 h-5 w-5 shrink-0 ${
            data.direction === 'improving'
              ? 'text-emerald-600'
              : data.direction === 'worsening'
                ? 'text-red-600'
                : 'text-slate-500'
          }`}
          aria-hidden
        />
        <div className="text-sm text-slate-800">
          <p className="font-semibold">
            {data.direction === 'improving'
              ? 'Boyle giderse durumunuz iyilesiyor'
              : data.direction === 'worsening'
                ? 'Boyle giderse durumunuz kotulesiyor'
                : 'Boyle giderse durumunuz degismiyor'}
          </p>
          <p className="mt-0.5">
            {lastMonth && formatYearMonth(lastMonth)} sonunda
            {hasDebt && (
              <>
                {' '}borcunuz <strong>{formatTRY(data.start.debtKurus)}</strong> →{' '}
                <strong>{formatTRY(data.end.debtKurus)}</strong>,
              </>
            )}{' '}
            {data.end.cashKurus >= 0 ? 'biriken nakit' : 'nakit acigi'}{' '}
            <strong>{formatTRY(Math.abs(data.end.cashKurus))}</strong> olur.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Tahminidir: son aylarin ortalamasi aynen surerse. Bayram, okul donemi, kis faturasi gibi
            dalgalanmalar sonucu degistirir.
          </p>
        </div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Aylik ortalama nakit akisi">
          <dl className="divide-y divide-slate-100">
            <Row label="Gelir" kurus={avg.incomeKurus} sign="+" />
            <Row label="Sabit gider" kurus={avg.fixedExpenseKurus} sign="−" />
            <Row label="Degisken gider" kurus={avg.variableExpenseKurus} sign="−" />
            <Row label="Borc odemeleri" kurus={data.monthlyDebtPaymentKurus} sign="−" />
            <Row label="Birikim plani" kurus={data.savingsPlanKurus} sign="−" />
            <div className="flex justify-between gap-3 pt-2.5 text-sm font-semibold">
              <dt>Ayda kalan</dt>
              <dd className={data.monthlyFreeCashKurus < 0 ? 'text-red-600' : 'text-emerald-600'}>
                <Money kurus={data.monthlyFreeCashKurus} />
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-slate-400">
            Taksitler ayrica her ayin planina gore dusulur. Sabit/degisken ayrimi kategori ayarindan
            gelir.
          </p>
        </Card>

        <div className="lg:col-span-2">
          <Card title="12 aylik tahmin" description="Kalan borc ve biriken nakit">
            <GidisatGrafigi projection={data.projection} scenario={data.scenario?.projection} />
            <button
              className="mt-2 text-sm font-medium text-brand-600 hover:underline"
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? 'Tabloyu gizle' : 'Tablo olarak goster'}
            </button>
            {showTable && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 font-medium">Ay</th>
                      <th className="pb-2 text-right font-medium">Kalan borc</th>
                      {data.scenario && <th className="pb-2 text-right font-medium">Senaryo</th>}
                      <th className="pb-2 text-right font-medium">Biriken nakit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.projection.map((p, i) => (
                      <tr key={p.month}>
                        <td className="py-1.5">{formatYearMonth(p.month)}</td>
                        <td className="tabular py-1.5 text-right">
                          <Money kurus={p.debtKurus} />
                        </td>
                        {data.scenario && (
                          <td className="tabular py-1.5 text-right">
                            <Money kurus={data.scenario.projection[i]?.debtKurus ?? 0} />
                          </td>
                        )}
                        <td className="tabular py-1.5 text-right">
                          <Money kurus={p.cashKurus} signed />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card
        title="Ayda daha az harcarsam?"
        description="Degisken giderden kisip borca yatirdiginiz tutarin etkisi"
      >
        {!hasDebt ? (
          <p className="text-sm text-slate-500">
            Kayitli borcunuz yok. Borc eklerseniz, harcamayi kisarak ne kadar erken bitirebileceginizi
            burada gorursunuz. <Link to="/borclar" className="font-medium text-brand-600 hover:underline">Borclar</Link>
          </p>
        ) : (
          <>
            <label className="block text-sm text-slate-700">
              Ayda <strong>{formatTRY(cutKurus)}</strong> daha az harca
              <input
                type="range"
                min={0}
                max={maxCut}
                step={CUT_STEP_KURUS}
                value={Math.min(cutKurus, maxCut)}
                onChange={(e) => setCutKurus(Number(e.target.value))}
                className="mt-2 block w-full accent-brand-600"
              />
            </label>
            <div className="mt-1 flex justify-between text-xs text-slate-400">
              <span>0</span>
              <span>Ortalama degisken gider: {formatTRY(avg.variableExpenseKurus)}</span>
            </div>

            {data.scenario ? (
              <div className="mt-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-950">
                {data.scenario.debtFreeMonth ? (
                  <>
                    Borclariniz <strong>{formatYearMonth(data.scenario.debtFreeMonth)}</strong> ayinda
                    biter
                    {data.scenario.baselineDebtFreeMonth && (
                      <> (simdiki tempoyla {formatYearMonth(data.scenario.baselineDebtFreeMonth)})</>
                    )}
                    .
                    {data.scenario.monthsSaved !== null && data.scenario.monthsSaved > 0 && (
                      <>
                        {' '}<strong>{data.scenario.monthsSaved} ay</strong> erken ve yaklasik{' '}
                        <strong>{formatTRY(data.scenario.interestSavedKurus ?? 0)}</strong> daha az
                        faiz.
                      </>
                    )}
                  </>
                ) : (
                  'Bu tutarla da borclar bitmiyor: aylik odemeler faizi karsilamiyor.'
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">
                Kaydiriciyi oynatin; ayda ne kadar kisarsaniz borcun ne zaman bitecegini gorun.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
