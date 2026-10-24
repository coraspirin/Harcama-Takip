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

export type CategoryKind = 'income' | 'expense';
/** 'fixed': her ay buyuk olcude ayni tutarda tekrar eder (kira, fatura). */
export type CategoryNature = 'fixed' | 'variable';

export type Category = {
  id: number;
  name: string;
  kind: CategoryKind;
  nature: CategoryNature;
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
  categories: number;
  transactions: number;
  budgets: number;
};

export type TransactionType = 'income' | 'expense';

export type Transaction = {
  id: number;
  categoryId: number | null;
  categoryName: string | null;
  type: TransactionType;
  amountKurus: number;
  date: string;
  description: string | null;
  source: 'manual' | 'scheduled';
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
  totals: {
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
