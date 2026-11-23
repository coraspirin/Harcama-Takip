import { useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { getYearlyReport } from '../services/finance.ts';
import type { YearlyCategoryRow, YearlyReport } from '../types/index.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { Card, EmptyState } from './ui/Card.tsx';
import { Money } from './Money.tsx';
import { AylikTrend } from './charts/AylikTrend.tsx';
import { EXPENSE_COLOR, INCOME_COLOR, OTHER_COLOR } from '../lib/chartPalette.ts';
import { formatTRY, formatYearMonth } from '../lib/format.ts';

const TOP_CATEGORY_COUNT = 10;

const MONTH_NAMES = [
  'Ocak',
  'Subat',
  'Mart',
  'Nisan',
  'Mayis',
  'Haziran',
  'Temmuz',
  'Agustos',
  'Eylul',
  'Ekim',
  'Kasim',
  'Aralik',
];

function currentYear(): number {
  return new Date().getFullYear();
}

/** Onceki yila gore degisim: yesil iyi, kirmizi kotu; null -> "—". */
function YearChange({ percent, invert = false }: { percent: number | null; invert?: boolean }) {
  if (percent === null) {
    return (
      <span className="text-xs text-slate-400" aria-label="Onceki yil verisi yok">
        —
      </span>
    );
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
      <Icon className="h-3.5 w-3.5" aria-hidden />%{Math.abs(rounded)} onceki yila gore
    </span>
  );
}

function SummaryCard({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{children}</p>
      <p className="mt-1">{note}</p>
    </div>
  );
}

function CategoryList({
  rows,
  tone,
  invert,
  emptyText,
}: {
  rows: YearlyCategoryRow[];
  tone: 'income' | 'expense';
  invert: boolean;
  emptyText: string;
}) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return <p className="text-sm text-slate-500">{emptyText}</p>;

  const visible = showAll ? rows : rows.slice(0, TOP_CATEGORY_COUNT);
  const barColor = tone === 'income' ? INCOME_COLOR : EXPENSE_COLOR;

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {visible.map((row) => (
          <li key={row.categoryId ?? 'none'} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium text-slate-900">
                {row.categoryName}
              </span>
              <span className="tabular shrink-0 font-medium text-slate-900">
                {formatTRY(row.totalKurus)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, Math.max(0, row.sharePercent))}%`,
                  backgroundColor: barColor,
                }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
              <span>
                %{row.sharePercent.toFixed(1).replace('.', ',')} pay · {row.transactionCount} islem
              </span>
              <YearChange percent={row.changePercent} invert={invert} />
            </div>
          </li>
        ))}
      </ul>
      {rows.length > TOP_CATEGORY_COUNT && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Ilk 10 kategoriyi goster' : `Tumunu goster (${rows.length})`}
          </Button>
        </div>
      )}
    </>
  );
}

function NatureBar({ nature }: { nature: YearlyReport['expenseByNature'] }) {
  const total = nature.fixedKurus + nature.variableKurus + nature.uncategorizedKurus;
  if (total <= 0) return <p className="text-sm text-slate-500">Gider kaydi yok.</p>;

  const segments = [
    { label: 'Sabit', kurus: nature.fixedKurus, color: '#2a78d6' },
    { label: 'Degisken', kurus: nature.variableKurus, color: '#eb6834' },
    { label: 'Kategorisiz', kurus: nature.uncategorizedKurus, color: OTHER_COLOR },
  ];

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {segments.map((s) => (
          <div
            key={s.label}
            style={{ width: `${(s.kurus / total) * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {segments.map((s) => (
          <div key={s.label}>
            <dt className="flex items-center gap-1.5 text-sm text-slate-500">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              {s.label}
            </dt>
            <dd className="tabular mt-0.5 font-medium text-slate-900">
              {formatTRY(s.kurus)}{' '}
              <span className="text-xs font-normal text-slate-500">
                (%{Math.round((s.kurus / total) * 100)})
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MonthlyTable({ months }: { months: YearlyReport['months'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Aylik gelir, gider ve net tablosu</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th scope="col" className="py-2 pr-3 font-medium">
              Ay
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Gelir
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Gider
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Net
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row" className="py-2 pr-3 text-left font-normal text-slate-700">
                {MONTH_NAMES[Number(m.month.slice(5, 7)) - 1] ?? m.month}
              </th>
              <td className="px-3 py-2 text-right">
                <Money kurus={m.incomeKurus} />
              </td>
              <td className="px-3 py-2 text-right">
                <Money kurus={m.expenseKurus} />
              </td>
              <td className="py-2 pl-3 text-right">
                <Money kurus={m.netKurus} signed />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isEmptyYear(r: YearlyReport): boolean {
  return (
    r.totals.incomeKurus === 0 &&
    r.totals.expenseKurus === 0 &&
    r.expenseByCategory.length === 0 &&
    r.incomeByCategory.length === 0
  );
}

export function YillikRapor() {
  const thisYear = currentYear();
  const [year, setYear] = useState(thisYear);
  const [tableOpen, setTableOpen] = useState(false);

  const report = useAsync(() => getYearlyReport(year), [year]);
  const data = report.data;

  const picker = (
    <div className="mb-4 inline-flex items-center gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setYear((y) => y - 1)}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Onceki yil"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <span className="min-w-20 text-center text-sm font-medium text-slate-900">{year}</span>
      <button
        type="button"
        onClick={() => setYear((y) => y + 1)}
        disabled={year >= thisYear}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Sonraki yil"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );

  if (report.error) {
    return (
      <>
        {picker}
        <Alert tone="error">{report.error}</Alert>
      </>
    );
  }

  if (!data) {
    return (
      <>
        {picker}
        <p className="text-sm text-slate-500" role="status">
          Yukleniyor...
        </p>
      </>
    );
  }

  if (isEmptyYear(data)) {
    return (
      <>
        {picker}
        <Card className={report.loading ? 'opacity-60 transition-opacity' : ''}>
          <EmptyState
            icon={CalendarRange}
            title="Bu yil icin kayitli islem yok."
            description="Baska bir yil secin ya da islem ekleyin."
          />
        </Card>
      </>
    );
  }

  const { totals, changePercent, highlights } = data;
  const lastMonthName = MONTH_NAMES[Math.max(0, data.monthsElapsed - 1)] ?? '';

  return (
    <>
      {picker}
      {data.isCurrentYear && (
        <p className="mb-3 text-xs text-slate-500">
          Ocak–{lastMonthName} verisi ({data.monthsElapsed} ay)
        </p>
      )}

      {/* Yeniden yuklemede onceki icerik soluk tutulur - sicrama olmaz */}
      <div className={report.loading ? 'opacity-60 transition-opacity' : ''}>
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Toplam gelir" note={<YearChange percent={changePercent.income} />}>
            <span className="text-emerald-600">
              <Money kurus={totals.incomeKurus} />
            </span>
          </SummaryCard>
          <SummaryCard
            label="Toplam gider"
            note={<YearChange percent={changePercent.expense} invert />}
          >
            <span className="text-red-600">
              <Money kurus={totals.expenseKurus} />
            </span>
          </SummaryCard>
          <SummaryCard label="Net" note={<YearChange percent={changePercent.net} />}>
            <Money kurus={totals.netKurus} signed />
          </SummaryCard>
          <SummaryCard
            label="Birikim orani"
            note={<span className="text-xs text-slate-400">Netin gelire orani</span>}
          >
            {totals.savingsRatePercent === null ? '—' : `%${Math.round(totals.savingsRatePercent)}`}
          </SummaryCard>
        </div>

        <div className="space-y-6">
          <Card
            title={`Aylik gelir ve gider — ${data.year}`}
            actions={
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={tableOpen}
                aria-controls="yillik-tablo"
                onClick={() => setTableOpen((v) => !v)}
              >
                {tableOpen ? 'Tabloyu gizle' : 'Tablo gorunumu'}
              </Button>
            }
          >
            <AylikTrend series={data.months} />
            <div id="yillik-tablo" className="mt-4" hidden={!tableOpen}>
              {tableOpen && <MonthlyTable months={data.months} />}
            </div>
          </Card>

          <Card title="One cikanlar">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-sm text-slate-500">En cok harcanan ay</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {highlights.highestExpenseMonth ? (
                    <>
                      {formatYearMonth(highlights.highestExpenseMonth.month)}
                      <span className="tabular block text-sm font-normal text-slate-600">
                        {formatTRY(highlights.highestExpenseMonth.expenseKurus)}
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">En az harcanan ay</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {highlights.lowestExpenseMonth ? (
                    <>
                      {formatYearMonth(highlights.lowestExpenseMonth.month)}
                      <span className="tabular block text-sm font-normal text-slate-600">
                        {formatTRY(highlights.lowestExpenseMonth.expenseKurus)}
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">Aylik ortalama gider</dt>
                <dd className="tabular mt-0.5 font-medium text-slate-900">
                  {formatTRY(highlights.averageMonthlyExpenseKurus)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">Aylik ortalama gelir</dt>
                <dd className="tabular mt-0.5 font-medium text-slate-900">
                  {formatTRY(highlights.averageMonthlyIncomeKurus)}
                </dd>
              </div>
            </dl>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Gider kategorileri" className="lg:col-span-2">
              <CategoryList
                rows={data.expenseByCategory}
                tone="expense"
                invert
                emptyText="Bu yil gider kaydi yok."
              />
            </Card>
            <Card title="Gelir kategorileri">
              <CategoryList
                rows={data.incomeByCategory}
                tone="income"
                invert={false}
                emptyText="Bu yil gelir kaydi yok."
              />
            </Card>
          </div>

          <Card title="Sabit ve degisken gider" description="Kategorinin niteligine gore dagilim">
            <NatureBar nature={data.expenseByNature} />
          </Card>
        </div>
      </div>
    </>
  );
}
