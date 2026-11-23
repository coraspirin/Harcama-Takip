import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Borclar from './Borclar.tsx';
import { debtService } from '../services/debts.ts';
import type { Debt, DebtListResponse, DebtPlan, StrategyResult } from '../types/index.ts';

vi.mock('../services/debts.ts', () => ({
  debtService: {
    list: vi.fn(),
    plan: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setBalance: vi.fn(),
    remove: vi.fn(),
    addPayment: vi.fn(),
    removePayment: vi.fn(),
  },
}));

const DEBT: Debt = {
  id: 1,
  kind: 'loan',
  direction: 'owe',
  name: 'Ihtiyac kredisi',
  counterparty: null,
  originalKurus: 1000000,
  reportedBalanceKurus: 800000,
  balanceDate: '2026-01-01',
  paidSinceKurus: 0,
  currentBalanceKurus: 800000,
  paidTotalKurus: 200000,
  paymentCount: 2,
  lastPaymentDate: null,
  monthlyInterestBp: 0,
  taxesIncluded: false,
  monthlyPaymentKurus: 25000,
  note: null,
  closed: false,
  forecast: null,
};

function strategy(kind: 'avalanche' | 'snowball' | 'baseline'): StrategyResult {
  return {
    strategy: kind === 'snowball' ? 'snowball' : 'avalanche',
    status: 'ends',
    months: 10,
    payoffMonth: '2027-05',
    totalInterestKurus: 0,
    order: [{ id: 1, name: 'Ihtiyac kredisi', months: 10, payoffMonth: '2027-05' }],
  };
}

const PLAN: DebtPlan = {
  extraKurus: 0,
  startMonth: '2026-11',
  avalanche: strategy('avalanche'),
  snowball: strategy('snowball'),
  baseline: strategy('baseline'),
};

const LIST: DebtListResponse = {
  debts: [DEBT],
  installments: [],
  totals: {
    oweKurus: 800000,
    lentKurus: 0,
    monthlyPaymentKurus: 25000,
    remainingInterestKurus: 0,
    debtFreeMonth: null,
    unknownForecastCount: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(debtService.list).mockResolvedValue(LIST);
  vi.mocked(debtService.plan).mockResolvedValue(PLAN);
  vi.mocked(debtService.create).mockResolvedValue(DEBT);
  vi.mocked(debtService.setBalance).mockResolvedValue({ debt: DEBT });
  vi.mocked(debtService.addPayment).mockResolvedValue({ debt: DEBT, affectsBalance: true });
});

async function renderPage() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Borclar />
    </MemoryRouter>,
  );
  await screen.findByText('Ihtiyac kredisi');
  return user;
}

type User = Awaited<ReturnType<typeof renderPage>>;

async function openCreateForm(user: User) {
  await user.click(screen.getByRole('button', { name: /Borc ekle/ }));
  return screen.getByRole('dialog', { name: 'Borc ekle' });
}

