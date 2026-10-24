import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip.tsx';
import {
  CATEGORICAL_COLORS,
  CHART_CHROME,
  EXPENSE_COLOR,
  INCOME_COLOR,
  compactLira,
} from '../../lib/chartPalette.ts';
import type { ProjectionPoint } from '../../types/index.ts';

const MONTH_SHORT = ['Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function shortMonth(ym: string): string {
  const [year, month] = ym.split('-').map(Number) as [number, number];
  return `${MONTH_SHORT[month - 1] ?? ''} ${String(year).slice(2)}`;
}

/**
 * 12 aylik gidisat: kalan borc ve biriken nakit.
 *
 * Iki olcu de TL oldugu icin tek eksen paylasilir (ikinci y ekseni yok).
 * Borc/nakit icin uygulamanin gider/gelir anlamsal cifti kullanilir; senaryo
 * cizgisi kategorik paletin ilk slotudur (uclu palet dogrulandi: CVD ΔE 20.1,
 * normal 21.2, hepsi yuzeye karsi 3:1 uzerinde). Efsane her zaman acik;
 * kimlik yalnizca renge birakilmaz.
 */
export function GidisatGrafigi({
  projection,
  scenario,
}: {
  projection: ProjectionPoint[];
  scenario?: ProjectionPoint[] | null;
}) {
  const data = projection.map((point, i) => ({
    month: shortMonth(point.month),
    'Kalan borc': point.debtKurus,
    'Biriken nakit': point.cashKurus,
    ...(scenario?.[i] && { 'Kalan borc (senaryo)': scenario[i]!.debtKurus }),
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          {/* Nakit eksiye duserse sifir cizgisi acigi gorunur kilar */}
          <ReferenceLine y={0} stroke={CHART_CHROME.axis} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART_CHROME.axis }} />
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 13, color: CHART_CHROME.text }}
          />
          <Line
            type="monotone"
            dataKey="Kalan borc"
            stroke={EXPENSE_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          {scenario && (
            <Line
              type="monotone"
              dataKey="Kalan borc (senaryo)"
              stroke={CATEGORICAL_COLORS[0]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="Biriken nakit"
            stroke={INCOME_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
