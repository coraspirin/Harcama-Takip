# Proje: Kişisel Harcama Takip Uygulaması (Çoklu Kullanıcı)

## Genel Bakış
Çok kullanıcılı, kişisel gelir/gider takip web uygulaması geliştir. Her kullanıcının verisi tamamen izole olacak (kullanıcı yalnızca kendi verisini görür/yönetir). Sistemde ayrıca bir **süper kullanıcı (super admin)** rolü olacak; bu rol yalnızca kullanıcı hesaplarını yönetir, uygulamanın gelir/gider/rapor gibi hiçbir işlevsel kısmına erişemez ve hiçbir kullanıcının finansal verisini göremez.

Uygulama; anlık işlem kaydının yanı sıra **planlanan ödeme/alacaklar**, **taksitli ödemeler**, **fatura takibi**, **çoklu hesap/cüzdan takibi**, **OCR ile ekstre/hesap hareketi okuma** özelliklerini içerecek; isteğe bağlı olarak **PWA (Progressive Web App)** ve **Home Assistant entegrasyonu** (telefona bildirim gönderme) desteği de eklenebilir.

## Teknoloji Yığını
- Frontend: React 18 + Vite + TypeScript
- Routing: react-router-dom
- State yönetimi: React Context + useReducer (veya React Query ile backend'den veri çekme)
- Grafik/görselleştirme: recharts
- Stil: Tailwind CSS
- İkon: lucide-react
- Backend: Node.js + Express (TypeScript)
- Veritabanı: SQLite (node:sqlite veya better-sqlite3)
- Kimlik doğrulama: JWT tabanlı auth (access token + refresh token), şifreler bcrypt ile hash'lensin
- OCR: tesseract.js + pdftoppm (PDF ekstre/hesap hareketi görüntüye çevirip OCR ile okuma)
- Zamanlanmış görevler: node-cron (planlanan ödeme/fatura tarihi kontrolü için)
- PWA (opsiyonel, en son faz): vite-plugin-pwa (service worker + manifest.json otomatik üretimi için)
- Deploy: Docker Compose (defterim projesindeki yaklaşımla tutarlı)
- Rate limiting: express-rate-limit (giriş/auth endpoint'leri için)

## Kullanıcı ve Yetkilendirme Modeli

### Roller
1. **Normal kullanıcı (`user`)** — Uygulamanın tüm işlevsel kısımlarını (işlemler, hesaplar, raporlar, OCR, bütçe vb.) yalnızca **kendi verisi** üzerinde kullanır.
2. **Süper kullanıcı (`super_admin`)** — Sistemde tek bir amacı var: kullanıcı hesaplarını yönetmek (listeleme, oluşturma, devre dışı bırakma/silme, şifre sıfırlama). Bu rolün:
   - Hiçbir işlem/hesap/rapor/OCR ekranına erişimi olmayacak (bu ekranlar/route'lar backend tarafında da rol kontrolüyle tamamen kapatılsın)
   - Herhangi bir kullanıcının finansal verisini sorgulayacak/görecek hiçbir API endpoint'i olmayacak — bu ayrım sadece frontend'de gizleme değil, backend'de rol bazlı erişim kontrolü (middleware) ile zorunlu kılınmalı

### Veri İzolasyonu
- Tüm veri tabloları (transactions, accounts, categories, budgets, planned_payments, installments, bills) bir `user_id` alanı içersin ve **her sorgu** oturum açmış kullanıcının id'siyle filtrelensin
- Bir kullanıcının API isteğiyle başka bir kullanıcının verisine erişmesi mümkün olmamalı (backend'de her route'ta bu kontrol açıkça yapılmalı, sadece frontend'e güvenilmemeli)
- Süper admin'in kullanıcı yönetimi endpoint'leri (`/admin/*`) tamamen ayrı bir route grubunda olsun ve normal veri route'larından (`/api/*`) tamamen bağımsız çalışsın

### Auth Akışı
- Kayıt (register) / giriş (login) / çıkış (logout)
- Giriş endpoint'inde rate limiting uygulanmalı (ör. IP/kullanıcı başına dakikada sınırlı deneme) — brute-force şifre denemelerine karşı
- "Tüm cihazlardan çıkış yap" özelliği: kullanıcı isteğe bağlı olarak tüm refresh token'larını iptal edip diğer oturumları kapatabilsin (şifre değişikliğinde de otomatik tetiklensin)
- Süper admin girişi ayrı bir giriş ekranından mı yoksa aynı ekrandan rol bazlı yönlendirmeyle mi yapılacağına karar ver; rol `user` ise normal uygulamaya, `super_admin` ise sadece kullanıcı yönetim paneline yönlendirilsin
- İlk kurulumda bir süper admin hesabının nasıl oluşturulacağı README'de belirtilsin (ör. seed script veya ortam değişkeni ile ilk admin oluşturma)

## Temel Özellikler (Normal Kullanıcı)

1. **Banka Yönetimi (Ayarlar altında)**
   - Kullanıcı kendi banka kayıtlarını ekleyip kaldırabilsin (ör. "İş Bankası", "Garanti BBVA")
   - Her banka kaydı kendi ayarlarını barındırsın: banka adı, **faiz oranı** (kredi kartı borcu için kullanılacak, ör. aylık gecikme/asgari ödeme faiz oranı)
   - Bir banka silinmeye çalışıldığında, o bankaya bağlı hesap/işlem kaydı varsa kullanıcıya uyarı gösterilsin ("Bu bankaya ait N kayıt silinecek, emin misiniz?")
   - Uyarı onaylanırsa banka VE o bankaya bağlı tüm hesap/işlem kayıtları silinsin (cascade delete)
   - Hesaplar (aşağıdaki madde) bir bankaya bağlı olabilir; nakit gibi bankaya bağlı olmayan hesaplar da desteklensin

2. **Çoklu Hesap/Cüzdan Takibi**
   - Hesap tanımları: ad, tür (nakit, banka hesabı, kredi kartı vb.), bağlı olduğu banka (opsiyonel, nakit için gerekmez), başlangıç bakiyesi
   - Her işlem bir hesaba bağlı olsun; hesap bakiyesi o hesaba ait işlemlerden otomatik hesaplansın
   - Hesaplar arası transfer (ör. banka hesabından nakite) desteklensin

3. **Kredi Kartı Borç/Faiz Takibi**
   - Kredi kartı tipi hesaplarda: dönem borcu (ekstre tutarı), ödenen tutar bilgisi girilebilsin
   - Borcun tamamı ödenmezse, kalan tutar üzerinden bağlı bankanın faiz oranı kullanılarak faiz hesaplansın ve **tahmini kalan borç** tutarına eklensin
   - Bu tahmini tutar dashboard/hesap detayında ayrıca gösterilsin (gerçek ekstre tutarından farklı olduğu belirtilerek — banka hesaplaması kesin sonuç olmayabilir, "tahmini" ibaresi önemli)

4. **Harcama/Gelir Kaydı**
   - Ekle / düzenle / sil
   - Alanlar: tarih, tutar, tür (gelir/gider), kategori, hesap, açıklama

5. **Kategoriler**
   - Varsayılan kategoriler + kullanıcının kendi kategorilerini ekleyip silebilmesi

6. **Planlanan Ödeme/Alacak**
   - Gelecekteki bir ödeme/alacak kaydı (tarih, tutar, tür, kategori, hesap, açıklama, karşı taraf)
   - Durum: "bekliyor" / "onaylandı"; vadesi geldiğinde uyarı gösterilsin
   - Onaylanınca otomatik olarak gelir/gider tablosuna işlensin, onaylanmadan raporlara dahil edilmesin

7. **Taksitli Ödeme Takibi**
   - Toplam tutar, taksit sayısı, başlangıç tarihi, kategori, hesap, açıklama
   - Otomatik aylık taksit kayıtları üretilsin, her biri "ödendi/bekliyor" işaretlenebilsin, ilerleme durumu gösterilsin (ör. 3/12)

8. **Fatura Takibi**
   - Fatura tanımları: ad, kesim/son ödeme tarihi, periyot
   - Her periyotta otomatik yeni "ödenecek fatura" kaydı, tutar kullanıcı tarafından girilsin
   - Yaklaşan fatura tarihleri için uyarı

9. **OCR ile Ekstre/Hesap Hareketi Okuma**
   - Kredi kartı ekstresi ve banka hesap hareketi (PDF) yükleme
   - PDF → görüntü → OCR → işlem satırlarının ayrıştırılması
   - Sonuçlar taslak listesi olarak gösterilsin, kullanıcı onaylayınca ilgili hesaba işlensin
   - Proje kök dizininde `sample_ekstre/banka_adı.pdf` formatında örnek ekstreler bulunacak — parser'ı banka bazında genişletilebilir tasarla (dosya adından/içerikten banka tespiti, her banka için ayrı parse stratejisi)

10. **Dashboard / Özet**
    - Hesap bazında bakiyeler, aylık toplam gelir/gider/net bakiye
    - Kategoriye göre harcama dağılımı (pasta grafik), aylık trend (çizgi/bar grafik)
    - Yaklaşan ödemeler/faturalar/taksitler özet kartı

11. **Aylık Gelir/Gider Raporları** — ay seçimi, toplam gelir/gider/net, önceki aya göre değişim yüzdesi

12. **Kategori Bazlı Raporlama** — dönem bazlı kategori kırılımı, en çok harcanan kategoriler, trend

13. **Filtreleme ve Arama** — tarih aralığı, kategori, hesap, tutar aralığı, açıklama üzerinde arama

14. **Bütçe Belirleme** — kategori bazlı aylık bütçe limiti, aşımda görsel uyarı

15. **Veri Yönetimi** — JSON export/import, kullanıcının kendi verisini sıfırlaması (onaylı)

## Özellikler (Süper Admin)
- Kullanıcı listesi (kullanıcı adı/e-posta, oluşturulma tarihi, aktif/pasif durumu)
- Yeni kullanıcı oluşturma
- Kullanıcıyı devre dışı bırakma / silme
- Kullanıcı şifresini sıfırlama
- **İşlem günlüğü (audit log):** Süper admin'in yaptığı her işlem (kullanıcı oluşturma, silme, devre dışı bırakma, şifre sıfırlama) kim tarafından, ne zaman yapıldığı bilgisiyle kayıt altına alınsın ve bir liste ekranında görüntülenebilsin
- **Not:** Bu ekranların hiçbirinde kullanıcının finansal verisine dair tek bir bilgi bile görünmemeli (ne bakiye, ne işlem sayısı, ne kategori — sadece hesap yönetimi bilgileri)

## Sayfa/Ekran Yapısı

**Normal kullanıcı:**
- `/giris`, `/kayit` — Giriş / kayıt
- `/` — Dashboard
- `/hesaplar` — Hesap/cüzdan yönetimi
- `/islemler` — İşlem listesi
- `/planlanan` — Planlanan ödeme/alacak
- `/taksitler` — Taksitli ödemeler
- `/faturalar` — Fatura takibi
- `/ice-aktar` — OCR ile ekstre yükleme
- `/raporlar` — Raporlar
- `/kategoriler` — Kategori yönetimi
- `/butce` — Bütçe
- `/ayarlar` — Bankalar (ekle/kaldır/faiz oranı), Home Assistant ayarları (opsiyonel), export/import/reset, hesap bilgileri, çıkış

**Süper admin (tamamen ayrı bir arayüz/layout):**
- `/admin/giris` — Admin girişi (veya ortak giriş ekranından rol bazlı yönlendirme)
- `/admin/kullanicilar` — Kullanıcı listesi ve yönetimi
- `/admin/islem-gunlugu` — Admin işlem günlüğü (audit log)

## Proje Yapısı Beklentisi
- `frontend/src/components/` — yeniden kullanılabilir UI bileşenleri
- `frontend/src/pages/` — normal kullanıcı sayfaları
- `frontend/src/pages/admin/` — süper admin sayfaları (ayrı layout ile)
- `frontend/src/context/AuthContext.tsx` — oturum/rol yönetimi
- `frontend/src/services/` — backend API çağrıları
- `frontend/src/types/` — TypeScript tip tanımları (User, Bank, Account, Transaction, Category, Budget, Installment, Bill, PlannedPayment)
- `backend/src/routes/` — Express route'ları: `auth`, `banks`, `accounts`, `transactions`, `categories`, `planned-payments`, `installments`, `bills`, `reports`, `ocr`
- `backend/src/routes/admin/` — süper admin route'ları (`users`, `audit-log`), diğer route'lardan tamamen ayrı
- `backend/src/middleware/auth.ts` — JWT doğrulama + rol kontrolü middleware'i (requireUser, requireSuperAdmin)
- `backend/src/db/` — SQLite bağlantısı, migration'lar (tüm tablolarda `user_id` foreign key; `banks` tablosu `interest_rate` alanı içerir, `accounts` tablosu opsiyonel `bank_id` foreign key içerir)
- `backend/src/services/ocrService.ts` — PDF → görüntü → OCR → parse akışı
- `backend/src/services/scheduler.ts` — planlanan ödeme/fatura tarihi kontrolü (node-cron)
- `backend/src/services/interestService.ts` — kredi kartı kalan borç üzerinden tahmini faiz hesaplama mantığı
- `backend/src/services/haNotificationService.ts` — Home Assistant REST API üzerinden bildirim gönderme (opsiyonel)

## Home Assistant Entegrasyonu (Opsiyonel)
Bu bölüm de zorunlu değil, çekirdek özellikler tamamlandıktan sonra eklenecek bir iyileştirme olarak değerlendirilsin.
- Ayarlar sayfasında ayrı bir "Home Assistant" bölümü olsun:
  - Bağlantı bilgileri: HA sunucu URL'i, erişim token'ı (long-lived access token)
  - Bildirim gönderilecek hedef cihaz/kişi seçimi (HA'daki mevcut `notify` servislerinin/hedeflerinin listesi çekilip seçilebilir hale getirilsin)
  - Bağlantıyı test etme butonu (test bildirimi gönderme)
- Backend'de HA'nın REST API'sine (`/api/services/notify/<hedef>`) istek atan bir `haNotificationService.ts` servisi olsun
- Bu entegrasyon açıkken, yaklaşan planlanan ödeme/taksit/fatura gibi mevcut uygulama-içi uyarılar aynı zamanda HA üzerinden telefona bildirim olarak da gönderilsin (kullanıcı bunu ayarlardan açıp kapatabilsin)
- HA bağlantı bilgileri (özellikle access token) güvenli şekilde saklanmalı, düz metin loglanmamalı

## PWA Gereksinimleri (Opsiyonel)
Bu bölüm zorunlu değil, zaman/kapsam elverirse en son eklenecek bir iyileştirme olarak değerlendirilsin. Çekirdek özellikler (auth, hesaplar, işlemler, raporlar, süper admin) tamamlanmadan bu kısma geçilmesin.
- `manifest.json`: uygulama adı, ikonlar, tema rengi, `display: standalone`
- Service worker: en azından app shell (statik dosyalar) cache'lensin, tam offline veri senkronizasyonu şart değil
- Ana ekrana ekleme (Add to Home Screen) desteklensin ve test edilsin
- HTTPS gereksinimi (yerel geliştirmede Vite'ın PWA eklentisi bunu geliştirme modunda simüle eder)

## UI/UX Beklentileri
- Mobil uyumlu (responsive)
- Sade, modern tasarım — dashboard'da göze çarpan sayılar ve grafikler ön planda
- Tutarlar Türk Lirası (₺) formatında, binlik ayraç ile
- Tarihler gün.ay.yıl formatında (ör. 22.07.2026)
- Boş durumlar için anlamlı boş ekran mesajları
- Süper admin arayüzü görsel olarak normal kullanıcı arayüzünden belirgin şekilde ayrışsın (yanlışlıkla karıştırılmasın)

## Diğer Gereksinimler
- Kod TypeScript ile yazılsın, `any` kullanımından kaçın
- **Tüm parasal tutarlar kuruş (integer) cinsinden saklansın** — ondalıklı (float) tutmak yuvarlama hatalarına yol açar, özellikle faiz hesaplamasında; ekranda gösterirken TL'ye çevrilip formatlanır
- Uygulama ilk açıldığında örnek/demo veri OLUŞTURMA — boş durum ekranı göster
- Şifreler asla düz metin saklanmasın (bcrypt hash)
- **Hassas bilgiler (JWT secret, HA access token, veritabanı yolu vb.) koda/repoya asla yazılmasın**, `.env` dosyası üzerinden ortam değişkeni olarak yönetilsin; `.env.example` dosyası eklensin, `.env` `.gitignore`'a dahil edilsin
- Deploy: Docker Compose ile çalışacak şekilde `docker-compose.yml` ve `Dockerfile`'lar hazırlansın (defterim projesindeki yaklaşımla tutarlı)
- README.md ekle: kurulum (`npm install`, `npm run dev`, Docker ile çalıştırma), ilk süper admin hesabının nasıl oluşturulacağı, `.env` değişkenlerinin açıklaması, proje yapısı açıklaması

## Önerilen Geliştirme Sırası (Fazlar)
1. **Faz 1:** Auth altyapısı (kayıt/giriş, JWT, rol middleware'i, rate limiting, tüm cihazlardan çıkış) + backend/frontend temel iskelet + `.env` yapılandırması + Docker Compose kurulumu
2. **Faz 2:** Banka yönetimi + hesap/cüzdan yönetimi + temel işlem CRUD (kullanıcı bazlı izolasyonla) + dashboard temel ekranlar
3. **Faz 3:** Kredi kartı borç/faiz hesaplama mantığı
4. **Faz 4:** Kategoriler, bütçe, filtreleme/arama, export/import
5. **Faz 5:** Aylık ve kategori bazlı raporlar
6. **Faz 6:** Planlanan ödeme/alacak + taksitli ödeme + fatura takibi (ortak "zamanlanmış kayıt" alt yapısı üzerinden)
7. **Faz 7:** Süper admin paneli (kullanıcı yönetimi + işlem günlüğü, tamamen izole route/arayüz)
8. **Faz 8:** OCR ile ekstre/hesap hareketi okuma (en karmaşık kısım, en sona bırakılmalı)
9. **Faz 9 (opsiyonel):** PWA desteği (manifest, service worker, test) — çekirdek özellikler tamamlandıktan sonra, zaman/kapsam elverirse eklenir
10. **Faz 10 (opsiyonel):** Home Assistant entegrasyonu (bağlantı ayarları, bildirim hedefi seçimi, mevcut uyarıların HA'ya da iletilmesi)

Uygulamayı bu gereksinimlere göre sıfırdan oluştur, önce auth + proje iskeletini (backend + frontend) kur, sonra fazları sırasıyla uygula. Her fazda kullanıcı veri izolasyonunun ve süper admin'in veri erişim kısıtının bozulmadığından emin ol.
