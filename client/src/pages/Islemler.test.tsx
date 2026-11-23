import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Islemler from './Islemler.tsx';
import { categoryService, transactionService } from '../services/finance.ts';

vi.mock('../services/finance.ts', () => ({
  categoryService: { list: vi.fn() },
  transactionService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(categoryService.list).mockResolvedValue([]);
  vi.mocked(transactionService.list).mockResolvedValue({
    transactions: [],
    totals: { incomeKurus: 0, expenseKurus: 0 },
    pagination: { page: 1, pageSize: 50, total: 0 },
  });
  vi.mocked(transactionService.create).mockClear();
});

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  render(<Islemler />);
  // Bos durumda hem baslikta hem EmptyState'te "Islem ekle" butonu olabilir.
  const [openButton] = await screen.findAllByRole('button', { name: /Islem ekle/ });
  await user.click(openButton!);
  return screen.getByLabelText<HTMLInputElement>(/Tutar/);
}

describe('Islemler - islem ekleme formu', () => {
  it('gecersiz tutarda Kaydet kilitlenir, Enter gonderim yapmaz; duzeltince dogru kurusla kaydeder', async () => {
    const user = userEvent.setup();
    vi.mocked(transactionService.create).mockResolvedValue({} as never);
    const input = await openForm(user);
    const save = screen.getByRole('button', { name: 'Kaydet' });

    // "1,005": ilk "1" gecerli (100 kurus) yayilir, sonra gecersiz olur.
    await user.type(input, '1,005');
    expect(screen.getByText('En fazla 2 ondalık hane girilebilir')).toBeInTheDocument();
    expect(save).toBeDisabled();

    await user.keyboard('{Enter}');
    await user.click(save);
    expect(transactionService.create).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '12,50');
    expect(save).toBeEnabled();

    await user.click(save);
    expect(transactionService.create).toHaveBeenCalledTimes(1);
    expect(transactionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountKurus: 1250, type: 'expense' }),
    );
  });
});
