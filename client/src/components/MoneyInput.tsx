import { useEffect, useRef, useState } from 'react';
import { TextField } from './ui/Field.tsx';
import { formatKurus, parseKurus } from '../lib/format.ts';

/**
 * Kullanicidan TL alir, kurusa (integer) cevirip yukari verir.
 *
 * Yazarken metin SERBEST birakilir, yalnizca odak kaybinda bicimlendirilir.
 * Boylece "1.234,5" gibi ara durumlar bozulmaz.
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

  /**
   * En son YUKARI BILDIRDIGIMIZ deger.
   *
   * Ebeveynden geri donen deger bununla ayniysa, degisiklik bizden geldi
   * demektir ve metne DOKUNULMAMALIDIR.
   */
  const lastEmitted = useRef<number | null>(valueKurus);

  useEffect(() => {
    // Kendi yaydigimiz degerin geri donusu metni ezmemeli.
    //
    // Ezseydi her tus vurusunda metin bicimlenmis haliyle yeniden yazilir ve
    // IMLEC SONA ATLARDI. Sonuc yalnizca rahatsiz edici degil, veriyi de
    // bozardi: "12" yazmak isteyen kullanici once "1" yazar, alan "1,00"a
    // donusur, imlec sona atlar ve "2" sona eklenerek "1,002" olusur; bu da
    // virgulden sonra uc hane oldugu icin BINLIK AYRACI sayilip 1.002,00 TL
    // olarak kaydedilirdi.
    //
    // Yalnizca deger DISARIDAN degistiginde (form sifirlandi, duzenlenecek
    // kayit yuklendi) metin esitlenir.
    if (valueKurus === lastEmitted.current) return;

    lastEmitted.current = valueKurus;
    setText(valueKurus === null ? '' : formatKurus(valueKurus));
  }, [valueKurus]);

  function emit(value: number | null) {
    lastEmitted.current = value;
    onChangeKurus(value);
  }

  function handleChange(raw: string) {
    setText(raw);

    if (raw.trim() === '') {
      setLocalError(undefined);
      emit(null);
      return;
    }

    try {
      emit(parseKurus(raw));
      setLocalError(undefined);
    } catch {
      setLocalError('Gecerli bir tutar girin');
    }
  }

  function handleBlur() {
    if (text.trim() === '') return;
    try {
      // Odak kaybinda bicimlendirmek guvenli: imlec zaten alanda degil.
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