describe('Borclar - borc ekleme formu', () => {
  it.each([
    [
      'Kalan borc',
      /Kalan borc/,
      { balanceKurus: 100000, originalKurus: 500000, monthlyPaymentKurus: 25000 },
    ],
    [
      'Baslangic tutari',
      /Baslangic tutari/,
      { balanceKurus: 100000, originalKurus: 100000, monthlyPaymentKurus: 25000 },
    ],
    [
      'Aylik odeme',
      /Aylik odeme/,
      { balanceKurus: 100000, originalKurus: 500000, monthlyPaymentKurus: 100000 },
    ],
  ])(
    '%s gecersizken Kaydet kilitlenir; duzeltince dogru kurusla kaydeder',
    async (_name, label, expected) => {
      const user = await renderPage();
      const dialog = await openCreateForm(user);
      const save = within(dialog).getByRole('button', { name: 'Kaydet' });

      await user.type(within(dialog).getByLabelText(/Ad/, { selector: 'input' }), 'Kredi');
      await user.type(within(dialog).getByLabelText(/Kalan borc/), '1000');
      await user.type(within(dialog).getByLabelText(/Baslangic tutari/), '5000');
      await user.type(within(dialog).getByLabelText(/Aylik odeme/), '250');
      expect(save).toBeEnabled();

      const field = within(dialog).getByLabelText<HTMLInputElement>(label);
      await user.clear(field);
      await user.type(field, '1,005');
      expect(within(dialog).getByText('En fazla 2 ondalık hane girilebilir')).toBeInTheDocument();
      expect(save).toBeDisabled();

      await user.click(save);
      expect(debtService.create).not.toHaveBeenCalled();

      await user.clear(field);
      await user.type(field, '1000');
      expect(save).toBeEnabled();
      await user.click(save);

      expect(debtService.create).toHaveBeenCalledTimes(1);
      expect(debtService.create).toHaveBeenCalledWith(expect.objectContaining(expected));
    },
  );

  it('gecersiz degerle kapatilip yeniden acilinca kilit takili kalmaz', async () => {
    const user = await renderPage();
    let dialog = await openCreateForm(user);

    await user.type(within(dialog).getByLabelText(/Kalan borc/), '1,005');
    expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Vazgec' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    dialog = await openCreateForm(user);
    const save = within(dialog).getByRole('button', { name: 'Kaydet' });
    expect(save).toBeEnabled();
    expect(within(dialog).getByLabelText(/Kalan borc/)).toHaveValue('');

    await user.type(within(dialog).getByLabelText(/Ad/, { selector: 'input' }), 'Kredi');
    await user.type(within(dialog).getByLabelText(/Kalan borc/), '12,50');
    expect(save).toBeEnabled();
    await user.click(save);
    expect(debtService.create).toHaveBeenCalledWith(
      expect.objectContaining({ balanceKurus: 1250 }),
    );
  });
});

describe('Borclar - odeme ve bakiye modallari', () => {
  it('odeme modalinda gecersiz tutarda Kaydet kilitlenir; duzeltince dogru kurusla kaydeder', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Odeme gir' }));
    const dialog = screen.getByRole('dialog', { name: 'Odeme gir' });
    const save = within(dialog).getByRole('button', { name: 'Kaydet' });
    const amount = within(dialog).getByLabelText<HTMLInputElement>(/Tutar/);

    await user.clear(amount);
    await user.type(amount, '1,005');
    expect(save).toBeDisabled();
    await user.click(save);
    expect(debtService.addPayment).not.toHaveBeenCalled();

    await user.clear(amount);
    await user.type(amount, '12,50');
    expect(save).toBeEnabled();
    await user.click(save);

    expect(debtService.addPayment).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ amountKurus: 1250 }),
    );
  });

  it('bakiye modalinda gecersiz tutarda Kaydet kilitlenir; kapatip acinca kilit kalmaz', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Bakiye guncelle' }));
    let dialog = screen.getByRole('dialog', { name: 'Bakiye guncelle' });
    const amount = within(dialog).getByLabelText<HTMLInputElement>(/Guncel bakiye/);

    await user.clear(amount);
    await user.type(amount, '1,005');
    expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(debtService.setBalance).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Vazgec' }));
    await user.click(screen.getByRole('button', { name: 'Bakiye guncelle' }));
    dialog = screen.getByRole('dialog', { name: 'Bakiye guncelle' });
    const save = within(dialog).getByRole('button', { name: 'Kaydet' });
    expect(save).toBeEnabled();

    const again = within(dialog).getByLabelText<HTMLInputElement>(/Guncel bakiye/);
    await user.clear(again);
    await user.type(again, '7000');
    await user.click(save);
    expect(debtService.setBalance).toHaveBeenCalledWith(1, 700000, expect.any(String));
  });
});

describe('Borclar - fazladan odeme plani', () => {
  it('Aylik ek tutar gecersizken sonuclar gizlenir, duzelince gorunur', async () => {
    const user = await renderPage();
    const extra = screen.getByLabelText<HTMLInputElement>(/Aylik ek tutar/);
    expect(await screen.findByText('Cig yontemi')).toBeInTheDocument();

    await user.type(extra, '1,005');
    expect(screen.queryByText('Cig yontemi')).not.toBeInTheDocument();
    expect(screen.queryByText('Kartopu yontemi')).not.toBeInTheDocument();

    await user.clear(extra);
    await user.type(extra, '100');
    expect(await screen.findByText('Cig yontemi')).toBeInTheDocument();
    expect(debtService.plan).toHaveBeenLastCalledWith(10000);
  });
});
