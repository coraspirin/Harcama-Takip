import { api } from './api.ts';
import type {
  Budget,
  BudgetListResponse,
  CategoryReport,
  Category,
  DashboardSummary,
  ForecastReport,
  ImportResult,
  MonthOverview,
  MonthlyReport,
  Pagination,
  TrendReport,
  Totals,
  Transaction,
} from '../types/index.ts';

export type TransactionInput = {
  categoryId: number | null;
  type: 'income' | 'expense';
  amountKurus: number;
  date: string;
  description: string | null;
};

export type TransactionQuery = {
  from?: string;
  to?: string;
  categoryId?: number;
  kind?: 'income' | 'expense';
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

export const categoryService = {
  list: (includeArchived = false) =>
    api
      .get<{ categories: Category[] }>(
        `/api/categories${includeArchived ? '?includeArchived=true' : ''}`,
      )
      .then((r) => r.categories),
  create: (input: { name: string; kind: Category['kind']; nature: Category['nature'] }) =>
    api.post<{ category: Category }>('/api/categories', input).then((r) => r.category),
  update: (id: number, input: { name: string; archived: boolean; nature?: Category['nature'] }) =>
    api.patch<{ category: Category }>(`/api/categories/${id}`, input).then((r) => r.category),
  /** Kullanimda olan kategori silinmez, arsivlenir; hangisi oldugu yanitla doner. */
  remove: (id: number) =>
    api.delete<{ action: 'deleted' | 'archived'; usageCount: number }>(`/api/categories/${id}`),
};

export const budgetService = {
  list: (month: string) => api.get<BudgetListResponse>(`/api/budgets?month=${month}`),
  /** categoryId null ise genel aylik limit olusturulur. */
  create: (input: { categoryId: number | null; yearMonth: string; limitKurus: number }) =>
    api.post<{ budget: Budget }>('/api/budgets', input),
  update: (id: number, limitKurus: number) =>
    api.patch<{ budget: Budget }>(`/api/budgets/${id}`, { limitKurus }),
  remove: (id: number) => api.delete<{ deleted: boolean }>(`/api/budgets/${id}`),
  overview: (month: string) => api.get<MonthOverview>(`/api/budgets/overview?month=${month}`),
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
  remove: (id: number) =>
    api.delete<{ deleted: boolean; removedRows: number }>(`/api/transactions/${id}`),

  /** Secilenleri topluca siler. */
  bulkDelete: (ids: number[]) =>
    api.post<{ removedRows: number }>('/api/transactions/bulk-delete', { ids }),
};

export const reportService = {
  monthly: (month: string) => api.get<MonthlyReport>(`/api/reports/monthly?month=${month}`),
  categories: (from: string, to: string, kind: 'income' | 'expense' = 'expense') =>
    api.get<CategoryReport>(`/api/reports/categories?from=${from}&to=${to}&kind=${kind}`),
  trend: (to: string, months = 12) =>
    api.get<TrendReport>(`/api/reports/trend?to=${to}&months=${months}`),
  forecast: (basis: 3 | 6 | 12, cutKurus = 0) =>
    api.get<ForecastReport>(`/api/reports/forecast?basis=${basis}&cut=${cutKurus}`),
};

export const dashboardService = {
  summary: (month?: string) =>
    api.get<DashboardSummary>(`/api/dashboard/summary${month ? `?month=${month}` : ''}`),
};
