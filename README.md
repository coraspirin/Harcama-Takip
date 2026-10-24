# Harcama Takip

Çok kullanıcılı ev muhasebesi uygulaması: gelir/gider, bekleyen ödemeler, bütçe
ve raporlar. Her kullanıcının verisi
tamamen izoledir; ayrıca yalnızca hesap yönetimi yapan, **hiçbir finansal veriye
erişemeyen** bir süper admin rolü vardır.

## Özellikler

| Alan | Kapsam |
| --- | --- |
| İşlemler | Gelir/gider CRUD · tarih, kategori, tutar aralığı ve açıklama filtreleri · toplu silme |
| Kategoriler | Varsayılan iskelet · sabit/değişken ayrımı · kullanımdaysa arşivleme |
| Bekleyen ödemeler | Planlanan ödeme/alacak · taksit (3/12 ilerleme) · fatura · günlük hatırlatma · tekrar eden ödeme önerileri |
| Raporlar | Aylık özet · kategori kırılımı (halka grafik) · 12 aylık trend |
| Bütçe | Kategori bazlı aylık limit · aşım uyarısı · önceki aydan kopyalama |
| Veri | JSON dışa/içe aktarım (birleştir veya üzerine yaz) · onaylı sıfırlama |
| Süper admin | Kullanıcı yönetimi · şifre sıfırlama · işlem günlüğü |
| Opsiyonel | PWA (ana ekrana ekleme) · Home Assistant bildirimleri |

## Teknoloji

| Katman | Kullanılan |
| --- | --- |
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS v4 + recharts + lucide-react |
| Backend | Node.js + Express + TypeScript |
| Veritabanı | SQLite (`node:sqlite` — yerleşik, native derleme yok) |
| Kimlik doğrulama | JWT (access + refresh), httpOnly cookie, bcrypt |
| Zamanlanmış görev | node-cron |
| Deploy | Docker Compose — tek container |

## Kurulum (geliştirme)

Gereksinim: **Node.js 24+** (`node:sqlite` ve TypeScript'in doğrudan
çalıştırılması için).

```bash
cp .env.example .env      # değerleri doldurun (aşağıya bakın)
npm install               # kök bağımlılıkları
npm run install:all       # server + client bağımlılıkları
npm run dev               # server :4000, client :5173
```

Tarayıcıda `http://localhost:5173`. Vite, `/api` isteklerini `:4000` adresine
yönlendirir; böylece geliştirmede de her şey aynı origin'den görünür ve httpOnly
cookie'ler CORS ayarı gerektirmeden çalışır.

## Docker ile çalıştırma

```bash
cp .env.example .env      # JWT_* ve ENCRYPTION_KEY değerlerini MUTLAKA değiştirin
docker compose up -d --build
```

`http://SUNUCU_IP:4000` adresinde yayına girer. Veritabanı `harcama-data`
volume'ünde kalıcıdır.

Sunucuda 4000 portu doluysa `docker-compose.yml`'i düzenlemeyin (her `git pull`'da
çakışır) — `.env` içine `HOST_PORT=4001` yazmanız yeterlidir.

`.env` içindeki `DATA_DIR` ve `CLIENT_DIR` satırları
**yalnızca yerel geliştirme içindir**; Docker'da compose bunları container içi
değerlerle ezer. Bırakmanız zararsızdır.

Sırları sunucuda üretmek için:

```bash
openssl rand -base64 48 | tr -d '\n=+/'   # JWT_ACCESS_SECRET (ve ayrıca REFRESH)
openssl rand -base64 32                   # ENCRYPTION_KEY (32 bayt olmalı)
chmod 600 .env
```

## İlk süper admin hesabının oluşturulması

Seed script'i veya ortam değişkeniyle şifre **yoktur**. Uygulama ilk kez
açıldığında `/kurulum` ekranı gösterilir; burada kullanıcı adı ve şifre
belirleyerek ilk süper admin hesabı oluşturulur. Kurulum tamamlandıktan sonra bu
ekran kalıcı olarak kapanır — ikinci bir süper admin buradan oluşturulamaz.

Normal kullanıcılar için **açık kayıt ekranı yoktur**; kullanıcıları yalnızca
süper admin oluşturur (`/admin/kullanicilar`).

## Ortam değişkenleri

Tümü ve açıklamaları için [.env.example](.env.example). Üretimde mutlaka
değiştirilmesi gerekenler:

