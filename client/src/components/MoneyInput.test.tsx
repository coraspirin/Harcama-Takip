import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoneyInput } from './MoneyInput.tsx';

/** Gercek formlardaki gibi kontrollu ebeveyn: gelen degeri state'e yazip geri verir. */
function Harness({
  initial = null,
  onChange,
}: {
  initial?: number | null;
  onChange?: (v: number | null) => void;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <div>
      <MoneyInput
        label="Tutar"
        valueKurus={value}
        onChangeKurus={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
      <button type="button" onClick={() => setValue(null)}>
        sifirla
      </button>
      <button type="button" onClick={() => setValue(250075)}>
        yukle
      </button>
      <output data-testid="deger">{value === null ? 'null' : value}</output>
    </div>
  );
}

function getInput(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>('Tutar');
}

describe('MoneyInput', () => {
  it('"12" yazarken metin her tusta yeniden bicimlenmez ve son deger 1200 olur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const input = getInput();
    await user.click(input);
    await user.keyboard('1');
    expect(input.value).toBe('1');
    await user.keyboard('2');
    expect(input.value).toBe('12');

    expect(onChange).toHaveBeenNthCalledWith(1, 100);
    expect(onChange).toHaveBeenLastCalledWith(1200);
    expect(screen.getByTestId('deger')).toHaveTextContent('1200');
  });

  it('"1.234,5" ara durumu bozulmaz, blur ile "1.234,50" olur (123450)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const input = getInput();
    await user.click(input);
    await user.keyboard('1.234,5');
    expect(input.value).toBe('1.234,5');
    expect(onChange).toHaveBeenLastCalledWith(123450);

    await user.tab();
    expect(input.value).toBe('1.234,50');
    expect(screen.getByTestId('deger')).toHaveTextContent('123450');
  });

  it('alan temizlenince null yayilir', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={1200} onChange={onChange} />);

    const input = getInput();
    expect(input.value).toBe('12,00');
    await user.clear(input);

    expect(input.value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('deger')).toHaveTextContent('null');
  });

  it('gecersiz girdide hata gosterir, blur metni degistirmez', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const input = getInput();
    await user.click(input);
    await user.keyboard('abc');
    expect(screen.getByText('Gecerli bir tutar girin')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    await user.tab();
    expect(input.value).toBe('abc');
    expect(screen.getByText('Gecerli bir tutar girin')).toBeInTheDocument();
  });

  it('"1,005" yazinca hata gosterir ve 100500 yayilmaz', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.type(getInput(), '1,005');
    expect(screen.getByText('Gecerli bir tutar girin')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(100500);
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(screen.getByTestId('deger')).not.toHaveTextContent('100500');
  });

  it('hata, gecerli girdiyle temizlenir', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = getInput();
    await user.type(input, 'abc');
    expect(screen.getByText('Gecerli bir tutar girin')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '5');
    expect(screen.queryByText('Gecerli bir tutar girin')).not.toBeInTheDocument();
  });

  it('deger disaridan degisince metin yeni degerle esitlenir', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = getInput();
    await user.type(input, '12');
    expect(input.value).toBe('12');

    await user.click(screen.getByRole('button', { name: 'yukle' }));
    expect(input.value).toBe('2.500,75');

    await user.click(screen.getByRole('button', { name: 'sifirla' }));
    expect(input.value).toBe('');
  });

  it('ilk deger bicimlenmis olarak gosterilir', () => {
    render(<Harness initial={123456} />);
    expect(getInput().value).toBe('1.234,56');
  });

  it('error prop yerel hatadan onceliklidir', () => {
    render(
      <MoneyInput
        label="Tutar"
        valueKurus={null}
        onChangeKurus={() => undefined}
        error="Zorunlu"
      />,
    );
    expect(screen.getByText('Zorunlu')).toBeInTheDocument();
  });
});
