/**
 * Ortam degiskenleri ayri bir modulde ayarlanir ve BURADA ILK SIRADA import
 * edilir: bir test dosyasi uygulama modullerinden birini (or. middleware)
 * sunucuyu baslatmadan once import ederse, config/env.ts o anda yuklenir ve
 * DATA_DIR'i dondurur - bu durumda testler GERCEK veri dizinine yazardi.
 */
import { TEST_DATA_DIR } from './env.ts';

import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

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

  getCookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /** Calinmis token senaryolarini kurmak icin. */
  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
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
let started = false;

export async function startTestServer(
  options: { configure?: (app: import('express').Express) => void } = {},
): Promise<TestServer> {
  // env.ts degiskenleri import aninda okur, bu yuzden DATA_DIR surec basina bir
  // kez sabitlenebilir. Node test kosucusu her dosyayi ayri surecte calistirdigi
  // icin bu bir kisit degil; ayni dosyada ikinci sunucu istenirse sessizce ayni
  // veritabanini paylasirdi - erken ve acik hata veriyoruz.
  if (started) {
    throw new Error(
      'startTestServer surec basina bir kez cagrilabilir. Izole veritabani gereken testleri ayri bir test dosyasina alin.',
    );
  }
  started = true;

  const dir = TEST_DATA_DIR;

  // Dinamik import, uygulama modulleri yalnizca gerektiginde yuklensin diye;
  // DATA_DIR zaten modul basinda ayarlandi.
  const { createApp } = await import('../app.ts');
  const { closeDb } = await import('../db/connection.ts');

  const app = createApp({ configure: options.configure });
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
