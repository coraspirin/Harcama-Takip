import { formatTRY } from '../lib/format.ts';

/**
 * Tutar gosterimi. `signed` acikken pozitif/negatif renklendirilir
 * (gelir yesil, gider/borc kirmizi).
 */
export function Money({
  kurus,
  signed = false,
  className = '',
}: {
  kurus: number;
  signed?: boolean;
  className?: string;
}) {
  const tone = !signed ? '' : kurus > 0 ? 'text-emerald-600' : kurus < 0 ? 'text-red-600' : '';
  return <span className={`tabular ${tone} ${className}`}>{formatTRY(kurus)}</span>;
}

/** Gelir/gider isaretini one cikaran gosterim (islem listeleri icin). */
export function SignedAmount({ kurus, type }: { kurus: number; type: string }) {
  const isIncome = type === 'income';

  const tone = isIncome ? 'text-emerald-600' : 'text-red-600';
  const sign = isIncome ? '+' : '−';

  return (
    <span className={`tabular font-medium ${tone}`}>
      {sign}
      {formatTRY(kurus)}
    </span>
  );
}
