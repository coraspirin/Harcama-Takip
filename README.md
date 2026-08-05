# Harcama Takip

Cok kullanicili kisisel gelir/gider takip uygulamasi. Her kullanicinin verisi
tamamen izoledir; ayrica yalnizca hesap yonetimi yapan, hicbir finansal veriye
erisemeyen bir **super admin** rolu vardir.

## Teknoloji

| Katman | Kullanilan |
| --- | --- |
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + recharts + lucide-react |
| Backend | Node.js + Express + TypeScript |
| Veritabani | SQLite (`node:sqlite` - yerlesik, native derleme yok) |
| Kimlik dogrulama | JWT (access + refresh), httpOnly cookie, bcrypt hash |
| OCR | pdfjs-dist (metin katmani) -> pdftoppm + tesseract.js (fallback) |
| Deploy | Docker Compose - tek container |

## Kurulum (gelistirme)

Gereksinim: **Node.js 24+** (`node:sqlite` ve TypeScript'in dogrudan
calistirilmasi icin).

```bash
cp .env.example .env      # degerleri doldurun (asagiya bakin)
npm install               # kok bagimliliklari (concurrently)
npm run install:all       # server + client bagimliliklari
npm run dev               # server :4000, client :5173
```

Tarayicida `http://localhost:5173` acilir. Vite, `/api` isteklerini
`http://localhost:4000` adresine yonlendirir; boylece gelistirmede de her sey
ayni origin'den gorunur ve httpOnly cookie'ler sorunsuz calisir.

## Docker ile calistirma

```bash
cp .env.example .env      # JWT_* ve ENCRYPTION_KEY degerlerini mutlaka degistirin
docker compose up --build
```

Uygulama `http://localhost:4000` adresinde yayina girer. Veritabani ve yuklenen
dosyalar `harcama-data` adli Docker volume'unde kalicidir.

## Ilk super admin hesabinin olusturulmasi

Seed script'i veya ortam degiskeni **yoktur**. Uygulama ilk kez acildiginda
kurulum ekrani (`/kurulum`) gosterilir ve burada kullanici adi + sifre
belirleyerek ilk super admin hesabi olusturulur. Kurulum tamamlandiktan sonra bu
ekran kalici olarak kapanir; ikinci bir super admin `/kurulum` uzerinden
olusturulamaz.

Normal kullanicilar icin **acik kayit ekrani yoktur** - kullanicilari yalnizca
super admin olusturur (`/admin/kullanicilar`).

## Ortam degiskenleri

Tum degiskenler ve aciklamalari icin [.env.example](.env.example) dosyasina
bakin. Uretimde mutlaka degistirilmesi gerekenler:

| Degisken | Aciklama |
| --- | --- |
| `JWT_ACCESS_SECRET` | Access token imzalama sirri (min. 32 karakter) |
| `JWT_REFRESH_SECRET` | Refresh token imzalama sirri (access'ten farkli olmali) |
| `ENCRYPTION_KEY` | Hassas alanlarin (Home Assistant token'i) AES-256-GCM anahtari, base64 32 bayt |
| `COOKIE_SECURE` | HTTPS arkasindaysaniz `true` |

Uretim modunda (`NODE_ENV=production`) bu degerler varsayilanda birakilirsa
uygulama **acilmaz**.

`.env` dosyasi `.gitignore` icindedir ve asla repoya girmez.

## Proje yapisi

```
server/
  src/
    config/env.ts          ortam degiskeni dogrulama (zod)
    db/                    SQLite baglantisi ve migration'lar
    lib/                   money (kurus aritmetigi), date, errors
    middleware/            hata yonetimi, auth, rate limit
    routes/                API endpoint'leri
    services/              faiz, zamanlanmis gorevler, OCR
client/
  src/
    components/            yeniden kullanilabilir UI bilesenleri
    pages/                 normal kullanici sayfalari
    pages/admin/           super admin sayfalari (ayri layout)
    context/               oturum/rol yonetimi
    services/              backend API cagrilari
    types/                 TypeScript tip tanimlari
```

## Testler

```bash
npm test                  # server/src/**/*.test.ts
```

Testler `node --test` ile calisir; ayri bir test kosucusu veya derleme adimi
gerekmez.

## Onemli kurallar

- **Tum parasal tutarlar kurus (integer) cinsinden saklanir.** Float, faiz ve
  taksit hesabinda yuvarlama hatasi biriktirir. Ekranda TL'ye cevrilir.
- Tarihler veritabaninda `YYYY-MM-DD` metni olarak tutulur, ekranda `gg.aa.yyyy`
  gosterilir.
- Her veri tablosu `user_id` icerir ve her sorgu oturum sahibinin id'siyle
  filtrelenir. Bu kontrol yalnizca frontend'de degil, backend'de zorunludur.
- Uygulama ilk acildiginda ornek/demo veri **olusturulmaz**; bos durum ekranlari
  gosterilir.
