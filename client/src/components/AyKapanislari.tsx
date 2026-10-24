import { CheckCircle2, XCircle } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { reportService } from '../services/finance.ts';
import { Alert } from './ui/Alert.tsx';
import { Card, EmptyState } from './ui/Card.tsx';
import { Money } from './Money.tsx';
import { formatYearMonth } from '../lib/format.ts';

/** Kapanmis aylarin ozeti: her ay icin tek kart. */
export function AyKapanislari() {
  const closings = useAsync(() => reportService.closings(6), []);

  if (closings.error) return <Alert tone="error">{closings.error}</Alert>;
  if (!closings.data) return null;

  const withData = closings.data.filter((c) => c.hasData);
  if (withData.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Henuz kapanmis ay yok"
          description="Bir ay boyunca gelir ve gider girdiginizde, ay bitince ozeti burada gorursunuz."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {withData.map((c) => (
        <Card key={c.month} title={formatYearMonth(c.month)}>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Gelir</dt>
              <dd className="font-medium text-emerald-600">
                <Money kurus={c.incomeKurus} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Gider</dt>
              <dd className="font-medium text-red-600">
                <Money kurus={c.expenseKurus} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Net</dt>
              <dd className="font-semibold">
                <Money kurus={c.netKurus} signed />
              </dd>
            </div>
          </dl>

          <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
            {c.limit && (
              <li className="flex items-center gap-1.5">
                {c.limit.kept ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" aria-hidden />
                )}
                Genel limit {c.limit.kept ? 'tutuldu' : 'asildi'}:{' '}
                <Money kurus={c.limit.spentKurus} /> / <Money kurus={c.limit.limitKurus} />
              </li>
            )}
            {c.exceededCategories.length > 0 && (
              <li>Limiti asilan kategoriler: {c.exceededCategories.join(', ')}</li>
            )}
            {c.topCategory && (
              <li>
                En cok harcanan: {c.topCategory.name} (<Money kurus={c.topCategory.totalKurus} />)
              </li>
            )}
            {c.savedKurus !== 0 && (
              <li>
                Birikime ayrilan: <Money kurus={c.savedKurus} />
              </li>
            )}
            {c.debtPaidKurus > 0 && (
              <li>
                Borca odenen: <Money kurus={c.debtPaidKurus} />
              </li>
            )}
          </ul>
        </Card>
      ))}
    </div>
  );
}
