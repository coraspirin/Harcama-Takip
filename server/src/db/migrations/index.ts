import type { Migration } from '../migrate.ts';
import { migration001Auth } from './001_auth.ts';
import { migration002HomeAssistant } from './002_home_assistant.ts';
import { migration003Household } from './003_household.ts';
import { migration004Debts } from './004_debts.ts';
import { migration005Subscriptions } from './005_subscriptions.ts';
import { migration006Savings } from './006_savings.ts';
import { migration007BillEndMonth } from './007_bill_end_month.ts';
import { migration008ExcludeFromBudget } from './008_exclude_from_budget.ts';

/**
 * Migration listesi. Yeni migration eklerken:
 *   1. yeni bir dosya olustur (or. 009_closings.ts)
 *   2. asagidaki diziye SIRAYLA ekle
 * Uygulanmis bir migration'in SQL'i asla degistirilmez; duzeltme yeni bir
 * migration ile yapilir.
 */
export const migrations: Migration[] = [
  migration001Auth,
  migration002HomeAssistant,
  migration003Household,
  migration004Debts,
  migration005Subscriptions,
  migration006Savings,
  migration007BillEndMonth,
  migration008ExcludeFromBudget,
];
