import { Link } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Plus,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { dashboardService, reportService } from '../services/finance.ts';
import { scheduledService } from '../services/scheduled.ts';
import { currentYearMonth } from '../components/MonthPicker.tsx';
import { KategoriDagilimi } from '../components/charts/KategoriDagilimi.tsx';
import { AylikTrend } from '../components/charts/AylikTrend.tsx';
import { Alert } from '../components/ui/Alert.tsx';
import { buttonClasses } from '../components/ui/Button.tsx';
import { Card, EmptyState, PageHeader } from '../components/ui/Card.tsx';
import { Money, SignedAmount } from '../components/Money.tsx';
import { ACCOUNT_TYPE_LABELS } from '../types/index.ts';
import { formatDate, formatYearMonth } from '../lib/format.ts';

function ChangeBadge({ percent, invert = false }: { percent: number | null; invert?: boolean }) {
  if (percent === null) return <span className="text-xs text-slate-400">onceki ay veri yok</span>;

  const rounded = Math.round(percent);
  const rising = rounded > 0;
  // Giderde artis kotu, gelirde artis iyi
  const good = invert ? !rising : rising;
  const tone = rounded === 0 ? 'text-slate-500' : good ? 'text-emerald-600' : 'text-red-600';
  const Icon = rising ? ArrowUpRight : ArrowDownRight;

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}>
      {rounded !== 0 && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {rounded === 0 ? 'degisim yok' : `%${Math.abs(rounded)} onceki aya gore`}
    </span>
  );
}

export default function Dashboard() {
  const summary = useAsync(() => dashboardService.summary(), []);
  const month = currentYearMonth();
  const monthly = useAsync(() => reportService.monthly(month), [month]);
  const trend = useAsync(() => reportService.trend(month, 6), [month]);
  const upcoming = useAsync(() => scheduledService.upcoming(30), []);

  if (summary.error) {
    return (
      <>
        <PageHeader title="Ozet" />
        <Alert tone="error">{summary.error}</Alert>
      </>
    );
  }

  const data = summary.data;
  const hasAccounts = (data?.accounts.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Ozet"
        description={data ? formatYearMonth(data.month) : undefined}
        actions={
          <Link to="/islemler" className={buttonClasses('primary', 'sm')}>
            <Plus className="h-4 w-4" aria-hidden />
            Islem ekle
          </Link>
        }
      />

      {!summary.loading && !hasAccounts && (
        <Card>
          <EmptyState
            icon={Wallet}
            title="Baslamak icin bir hesap ekleyin"
            description="Nakit cuzdaniniz, banka hesabiniz veya kredi kartinizi tanimladiktan sonra gelir ve giderlerinizi kaydedebilirsiniz."
            action={
              <Link to="/hesaplar" className={buttonClasses('primary', 'sm')}>
                <Plus className="h-4 w-4" aria-hidden />
                Hesap ekle
              </Link>
            }
          />
        </Card>
      )}

      {data && hasAccounts && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Toplam varlik</p>
              <p className="mt-1 text-2xl font-semibold">
                <Money kurus={data.totals.totalBalanceKurus} signed />
              </p>
              <p className="mt-1 text-xs text-slate-400">Kredi karti borclari dusulmus</p>
            </div>

            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="flex items-center gap-1.5 text-sm text-slate-500">
                <TrendingUp className="h-4 w-4 text-emerald-500" aria-hidden />
                Bu ay gelir
              </p>
              <p className="mt-1 text-2xl font-semibold text-emerald-600">
                <Money kurus={data.totals.incomeKurus} />
              </p>
              <p className="mt-1">
                <ChangeBadge percent={data.previousMonth.incomeChangePercent} />
              </p>
            </div>

            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="flex items-center gap-1.5 text-sm text-slate-500">
                <TrendingDown className="h-4 w-4 text-red-500" aria-hidden />
                Bu ay gider
              </p>
              <p className="mt-1 text-2xl font-semibold text-red-600">
                <Money kurus={data.totals.expenseKurus} />
              </p>
              <p className="mt-1">
                <ChangeBadge percent={data.previousMonth.expenseChangePercent} invert />
              </p>
            </div>

            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Bu ay net</p>
              <p className="mt-1 text-2xl font-semibold">
                <Money kurus={data.totals.netKurus} signed />
              </p>
              <p className="mt-1 text-xs text-slate-400">Transferler haric</p>
            </div>
          </div>

          {upcoming.data && upcoming.data.occurrences.length > 0 && (
            <div className="mb-6">
              <Card
                title="Yaklasan odemeler"
                description={
                  upcoming.data.overdueCount > 0
                    ? `${upcoming.data.overdueCount} kayit gecikmis durumda`
                    : 'Onumuzdeki 30 gun'
                }
              >
                <ul className="-my-2 divide-y divide-slate-100">
                  {upcoming.data.occurrences.slice(0, 6).map((occurrence) => {
                    const overdue = occurrence.dueDate < upcoming.data!.today;
                    return (
                      <li key={occurrence.id} className="flex items-center gap-3 py-2.5">
                        <CalendarClock
                          className={`h-4 w-4 shrink-0 ${overdue ? 'text-red-500' : 'text-slate-400'}`}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900">
                            {occurrence.itemName}
                            {occurrence.seq !== null && ` (${occurrence.seq}/${occurrence.totalSeq})`}
                          </p>
                          <p className={`text-sm ${overdue ? 'text-red-600' : 'text-slate-500'}`}>
                            {overdue ? 'Gecikti · ' : ''}
                            {formatDate(occurrence.dueDate)} · {occurrence.accountName}
                          </p>
                        </div>
                        <span className="tabular shrink-0 text-sm font-medium text-slate-900">
                          {occurrence.amountKurus === null ? (
                            <span className="text-slate-400">tutar girilmedi</span>
                          ) : (
                            <Money kurus={occurrence.amountKurus} />
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          )}

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card title="Bu ay kategori dagilimi">
              <KategoriDagilimi items={monthly.data?.expenseByCategory ?? []} />
            </Card>

            <Card title="Son 6 ay" description="Gelir ve gider trendi">
              {trend.data && <AylikTrend series={trend.data.series} />}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card
              title="Hesaplar"
              actions={
                <Link to="/hesaplar" className="text-sm font-medium text-brand-600 hover:underline">
                  Tumu
                </Link>
              }
            >
              <ul className="-my-2 divide-y divide-slate-100">
                {data.accounts.map((account) => (
                  <li key={account.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{account.name}</p>
                      <p className="truncate text-sm text-slate-500">
                        {ACCOUNT_TYPE_LABELS[account.type]}
                        {account.bankName && ` · ${account.bankName}`}
                      </p>
                    </div>
                    <Money kurus={account.balanceKurus} signed className="font-medium" />
                  </li>
                ))}
              </ul>
            </Card>

            <Card
              title="Son islemler"
              actions={
                <Link to="/islemler" className="text-sm font-medium text-brand-600 hover:underline">
                  Tumu
                </Link>
              }
            >
              {data.recentTransactions.length === 0 ? (
                <EmptyState title="Henuz islem yok" description="Ilk kaydinizi ekleyin." />
              ) : (
                <ul className="-my-2 divide-y divide-slate-100">
                  {data.recentTransactions.map((tx) => (
                    <li key={tx.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">
                          {tx.description || tx.categoryName || 'Islem'}
                        </p>
                        <p className="truncate text-sm text-slate-500">
                          {formatDate(tx.date)} · {tx.accountName}
                        </p>
                      </div>
                      <SignedAmount kurus={tx.amountKurus} type={tx.type} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
