import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Gauge,
  Landmark,
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
import { formatDate, formatYearMonth } from '../lib/format.ts';
import type { DashboardSummary } from '../types/index.ts';

/** Yaklasan odemeler listesinde kac gun ileriye bakilir. */
const UPCOMING_DAYS = 7;

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

function StatTile({
  icon: Icon,
  iconTone,
  label,
  children,
  footer,
}: {
  icon: typeof Wallet;
  iconTone: string;
  label: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="flex items-center gap-1.5 text-sm text-slate-500">
        <Icon className={`h-4 w-4 ${iconTone}`} aria-hidden />
        {label}
      </p>
      <div className="mt-1 text-2xl font-semibold">{children}</div>
      {footer && <div className="mt-1 text-xs text-slate-400">{footer}</div>}
    </div>
  );
}

function LimitCard({ limit }: { limit: NonNullable<DashboardSummary['limit']> }) {
  const width = Math.min(100, limit.usagePercent);
  const tone = limit.exceeded
    ? 'bg-red-500'
    : limit.usagePercent >= 80
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  return (
    <Card
      title="Bu ayin limiti"
      actions={
        <Link to="/butce" className="text-sm font-medium text-brand-600 hover:underline">
          Butce
        </Link>
      }
    >
      <p className="text-sm text-slate-600">
        <Money kurus={limit.spentKurus} /> / <Money kurus={limit.limitKurus} /> harcandi
      </p>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">
            {limit.exceeded ? 'Limit asildi' : 'Kalan'}
          </p>
          <p className={`font-semibold ${limit.exceeded ? 'text-red-600' : 'text-slate-900'}`}>
            <Money kurus={Math.abs(limit.remainingKurus)} />
          </p>
        </div>
        {limit.dailyAllowanceKurus !== null && (
          <div>
            <p className="text-xs text-slate-500">Gunluk ({limit.daysLeft} gun)</p>
            <p className="font-semibold text-slate-900">
              <Money kurus={limit.dailyAllowanceKurus} />
            </p>
          </div>
        )}
      </div>
      {limit.projectedExceeds && !limit.exceeded && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Bu hizla ay sonu <Money kurus={limit.projectedSpendKurus} /> olur.
        </p>
      )}
    </Card>
  );
}

