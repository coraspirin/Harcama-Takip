import { useCallback, useState } from 'react';

export type FieldValidityProps = {
  onValidityChange: (valid: boolean) => void;
};

/**
 * Bir formdaki birden fazla MoneyInput'un gecerlilik durumunu tek yerde toplar.
 *
 * Kullanim:
 *   const { register, allValid } = useFieldValidity();
 *   <MoneyInput {...register('tutar')} ... />
 *   <Button disabled={saving || !allValid}>Kaydet</Button>
 *
 * Alan basina ayri useState tutmak yerine gecersiz alan adlarini bir kumede
 * toplar; yeni alan eklemek tek satirdir ve "hepsi gecerli mi" tek ifadedir.
 * Gecerli alan kumeden cikar (MoneyInput unmount'ta gecerli bildirir), boylece
 * kosullu render edilen alanlar butonu kilitli birakmaz.
 */
export function useFieldValidity() {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set());

  const setValidity = useCallback((name: string, valid: boolean) => {
    setInvalid((prev) => {
      if (prev.has(name) === !valid) return prev;
      const next = new Set(prev);
      if (valid) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const register = useCallback(
    (name: string): FieldValidityProps => ({
      onValidityChange: (valid) => setValidity(name, valid),
    }),
    [setValidity],
  );

  return { register, allValid: invalid.size === 0 };
}
