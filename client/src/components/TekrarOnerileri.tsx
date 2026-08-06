import { Lightbulb, X } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { matchingService, type RecurrenceSuggestion } from '../services/matching.ts';
import { Button } from './ui/Button.tsx';
import { Card } from './ui/Card.tsx';
import { Money } from './Money.tsx';
import { formatDate } from '../lib/format.ts';

/**
 * Gecmis islemlerden cikarilan tekrar onerileri.
 *
 * Oneri HICBIR ZAMAN kendiliginden kayit olusturmaz: zamanlanmis kayitlar
 * bildirim uretir, onaysiz olusmalari gurultu yaratirdi. Kullanici "olustur"
 * dediginde form on-doldurulmus olarak acilir.
 */
export function TekrarOnerileri({
  kind,
  onUse,
}: {
  kind: RecurrenceSuggestion['kind'];
  onUse: (suggestion: RecurrenceSuggestion) => void;
}) {
  const suggestions = useAsync(() => matchingService.recurrences(), []);

  const list = (suggestions.data ?? []).filter((s) => s.kind === kind);
  if (list.length === 0) return null;

  async function dismiss(signature: string) {
    await matchingService.rejectRecurrence(signature);
    await suggestions.reload();
  }

  return (
    <Card
      title="Gecmisinizde tekrar eden odemeler"
      description="Bunlari zamanlanmis kayda cevirirseniz vadesi yaklastiginda hatirlatilir"
      className="mb-6"
    >
      <ul className="space-y-2">
        {list.map((item) => (
          <li
            key={item.signature}
            className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3"
          >
            <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900">{item.name}</p>
              <p className="text-sm text-slate-500">
                {item.occurrences} kez · yaklasik {item.averageIntervalDays} gunde bir ·{' '}
                {formatDate(item.firstDate)} – {formatDate(item.lastDate)}
                {item.installmentTotal !== null &&
                  ` · ekstrede ${item.installmentSeq}/${item.installmentTotal} taksit yaziyor`}
              </p>
            </div>

            <span className="tabular shrink-0 text-sm font-medium text-slate-900">
              <Money kurus={item.amountKurus} />
              {item.amountVaries && (
                <span className="ml-1 font-normal text-slate-500">(ort.)</span>
              )}
            </span>

            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="secondary" onClick={() => onUse(item)}>
                Kayit olustur
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Bir daha onerme"
                onClick={() => void dismiss(item.signature)}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
