import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZamanlanmisListe, type ScheduledView } from './ZamanlanmisListe.tsx';
import { occurrenceService, scheduledService } from '../services/scheduled.ts';
import { categoryService } from '../services/finance.ts';
import { matchingService } from '../services/matching.ts';
import type { Occurrence, ScheduledItem } from '../types/index.ts';

vi.mock('../services/scheduled.ts', () => ({
  scheduledService: {
    list: vi.fn(),
    occurrences: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    setExcludeFromBudget: vi.fn(),
    setAutoConfirm: vi.fn(),
  },
  occurrenceService: { confirm: vi.fn(), unconfirm: vi.fn() },
}));
vi.mock('../services/finance.ts', () => ({
  categoryService: { list: vi.fn() },
}));
vi.mock('../services/matching.ts', () => ({
  matchingService: { recurrences: vi.fn(), rejectRecurrence: vi.fn() },
}));

const BILL: ScheduledItem = {
  id: 7,
  kind: 'bill',
  name: 'Elektrik',
  direction: 'expense',
  categoryId: null,
  categoryName: null,
  counterparty: null,
  description: null,
  totalAmountKurus: null,
  installmentCount: null,
  period: 'monthly',
  amountKurus: null,
  startDate: '2026-11-01',
  active: true,
  progress: { total: 1, confirmed: 0, pending: 1 },
  nextDueDate: '2099-01-01',
  remainingKurus: 0,
  isSubscription: false,
  endMonth: null,
  excludeFromBudget: false,
  autoConfirm: false,
};

const OCCURRENCE: Occurrence = {
  id: 70,
  scheduledItemId: 7,
  itemName: 'Elektrik',
  kind: 'bill',
  direction: 'expense',
  categoryName: null,
  dueDate: '2099-01-01',
  amountKurus: null,
  status: 'pending',
  transactionId: null,
  seq: null,
  totalSeq: null,
  excludeFromBudget: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scheduledService.list).mockResolvedValue([]);
  vi.mocked(scheduledService.occurrences).mockResolvedValue([]);
  vi.mocked(scheduledService.create).mockResolvedValue(BILL);
  vi.mocked(categoryService.list).mockResolvedValue([]);
  vi.mocked(matchingService.recurrences).mockResolvedValue([]);
  vi.mocked(occurrenceService.confirm).mockResolvedValue({ occurrence: OCCURRENCE });
});

async function openForm(view: ScheduledView) {
  const user = userEvent.setup();
  const utils = render(<ZamanlanmisListe view={view} />);
  // Bos listede hem ustte hem EmptyState'te ekle butonu bulunur.
  const [add] = await screen.findAllByRole('button', { name: /ekle$/ });
  await user.click(add!);
  const dialog = screen.getByRole('dialog');
  return { user, dialog, ...utils };
}

