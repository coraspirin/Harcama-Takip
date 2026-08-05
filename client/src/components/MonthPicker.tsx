import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatYearMonth } from '../lib/format.ts';

/** "2026-08" +/- n ay */
export function shiftYearMonth(ym: string, months: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

export function currentYearMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
}

export function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200">
      <button
        onClick={() => onChange(shiftYearMonth(value, -1))}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Onceki ay"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>

      <span className="min-w-32 text-center text-sm font-medium text-slate-900">
        {formatYearMonth(value)}
      </span>

      <button
        onClick={() => onChange(shiftYearMonth(value, 1))}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Sonraki ay"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
