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
