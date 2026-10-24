import { api } from './api.ts';
import type { SavingsContribution, SavingsGoal, SavingsOverview } from '../types/index.ts';

export type GoalInput = {
  name: string;
  targetKurus: number;
  targetDate: string | null;
  monthlyPlanKurus: number | null;
  isEmergencyFund: boolean;
  note: string | null;
};

type GoalResponse = { goal: SavingsGoal; contributions: SavingsContribution[] };

export const savingsService = {
  overview: (includeClosed = false) =>
    api.get<SavingsOverview>(`/api/savings${includeClosed ? '?includeClosed=true' : ''}`),
  detail: (id: number) => api.get<GoalResponse>(`/api/savings/${id}`),
  create: (input: GoalInput) => api.post<GoalResponse>('/api/savings', input),
  update: (id: number, input: GoalInput & { closed: boolean }) =>
    api.patch<GoalResponse>(`/api/savings/${id}`, input),
  remove: (id: number) => api.delete<{ deleted: boolean }>(`/api/savings/${id}`),
  /** Eksi tutar hedeften cekistir. */
  contribute: (id: number, input: { date: string; amountKurus: number; note: string | null }) =>
    api.post<GoalResponse>(`/api/savings/${id}/contributions`, input),
  removeContribution: (id: number, contributionId: number) =>
    api.delete<GoalResponse>(`/api/savings/${id}/contributions/${contributionId}`),
};
