import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YillikRapor } from './YillikRapor.tsx';
import { getYearlyReport } from '../services/finance.ts';
import type { YearlyCategoryRow, YearlyReport } from '../types/index.ts';

vi.mock('../services/finance.ts', () => ({ getYearlyReport: vi.fn() }));
// Grafik jsdom'da olcu alamaz; veri tablosu ayrica test edilir.
vi.mock('./charts/AylikTrend.tsx', () => ({ AylikTrend: () => <div>grafik</div> }));

const thisYear = new Date().getFullYear();

const row = (over: Partial<YearlyCategoryRow> = {}): YearlyCategoryRow => ({
  categoryId: 1,
  categoryName: 'Market',
  totalKurus: 1_200_000,
  sharePercent: 40,
  transactionCount: 30,
  previousYearKurus: 1_000_000,
  changePercent: 20,
  ...over,
});

function report(over: Partial<YearlyReport> = {}): YearlyReport {
  const year = over.year ?? thisYear;
  return {
    year,
    isCurrentYear: year === thisYear,
    monthsElapsed: 11,
    totals: {
      incomeKurus: 6_000_000,
      expenseKurus: 3_000_000,
      netKurus: 3_000_000,
      savingsRatePercent: 50,
    },
    previousYear: { incomeKurus: 5_000_000, expenseKurus: 3_500_000, netKurus: 1_500_000 },
    changePercent: { income: 20, expense: -14.3, net: null },
    months: Array.from({ length: 12 }, (_, i) => ({
      month: `${year}-${String(i + 1).padStart(2, '0')}`,
      incomeKurus: 500_000,
      expenseKurus: 250_000,
      netKurus: 250_000,
    })),
    expenseByCategory: [row()],
    incomeByCategory: [row({ categoryId: 9, categoryName: 'Maas', changePercent: null })],
    highlights: {
      highestExpenseMonth: { month: `${year}-03`, expenseKurus: 400_000 },
      lowestExpenseMonth: { month: `${year}-07`, expenseKurus: 100_000 },
      averageMonthlyExpenseKurus: 272_700,
      averageMonthlyIncomeKurus: 545_400,
    },
    expenseByNature: {
      fixedKurus: 1_000_000,
      variableKurus: 1_500_000,
      uncategorizedKurus: 500_000,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(getYearlyReport).mockReset();
  vi.mocked(getYearlyReport).mockImplementation((year) => Promise.resolve(report({ year })));
});

describe('YillikRapor', () => {
  it('kartlari, degisim yuzdelerini ve en yuksek ayi gosterir', async () => {
    render(<YillikRapor />);

    const income = (await screen.findByText('Toplam gelir')).closest('div')!;
    expect(within(income).getByText(/60\.000,00/)).toBeInTheDocument();
    expect(within(income).getByText(/%20 onceki yila gore/)).toBeInTheDocument();

    const expense = screen.getByText('Toplam gider').closest('div')!;
    expect(within(expense).getByText(/%14 onceki yila gore/)).toBeInTheDocument();
    // gider dususu iyi -> yesil
    expect(within(expense).getByText(/%14/).className).toContain('text-emerald-600');
    expect(income.querySelector('.text-emerald-600')).not.toBeNull();

    // null degisim "—"
    const net = screen.getByText('Net').closest('div')!;
    expect(within(net).getByText('—')).toBeInTheDocument();

    expect(screen.getByText('%50')).toBeInTheDocument();
    expect(screen.getByText('En cok harcanan ay')).toBeInTheDocument();
    expect(screen.getByText(`Mart ${thisYear}`)).toBeInTheDocument();
    expect(screen.getByText(`Temmuz ${thisYear}`)).toBeInTheDocument();
    expect(screen.getByText(/Ocak–Kasim verisi/)).toBeInTheDocument();
  });

  it('gider kategorisi satirini pay ve degisimle gosterir; ilk 10 + tumunu goster', async () => {
    vi.mocked(getYearlyReport).mockResolvedValue(
      report({
        expenseByCategory: Array.from({ length: 12 }, (_, i) =>
          row({ categoryId: i + 1, categoryName: `Kat ${i + 1}` }),
        ),
      }),
    );
    const user = userEvent.setup();
    render(<YillikRapor />);

    expect(await screen.findByText('Kat 10')).toBeInTheDocument();
    expect(screen.queryByText('Kat 11')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Tumunu goster \(12\)/ }));
    expect(screen.getByText('Kat 12')).toBeInTheDocument();
  });

  it('tablo gorunumu acilir ve aylari listeler', async () => {
    const user = userEvent.setup();
    render(<YillikRapor />);
    await screen.findByText('Toplam gelir');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tablo gorunumu' }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    expect(within(table).getByText('Ocak')).toBeInTheDocument();
  });

  it('bos yilda mesaj gosterir', async () => {
    vi.mocked(getYearlyReport).mockResolvedValue(
      report({
        totals: { incomeKurus: 0, expenseKurus: 0, netKurus: 0, savingsRatePercent: null },
        expenseByCategory: [],
        incomeByCategory: [],
      }),
    );
    render(<YillikRapor />);
    expect(await screen.findByText('Bu yil icin kayitli islem yok.')).toBeInTheDocument();
  });

  it('hata durumunda hata gosterir', async () => {
    vi.mocked(getYearlyReport).mockRejectedValue(new Error('x'));
    render(<YillikRapor />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('yil degisince servis yeni yilla cagrilir; gelecek yil secilemez', async () => {
    const user = userEvent.setup();
    render(<YillikRapor />);
    await screen.findByText('Toplam gelir');

    expect(getYearlyReport).toHaveBeenLastCalledWith(thisYear);
    const next = screen.getByRole('button', { name: 'Sonraki yil' });
    expect(next).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Onceki yil' }));
    expect(await screen.findByText(String(thisYear - 1))).toBeInTheDocument();
    expect(getYearlyReport).toHaveBeenLastCalledWith(thisYear - 1);
    expect(next).toBeEnabled();
    // gecmis yilda "Ocak–<ay> verisi" notu yok
    await screen.findByText('Toplam gelir');
    expect(screen.queryByText(/verisi/)).not.toBeInTheDocument();

    await user.click(next);
    expect(getYearlyReport).toHaveBeenLastCalledWith(thisYear);
  });
});
