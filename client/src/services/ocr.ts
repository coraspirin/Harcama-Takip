import { ApiError, api } from './api.ts';

export type OcrImport = {
  id: number;
  accountId: number;
  accountName: string;
  filename: string;
  parserId: string;
  extraction: 'text' | 'ocr';
  pageCount: number;
  status: 'draft' | 'applied' | 'discarded';
  lineCount: number;
  duplicateCount: number;
  excludedCount: number;
  balanceCheck: BalanceCheck | null;
  balanceGapCount: number;
  balanceGapKurus: number;
  createdAt: string;
  appliedAt: string | null;
};

export type BalanceCheck = 'ok' | 'gaps' | 'unavailable';

export type OcrDraftLine = {
  id: number;
  lineNo: number;
  date: string;
  description: string;
  amountKurus: number;
  type: 'income' | 'expense';
  categoryId: number | null;
  label: string | null;
  balanceKurus: number | null;
  chainBreak: boolean;
  isDuplicate: boolean;
  excluded: boolean;
  raw: string | null;
};

export type UploadResult = {
  importId: number;
  parserId: string;
  parserName: string;
  extraction: 'text' | 'ocr';
  pageCount: number;
  lineCount: number;
  skippedByDateCount: number;
  duplicateCount: number;
  balanceCheck: BalanceCheck;
  balanceGapCount: number;
  balanceGapKurus: number;
  statementBalanceKurus: number | null;
  unmappedLabels: string[];
};

export type LabelMapping = {
  parserId: string;
  label: string;
  categoryId: number | null;
};

export const ocrService = {
  parsers: () =>
    api.get<{ parsers: { id: string; name: string }[] }>('/api/ocr/parsers').then((r) => r.parsers),

  imports: () => api.get<{ imports: OcrImport[] }>('/api/ocr/imports').then((r) => r.imports),

  detail: (id: number) =>
    api.get<{ import: OcrImport; lines: OcrDraftLine[] }>(`/api/ocr/imports/${id}`),

  /**
   * Dosya yukleme fetch ile dogrudan yapilir: api.send JSON govde varsayar,
   * multipart'ta Content-Type sinirini tarayicinin kendisi yazmalidir.
   */
  upload: async (
    file: File,
    accountId: number,
    parserId?: string,
    fromDate?: string,
  ): Promise<UploadResult> => {
    const form = new FormData();
    form.set('file', file);
    form.set('accountId', String(accountId));
    if (parserId) form.set('parserId', parserId);
    if (fromDate) form.set('fromDate', fromDate);

    const res = await fetch('/api/ocr/upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });

    if (!res.ok) {
      let message = 'Ekstre yuklenemedi';
      let code = 'UNKNOWN';
      try {
        const body = (await res.json()) as { error?: { message?: string; code?: string } };
        message = body.error?.message ?? message;
        code = body.error?.code ?? code;
      } catch {
        /* JSON degilse varsayilan mesaj kalir */
      }
      throw new ApiError(res.status, code, message);
    }

    const body = (await res.json()) as { result: UploadResult };
    return body.result;
  },

  updateLine: (
    id: number,
    input: {
      date: string;
      description: string;
      amountKurus: number;
      type: 'income' | 'expense';
      categoryId: number | null;
      excluded: boolean;
    },
  ) => api.patch<{ line: OcrDraftLine }>(`/api/ocr/lines/${id}`, input),

  apply: (id: number) =>
    api.post<{ result: { created: number; skipped: number } }>(`/api/ocr/imports/${id}/apply`),

  remove: (id: number) =>
    api.delete<{ deleted: boolean; discarded?: boolean }>(`/api/ocr/imports/${id}`),

  /** Secili satirlara toplu islem; 600 satirda tek tek PATCH pratik degil. */
  bulk: (
    importId: number,
    ids: number[],
    action: 'exclude' | 'include' | 'setCategory',
    categoryId: number | null = null,
  ) =>
    api.post<{ updated: number }>(`/api/ocr/imports/${importId}/bulk`, {
      ids,
      action,
      categoryId,
    }),

  labelMap: () =>
    api.get<{ mappings: LabelMapping[] }>('/api/ocr/label-map').then((r) => r.mappings),

  saveLabelMap: (parserId: string, label: string, categoryId: number | null) =>
    api.put<{ saved: boolean }>('/api/ocr/label-map', { parserId, label, categoryId }),
};
