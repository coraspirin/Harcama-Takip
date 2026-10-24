import { api } from './api.ts';

export type RecurrenceSuggestion = {
  signature: string;
  /** subscription: her ay ayni tutar · bill: tutar degisken · installment: taksit */
  kind: 'installment' | 'bill' | 'subscription';
  name: string;
  occurrences: number;
  amountKurus: number;
  amountVaries: boolean;
  firstDate: string;
  lastDate: string;
  averageIntervalDays: number;
  categoryId: number | null;
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
