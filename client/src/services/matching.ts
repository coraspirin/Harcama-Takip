import { api } from './api.ts';

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
  recurrences: () =>
    api
      .get<{ suggestions: RecurrenceSuggestion[] }>('/api/matching/recurrences')
      .then((r) => r.suggestions),

  rejectRecurrence: (signature: string) =>
    api.post<{ rejected: boolean }>('/api/matching/recurrences/reject', { signature }),
};