| Değişken | Açıklama |
| --- | --- |
| `JWT_ACCESS_SECRET` | Access token imzalama sırrı (min. 32 karakter) |
| `JWT_REFRESH_SECRET` | Refresh token sırrı (access'ten farklı olmalı) |
| `ENCRYPTION_KEY` | Home Assistant token'ının AES-256-GCM anahtarı, base64 32 bayt |
| `COOKIE_SECURE` | HTTPS arkasındaysanız `true` |

Üretim modunda (`NODE_ENV=production`) bu değerler varsayılanda bırakılırsa
uygulama **açılmaz**. `.env` `.gitignore` içindedir.

## Proje yapısı

```
server/src/
  config/env.ts          ortam değişkeni doğrulama (zod)
  db/                    SQLite bağlantısı, migration'lar ve repository modülleri
  lib/                   money (kuruş aritmetiği), date, errors, validation
  middleware/            auth (rol kontrolü), rate limit, hata yönetimi
  routes/                API uçları
  routes/admin/          süper admin uçları (diğerlerinden tamamen ayrı)
  services/              zamanlanmış görev, tekrar tespiti, veri aktarımı, kripto, Home Assistant
client/src/
  components/            yeniden kullanılabilir UI + grafikler
  pages/ · pages/admin/  kullanıcı ve süper admin sayfaları
  context/AuthContext    oturum ve rol yönetimi
  services/              backend API çağrıları
```

## Testler

```bash
npm test        # node --test ile
```

Ayrı bir test koşucusu veya derleme adımı gerekmez. Kapsam: kuruş aritmetiği ve
taksit bölme, faiz senaryoları, **veri izolasyonu** (her kullanıcı yalnızca kendi
verisi), rol ayrımı, token rotasyonu ve yeniden kullanım tespiti, rate limit,
zamanlanmış görev idempotency'si, eski kurulumdan migration,
export→reset→import round-trip.

## Tasarım kuralları

- **Tüm parasal tutarlar kuruş (integer) cinsinden saklanır.** Float, faiz ve
  taksit hesabında yuvarlama hatası biriktirir. Taksit bölmede artan kuruş ilk
  taksitlere dağıtılır; toplam daima korunur.
- Tarihler veritabanında `YYYY-MM-DD` metni; ekranda `gg.aa.yyyy`. Tarih
  aritmetiği metin üzerinden yapılır — saat dilimi kaynaklı gün kaymaları olmaz.
- **İşlem bir hesaba bağlı değildir.** Banka, hesap ve kart ekstresi takibi
  yoktur; işlem tarih + tutar + gelir/gider + kategori + açıklamadan ibarettir.
- **Harcama, yapıldığı anda gider olarak girilir** (kartla da olsa). Kart
  borcunu ya da krediyi ödemek ikinci bir gider değildir; çift sayımı önlemek
  için borç ödemeleri gelir/gider tablosuna yazılmaz.
- Her tablo `user_id` içerir ve **her sorgu** oturum sahibinin id'siyle
  filtrelenir. Başkasının kaydına erişim 403 değil **404** döner — kaydın var
  olup olmadığı sızdırılmaz.
- Kullanımdaki kategori silinmez, **arşivlenir** (geçmiş işlemlerin izi
  kaybolmasın). Kullanıcı silinince tüm verisi de silinir; etkisi önceden
  gösterilip onaylanır.
- Uygulama ilk açıldığında örnek/demo veri **oluşturulmaz**; boş durum ekranları
  gösterilir. Yeni kullanıcıda yalnızca varsayılan kategori iskeleti kurulur.

## Güvenlik notları

- Şifreler bcrypt (cost 12) ile hash'lenir; refresh token'lar veritabanında
  SHA-256 hash'li tutulur ve her yenilemede döndürülür. İptal edilmiş bir token
  tekrar kullanılırsa o oturumun tüm zinciri kapatılır.
- Kullanıcı her istekte veritabanından tazelenir: pasife alınan hesap, elindeki
  geçerli token ile de işlem yapamaz.
- Süper admin bir şifreyi sıfırlayıp o kullanıcı olarak giriş yapabilir — bu, rol
  ayrımının kaçınılmaz sınırıdır. Mitigasyon: işlem audit log'a yazılır ve
  kullanıcı ilk girişte şifresini değiştirmek zorundadır.

## Opsiyonel özellikler

**PWA** — Ana ekrana eklenip uygulama gibi açılır; uygulama kabuğu önbelleğe
alınır. Tam offline veri senkronizasyonu kapsam dışıdır ve `/api` yanıtları asla
önbelleğe alınmaz (bayat veri göstermek, hiç göstermemekten kötüdür). Kurulum
HTTPS gerektirir (`localhost` istisna).

**Home Assistant** — Ayarlar → Home Assistant bölümünden sunucu adresi, uzun
ömürlü erişim token'ı ve bildirim hedefi tanımlanır; "Test bildirimi gönder" ile
doğrulanır. Açıkken günlük tarama, yaklaşan ödeme uyarılarını telefona da
gönderir. Kapalı veya erişilemez olsa da uyarılar uygulama içindeki bildirim
zilinde görünmeye devam eder.
