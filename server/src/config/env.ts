import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseAllowedHostEntry, type AllowedHost } from '../lib/haUrl.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/ dizininin mutlak yolu (src/config -> src -> server) */
const serverRoot = path.resolve(here, '..', '..');

const isProd = process.env.NODE_ENV === 'production';

/**
 * Uretimde zayif sirlarla acilmayi engelleriz. Gelistirmede ise
 * ".env" olusturulmadan da uygulama ayaga kalksin diye varsayilan verilir.
 */
const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} en az 32 karakter olmali (.env.example icindeki komutla uretin)`)
    .refine((v) => !isProd || !v.startsWith('degistir'), {
      message: `${name} uretim ortaminda varsayilan degerde birakilamaz`,
    });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATA_DIR: z.string().default(path.join(serverRoot, '..', 'data')),
  CLIENT_DIR: z.string().default(path.join(serverRoot, '..', 'client', 'dist')),

  JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET').default(
    'degistir-bu-degeri-en-az-32-karakter-olmali',
  ),
  JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET').default(
    'degistir-bu-degeri-de-farkli-ve-en-az-32-karakter',
  ),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  ENCRYPTION_KEY: z.string().default('degistir-32-baytlik-base64-anahtar'),

  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  TZ: z.string().default('Europe/Istanbul'),

  /**
   * Home Assistant icin izinli host listesi (virgulle ayrilmis). Bos = kisitlama yok.
   * Ornek: homeassistant.local,192.168.61.10,ha.example.com:8123,*.example.org
   */
  HA_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((value, ctx): AllowedHost[] => {
      const result: AllowedHost[] = [];
      for (const part of value.split(',')) {
        if (part.trim() === '') continue;
        try {
          result.push(parseAllowedHostEntry(part));
        } catch (err) {
          ctx.addIssue({ code: 'custom', message: (err as Error).message });
          return z.NEVER;
        }
      }
      return result;
    }),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  // Logger env.ts'e baglidir (logger env.LOG_LEVEL okur); dogrulama basarisizken
  // logger kurulamaz ve dongusel bagimlilik olusur, bu yuzden burada console kalir.
  console.error('Ortam degiskenleri gecersiz:\n' + issues.join('\n'));
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  DATA_DIR: path.resolve(raw.DATA_DIR),
  CLIENT_DIR: path.resolve(raw.CLIENT_DIR),
  serverRoot,
} as const;

export type Env = typeof env;
