import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Uretim (Docker) yolunun testi: TEK container hem API'yi hem build edilmis
 * frontend'i ayni porttan servis eder. Bu yol diger testlerde hic calismaz
 * cunku onlar NODE_ENV=test ile kosar.
 *
 * Ayrica onbellek basliklarini dogrular: onbellekten gelen eski bir sw.js
 * guncellemeyi KALICI olarak bloke ederdi.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '..', '..', 'client', 'dist');

let server: Server;
let baseUrl: string;
let tempDir: string;

const clientBuilt = fs.existsSync(path.join(clientDist, 'index.html'));

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harcama-prod-'));

  // Uretim modu gecerli sirlar ister; varsayilanlarla acilmayi reddeder.
  process.env.NODE_ENV = 'production';
  process.env.DATA_DIR = tempDir;
  process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
  process.env.CLIENT_DIR = clientDist;
  process.env.JWT_ACCESS_SECRET = 'uretim-testi-access-sirri-en-az-otuziki-karakter';
  process.env.JWT_REFRESH_SECRET = 'uretim-testi-refresh-sirri-en-az-otuziki-karakter';
  process.env.COOKIE_SECURE = 'false';

  const { createApp } = await import('./app.ts');
  const app = createApp();

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  const { closeDb } = await import('./db/connection.ts');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* gecici dizin */
  }
});

describe('uretim modu (tek container)', () => {
  test('API uretim modunda da calisir', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { status: string }).status, 'ok');
  });

  test('bilinmeyen /api yolu HTML degil JSON 404 doner', async () => {
    const res = await fetch(`${baseUrl}/api/olmayan`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  });

  test('SPA rotalari index.html ile karsilanir', { skip: !clientBuilt }, async () => {
    // Istemci tarafi bir rota: sunucuda karsiligi yok, index.html donmeli
    const res = await fetch(`${baseUrl}/hesaplar`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await res.text(), /<div id="root">/);
  });

  test('index.html ONBELLEGE ALINMAZ', { skip: !clientBuilt }, async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.match(res.headers.get('cache-control') ?? '', /no-cache/);
  });

  test('service worker ONBELLEGE ALINMAZ', { skip: !clientBuilt }, async () => {
    const res = await fetch(`${baseUrl}/sw.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  });

  test('hash\'li varliklar onbellege alinir', { skip: !clientBuilt }, async () => {
    const html = await (await fetch(`${baseUrl}/`)).text();
    const match = /src="(\/assets\/[^"]+\.js)"/.exec(html);
    assert.ok(match?.[1], 'index.html bir varlik referansi icermeli');

    const res = await fetch(`${baseUrl}${match[1]}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /max-age=/);
  });

  test('manifest yayinlanir', { skip: !clientBuilt }, async () => {
    const res = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(res.status, 200);

    const manifest = (await res.json()) as { name: string; display: string; icons: unknown[] };
    assert.equal(manifest.name, 'Harcama Takip');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.length >= 2);
  });

  test('guvenlik basliklari uretimde aktif', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.ok(res.headers.get('content-security-policy'), 'CSP uretimde acik olmali');
    assert.equal(res.headers.get('x-powered-by'), null, 'sunucu imzasi gizlenmeli');
  });

  // Bu iki test gercek bir uretim arizasindan sonra yazildi: helmet'in
  // varsayilan CSP'si upgrade-insecure-requests iceriyor. Sunucu duz HTTP'de
  // yayindayken tarayici belgeyi alir ama tum alt kaynaklari https'e yukseltir;
  // TLS olmadigi icin her script/css/ikon ERR_SSL_PROTOCOL_ERROR ile duser ve
  // kullanici bos beyaz ekran gorur. Baslik VARDIR, o yuzden yukaridaki test
  // gecerken uygulama tamamen kirikti.
  test('HTTPS yokken upgrade-insecure-requests GONDERILMEZ', async () => {
    const csp = (await fetch(`${baseUrl}/`)).headers.get('content-security-policy') ?? '';
    assert.doesNotMatch(
      csp,
      /upgrade-insecure-requests/,
      'COOKIE_SECURE=false iken bu direktif tum varliklari kirar',
    );
    assert.match(csp, /default-src 'self'/, 'CSP yine de uygulanmali');
  });

  test('HTTPS yokken HSTS gonderilmez', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.headers.get('strict-transport-security'), null);
  });
});
