import { api } from './api.ts';
import type {
  BillPeriod,
  Notification,
  Occurrence,
  ScheduledItem,
  ScheduledKind,
  ScheduledSummary,
} from '../types/index.ts';

export type ScheduledInput = {
  kind: ScheduledKind;
  name: string;
  direction: 'income' | 'expense';
  categoryId: number | null;
  counterparty: string | null;
  description: string | null;
  startDate: string;
  amountKurus?: number | null;
  totalAmountKurus?: number | null;
  installmentCount?: number | null;
  period?: BillPeriod | null;
  /** Yalnizca faturada: sabit tutarli abonelik */
  isSubscription?: boolean;
  /** Yalnizca faturada: vadeler bu aya kadar (dahil) uretilir */
  endMonth?: string | null;
};

export const scheduledService = {
  list: (kind?: ScheduledKind) =>
    api
      .get<{ items: ScheduledItem[] }>(`/api/scheduled${kind ? `?kind=${kind}` : ''}`)
      .then((r) => r.items),

  summary: (month?: string) =>
    api.get<ScheduledSummary>(`/api/scheduled/summary${month ? `?month=${month}` : ''}`),

  upcoming: (days = 30) =>
    api.get<{ today: string; occurrences: Occurrence[]; overdueCount: number }>(
      `/api/scheduled/upcoming?days=${days}`,
    ),

  occurrences: (itemId: number) =>
    api
      .get<{ occurrences: Occurrence[] }>(`/api/scheduled/${itemId}/occurrences`)
      .then((r) => r.occurrences),

  create: (input: ScheduledInput) =>
    api.post<{ item: ScheduledItem }>('/api/scheduled', input).then((r) => r.item),

  update: (
    id: number,
    input: {
      name: string;
      categoryId: number | null;
      counterparty: string | null;
      description: string | null;
      active: boolean;
    },
  ) => api.patch<{ item: ScheduledItem }>(`/api/scheduled/${id}`, input).then((r) => r.item),

  remove: (id: number) =>
    api.delete<{ deleted: boolean; keptTransactions: number }>(`/api/scheduled/${id}`),
};

export const occurrenceService = {
  confirm: (id: number, input: { amountKurus?: number; date?: string } = {}) =>
    api.post<{ occurrence: Occurrence }>(`/api/occurrences/${id}/confirm`, input),

  unconfirm: (id: number) =>
    api.post<{ occurrence: Occurrence }>(`/api/occurrences/${id}/unconfirm`),

  update: (id: number, input: { amountKurus: number | null; dueDate: string }) =>
    api.patch<{ occurrence: Occurrence }>(`/api/occurrences/${id}`, input),
};

export const notificationService = {
  list: () => api.get<{ notifications: Notification[]; unreadCount: number }>('/api/notifications'),
  markRead: (id: number) =>
    api.post<{ unreadCount: number }>(`/api/notifications/${id}/read`),
  markAllRead: () => api.post<{ marked: number; unreadCount: number }>('/api/notifications/read-all'),
  remove: (id: number) => api.delete<{ unreadCount: number }>(`/api/notifications/${id}`),
};
