import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { HizliEkle } from './HizliEkle.tsx';
import AppLayout from '../layouts/AppLayout.tsx';
import { categoryService, getRecentCategories, transactionService } from '../services/finance.ts';
import { suggestCategory } from '../services/finance.ts';
import { todayIso } from '../lib/format.ts';
import type { Category } from '../types/index.ts';

vi.mock('../services/finance.ts', () => ({
  categoryService: { list: vi.fn() },
  transactionService: { create: vi.fn() },
  getRecentCategories: vi.fn(),
  suggestCategory: vi.fn(),
}));
vi.mock('../context/AuthContext.tsx', () => ({
  useAuth: () => ({ user: { username: 'ali' }, logout: vi.fn() }),
}));
vi.mock('./BildirimZili.tsx', () => ({ BildirimZili: () => null }));

const cat = (id: number, name: string, kind: Category['kind']): Category => ({
  id,
  name,
  kind,
  nature: 'variable',
  isDefault: false,
  archived: false,
});

beforeEach(() => {
  vi.mocked(categoryService.list).mockResolvedValue([
    cat(1, 'Market', 'expense'),
    cat(2, 'Ulasim', 'expense'),
    cat(3, 'Maas', 'income'),
  ]);
  vi.mocked(getRecentCategories).mockReset();
  vi.mocked(getRecentCategories).mockImplementation((type) =>
    Promise.resolve(
      type === 'expense'
        ? [{ categoryId: 1, categoryName: 'Market', useCount: 5, lastUsedAt: null }]
        : [{ categoryId: 3, categoryName: 'Maas', useCount: 2, lastUsedAt: null }],
    ),
  );
  vi.mocked(suggestCategory).mockResolvedValue([]);
  vi.mocked(transactionService.create).mockReset();
  vi.mocked(transactionService.create).mockResolvedValue({} as never);
});

function renderModal(onClose = vi.fn()) {
  render(<HizliEkle open onClose={onClose} />);
  return { onClose, user: userEvent.setup() };
}

describe('HizliEkle', () => {
  it('Gider varsayilan; son kategoriler chip olarak gelir, tur degisince yeniden cekilir', async () => {
    const { user } = renderModal();
    expect(await screen.findByRole('button', { name: 'Market' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gider' })).toHaveAttribute('aria-pressed', 'true');
    expect(getRecentCategories).toHaveBeenCalledWith('expense', 6);

    await user.click(screen.getByRole('button', { name: 'Gelir' }));
    expect(await screen.findByRole('button', { name: 'Maas' })).toBeInTheDocument();
    expect(getRecentCategories).toHaveBeenCalledWith('income', 6);
  });

  it('gecersiz veya bos tutarda Kaydet ve Kaydet ve yeni kilitli', async () => {
    const { user } = renderModal();
    const input = await screen.findByLabelText(/Tutar/);
    const save = screen.getByRole('button', { name: 'Kaydet' });
    const saveNew = screen.getByRole('button', { name: 'Kaydet ve yeni' });
    expect(save).toBeDisabled();
    expect(saveNew).toBeDisabled();

    await user.type(input, '1,005');
    expect(save).toBeDisabled();

    await user.clear(input);
    await user.type(input, '25');
    expect(save).toBeEnabled();
    expect(saveNew).toBeEnabled();
  });

  it('gecerli girisle create dogru govdeyle cagrilir, modal kapanir', async () => {
    const { user, onClose } = renderModal();
    await user.type(await screen.findByLabelText(/Tutar/), '12,50');
    await user.click(await screen.findByRole('button', { name: 'Market' }));
    await user.type(screen.getByLabelText('Aciklama'), '  haftalik alisveris ');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(transactionService.create).toHaveBeenCalledWith({
      amountKurus: 1250,
      type: 'expense',
      categoryId: 1,
      date: todayIso(),
      description: 'haftalik alisveris',
    });
  });

  it('kategori ve aciklama bos birakilabilir (kategorisiz, description null)', async () => {
    const { user } = renderModal();
    await user.type(await screen.findByLabelText(/Tutar/), '5');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(transactionService.create).toHaveBeenCalled());
    expect(transactionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountKurus: 500, categoryId: null, description: null }),
    );
  });

  it('Kaydet ve yeni formu sifirlar, modal acik kalir', async () => {
    const { user, onClose } = renderModal();
    const input = await screen.findByLabelText<HTMLInputElement>(/Tutar/);
    await user.type(input, '40');
    await user.click(await screen.findByRole('button', { name: 'Market' }));
    await user.type(screen.getByLabelText('Aciklama'), 'ekmek');
    await user.click(screen.getByRole('button', { name: 'Kaydet ve yeni' }));

    await waitFor(() => expect(transactionService.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/Tutar/).value).toBe(''));
    expect(screen.getByLabelText<HTMLInputElement>('Aciklama').value).toBe('');
    expect(screen.getByRole('button', { name: 'Market' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('kayit hatasinda mesaj gosterir ve modal acik kalir', async () => {
    vi.mocked(transactionService.create).mockRejectedValue(new Error('x'));
    const { user, onClose } = renderModal();
    await user.type(await screen.findByLabelText(/Tutar/), '5');
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kaydedilemedi');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('AppLayout yuzen + butonu', () => {
  it('Hizli islem ekle butonu modali acar', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/islemler']}>
        <AppLayout />
        <Outlet />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hizli islem ekle' }));
    expect(await screen.findByRole('dialog', { name: 'Hizli islem ekle' })).toBeInTheDocument();
  });
});
