import { useCallback, useMemo, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useCategorySuggestion } from './useCategorySuggestion.ts';
import { suggestCategory } from '../services/finance.ts';
import { KategoriOnerileri } from '../components/KategoriOnerileri.tsx';
import type { CategorySuggestion } from '../types/index.ts';

vi.mock('../services/finance.ts', () => ({ suggestCategory: vi.fn() }));

const sug = (
  categoryId: number,
  categoryName: string,
  confidence = 0.5,
  matchCount = 1,
): CategorySuggestion => ({ categoryId, categoryName, confidence, matchCount });

function Harness({
  allowAuto = true,
  initialCategory = null,
}: {
  allowAuto?: boolean;
  initialCategory?: number | null;
}) {
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(initialCategory);
  const valid = useMemo(() => new Set([1, 2, 3]), []);
  const onSelect = useCallback((id: number) => setCategoryId(id), []);
  const suggest = useCategorySuggestion({
    description,
    type: 'expense',
    categoryId,
    onSelect,
    validCategoryIds: valid,
    allowAutoSelect: allowAuto,
  });

  return (
    <div>
      <input
        aria-label="aciklama"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <select
        aria-label="kategori"
        value={categoryId ?? ''}
        onChange={(e) => {
          suggest.markManual();
          setCategoryId(e.target.value ? Number(e.target.value) : null);
        }}
      >
        <option value="">Kategorisiz</option>
        <option value="1">Market</option>
        <option value="2">Ulasim</option>
        <option value="3">Fatura</option>
      </select>
      <KategoriOnerileri
        suggestions={suggest.suggestions}
        selectedId={categoryId}
        autoSelected={suggest.autoSelected}
        onChoose={suggest.choose}
      />
    </div>
  );
}

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText('aciklama'), { target: { value } });
const settle = () => act(() => vi.advanceTimersByTimeAsync(300));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(suggestCategory).mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useCategorySuggestion', () => {
  it('300 ms debounce: yazarken tek istek, bekledikten sonra', async () => {
    vi.mocked(suggestCategory).mockResolvedValue([sug(1, 'Market')]);
    render(<Harness />);

    type('mar');
    await act(() => vi.advanceTimersByTimeAsync(200));
    type('mark');
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(suggestCategory).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(suggestCategory).toHaveBeenCalledTimes(1);
    expect(suggestCategory).toHaveBeenCalledWith('mark', 'expense');
    expect(screen.getByRole('button', { name: /Oneri: Market/ })).toBeInTheDocument();
  });

  it('2 karakterden kisa aciklamada istek atmaz', async () => {
    render(<Harness />);
    type('m');
    await settle();
    expect(suggestCategory).not.toHaveBeenCalled();
  });

  it('chip tiklaninca kategori secilir', async () => {
    vi.mocked(suggestCategory).mockResolvedValue([sug(2, 'Ulasim')]);
    render(<Harness />);
    type('otobus');
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /Oneri: Ulasim/ }));
    expect(screen.getByLabelText<HTMLSelectElement>('kategori').value).toBe('2');
  });

  it('kullanici secimi otomatik degistirilmez (yuksek guvenli oneri olsa bile)', async () => {
    vi.mocked(suggestCategory).mockResolvedValue([sug(1, 'Market', 0.95, 10)]);
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('kategori'), { target: { value: '3' } });
    type('migros');
    await settle();

    expect(screen.getByLabelText<HTMLSelectElement>('kategori').value).toBe('3');
    expect(screen.getByRole('button', { name: /Oneri: Market/ })).toBeInTheDocument();
    expect(screen.queryByText('otomatik secildi')).not.toBeInTheDocument();
  });

  it('kategori bos + guven>=0.8 ve eslesme>=3: otomatik secer ve ipucu gosterir', async () => {
    vi.mocked(suggestCategory).mockResolvedValue([sug(1, 'Market', 0.9, 5)]);
    render(<Harness />);
    type('migros');
    await settle();

    expect(screen.getByLabelText<HTMLSelectElement>('kategori').value).toBe('1');
    expect(screen.getByText('otomatik secildi')).toBeInTheDocument();
  });

  it('esik altinda (guven 0.7 ya da eslesme 2) otomatik secmez', async () => {
    vi.mocked(suggestCategory).mockResolvedValue([sug(1, 'Market', 0.7, 9)]);
    render(<Harness />);
    type('migros');
    await settle();
    expect(screen.getByLabelText<HTMLSelectElement>('kategori').value).toBe('');

    vi.mocked(suggestCategory).mockResolvedValue([sug(1, 'Market', 0.95, 2)]);
    type('migros 2');
    await settle();
    expect(screen.getByLabelText<HTMLSelectElement>('kategori').value).toBe('');
  });

  it('kullanici kategoriyi elle bosaltirsa bir daha otomatik secilmez', async () => {
    vi.mocked(suggestCategory).mockResolvedValue([sug(1, 'Market', 0.9, 5)]);
    render(<Harness />);
    type('migros');
    await settle();
    expect(screen.getByLabelText<HTMLSelectElement>('kategori').value).toBe('1');

    fireEvent.change(screen.getByLabelText('kategori'), { target: { value: '' } });
    type('migros market');
    await settle();
    expect(screen.getByLabelText<HTMLSelectElement>('kategori').value).toBe('');
  });

  it('allowAutoSelect=false (duzenleme): kategori bos olsa da otomatik secilmez', async () => {
    vi.mocked(suggestCategory).mockResolvedValue([sug(1, 'Market', 0.95, 9)]);
    render(<Harness allowAuto={false} />);
    type('migros');
    await settle();
    expect(screen.getByLabelText<HTMLSelectElement>('kategori').value).toBe('');
  });

  it('mevcut kategori otomatik degismez', async () => {
    vi.mocked(suggestCategory).mockResolvedValue([sug(1, 'Market', 0.95, 9)]);
    render(<Harness initialCategory={3} />);
    type('migros');
    await settle();
    expect(screen.getByLabelText<HTMLSelectElement>('kategori').value).toBe('3');
  });

  it('eski istegin yaniti yenisini ezmez', async () => {
    let resolveFirst: (v: CategorySuggestion[]) => void = () => undefined;
    vi.mocked(suggestCategory)
      .mockImplementationOnce(
        () =>
          new Promise<CategorySuggestion[]>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([sug(2, 'Ulasim')]);
    render(<Harness />);

    type('mig');
    await settle(); // 1. istek havada
    type('migros');
    await settle(); // 2. istek cozuldu
    expect(screen.getByRole('button', { name: /Oneri: Ulasim/ })).toBeInTheDocument();

    await act(async () => {
      resolveFirst([sug(1, 'Market')]); // gec gelen eski yanit
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /Oneri: Market/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Oneri: Ulasim/ })).toBeInTheDocument();
  });

  it('hata olursa oneri gostermez ve hata kutusu acmaz', async () => {
    vi.mocked(suggestCategory).mockRejectedValue(new Error('ag hatasi'));
    render(<Harness />);
    type('migros');
    await settle();
    expect(screen.queryByRole('button', { name: /Oneri:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
