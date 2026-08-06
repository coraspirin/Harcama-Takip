import type { Migration } from '../migrate.ts';
import { migration001Auth } from './001_auth.ts';
import { migration002FinanceCore } from './002_finance_core.ts';
import { migration003CardStatements } from './003_card_statements.ts';
import { migration004Budgets } from './004_budgets.ts';
import { migration005Scheduled } from './005_scheduled.ts';
import { migration006Ocr } from './006_ocr.ts';
import { migration007HomeAssistant } from './007_home_assistant.ts';
import { migration008ImportQuality } from './008_import_quality.ts';
import { migration009PostImport } from './009_post_import.ts';

/**
 * Migration listesi. Yeni migration eklerken:
 *   1. yeni bir dosya olustur (or. 004_budgets.ts)
 *   2. asagidaki diziye SIRAYLA ekle
 * Uygulanmis bir migration'in SQL'i asla degistirilmez; duzeltme yeni bir
 * migration ile yapilir.
 */
export const migrations: Migration[] = [
  migration001Auth,
  migration002FinanceCore,
  migration003CardStatements,
  migration004Budgets,
  migration005Scheduled,
  migration006Ocr,
  migration007HomeAssistant,
  migration008ImportQuality,
  migration009PostImport,
];
