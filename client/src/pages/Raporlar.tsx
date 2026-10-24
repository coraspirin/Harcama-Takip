import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { reportService } from '../services/finance.ts';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, PageHeader } from '../components/ui/Card.tsx';
import { Money } from '../components/Money.tsx';
import { MonthPicker, currentYearMonth } from '../components/MonthPicker.tsx';
import { KategoriDagilimi } from '../components/charts/KategoriDagilimi.tsx';
import { AylikTrend } from '../components/charts/AylikTrend.tsx';
import { formatYearMonth } from '../lib/format.ts';

function ChangeNote({ percent, invert = false }: { percent: number | null; invert?: boolean }) {
  if (percent === null) {
    return <span className="text-xs text-slate-400">onceki ay veri yok</span>;
  }

  const rounded = Math.round(percent);
  if (rounded === 0) return <span className="text-xs text-slate-500">degisim yok</span>;

  const rising = rounded > 0;
  const good = invert ? !rising : rising;
  const Icon = rising ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        good ? 'text-emerald-600' : 'text-red-600'
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />%{Math.abs(rounded)} onceki aya gore
    </span>
  );
}

const TREND_MONTHS = 12;

export default function Raporlar() {
  const [month, setMonth] = useState(currentYearMonth());
  const [breakdownKind, setBreakdownKind] = useState<'expense' | 'income'>('expense');

  const monthly = useAsync(() => reportService.monthly(month), [month]);
  const trend = useAsync(() => reportService.trend(month, TREND_MONTHS), [month]);

  const data = monthly.data;
  const breakdown =
    breakdownKind === 'expense' ? (data?.expenseByCategory ?? []) : (data?.incomeByCategory ?? []);

  return (
    <>
      <PageHeader title="Raporlar" description="Aylik ozet, kategori kirilimi ve trend" />

      {/* Tek filtre satiri: asagidaki tum grafikleri ayni dilime gore yeniler */}
      <div className="mb-4">
        <MonthPicker value={month} onChange={setMonth} />
      </div>

      {(monthly.error || trend.error) && (
        <div className="mb-4">
          <Alert tone="error">{monthly.error ?? trend.error}</Alert>
        </div>
      )}

      {/* Yeniden yuklemede iskelet yerine onceki icerik soluk tutulur - siçrama olmaz */}
      <div className={monthly.loading && data ? 'opacity-60 transition-opacity' : ''}>
        {data && (
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Gelir</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-600">
                <Money kurus={data.totals.incomeKurus} />
              </p>
              <p className="mt-1">
                <ChangeNote percent={data.previous.incomeChangePercent} />
              </p>
            </div>

            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Gider</p>
              <p className="mt-1 text-2xl font-semibold text-red-600">
                <Money kurus={data.totals.expenseKurus} />
              </p>
              <p className="mt-1">
                <ChangeNote percent={data.previous.expenseChangePercent} invert />
              </p>
            </div>

            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Net</p>
              <p className="mt-1 text-2xl font-semibold">
                <Money kurus={data.totals.netKurus} signed />
              </p>
              <p className="mt-1 text-xs text-slate-400">Gelir eksi gider</p>
            </div>
          </div>
        )}

        <div className="space-y-6">
          <Card
            title={`Kategori dagilimi — ${formatYearMonth(month)}`}
            actions={
              <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                {(['expense', 'income'] as const).map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setBreakdownKind(kind)}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                      breakdownKind === kind
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {kind === 'expense' ? 'Gider' : 'Gelir'}
                  </button>
                ))}
              </div>
            }
          >
            <KategoriDagilimi items={breakdown} />
          </Card>

          <Card
            title="Aylik trend"
            description={`Son ${TREND_MONTHS} ay — islem olmayan aylar sifir gosterilir`}
          >
            {trend.data && <AylikTrend series={trend.data.series} />}
          </Card>

        </div>
      </div>
    </>
  );
}
