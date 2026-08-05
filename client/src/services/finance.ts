import { api } from './api.ts';
import type {
  Account,
  Bank,
  Category,
  DashboardSummary,
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

export const dashboardService = {
  summary: (month?: string) =>
    api.get<DashboardSummary>(`/api/dashboard/summary${month ? `?month=${month}` : ''}`),
};
