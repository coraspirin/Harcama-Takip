import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoneyInput } from './MoneyInput.tsx';

/** Gercek formlardaki gibi kontrollu ebeveyn: gelen degeri state'e yazip geri verir. */
function Harness({
  initial = null,
  onChange,
  onValidityChange,
}: {
  initial?: number | null;
  onChange?: (v: number | null) => void;
  onValidityChange?: (valid: boolean) => void;
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
        onValidityChange={onValidityChange}
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
    expect(screen.getByText('Geçersiz tutar')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    await user.tab();
    expect(input.value).toBe('abc');
    expect(screen.getByText('Geçersiz tutar')).toBeInTheDocument();
  });

  it('"1,005" yazinca hata gosterir ve 100500 yayilmaz', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.type(getInput(), '1,005');
    expect(screen.getByText('En fazla 2 ondalık hane girilebilir')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(100500);
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(screen.getByTestId('deger')).not.toHaveTextContent('100500');
  });

  it('hata, gecerli girdiyle temizlenir', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = getInput();
    await user.type(input, 'abc');
    expect(screen.getByText('Geçersiz tutar')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '5');
    expect(screen.queryByText('Geçersiz tutar')).not.toBeInTheDocument();
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

  describe('gecerlilik bildirimi', () => {
    it('"1,005" false, duzeltince true; yalnizca degisimde cagrilir', async () => {
      const user = userEvent.setup();
      const onValidity = vi.fn();
      render(<Harness onValidityChange={onValidity} />);

      const input = getInput();
      await user.type(input, '1,00');
      expect(onValidity).not.toHaveBeenCalled();

      await user.type(input, '5');
      expect(onValidity).toHaveBeenCalledTimes(1);
      expect(onValidity).toHaveBeenLastCalledWith(false);

      // Gecersiz durumda yazmaya devam etmek tekrar bildirim uretmez.
      await user.type(input, '6');
      expect(onValidity).toHaveBeenCalledTimes(1);

      await user.clear(input);
      await user.type(input, '1,00');
      expect(onValidity).toHaveBeenCalledTimes(2);
      expect(onValidity).toHaveBeenLastCalledWith(true);
    });

    it('"abc" false, alan bosaltilinca true', async () => {
      const user = userEvent.setup();
      const onValidity = vi.fn();
      render(<Harness onValidityChange={onValidity} />);

      const input = getInput();
      await user.type(input, 'abc');
      expect(onValidity).toHaveBeenCalledTimes(1);
      expect(onValidity).toHaveBeenLastCalledWith(false);

      await user.clear(input);
      expect(onValidity).toHaveBeenCalledTimes(2);
      expect(onValidity).toHaveBeenLastCalledWith(true);
    });

    it('gecersizken unmount edilince gecerli bildirilir', async () => {
      const user = userEvent.setup();
      const onValidity = vi.fn();
      const { unmount } = render(<Harness onValidityChange={onValidity} />);

      await user.type(getInput(), 'abc');
      expect(onValidity).toHaveBeenLastCalledWith(false);

      unmount();
      expect(onValidity).toHaveBeenCalledTimes(2);
      expect(onValidity).toHaveBeenLastCalledWith(true);
    });

    it('gecerliyken unmount bildirim uretmez', () => {
      const onValidity = vi.fn();
      const { unmount } = render(<Harness initial={500} onValidityChange={onValidity} />);
      unmount();
      expect(onValidity).not.toHaveBeenCalled();
    });

    it('gecersizken deger disaridan degisirse hata temizlenir ve gecerli bildirilir', async () => {
      const user = userEvent.setup();
      const onValidity = vi.fn();
      render(<Harness onValidityChange={onValidity} />);

      await user.type(getInput(), 'abc');
      expect(onValidity).toHaveBeenLastCalledWith(false);

      await user.click(screen.getByRole('button', { name: 'yukle' }));
      expect(getInput().value).toBe('2.500,75');
      expect(screen.queryByText('Geçersiz tutar')).not.toBeInTheDocument();
      expect(onValidity).toHaveBeenLastCalledWith(true);
    });
  });

  it('hata mesaji parseKurus mesajidir: "abc" -> Geçersiz tutar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(getInput(), 'abc');
    expect(screen.getByText('Geçersiz tutar')).toBeInTheDocument();
    expect(getInput()).toHaveAttribute('aria-invalid', 'true');
  });

  it('setCustomValidity: gecersizken input.validity.valid false, duzelince true', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = getInput();
    expect(input.validity.valid).toBe(true);

    await user.type(input, '1,005');
    expect(input.validity.valid).toBe(false);
    expect(input.validationMessage).toBe('En fazla 2 ondalık hane girilebilir');

    await user.clear(input);
    expect(input.validity.valid).toBe(true);
  });
});
