import { api } from './api.ts';
import type {
  Account,
  Bank,
  Budget,
  BudgetListResponse,
  CardStatement,
  CardSummary,
  Category,
  DashboardSummary,
  ImportResult,
  Pagination,
  Totals,
  Transaction,
} from '../types/index.ts';

export type BankInput = {
  name: string;
  monthlyInterestBp: number;
  taxesIncluded: boolean;
};

export type AccountInput = {
  name: string;
  type: Account['type'];
  bankId: number | null;
  openingBalanceKurus: number;
  archived?: boolean;
  statementDay?: number | null;
  dueDay?: number | null;
  creditLimitKurus?: number | null;
};

export type StatementInput = {
  accountId: number;
  periodEnd: string;
  dueDate: string | null;
  statementAmountKurus: number;
  paidAmountKurus: number;
  minimumPaymentKurus: number | null;
};

export type TransactionInput = {
  accountId: number;
  categoryId: number | null;
  type: 'income' | 'expense';
  amountKurus: number;
  date: string;
  description: string | null;
};

export type TransferInput = {
  fromAccountId: number;
  toAccountId: number;
  amountKurus: number;
  date: string;
  description: string | null;
};

export type TransactionQuery = {
  from?: string;
  to?: string;
  accountId?: number;
  categoryId?: number;
  kind?: 'income' | 'expense' | 'transfer';
  minAmountKurus?: number;
  maxAmountKurus?: number;
  search?: string;
  page?: number;
  pageSize?: number;
};

function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const bankService = {
  list: () => api.get<{ banks: Bank[] }>('/api/banks').then((r) => r.banks),
  create: (input: BankInput) => api.post<{ bank: Bank }>('/api/banks', input).then((r) => r.bank),
  update: (id: number, input: BankInput) =>
    api.patch<{ bank: Bank }>(`/api/banks/${id}`, input).then((r) => r.bank),
  impact: (id: number) =>
    api
      .get<{ impact: { accounts: number; transactions: number } }>(`/api/banks/${id}/impact`)
      .then((r) => r.impact),
  remove: (id: number) => api.delete<{ deleted: boolean }>(`/api/banks/${id}`),
};

export const accountService = {
  list: (includeArchived = false) =>
    api
      .get<{ accounts: Account[] }>(`/api/accounts${includeArchived ? '?includeArchived=true' : ''}`)
      .then((r) => r.accounts),
  get: (id: number) => api.get<{ account: Account }>(`/api/accounts/${id}`).then((r) => r.account),
  create: (input: AccountInput) =>
    api.post<{ account: Account }>('/api/accounts', input).then((r) => r.account),
  update: (id: number, input: AccountInput) =>
    api.patch<{ account: Account }>(`/api/accounts/${id}`, input).then((r) => r.account),
  remove: (id: number, force = false) =>
    api.delete<{ deleted: boolean; deletedTransactions: number }>(
      `/api/accounts/${id}${force ? '?force=true' : ''}`,
    ),
};

export const categoryService = {
  list: (includeArchived = false) =>
    api
      .get<{ categories: Category[] }>(
        `/api/categories${includeArchived ? '?includeArchived=true' : ''}`,
      )
      .then((r) => r.categories),
  create: (input: { name: string; kind: Category['kind'] }) =>
    api.post<{ category: Category }>('/api/categories', input).then((r) => r.category),
  update: (id: number, input: { name: string; archived: boolean }) =>
    api.patch<{ category: Category }>(`/api/categories/${id}`, input).then((r) => r.category),
  /** Kullanimda olan kategori silinmez, arsivlenir; hangisi oldugu yanitla doner. */
  remove: (id: number) =>
    api.delete<{ action: 'deleted' | 'archived'; usageCount: number }>(`/api/categories/${id}`),
};

export const budgetService = {
  list: (month: string) => api.get<BudgetListResponse>(`/api/budgets?month=${month}`),
  create: (input: { categoryId: number; yearMonth: string; limitKurus: number }) =>
    api.post<{ budget: Budget }>('/api/budgets', input),
  update: (id: number, limitKurus: number) =>
    api.patch<{ budget: Budget }>(`/api/budgets/${id}`, { limitKurus }),
  remove: (id: number) => api.delete<{ deleted: boolean }>(`/api/budgets/${id}`),
  copyFromPreviousMonth: (toMonth: string) =>
    api.post<{ fromMonth: string; toMonth: string; copied: number }>('/api/budgets/copy', {
      toMonth,
    }),
};

export const dataService = {
  exportAll: () => api.get<Record<string, unknown>>('/api/data/export'),
  importAll: (mode: 'merge' | 'replace', data: unknown) =>
    api.post<{ result: ImportResult }>('/api/data/import', { mode, data }),
  reset: (confirm: string) => api.post<{ reset: boolean }>('/api/data/reset', { confirm }),
};

export const transactionService = {
  list: (query: TransactionQuery = {}) =>
    api.get<{ transactions: Transaction[]; totals: Totals; pagination: Pagination }>(
      `/api/transactions${toQueryString(query)}`,
    ),
  create: (input: TransactionInput) =>
    api.post<{ transaction: Transaction }>('/api/transactions', input).then((r) => r.transaction),
  update: (id: number, input: TransactionInput) =>
    api
      .patch<{ transaction: Transaction }>(`/api/transactions/${id}`, input)
      .then((r) => r.transaction),
  remove: (id: number) => api.delete<{ deleted: boolean; removedRows: number }>(`/api/transactions/${id}`),
  transfer: (input: TransferInput) =>
    api.post<{ transferGroupId: string; transactions: Transaction[] }>(
      '/api/transactions/transfer',
      input,
    ),
};

export const statementService = {
  list: (accountId: number) =>
    api
      .get<{ statements: CardStatement[] }>(`/api/statements?accountId=${accountId}`)
      .then((r) => r.statements),
  summary: (accountId: number) =>
    api.get<CardSummary>(`/api/statements/summary?accountId=${accountId}`),
  create: (input: StatementInput) =>
    api.post<{ statement: CardStatement }>('/api/statements', input).then((r) => r.statement),
  update: (id: number, input: StatementInput) =>
    api.patch<{ statement: CardStatement }>(`/api/statements/${id}`, input).then((r) => r.statement),
  remove: (id: number) => api.delete<{ deleted: boolean }>(`/api/statements/${id}`),
};

export const dashboardService = {
  summary: (month?: string) =>
    api.get<DashboardSummary>(`/api/dashboard/summary${month ? `?month=${month}` : ''}`),
};
