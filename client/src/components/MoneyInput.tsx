import { useEffect, useState } from 'react';
import { TextField } from './ui/Field.tsx';
import { formatKurus, parseKurus } from '../lib/format.ts';

/**
 * Kullanicidan TL alir, kurusa (integer) cevirip yukari verir.
 * Yazarken serbest metin tutulur; odak kaybinda normalize edilir. Boylece
 * "1.234,5" gibi ara durumlar yazim sirasinda bozulmaz.
 */
export function MoneyInput({
  label,
  valueKurus,
  onChangeKurus,
  hint,
  error,
  required,
  autoFocus,
}: {
  label: string;
  valueKurus: number | null;
  onChangeKurus: (value: number | null) => void;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(valueKurus === null ? '' : formatKurus(valueKurus));
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  // Disaridan gelen deger degistiginde (or. form sifirlandi) metni esitle
  useEffect(() => {
    setText(valueKurus === null ? '' : formatKurus(valueKurus));
  }, [valueKurus]);

  function handleChange(raw: string) {
    setText(raw);
    if (raw.trim() === '') {
      setLocalError(undefined);
      onChangeKurus(null);
      return;
    }
    try {
      onChangeKurus(parseKurus(raw));
      setLocalError(undefined);
    } catch {
      setLocalError('Gecerli bir tutar girin');
    }
  }

  function handleBlur() {
    if (text.trim() === '') return;
    try {
      setText(formatKurus(parseKurus(text)));
    } catch {
      /* hatali deger oldugu gibi kalsin, kullanici duzeltsin */
    }
  }

  return (
    <TextField
      label={label}
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      inputMode="decimal"
      placeholder="0,00"
      hint={hint}
      error={error ?? localError}
      required={required}
      autoFocus={autoFocus}
      className="tabular"
    />
  );
}