function DebtCard({ debts }: { debts: DashboardSummary['debts'] }) {
  return (
    <Card
      title="Borclar"
      actions={
        <Link to="/borclar" className="text-sm font-medium text-brand-600 hover:underline">
          Tumu
        </Link>
      }
    >
      {debts.oweKurus === 0 && debts.lentKurus === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Kayitli borc yok"
          description="Kredi veya kart borcunuzu ekleyin, ne zaman bitecegini gosterelim."
        />
      ) : (
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Toplam borc</dt>
            <dd className="font-semibold">
              <Money kurus={debts.oweKurus} />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Aylik odeme</dt>
            <dd>
              <Money kurus={debts.monthlyPaymentKurus} />
            </dd>
          </div>
          {debts.lentKurus > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Alacaklar</dt>
              <dd>
                <Money kurus={debts.lentKurus} />
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t border-slate-100 pt-3">
            <dt className="text-slate-500">Borcsuz kalma</dt>
            <dd
              className={`font-semibold ${debts.debtFreeMonth ? 'text-emerald-600' : 'text-slate-500'}`}
            >
              {debts.debtFreeMonth
                ? formatYearMonth(debts.debtFreeMonth)
                : debts.unknownForecastCount > 0
                  ? `${debts.unknownForecastCount} borcun bitisi belirsiz`
                  : '—'}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const summary = useAsync(() => dashboardService.summary(), []);
  const month = currentYearMonth();
  const monthly = useAsync(() => reportService.monthly(month), [month]);
  const trend = useAsync(() => reportService.trend(month, 6), [month]);
  const upcoming = useAsync(() => scheduledService.upcoming(UPCOMING_DAYS), []);

  if (summary.error) {
    return (
      <>
        <PageHeader title="Ozet" />
        <Alert tone="error">{summary.error}</Alert>
      </>
    );
  }

  const data = summary.data;

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

      {data && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon={TrendingUp}
              iconTone="text-emerald-500"
              label="Bu ay gelir"
              footer={<ChangeBadge percent={data.previousMonth.incomeChangePercent} />}
            >
              <span className="text-emerald-600">
                <Money kurus={data.totals.incomeKurus} />
              </span>
            </StatTile>

            <StatTile
              icon={TrendingDown}
              iconTone="text-red-500"
              label="Bu ay gider"
              footer={<ChangeBadge percent={data.previousMonth.expenseChangePercent} invert />}
            >
              <span className="text-red-600">
                <Money kurus={data.totals.expenseKurus} />
              </span>
            </StatTile>

            <StatTile
              icon={Wallet}
              iconTone="text-brand-600"
              label="Serbest para"
              footer={
                data.overview.incomeIsEstimate
                  ? 'Gelir tahmini (onceki aylarin ortalamasi)'
                  : 'Beklenen gelir − harcanan − bekleyen odemeler − kenara ayrilacak'
              }
            >
              <Money kurus={data.overview.freeKurus} signed />
            </StatTile>

            <StatTile
              icon={Gauge}
              iconTone="text-amber-500"
              label="Gunluk harcanabilir"
              footer={
                data.limit ? (
                  `Genel limite gore, bugun dahil ${data.limit.daysLeft} gun`
                ) : (
                  <Link to="/butce" className="font-medium text-brand-600 hover:underline">
                    Genel limit koyun
                  </Link>
                )
              }
            >
              {data.limit?.dailyAllowanceKurus != null ? (
                <Money kurus={data.limit.dailyAllowanceKurus} />
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </StatTile>
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card
                title="Yaklasan odemeler"
                description={
                  upcoming.data && upcoming.data.overdueCount > 0
                    ? `${upcoming.data.overdueCount} kayit gecikmis durumda`
                    : `Onumuzdeki ${UPCOMING_DAYS} gun`
                }
                actions={
                  <Link to="/bekleyen" className="text-sm font-medium text-brand-600 hover:underline">
                    Tumu
                  </Link>
                }
              >
                {!upcoming.data || upcoming.data.occurrences.length === 0 ? (
                  <EmptyState
                    icon={CalendarClock}
                    title="Yaklasan odeme yok"
                    description={`Onumuzdeki ${UPCOMING_DAYS} gunde vadesi gelen kayit bulunmuyor.`}
                  />
                ) : (
                  <ul className="-my-2 divide-y divide-slate-100">
                    {upcoming.data.occurrences.slice(0, 8).map((occurrence) => {
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
                              {formatDate(occurrence.dueDate)}
                            </p>
                          </div>
                          <span className="tabular shrink-0 text-sm font-medium text-slate-900">
                            {occurrence.amountKurus === null ? (
                              <span className="text-slate-400">tutar girilmedi</span>
                            ) : (
                              <SignedAmount kurus={occurrence.amountKurus} type={occurrence.direction} />
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>

            <div className="space-y-6">
              {data.limit && <LimitCard limit={data.limit} />}
              <DebtCard debts={data.debts} />
            </div>
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card title="Bu ay kategori dagilimi">
              <KategoriDagilimi items={monthly.data?.expenseByCategory ?? []} />
            </Card>

            <Card title="Son 6 ay" description="Gelir ve gider trendi">
              {trend.data && <AylikTrend series={trend.data.series} />}
            </Card>
          </div>

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
                        {formatDate(tx.date)}
                        {tx.categoryName && tx.description ? ` · ${tx.categoryName}` : ''}
                      </p>
                    </div>
                    <SignedAmount kurus={tx.amountKurus} type={tx.type} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}
