import { api } from './api.ts';
import type {
  Debt,
  DebtDetail,
  DebtDirection,
  DebtKind,
  DebtListResponse,
  DebtPlan,
} from '../types/index.ts';

export type DebtInput = {
  kind: DebtKind;
  direction: DebtDirection;
  name: string;
  counterparty: string | null;
  monthlyInterestBp: number;
  taxesIncluded: boolean;
  monthlyPaymentKurus: number | null;
  note: string | null;
};

export const debtService = {
  list: (includeClosed = false) =>
    api.get<DebtListResponse>(`/api/debts${includeClosed ? '?includeClosed=true' : ''}`),
  detail: (id: number, extraKurus = 0) =>
    api.get<DebtDetail>(`/api/debts/${id}?extra=${extraKurus}`),
  plan: (extraKurus: number) => api.get<DebtPlan>(`/api/debts/plan?extra=${extraKurus}`),
  create: (
    input: DebtInput & { balanceKurus: number; originalKurus: number | null; balanceDate?: string },
  ) => api.post<{ debt: Debt }>('/api/debts', input).then((r) => r.debt),
  update: (id: number, input: DebtInput & { originalKurus: number; closed: boolean }) =>
    api.patch<{ debt: Debt }>(`/api/debts/${id}`, input).then((r) => r.debt),
  setBalance: (id: number, balanceKurus: number, date: string) =>
    api.post<{ debt: Debt }>(`/api/debts/${id}/balance`, { balanceKurus, date }),
  remove: (id: number) => api.delete<{ deleted: boolean }>(`/api/debts/${id}`),
  addPayment: (id: number, input: { date: string; amountKurus: number; note: string | null }) =>
    api.post<{ debt: Debt; affectsBalance: boolean }>(`/api/debts/${id}/payments`, input),
  removePayment: (id: number, paymentId: number) =>
    api.delete<{ debt: Debt | null }>(`/api/debts/${id}/payments/${paymentId}`),
};
