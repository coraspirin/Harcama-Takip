# TODO — İyileştirmeler

Proje incelemesinden (2026-11-23) çıkan iyileştirme listesi. Tamamlanan maddeler
işaretlenir ve memory.md'ye loglanır.

> Not: Veritabanı yedeği Docker seviyesinde alınıyor; uygulama içi yedekleme kapsam dışıdır.

## 🔴 Yüksek öncelik

- [ ] **`.env.example` dosyasını ekle**
  - README kurulum adımı buna dayanıyor ama dosya yok
  - Değişken listesini `server/src/config/env.ts` (zod şeması) kaynak alarak çıkar
- [x] **Container'ı root olmayan kullanıcıyla çalıştır**
  - Dockerfile: `/data` için `chown node:node`, ardından `USER node`
  - Sunucudaki mevcut volume'de dosya sahipliğini bir kez düzelt
  - Not: README'de belgelendi, sunucuda elle uygulanacak (chown 1000:1000)

## 🟠 Orta öncelik

- [x] **CI**: GitHub Actions ile her push'ta `npm run lint`, `format:check`, `typecheck`, `test` ve `build` (`.github/workflows/ci.yml`)
  - Sonra: `git archive | ssh` ile yapılan elle yayını script'e bağla
- [x] **Frontend testleri** (Vitest + Testing Library)
  - `MoneyInput.tsx` (imleç/tutar bozulması geçmişte yaşandı)
  - `lib/format.ts` (₺ ve gg.aa.yyyy biçimleri)
  - `App.tsx` rol bazlı yönlendirme (kurulum / giriş / şifre değiştirme / admin / user)
- [x] **ESLint + Prettier**
  - Kurallar: `no-floating-promises`, `react-hooks/exhaustive-deps`, `no-explicit-any`
- [x] **Node sürümünü sabitle**
  - Şu an README "24+", Dockerfile `node:26-alpine`, `@types/node` 24
  - Tek sürüme karar ver, `package.json`'lara `engines` ekle (`node:sqlite` deneysel)
- [ ] **prompt.md'yi arşivle**
  - Kaldırılmış kapsamı (banka/hesap/OCR) anlatıyor; `docs/arsiv/` altına taşı, README esas alınsın

## 🟡 Düşük öncelik

- [ ] **Yapılandırılmış loglama** (pino); zamanlanmış görev sonunda özet satırı
- [ ] **Health check'i genişlet**: veritabanı erişimi + son zamanlanmış taramanın zamanı ve sonucu
- [ ] **Home Assistant adresi için SSRF sınırı**: admin tarafında izinli host listesi (opsiyonel; kullanıcılar güvenilir)
- [ ] **Rapor performansı**: yavaşlık görülürse aylık özetleri önbelleğe al (index'ler şu an yeterli)

## 💡 Ürün fikirleri

- [ ] Hızlı işlem ekleme (PWA kısayolu, son kullanılan kategoriler)
- [ ] CSV dışa aktarma (Excel için)
- [ ] Yıllık özet raporu
- [ ] Kategori kuralları: açıklamadan otomatik kategori önerisi

## Önerilen uygulama sırası

1. `.env.example` + Docker `USER node`
2. CI + Node sürümü sabitleme + ESLint/Prettier
3. Frontend testleri
4. Loglama + health check