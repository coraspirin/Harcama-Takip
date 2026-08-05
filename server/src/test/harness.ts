import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Test kosumu icin izole ortam. env.ts ortam degiskenlerini import aninda
 * okudugu icin bu ayarlar, uygulama modulleri yuklenmeden ONCE yapilmalidir;
 * bu yuzden app dinamik olarak import edilir.
 */
process.env.NODE_ENV = 'test';
process.env.TZ = 'Europe/Istanbul';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-en-az-otuziki-karakter-uzunlugunda';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-en-az-otuziki-karakter-uzunlugunda';
process.env.COOKIE_SECURE = 'false';

export type TestResponse<T = unknown> = {
  status: number;
  body: T;
  headers: Headers;
};

/**
 * Cookie tutan basit bir istemci. Gercek tarayici gibi davranir: sunucunun
 * set-cookie ile verdigi access/refresh token'lari saklar ve sonraki isteklere
 * ekler. Boylece auth akisi uctan uca test edilebilir.
 */
export class TestClient {
  private readonly cookies = new Map<string, string>();
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request<T = unknown>(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<TestResponse<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.size > 0) {
      headers['cookie'] = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const idx = pair?.indexOf('=') ?? -1;
      if (idx <= 0 || !pair) continue;
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      // Max-Age=0 veya bos deger -> cookie silinmis demektir
      if (value === '' || /max-age=0/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }

    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      /* JSON degilse ham metin kalir */
    }

    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = unknown>(endpoint: string) {
    return this.request<T>('GET', endpoint);
  }
  post<T = unknown>(endpoint: string, body?: unknown) {
    return this.request<T>('POST', endpoint, body);
  }
  patch<T = unknown>(endpoint: string, body?: unknown) {
    return this.request<T>('PATCH', endpoint, body);
  }
  put<T = unknown>(endpoint: string, body?: unknown) {
    return this.request<T>('PUT', endpoint, body);
  }
  delete<T = unknown>(endpoint: string, body?: unknown) {
    return this.request<T>('DELETE', endpoint, body);
  }

  hasCookie(name: string): boolean {
    return this.cookies.has(name);
  }

  clearCookies(): void {
    this.cookies.clear();
  }
}

export type TestServer = {
  url: string;
  /** Her cagri, kendi cookie kavanozu olan yeni bir istemci doner (= yeni cihaz). */
  newClient: () => TestClient;
  close: () => Promise<void>;
};

/**
 * Gecici bir dizinde temiz veritabaniyla uygulamayi rastgele bir portta baslatir.
 * Her test dosyasi kendi ornegini alir; testler birbirinin verisini gormez.
 */
export async function startTestServer(): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harcama-test-'));
  process.env.DATA_DIR = dir;
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');

  // Dinamik import: env.ts ortam degiskenlerini yukleme aninda okur, bu yuzden
  // yukaridaki DATA_DIR atamasindan SONRA yuklenmeli.
  // (Node test kosucusu her test dosyasini ayri surecte calistirir; bu yuzden
  //  modul tekil'i dosyalar arasinda paylasilmaz.)
  const { createApp } = await import('../app.ts');
  const { closeDb } = await import('../db/connection.ts');

  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    newClient: () => new TestClient(url),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          // Windows'ta acik SQLite dosya tanitici varken dizin silinemez.
          closeDb();
          try {
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {
            /* gecici dizin; silinemezse isletim sistemi temizler */
          }
          resolve();
        });
      }),
  };
}
