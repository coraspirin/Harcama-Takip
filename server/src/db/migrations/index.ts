import type { Migration } from '../migrate.ts';
import { migration001Auth } from './001_auth.ts';
import { migration007HomeAssistant } from './007_home_assistant.ts';
import { migration014Household } from './014_household.ts';

/**
 * Migration listesi. Yeni migration eklerken:
 *   1. yeni bir dosya olustur (or. 015_debts.ts)
 *   2. asagidaki diziye SIRAYLA ekle
 * Uygulanmis bir migration'in SQL'i asla degistirilmez; duzeltme yeni bir
 * migration ile yapilir.
 *
 * Bosluklar bilinclidir: 002-006 ve 008-013 ev muhasebesine geciste silindi
 * (bkz. 014_household). Eski kurulumlarda bu id'ler uygulanmis durumdadir;
 * yeni migration'lar 015'ten devam etmelidir.
 */
export const migrations: Migration[] = [
  migration001Auth,
  migration007HomeAssistant,
  migration014Household,
];
