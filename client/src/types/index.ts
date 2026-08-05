export type Role = 'user' | 'super_admin';

export type User = {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type Bank = {
  id: number;
  name: string;
  /** Aylik faiz orani baz puan cinsinden: %3.11 -> 311 */
  monthlyInterestBp: number;
  taxesIncluded: boolean;
  createdAt: string;
};

export type AccountType = 'cash' | 'bank' | 'credit_card';

export type Account = {
  id: number;
  name: string;
  type: AccountType;
  bankId: number | null;
  bankName: string | null;
  openingBalanceKurus: number;
  balanceKurus: number;
  transactionCount: number;
  archived: boolean;
  /** Kredi kartina ozgu alanlar */
  statementDay: number | null;
  dueDay: number | null;
  creditLimitKurus: number | null;
  createdAt: string;
};

export type CardStatement = {
  id: number;
  accountId: number;
  periodEnd: string;
  dueDate: string | null;
  statementAmountKurus: number;
  paidAmountKurus: number;
  minimumPaymentKurus: number | null;
  createdAt: string;
};

export type InterestBreakdown = {
  unpaidKurus: number;
  baseInterestKurus: number;
  taxKurus: number;
  totalInterestKurus: number;
  estimatedDebtKurus: number;
  monthlyInterestBp: number;
  taxesIncluded: boolean;
};

export type CardSummary = {
  accountId: number;
  balanceKurus: number;
  bank: { id: number; name: string; monthlyInterestBp?: number; taxesIncluded?: boolean } | null;
  statement: CardStatement | null;
  period?: { start: string | null; end: string };
  interest: InterestBreakdown | null;
  reconciliation: {
    statementAmountKurus: number;
    transactionsTotalKurus: number;
    differenceKurus: number;
    matches: boolean;
  } | null;
  warning: string | null;
};

export type CategoryKind = 'income' | 'expense';

export type Category = {
  id: number;
  name: string;
  kind: CategoryKind;
  isDefault: boolean;
  archived: boolean;
  /** Yalnizca /api/categories listesinde doner */
  usageCount?: number;
};

export type Budget = {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryArchived: boolean;
  yearMonth: string;
  limitKurus: number;
  spentKurus: number;
  remainingKurus: number;
  usagePercent: number;
  exceeded: boolean;
};

export type BudgetListResponse = {
  month: string;
  budgets: Budget[];
  totals: { limitKurus: number; spentKurus: number; exceededCount: number };
};

export type CategoryBreakdownItem = {
  categoryId: number | null;
  categoryName: string;
  totalKurus: number;
  transactionCount: number;
  sharePercent: number;
};

export type MonthlyReport = {
  month: string;
  totals: { incomeKurus: number; expenseKurus: number; netKurus: number };
  previous: {
    month: string;
    incomeKurus: number;
    expenseKurus: number;
    netKurus: number;
    incomeChangePercent: number | null;
    expenseChangePercent: number | null;
  };
  expenseByCategory: CategoryBreakdownItem[];
  incomeByCategory: CategoryBreakdownItem[];
  byAccount: { accountId: number; accountName: string; incomeKurus: number; expenseKurus: number }[];
};

export type CategoryReport = {
  from: string;
  to: string;
  kind: 'income' | 'expense';
  totalKurus: number;
  categories: CategoryBreakdownItem[];
};

export type TrendReport = {
  from: string;
  to: string;
  series: { month: string; incomeKurus: number; expenseKurus: number; netKurus: number }[];
};

export type ScheduledKind = 'planned' | 'installment' | 'bill';
export type BillPeriod = 'monthly' | 'quarterly' | 'yearly';
export type OccurrenceStatus = 'pending' | 'confirmed' | 'skipped';

export type ScheduledItem = {
  id: number;
  kind: ScheduledKind;
  name: string;
  direction: 'income' | 'expense';
  accountId: number;
  accountName: string;
  categoryId: number | null;
  categoryName: string | null;
  counterparty: string | null;
  description: string | null;
  totalAmountKurus: number | null;
  installmentCount: number | null;
  period: BillPeriod | null;
  amountKurus: number | null;
  startDate: string;
  active: boolean;
  progress: { total: number; confirmed: number; pending: number };
  nextDueDate: string | null;
  remainingKurus: number;
};

export type Occurrence = {
  id: number;
  scheduledItemId: number;
  itemName: string;
  kind: ScheduledKind;
  direction: 'income' | 'expense';
  accountId: number;
  accountName: string;
  categoryName: string | null;
  dueDate: string;
  amountKurus: number | null;
  status: OccurrenceStatus;
  transactionId: number | null;
  seq: number | null;
  totalSeq: number | null;
};

export type Notification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  relatedType: string | null;
  relatedId: number | null;
  dueDate: string | null;
  read: boolean;
  createdAt: string;
};

export const BILL_PERIOD_LABELS: Record<BillPeriod, string> = {
  monthly: 'Aylik',
  quarterly: 'Uc aylik',
  yearly: 'Yillik',
};

export type ImportResult = {
  mode: 'merge' | 'replace';
  banks: number;
  accounts: number;
  categories: number;
  transactions: number;
  cardStatements: number;
  budgets: number;
  skippedTransactions: number;
};

export type TransactionType = 'income' | 'expense' | 'transfer_in' | 'transfer_out';

export type Transaction = {
  id: number;
  accountId: number;
  accountName: string;
  categoryId: number | null;
  categoryName: string | null;
  type: TransactionType;
  amountKurus: number;
  date: string;
  description: string | null;
  transferGroupId: string | null;
  counterpartyAccountName: string | null;
  source: 'manual' | 'ocr' | 'scheduled';
  createdAt: string;
};

export type Totals = {
  incomeKurus: number;
  expenseKurus: number;
};

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
};

export type DashboardSummary = {
  month: string;
  accounts: Account[];
  totals: {
    totalBalanceKurus: number;
    incomeKurus: number;
    expenseKurus: number;
    netKurus: number;
  };
  previousMonth: {
    month: string;
    incomeKurus: number;
    expenseKurus: number;
    netKurus: number;
    incomeChangePercent: number | null;
    expenseChangePercent: number | null;
  };
  recentTransactions: Transaction[];
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Nakit',
  bank: 'Banka hesabi',
  credit_card: 'Kredi karti',
};
