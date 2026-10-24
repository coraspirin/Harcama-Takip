/**
 * Turkce'ye ozgu harfleri ASCII karsiliklarina indirger ve kucuk harfe cevirir.
 *
 * toLocaleLowerCase('tr') "IADE" -> "ıade" yapar (noktasiz i), duz
 * toLowerCase ise "İADE" -> "i̇ade" (birlesik nokta) uretir; ikisi de
 * metin karsilastirmasini sessizce bozar. Ayrica "ödeme" ile "odeme" ayni
 * sayilmalidir.
 */
export function foldTurkish(value: string): string {
  return value
    .replace(/[İIı]/g, 'i')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[Üü]/g, 'u')
    .replace(/[Öö]/g, 'o')
    .replace(/[Çç]/g, 'c')
    .toLowerCase();
}
