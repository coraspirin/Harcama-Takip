import { applyBasisPoints } from '../lib/money.ts';

/**
 * Turkiye'de kredi karti faizi uzerine KKDF (%15) ve BSMV (%15) alinir;
 * toplamda faizin %30'u kadar ek yuk demektir. 3000 bp = %30.
 */
export const TAX_SURCHARGE_BP = 3_000;

export type InterestInput = {
  /** Ekstre (donem borcu) tutari */
  statementAmountKurus: number;
  /** Kullanicinin odedigi tutar */
  paidAmountKurus: number;
  /** Bankanin aylik akdi faiz orani, baz puan (311 = %3.11) */
  monthlyInterestBp: number;
  /** KKDF + BSMV eklensin mi */
  taxesIncluded: boolean;
};

export type InterestBreakdown = {
  /** Odenmeyen kalan tutar (negatif olamaz) */
  unpaidKurus: number;
  /** Vergisiz akdi faiz */
  baseInterestKurus: number;
  /** KKDF + BSMV */
  taxKurus: number;
  /** Faiz + vergiler */
  totalInterestKurus: number;
  /** Kalan borc + faiz -> gelecek ekstreye tasinacagi TAHMIN edilen tutar */
  estimatedDebtKurus: number;
  monthlyInterestBp: number;
  taxesIncluded: boolean;
};

/**
 * Odenmeyen kalan tutar uzerinden bir aylik TAHMINI faizi hesaplar.
 *
 * Bu bir tahmindir, bankanin kesin hesabi degildir: gercekte bankalar faizi
 * gun bazinda ve islem tarihlerine gore isletir, asgari odeme altinda kalan
 * tutara farkli oran uygulayabilir. Kullaniciya her zaman "tahmini" oldugu
 * belirtilerek gosterilir.
 */
export function calculateStatementInterest(input: InterestInput): InterestBreakdown {
  const unpaidKurus = Math.max(0, input.statementAmountKurus - input.paidAmountKurus);

  const baseInterestKurus = applyBasisPoints(unpaidKurus, input.monthlyInterestBp);
  const taxKurus = input.taxesIncluded ? applyBasisPoints(baseInterestKurus, TAX_SURCHARGE_BP) : 0;
  const totalInterestKurus = baseInterestKurus + taxKurus;

  return {
    unpaidKurus,
    baseInterestKurus,
    taxKurus,
    totalInterestKurus,
    estimatedDebtKurus: unpaidKurus + totalInterestKurus,
    monthlyInterestBp: input.monthlyInterestBp,
    taxesIncluded: input.taxesIncluded,
  };
}

/**
 * Ekstre tutari ile islemlerden hesaplanan donem hareketi arasindaki fark.
 * Sifirdan farkliysa ya bir islem girilmemis ya da ekstre yanlis girilmistir;
 * karar kullaniciya birakilir.
 */
export type Reconciliation = {
  statementAmountKurus: number;
  transactionsTotalKurus: number;
  differenceKurus: number;
  matches: boolean;
};

export function reconcileStatement(
  statementAmountKurus: number,
  transactionsTotalKurus: number,
): Reconciliation {
  const differenceKurus = statementAmountKurus - transactionsTotalKurus;
  return {
    statementAmountKurus,
    transactionsTotalKurus,
    differenceKurus,
    matches: differenceKurus === 0,
  };
}
