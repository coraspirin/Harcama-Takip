import { applyBasisPoints } from '../lib/money.ts';

/**
 * Turkiye'de kredi karti ve tuketici kredisi faizi uzerine KKDF (%15) ve BSMV
 * (%15) alinir; toplamda faizin %30'u kadar ek yuk demektir. 3000 bp = %30.
 */
export const TAX_SURCHARGE_BP = 3_000;

export type MonthlyInterest = {
  /** Vergisiz akdi faiz */
  baseInterestKurus: number;
  /** KKDF + BSMV */
  taxKurus: number;
  /** Faiz + vergiler */
  totalInterestKurus: number;
};

/**
 * Bakiye uzerinden bir aylik TAHMINI faiz.
 *
 * Bu bir tahmindir, bankanin kesin hesabi degildir: gercekte faiz gun bazinda
 * isletilir ve asgari odeme altinda kalan tutara farkli oran uygulanabilir.
 * Kullaniciya her zaman "tahmini" oldugu belirtilerek gosterilir.
 */
export function monthlyInterest(
  balanceKurus: number,
  monthlyInterestBp: number,
  taxesIncluded: boolean,
): MonthlyInterest {
  const baseInterestKurus = applyBasisPoints(Math.max(0, balanceKurus), monthlyInterestBp);
  const taxKurus = taxesIncluded ? applyBasisPoints(baseInterestKurus, TAX_SURCHARGE_BP) : 0;
  return { baseInterestKurus, taxKurus, totalInterestKurus: baseInterestKurus + taxKurus };
}
