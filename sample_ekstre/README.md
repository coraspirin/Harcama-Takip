# Örnek ekstreler

Bu dizin, OCR ayrıştırıcılarını gerçek ekstre biçimlerine göre ayarlamak için
kullanılır.

## ⚠️ Bu dizindeki PDF'ler repoya **girmez**

Gerçek banka ekstreleri kişisel finansal veridir: hesap numarası, bakiye,
harcama geçmişi ve çoğu zaman ad-soyad içerir. `.gitignore` bu dizindeki her
şeyi (bu README hariç) dışarıda tutar.

```
sample_ekstre/*
!sample_ekstre/README.md
```

## Kullanım

Kendi ekstrelerinizi test etmek için buraya banka adıyla koyun:

```
sample_ekstre/is-bankasi.pdf
sample_ekstre/garanti-kredi-karti.pdf
sample_ekstre/yapikredi-hesap-hareketi.pdf
```

Sonra uygulamada **İçe aktar** sayfasından yükleyin. Ayrıştırıcı, dosya adından
ve içerikten bankayı tespit eder; yanlış tespit ederse listeden elle
seçebilirsiniz.

## Yeni banka ayrıştırıcısı ekleme

Ayrıştırıcılar [server/src/services/ocr/parserRegistry.ts](../server/src/services/ocr/parserRegistry.ts)
dosyasında tanımlıdır. Çoğu banka için fark yalnızca işaret ve sütun
kurallarındadır; ortak satır ayrıştırıcısı seçeneklerle beslenir:

```ts
bankParser('bankaadi', 'Banka Adı', ['dosya-adinda-veya-icerikte-gecen', 'anahtar'], {
  unsignedMeansExpense: true,   // kredi kartı ekstresi: işaretsiz tutar = harcama
  lastAmountIsBalance: false,   // satırın son tutarı bakiye değilse
});
```

## Test fixture'ları

Ayrıştırıcı testleri gerçek PDF kullanmaz; anonimleştirilmiş metin
fixture'larıyla çalışır:
[server/src/services/ocr/statementParser.test.ts](../server/src/services/ocr/statementParser.test.ts)

Uçtan uca test için ise kod içinde geçerli bir PDF üretilir:
[server/src/test/pdfFixture.ts](../server/src/test/pdfFixture.ts)

Yeni bir banka biçimi eklerken, o bankanın ekstresinden **anonimleştirilmiş**
birkaç satırı fixture olarak testlere ekleyin — gerçek tutarları ve açıklamaları
değiştirmeyi unutmayın.