describe('ZamanlanmisListe - kayit formu', () => {
  it('planlanan: gecersiz tutarda Kaydet kilitlenir; duzeltince dogru kurusla kaydeder', async () => {
    const { user, dialog } = await openForm('planned');
    const save = within(dialog).getByRole('button', { name: 'Kaydet' });
    const amount = within(dialog).getByLabelText<HTMLInputElement>(/Tutar/);

    await user.type(within(dialog).getByLabelText(/^Ad/), 'Kira');
    await user.type(amount, '1,005');
    expect(within(dialog).getByText('En fazla 2 ondalık hane girilebilir')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.click(save);
    expect(scheduledService.create).not.toHaveBeenCalled();

    await user.clear(amount);
    await user.type(amount, '12,50');
    expect(save).toBeEnabled();
    await user.click(save);

    expect(scheduledService.create).toHaveBeenCalledTimes(1);
    expect(scheduledService.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'planned', amountKurus: 1250 }),
    );
  });

  it('taksit: gecersiz toplam tutarda Kaydet kilitlenir; duzeltince totalAmountKurus dogru gider', async () => {
    const { user, dialog } = await openForm('installment');
    const save = within(dialog).getByRole('button', { name: 'Kaydet' });
    const total = within(dialog).getByLabelText<HTMLInputElement>(/Toplam tutar/);

    await user.type(within(dialog).getByLabelText(/^Ad/), 'Telefon');
    await user.type(total, '1,005');
    expect(save).toBeDisabled();

    await user.clear(total);
    await user.type(total, '1200');
    expect(save).toBeEnabled();
    await user.click(save);

    expect(scheduledService.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'installment', totalAmountKurus: 120000 }),
    );
  });

  it('abonelik: gecersiz tutarda Kaydet kilitlenir; duzeltince dogru kurusla kaydeder', async () => {
    const { user, dialog } = await openForm('subscription');
    const save = within(dialog).getByRole('button', { name: 'Kaydet' });
    const amount = within(dialog).getByLabelText<HTMLInputElement>(/Tutar/);

    await user.type(within(dialog).getByLabelText(/^Ad/), 'Dizi');
    await user.type(amount, '1,005');
    expect(save).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, '99,90');
    expect(save).toBeEnabled();
    await user.click(save);

    expect(scheduledService.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bill', isSubscription: true, amountKurus: 9990 }),
    );
  });

  it('dal degisiminde (abonelik -> planlanan) gecersiz alan unmount olur, kilit takili kalmaz', async () => {
    const { user, dialog, rerender } = await openForm('subscription');
    await user.type(within(dialog).getByLabelText(/Tutar/), '1,005');
    expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled();

    rerender(<ZamanlanmisListe view="planned" />);

    const after = screen.getByRole('dialog');
    // Ust state son gecerli degeri ("1" -> 100 kurus) tutar; yeni alan onunla acilir.
    expect(within(after).getByLabelText(/Tutar/)).toHaveValue('1,00');
    expect(
      within(after).queryByText('En fazla 2 ondalık hane girilebilir'),
    ).not.toBeInTheDocument();
    expect(within(after).getByRole('button', { name: 'Kaydet' })).toBeEnabled();
  });

  it('dal degisiminde (fatura -> taksit) gecersiz alan unmount olur, kilit takili kalmaz', async () => {
    const { user, dialog, rerender } = await openForm('bill');
    await user.type(within(dialog).getByLabelText(/Tahmini tutar/), '1,005');
    expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled();

    rerender(<ZamanlanmisListe view="installment" />);

    const after = screen.getByRole('dialog');
    expect(within(after).getByLabelText(/Toplam tutar/)).toHaveValue('');
    expect(within(after).getByRole('button', { name: 'Kaydet' })).toBeEnabled();
  });

  it('gecersiz degerle kapatilip yeniden acilinca kilit takili kalmaz', async () => {
    const { user, dialog } = await openForm('planned');
    await user.type(within(dialog).getByLabelText(/Tutar/), '1,005');
    await user.click(within(dialog).getByRole('button', { name: 'Vazgec' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const [add] = await screen.findAllByRole('button', { name: /ekle$/ });
    await user.click(add!);
    const reopened = screen.getByRole('dialog');
    expect(within(reopened).getByRole('button', { name: 'Kaydet' })).toBeEnabled();
  });
});

describe('ZamanlanmisListe - tutarla onayla modali', () => {
  async function openAmountModal() {
    vi.mocked(scheduledService.list).mockResolvedValue([BILL]);
    vi.mocked(scheduledService.occurrences).mockResolvedValue([OCCURRENCE]);
    const user = userEvent.setup();
    render(<ZamanlanmisListe view="bill" />);
    await screen.findByText('Elektrik');
    await user.click(screen.getByRole('button', { name: 'Vadeleri goster' }));
    await user.click(await screen.findByRole('button', { name: 'Onayla' }));
    return { user, dialog: screen.getByRole('dialog', { name: 'Odemeyi onayla' }) };
  }

  it('gecersiz tutarda Onayla kilitlenir ve onay API cagrilmaz; duzeltince dogru kurusla onaylar', async () => {
    const { user, dialog } = await openAmountModal();
    const confirm = within(dialog).getByRole('button', { name: 'Onayla' });
    const amount = within(dialog).getByLabelText<HTMLInputElement>(/Odenen tutar/);

    await user.type(amount, '1,005');
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(occurrenceService.confirm).not.toHaveBeenCalled();

    await user.clear(amount);
    await user.type(amount, '350,25');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(occurrenceService.confirm).toHaveBeenCalledTimes(1);
    expect(occurrenceService.confirm).toHaveBeenCalledWith(
      70,
      expect.objectContaining({ amountKurus: 35025 }),
    );
  });

  it('gecersiz degerle kapatilip yeniden acilinca kilit takili kalmaz', async () => {
    const { user, dialog } = await openAmountModal();
    await user.type(within(dialog).getByLabelText(/Odenen tutar/), '1,005');
    await user.click(within(dialog).getByRole('button', { name: 'Vazgec' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Onayla' }));
    const reopened = screen.getByRole('dialog', { name: 'Odemeyi onayla' });
    expect(within(reopened).getByLabelText(/Odenen tutar/)).toHaveValue('');
    expect(within(reopened).getByRole('button', { name: 'Onayla' })).toBeEnabled();
  });
});
