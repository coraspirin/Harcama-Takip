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
  /** null: genel aylik limit (o ayin tum giderleri) */
  categoryId: number | null;
  categoryName: string | null;
  categoryArchived: boolean;
  isGeneral: boolean;
  yearMonth: string;
  limitKurus: number;
  spentKurus: number;
  remainingKurus: number;
  usagePercent: number;
  exceeded: boolean;
  /** Bugun DAHIL kalan gun; gecmis ayda 0 */
  daysLeft: number;
  /** Limiti asmamak icin bugunden itibaren gunluk tutar; gecmis ayda null */
  dailyAllowanceKurus: number | null;
  /** Bu hizla ay sonunda varilacak harcama */
  projectedSpendKurus: number;
  projectedExceeds: boolean;
};

export type BudgetListResponse = {
  month: string;
  general: Budget | null;
  budgets: Budget[];
  /** Yalnizca kategori limitleri; genel limit ayni giderleri tekrar sayardi */
  totals: { limitKurus: number; spentKurus: number; exceededCount: number };
};

export type MonthOverview = {
  month: string;
  actualIncomeKurus: number;
  pendingIncomeKurus: number;
  averageIncomeKurus: number;
  expectedIncomeKurus: number;
  /** Bu ay gelir gorunmedigi icin onceki aylarin ortalamasi kullanildi */
  incomeIsEstimate: boolean;
  spentKurus: number;
  pendingExpenseKurus: number;
  /** Tutari henuz girilmemis bekleyen vadeler */
  unknownAmountCount: number;
  freeKurus: number;
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
  /** Bu ayin genel limiti ve gidisati; limit yoksa null */
  limit: {
    limitKurus: number;
    spentKurus: number;
    remainingKurus: number;
    usagePercent: number;
    exceeded: boolean;
    daysLeft: number;
    dailyAllowanceKurus: number | null;
    projectedSpendKurus: number;
    projectedExceeds: boolean;
  } | null;
  overview: MonthOverview;
  debts: DebtListResponse['totals'];
  recentTransactions: Transaction[];
};

export type DebtKind = 'loan' | 'credit_card' | 'personal';
export type DebtDirection = 'owe' | 'lent';

export const DEBT_KIND_LABELS: Record<DebtKind, string> = {
  loan: 'Kredi',
  credit_card: 'Kredi karti',
  personal: 'Kisiye borc/alacak',
};

/**
 * ends: tahmini bitis ayi var · never: odeme faizi karsilamiyor ·
 * no_payment: aylik odeme girilmemis · paid: bakiye sifir
 */
export type PayoffStatus = 'ends' | 'never' | 'no_payment' | 'paid';

export type PayoffSummary = {
  status: PayoffStatus;
  months: number | null;
  payoffMonth: string | null;
  totalInterestKurus: number | null;
  totalPaidKurus: number | null;
  firstMonthInterestKurus: number;
};

export type Debt = {
  id: number;
  kind: DebtKind;
  direction: DebtDirection;
  name: string;
  counterparty: string | null;
  originalKurus: number;
  reportedBalanceKurus: number;
  balanceDate: string;
  paidSinceKurus: number;
  currentBalanceKurus: number;
  paidTotalKurus: number;
  paymentCount: number;
  lastPaymentDate: string | null;
  monthlyInterestBp: number;
  taxesIncluded: boolean;
  monthlyPaymentKurus: number | null;
  note: string | null;
  closed: boolean;
  /** Kapali borclarda null */
  forecast: PayoffSummary | null;
};

export type InstallmentDebt = {
  itemId: number;
  name: string;
  remainingKurus: number;
  remainingCount: number;
  totalCount: number | null;
  nextDueDate: string | null;
  lastDueDate: string | null;
  monthlyKurus: number | null;
};

export type DebtListResponse = {
  debts: Debt[];
  installments: InstallmentDebt[];
  totals: {
    oweKurus: number;
    lentKurus: number;
    monthlyPaymentKurus: number;
    remainingInterestKurus: number;
    /** Tum borclarin bitecegi tahmini ay; hesaplanamayan borc varsa null */
    debtFreeMonth: string | null;
    unknownForecastCount: number;
  };
};

export type DebtPayment = {
  id: number;
  debtId: number;
  date: string;
  amountKurus: number;
  note: string | null;
};

export type PayoffRow = {
  month: string;
  openingKurus: number;
  interestKurus: number;
  paymentKurus: number;
  closingKurus: number;
};

export type DebtDetail = {
  debt: Debt;
  payments: DebtPayment[];
  schedule: PayoffRow[];
  whatIf: {
    extraKurus: number;
    base: PayoffSummary;
    improved: PayoffSummary;
    monthsSaved: number | null;
    interestSavedKurus: number | null;
  };
};

export type StrategyResult = {
  strategy: 'avalanche' | 'snowball';
  status: 'ends' | 'never' | 'paid';
  months: number | null;
  payoffMonth: string | null;
  totalInterestKurus: number | null;
  order: { id: number; name: string; months: number; payoffMonth: string }[];
};

export type DebtPlan = {
  extraKurus: number;
  startMonth: string;
  avalanche: StrategyResult;
  snowball: StrategyResult;
  baseline: StrategyResult;
};
