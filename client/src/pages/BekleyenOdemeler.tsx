import { useSearchParams } from 'react-router-dom';
import { PiggyBank, Repeat } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { scheduledService } from '../services/scheduled.ts';
import { BILL_PERIOD_LABELS } from '../types/index.ts';
import { Card, PageHeader } from '../components/ui/Card.tsx';
import { Money } from '../components/Money.tsx';
import { ZamanlanmisListe, type ScheduledView } from '../components/ZamanlanmisListe.tsx';
import { formatYearMonth } from '../lib/format.ts';

/** URL'deki sekme adi (Turkce, okunur) -> gorunum */
const TABS: { slug: string; view: ScheduledView; label: string }[] = [
  { slug: 'planlanan', view: 'planned', label: 'Planlanan' },
  { slug: 'fatura', view: 'bill', label: 'Faturalar' },
  { slug: 'abonelik', view: 'subscription', label: 'Abonelikler' },
  { slug: 'taksit', view: 'installment', label: 'Taksitler' },
];

export default function BekleyenOdemeler() {
  const [params, setParams] = useSearchParams();
  const active = TABS.find((t) => t.slug === params.get('sekme')) ?? TABS[0]!;
  const summary = useAsync(() => scheduledService.summary(), []);

  const subscriptions = summary.data?.subscriptions;
  const reserve = summary.data?.reserve;

  return (
    <>
      <PageHeader
        title="Bekleyen odemeler"
        description="Planlanan odemeler, faturalar, abonelikler ve taksitler"
      />

      {summary.data && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card
            title={
              <span className="flex items-center gap-1.5">
                <Repeat className="h-4 w-4 text-brand-600" aria-hidden />
                Abonelikler
              </span>
            }
          >
            {subscriptions && subscriptions.items.length > 0 ? (
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">Aylik</p>
                  <p className="text-xl font-semibold">
                    <Money kurus={subscriptions.monthlyKurus} />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Yillik</p>
                  <p className="text-xl font-semibold">
                    <Money kurus={subscriptions.yearlyKurus} />
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Sabit tutarli odemelerinizi "Abonelikler" sekmesinden ekleyin.
              </p>
            )}
          </Card>

          <Card
            title={
              <span className="flex items-center gap-1.5">
                <PiggyBank className="h-4 w-4 text-amber-500" aria-hidden />
                Bu ay kenara ayir
              </span>
            }
            description={`Uc aylik ve yillik giderlerin aylik payi · ${formatYearMonth(summary.data.month)}`}
          >
            {reserve && reserve.items.length > 0 ? (
              <>
                <p className="text-xl font-semibold">
                  <Money kurus={reserve.monthlyKurus} />
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {reserve.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3">
                      <span className="truncate text-slate-600">
                        {item.name}
                        <span className="text-slate-400">
                          {' '}
                          · {BILL_PERIOD_LABELS[item.period].toLowerCase()}{' '}
                          <Money kurus={item.amountKurus} />
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-slate-900">
                        {item.dueThisMonth ? (
                          <span className="text-xs text-amber-700">bu ay odenecek</span>
                        ) : (
                          <Money kurus={item.monthlyShareKurus} />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                Kasko, emlak vergisi gibi uc aylik veya yillik bir fatura eklerseniz, her ay ne kadar
                kenara ayirmaniz gerektigini burada gorursunuz.
              </p>
            )}
            {reserve && reserve.unknownCount > 0 && (
              <p className="mt-2 text-xs text-slate-400">
                {reserve.unknownCount} faturanin tutari bilinmedigi icin hesaba katilmadi.
              </p>
            )}
          </Card>
        </div>
      )}

      <div
        role="tablist"
        className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200"
      >
        {TABS.map((tab) => (
          <button
            key={tab.slug}
            role="tab"
            aria-selected={tab.slug === active.slug}
            onClick={() => setParams({ sekme: tab.slug })}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${
              tab.slug === active.slug
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ZamanlanmisListe
        key={active.view}
        view={active.view}
        onChanged={() => void summary.reload()}
      />
    </>
  );
}
