import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Test ortam degiskenleri.
 *
 * AYRI BIR MODUL olmasi zorunlu: ESM import'lari hoist edilir, yani bir test
 * dosyasinin govdesindeki `process.env.X = ...` satiri, o dosyanin import
 * ettigi modullerden SONRA calisir. config/env.ts degiskenleri yuklenme
 * aninda okudugu icin atama gec kalirdi. Bu modulu ilk sirada import etmek
 * dogru sirayi garanti eder.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Europe/Istanbul';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-en-az-otuziki-karakter-uzunlugunda';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-en-az-otuziki-karakter-uzunlugunda';
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.COOKIE_SECURE = 'false';

/** Gecici veri dizini; surec basina bir kez olusturulur. */
export const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'harcama-test-'));

process.env.DATA_DIR = TEST_DATA_DIR;
