import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip.tsx';
import { CHART_CHROME, EXPENSE_COLOR, INCOME_COLOR, compactLira } from '../../lib/chartPalette.ts';

export type TrendPoint = {
  month: string; // YYYY-MM
  incomeKurus: number;
  expenseKurus: number;
  netKurus: number;
};

const MONTH_SHORT = ['Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function shortMonth(ym: string): string {
  const [year, month] = ym.split('-').map(Number) as [number, number];
  return `${MONTH_SHORT[month - 1] ?? ''} ${String(year).slice(2)}`;
}

/**
 * Aylik gelir/gider trendi - gruplu cubuk.
 *
 * Tek eksen kullanilir: gelir ve gider ayni birimde (kurus) oldugu icin
 * karsilastirilabilirler. Ikinci bir y ekseni EKLENMEZ; iki farkli olcegi tek
 * grafige koymak olmayan bir korelasyon uydurur.
 *
 * Renkler uygulamanin gelir/gider anlamsal ciftidir; efsane her zaman acik ve
 * cubuk sirasi sabit oldugu icin kimlik yalnizca renge birakilmaz.
 */
export function AylikTrend({ series }: { series: TrendPoint[] }) {
  const data = series.map((point) => ({
    month: shortMonth(point.month),
    Gelir: point.incomeKurus,
    Gider: point.expenseKurus,
  }));

  return (
    /* Yukseklik x ekseni bandini da kapsar; kart icinde ikinci bir kaydirma olusmaz */
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          {/* Duz saclı izgara - kesikli cizgi "esik/projeksiyon" gibi okunur */}
          <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: CHART_CHROME.muted, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: CHART_CHROME.axis }}
          />
          <YAxis
            tickFormatter={compactLira}
            tick={{ fill: CHART_CHROME.muted, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} />
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 13, color: CHART_CHROME.text }}
          />
          {/* Yuvarlatilmis veri uclari tabana sabit; cubuklar ince tutulur */}
          <Bar dataKey="Gelir" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Gider" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
