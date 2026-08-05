import type { Migration } from '../migrate.ts';
import { migration001Auth } from './001_auth.ts';
import { migration002FinanceCore } from './002_finance_core.ts';

/**
 * Migration listesi. Yeni migration eklerken:
 *   1. yeni bir dosya olustur (or. 002_banks_accounts.ts)
 *   2. asagidaki diziye SIRAYLA ekle
 * Uygulanmis bir migration'in SQL'i asla degistirilmez; duzeltme yeni bir
 * migration ile yapilir.
 */
export const migrations: Migration[] = [migration001Auth, migration002FinanceCore];
