import { api } from './api.ts';

export type TransferCandidate = {
  expenseId: number;
  incomeId: number;
  amountKurus: number;
  expenseAccountId: number;
  expenseAccountName: string;
  expenseDate: string;
  expenseDescription: string;
  incomeAccountId: number;
  incomeAccountName: string;
  incomeDate: string;
  incomeDescription: string;
  dayDifference: number;
  certain: boolean;
  reason: string | null;
};

export type MatchedTransfer = {
  transferGroupId: string;
  amountKurus: number;
  date: string;
  description: string | null;
  fromAccountName: string;
  toAccountName: string | null;
  matched: 'auto' | 'confirmed';
};

export type MatchSettings = {
  dayWindow: number;
  autoLink: boolean;
  selfAliases: string;
};

export type RecurrenceSuggestion = {
  signature: string;
  kind: 'installment' | 'bill' | 'planned';
  name: string;
  occurrences: number;
  amountKurus: number;
  amountVaries: boolean;
  firstDate: string;
  lastDate: string;
  averageIntervalDays: number;
  categoryId: number | null;
  accountId: number;
  installmentSeq: number | null;
  installmentTotal: number | null;
};

export const matchingService = {
  candidates: () =>
    api.get<{ candidates: TransferCandidate[]; matched: MatchedTransfer[] }>(
      '/api/matching/transfer-candidates',
    ),

  scan: () =>
    api.post<{ result: { linked: number; pending: number } }>('/api/matching/scan'),

  link: (expenseId: number, incomeId: number) =>
    api.post<{ transferGroupId: string }>('/api/matching/link', { expenseId, incomeId }),

  reject: (expenseId: number, incomeId: number) =>
    api.post<{ rejected: boolean }>('/api/matching/reject', { expenseId, incomeId }),

  unlink: (transferGroupId: string) =>
    api.post<{ restored: number }>('/api/matching/unlink', { transferGroupId }),

  settings: () =>
    api.get<{ settings: MatchSettings }>('/api/matching/settings').then((r) => r.settings),

  saveSettings: (settings: MatchSettings) =>
    api.put<{ saved: boolean }>('/api/matching/settings', settings),

  recurrences: () =>
    api
      .get<{ suggestions: RecurrenceSuggestion[] }>('/api/matching/recurrences')
      .then((r) => r.suggestions),

  rejectRecurrence: (signature: string) =>
    api.post<{ rejected: boolean }>('/api/matching/recurrences/reject', { signature }),
};
