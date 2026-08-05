import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { EmptyState } from '../ui/Card.tsx';
import { ChartTooltip } from './ChartTooltip.tsx';
import { Money } from '../Money.tsx';
import { CATEGORICAL_COLORS, MAX_PIE_SLICES, OTHER_COLOR } from '../../lib/chartPalette.ts';
import { PieChart as PieIcon } from 'lucide-react';

export type BreakdownItem = {
  categoryId: number | null;
  categoryName: string;
  totalKurus: number;
  transactionCount: number;
  sharePercent: number;
};

/**
 * Kategori dagilimi: halka grafik + yaninda SIRALI LISTE.
 *
 * Liste sussuz bir eklenti degil, gerekli: (a) halka yalnizca "bir bakista
 * parca-butun" icindir, yakin degerler ondan okunmaz; (b) palette uc rengin
 * beyaz yuzeyle kontrasti 3:1'in altinda, bu yuzden sayisal karsiligin gorunur
 * olmasi zorunlu.
 *
 * En fazla 6 dilim gosterilir; kalanlar "Diger" altinda toplanir - uretilmis
 * 7., 8. renk yoktur.
 */
export function KategoriDagilimi({ items }: { items: BreakdownItem[] }) {
  const { slices, total } = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.totalKurus - a.totalKurus);
    const sum = sorted.reduce((acc, item) => acc + item.totalKurus, 0);

    if (sorted.length <= MAX_PIE_SLICES) {
      return {
        slices: sorted.map((item, i) => ({ ...item, color: CATEGORICAL_COLORS[i] ?? OTHER_COLOR })),
        total: sum,
      };
    }

    const head = sorted.slice(0, MAX_PIE_SLICES - 1);
    const tail = sorted.slice(MAX_PIE_SLICES - 1);
    const tailTotal = tail.reduce((acc, item) => acc + item.totalKurus, 0);

    return {
      slices: [
        ...head.map((item, i) => ({ ...item, color: CATEGORICAL_COLORS[i] ?? OTHER_COLOR })),
        {
          categoryId: null,
          categoryName: `Diger (${tail.length} kategori)`,
          totalKurus: tailTotal,
          transactionCount: tail.reduce((acc, item) => acc + item.transactionCount, 0),
          sharePercent: sum === 0 ? 0 : Math.round((tailTotal / sum) * 1000) / 10,
          color: OTHER_COLOR,
        },
      ],
      total: sum,
    };
  }, [items]);

  if (slices.length === 0) {
    return (
      <EmptyState
        icon={PieIcon}
        title="Bu donemde harcama yok"
        description="Islem ekledikce kategori dagilimi burada gorunecek."
      />
    );
  }

  const chartData = slices.map((s) => ({ name: s.categoryName, value: s.totalKurus }));

  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,200px)_1fr] sm:items-center">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="88%"
              /* Dilimler arasi 2px yuzey bosluglu ayrim - cizgi cerceve degil */
              paddingAngle={2}
              stroke="#ffffff"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.categoryName} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Tablo gorunumu: her degerin renkten bagimsiz okunabildigi yer */}
      <ul className="space-y-2">
        {slices.map((slice) => (
          <li key={slice.categoryName} className="flex items-center gap-2.5 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: slice.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-slate-700">{slice.categoryName}</span>
            <span className="tabular shrink-0 text-slate-500">%{slice.sharePercent}</span>
            <span className="tabular w-28 shrink-0 text-right font-medium text-slate-900">
              <Money kurus={slice.totalKurus} />
            </span>
          </li>
        ))}

        <li className="flex items-center gap-2.5 border-t border-slate-100 pt-2 text-sm">
          <span className="h-2.5 w-2.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 font-medium text-slate-700">Toplam</span>
          <span className="tabular w-28 shrink-0 text-right font-semibold text-slate-900">
            <Money kurus={total} />
          </span>
        </li>
      </ul>
    </div>
  );
}
