# Değişiklik Günlüğü

Projede yapılan değişiklikler tarih ve saat damgasıyla, en yenisi en üstte olacak şekilde burada tutulur.

Biçim: `YYYY-MM-DD HH:MM | değişiklik özeti`

## Kayıtlar

- 2026-10-24 16:31 | Faz C (aylık limit): genel aylık limit (tüm giderler) eklendi; her limit için bugün dahil kalan gün, günlük harcanabilir tutar ve mevcut hızla ay sonu tahmini hesaplanıyor (budgetPaceService). Yeni /api/budgets/overview: beklenen gelir (gelir yoksa önceki 3 ayın ortalaması), harcanan, bekleyen ödemeler (geciken dahil) ve serbest para. Bütçe sayfası yeniden düzenlendi, genel limit için öneri gösteriliyor. Genel limit varken "önceki aydan kopyala"nın hiçbir şey kopyalamaması (NOT IN + NULL) düzeltildi. 174 test geçiyor.
- 2026-10-24 16:26 | Faz A (ev muhasebesine sadeleştirme): banka, hesap, kredi kartı ekstresi, faiz paneli ve OCR/içe aktarma kaldırıldı. Yeni 014_household migration'ı eski finans tablolarını düşürüp hesapsız şemayı kurar (kullanıcılar ve HA ayarları korunur, varsayılan kategoriler yeniden eklenir). Kategorilere sabit/değişken (nature) eklendi, genel aylık limit için bütçe kategorisi boş olabilir. Yedek formatı sürüm 2 (sürüm 1 yedekler okunur). OCR bağımlılıkları ve Docker'daki poppler/tesseract kaldırıldı. 158 test geçiyor.
- 2026-10-24 15:07 | memory.md oluşturuldu; geçmiş değişiklikler git geçmişinden aktarıldı

### Git geçmişinden aktarılanlar

- 2026-09-05 03:14 | bcd0966 | Okunamayan satırlar sınıflandırılıyor: kayıp işlem mi, başlık mı
- 2026-09-05 03:06 | 89108e8 | Kredi kartı ekstresi okunuyor: ay adıyla tarih, sağdaki tutar, sondaki artı
- 2026-09-05 02:43 | fced76d | Ardışık ters kayıtlarda baş satırı artık doğru gövdeye bağlanıyor
- 2026-09-05 02:35 | 312df46 | Tarihi ALTTA kalan sarılmış kayıtlar okunuyor (Garanti)
- 2026-09-04 16:59 | 9d00478 | Tutar sütunu bakiyenin solundan alınır, okunamayan satırlar raporlanır
- 2026-09-04 09:44 | 956180c | Hesap arası transfer ayrımı kaldırıldı
- 2026-09-04 01:40 | bf6f912 | Mükerrer bastırma kaldırıldı, gerçek silme ve toplu silme eklendi
- 2026-09-04 00:12 | a35eb05 | Tutar alanında imlecin sona atlaması ve tutarın bozulması düzeltildi
- 2026-09-04 00:07 | 2bb2967 | Garanti: çok parçaya bölünen kayıtlar ve artı işaretli tutarlar
- 2026-09-03 23:50 | f6070f2 | Enpara biçimi: üç satıra sarılan kayıtlar ve önek etiket
- 2026-08-07 01:04 | 67ae440 | Faz 12: hesap arası transfer eşleştirme + tekrar eden ödeme önerileri
- 2026-08-07 00:52 | 0dda7d9 | Faz 11: içe aktarma doğruluğu (mükerrer, bakiye zinciri, etiketler, toplu araç)
- 2026-08-05 19:22 | 421550c | OCR: pdfjs parçalarının satıra dizilmesi düzeltildi
- 2026-08-05 19:12 | 6236a74 | Docker subnet'i sabitlendi (Home Assistant erişimi için)
- 2026-08-05 18:13 | cdc1e8d | HTTPS yokken upgrade-insecure-requests ve HSTS gönderilmiyor
- 2026-08-05 18:08 | e96b382 | README: sunucu kurulumu için HOST_PORT ve sır üretimi notları
- 2026-08-05 18:02 | 42ba85c | env_file'ın Docker yollarını ezmesi engellendi
- 2026-08-05 17:58 | e7c26db | Dış port .env ile ayarlanabilir hale getirildi
- 2026-08-05 17:51 | 63ff92c | Üretim (tek container) yolu için test eklendi
- 2026-08-05 17:49 | affc1b5 | Faz 10 (opsiyonel): Home Assistant entegrasyonu
- 2026-08-05 17:41 | 3d71121 | Faz 9 (opsiyonel): PWA desteği
- 2026-08-05 17:37 | 6ddbe66 | Faz 8: OCR ile ekstre ve hesap hareketi okuma
- 2026-08-05 17:20 | 5c1b205 | Faz 7: süper admin paneli ve işlem günlüğü
- 2026-08-05 17:15 | 97903e6 | Faz 6: planlanan ödeme, taksit ve fatura (tek altyapı) + bildirimler
- 2026-08-05 14:12 | 7bd9fc8 | Faz 5: raporlar ve grafikler
- 2026-08-05 14:05 | e4f9ad3 | Faz 4: kategori yönetimi, bütçe ve veri dışa/içe aktarım
- 2026-08-05 13:57 | 0156d15 | Faz 3: kredi kartı ekstresi ve tahmini faiz
- 2026-08-05 13:50 | 195d6b8 | Faz 2: banka, hesap, kategori, işlem ve transfer
- 2026-08-05 13:36 | 67c91f4 | Faz 1: kimlik doğrulama, kurulum sihirbazı ve rol kontrolü
- 2026-08-05 13:21 | c4da47a | Faz 0: proje iskeleti, Docker kurulumu ve temel altyapı
- 2026-07-27 01:54 | e4e59ab | İlk commit
