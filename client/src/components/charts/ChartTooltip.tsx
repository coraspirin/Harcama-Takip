import type { TooltipProps } from 'recharts';
import { formatTRY } from '../../lib/format.ts';

/**
 * Ortak ipucu kutusu. Ipucu bir GELISTIRMEdir, tek okuma yolu degil:
 * her deger ayrica eksende, dogrudan etikette veya yandaki listede bulunur.
 */
export function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg bg-white px-3 py-2 text-sm shadow-lg ring-1 ring-slate-200">
      {label !== undefined && label !== '' && (
        <p className="mb-1 font-medium text-slate-900">{String(label)}</p>
      )}
      <ul className="space-y-0.5">
        {payload.map((item) => (
          <li key={String(item.dataKey)} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
            <span className="text-slate-600">{item.name}</span>
            <span className="tabular ml-auto font-medium text-slate-900">
              {formatTRY(Number(item.value ?? 0))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
