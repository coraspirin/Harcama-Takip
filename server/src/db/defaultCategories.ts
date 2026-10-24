/**
 * Yeni kullanici olusturulurken eklenen varsayilan kategoriler.
 * Bu bir "demo veri" degildir: kullanicinin ilk islemini kategorisiz girmek
 * zorunda kalmamasi icin gereken minimum iskelet.
 *
 * Ayri dosyada durur cunku migration'lar da kullanir; categories.ts ise
 * connection.ts'e bagli ve migration zincirinden import edilirse dongu olusur.
 *
 * nature: 'fixed' her ay buyuk olcude ayni tutarda tekrar eden giderdir
 * (kira, fatura). Tahminler sabit ve degisken gideri ayri ortalar.
 */
export const DEFAULT_CATEGORIES: {
  name: string;
  kind: 'income' | 'expense';
  nature: 'fixed' | 'variable';
}[] = [
  { name: 'Market', kind: 'expense', nature: 'variable' },
  { name: 'Yemek', kind: 'expense', nature: 'variable' },
  { name: 'Ulasim', kind: 'expense', nature: 'variable' },
  { name: 'Fatura', kind: 'expense', nature: 'fixed' },
  { name: 'Kira', kind: 'expense', nature: 'fixed' },
  { name: 'Aidat', kind: 'expense', nature: 'fixed' },
  { name: 'Saglik', kind: 'expense', nature: 'variable' },
  { name: 'Giyim', kind: 'expense', nature: 'variable' },
  { name: 'Ev', kind: 'expense', nature: 'variable' },
  { name: 'Cocuk', kind: 'expense', nature: 'variable' },
  { name: 'Eglence', kind: 'expense', nature: 'variable' },
  { name: 'Egitim', kind: 'expense', nature: 'fixed' },
  { name: 'Abonelik', kind: 'expense', nature: 'fixed' },
  { name: 'Diger gider', kind: 'expense', nature: 'variable' },
  { name: 'Maas', kind: 'income', nature: 'fixed' },
  { name: 'Ek gelir', kind: 'income', nature: 'variable' },
  { name: 'Yatirim geliri', kind: 'income', nature: 'variable' },
  { name: 'Diger gelir', kind: 'income', nature: 'variable' },
];
